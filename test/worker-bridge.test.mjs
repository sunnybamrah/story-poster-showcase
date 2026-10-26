import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWorkerBridge } from '../server/worker-bridge.js';
import { createSubscriptionTransport } from '../server/subscription-transport.js';
import { executeWorkerRequest, createWorkerOutbox } from '../server/generation-worker.mjs';

const secret = 'test-worker-secret-at-least-thirty-two-characters', workerId = 'fixture-worker';
const auth = `Bearer ${secret}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(t) {
  const resultDirectory = mkdtempSync(join(tmpdir(), 'worker-results-test-')); t.after(() => rmSync(resultDirectory, { recursive: true, force: true }));
  const db = { workerRequests: [] }, saved = [], bridge = createWorkerBridge({ db, persist() { saved.push(structuredClone(db)); }, secret, resultDirectory }); t.after(() => bridge.close());
  const action = (path, data = {}) => bridge.handle(`/api/worker/${path}`, { workerId, ...data }, auth);
  return { db, saved, bridge, action, resultDirectory };
}

test('fixed worker protocol holds inputs only in memory, accepts one claimed completion and never reruns it', async t => {
  const h = harness(t); await h.action('poll');
  const promise = h.bridge.run({ requestId: randomUUID(), prompt: 'PRIVATE INPUT', images: [Buffer.from('PRIVATE IMAGE')], model: 'gpt-6-astra', effort: 'medium' }); await tick();
  assert.ok(!JSON.stringify(h.saved).includes('PRIVATE')); assert.equal(h.db.workerRequests[0].status, 'waiting');
  const { job } = await h.action('poll'); assert.equal(job.prompt, 'PRIVATE INPUT'); assert.equal(Buffer.from(job.images[0], 'base64').toString(), 'PRIVATE IMAGE');
  assert.equal((await h.action('poll')).job, null);
  await assert.rejects(() => h.action('complete', { requestId: job.id, claimToken: 'incorrect', result: { text: '{}' } }), /matching claim/);
  const complete = { requestId: job.id, claimToken: job.claimToken, result: { text: '{"story":"finished"}', usage: { input_tokens: 3 } } };
  await h.action('complete', complete); assert.equal((await promise).text, complete.result.text);
  assert.equal((await h.action('complete', complete)).alreadyReceived, true);
  await assert.rejects(() => h.bridge.run({ requestId: job.id, prompt: 'same' }), /not be run twice/);
  assert.ok(!JSON.stringify(h.saved).includes('\"story\":\"finished\"'));
});

test('worker authentication, lost claims and offline starts cannot execute new requests', async t => {
  const h = harness(t);
  await assert.rejects(() => h.bridge.run({ prompt: 'text' }), /offline/);
  await assert.rejects(() => h.bridge.handle('/api/worker/poll', { workerId }, 'Bearer wrong'), /access denied/);
  await h.action('poll');
  const promise = h.bridge.run({ prompt: 'private', model: 'gpt-6-astra', effort: 'medium' }); promise.catch(() => {}); await tick(); const { job } = await h.action('poll');
  h.bridge.close(); await assert.rejects(() => promise, /restarted/);
  const restored = createWorkerBridge({ db: h.db, persist() {}, secret, resultDirectory: h.resultDirectory }); t.after(() => restored.close());
  assert.equal(h.db.workerRequests[0].status, 'interrupted');
  assert.equal((await restored.handle('/api/worker/complete', { workerId, requestId: job.id, claimToken: job.claimToken, result: { text: '{}' } }, auth)).ok, true);
  assert.equal(h.db.workerRequests[0].status, 'complete');
});

test('the subscription adapter leaves remote photo payloads in RAM and retains real call receipts', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'remote-subscription-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const h = harness(t); await h.action('poll');
  const transport = createSubscriptionTransport({ logFile: join(directory, 'requests.jsonl'), run: h.bridge.run });
  const promise = transport.call({ path: '/v1/responses', stage: 'portrait-check', body: { input: 'data:image/png;base64,' + Buffer.from('PRIVATE PHOTO').toString('base64') } }); await tick();
  assert.deepEqual(readdirSync(directory), ['requests.jsonl']);
  assert.ok(!readFileSync(join(directory, 'requests.jsonl'), 'utf8').includes('PRIVATE PHOTO'));
  const { job } = await h.action('poll'); assert.equal(job.model, 'gpt-6.1-sol');
  await h.action('complete', { requestId: job.id, claimToken: job.claimToken, result: { text: '{}' } });
  const response = await promise; assert.equal(transport.wireCount(), 1); assert.equal(transport.responseDetails(response).id, job.id);
});

test('local worker uses only fixed executable options and removes references even when model work fails', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'worker-cli-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const job = { id: randomUUID(), kind: 'image', model: 'gpt-6-astra', effort: 'high', prompt: 'Save to __STORY_POSTER_OUTPUT__', images: [Buffer.from('private reference').toString('base64')], directory: '/ignored-cloud-path', executable: '/ignored-cloud-command' };
  const result = await executeWorkerRequest(job, { temporaryRoot: directory, run: async options => { assert.ok(options.directory.startsWith(directory)); assert.ok(!options.prompt.includes('__STORY_POSTER_OUTPUT__')); assert.equal(readFileSync(options.images[0], 'utf8'), 'private reference'); assert.equal(options.executable, undefined); return { bytes: Buffer.from('image') }; } });
  assert.equal(result.image, Buffer.from('image').toString('base64')); assert.deepEqual(readdirSync(directory), []);
  await assert.rejects(() => executeWorkerRequest({ ...job, model: 'arbitrary' }, { temporaryRoot: directory }), /Invalid/);
  await assert.rejects(() => executeWorkerRequest(job, { temporaryRoot: directory, run: async () => { throw Error('provider failed'); } }), /provider failed/); assert.deepEqual(readdirSync(directory), []);
});


test('a replacement worker polling cannot keep a lost claim alive', async t => {
  let now = 100000; const resultDirectory = mkdtempSync(join(tmpdir(), 'worker-liveness-test-')); t.after(() => rmSync(resultDirectory, { recursive: true, force: true })); const db = {}, bridge = createWorkerBridge({ db, persist() {}, secret, resultDirectory, now: () => now }); t.after(() => bridge.close());
  await bridge.handle('/api/worker/poll', { workerId }, auth);
  const promise = bridge.run({ prompt: 'private', model: 'gpt-6-astra', effort: 'medium' }); promise.catch(() => {}); await tick();
  const { job } = await bridge.handle('/api/worker/poll', { workerId }, auth);
  now += 50000; await bridge.handle('/api/worker/poll', { workerId: 'new-worker-id' }, auth);
  now += 41000; bridge.expireLostClaims(); await assert.rejects(() => promise, /disconnected/);
  await assert.rejects(() => bridge.handle('/api/worker/complete', { workerId, requestId: job.id, claimToken: job.claimToken, result: { text: '{}' } }, auth), /already connected|interrupted/);
});

test('generated results survive server restart and reuse the exact logical request without another call', async t => {
  const h = harness(t); await h.action('poll');
  const requestKey = 'stable-private-job-stage-hash';
  const promise = h.bridge.run({ requestId: randomUUID(), requestKey, prompt: 'private note', model: 'gpt-6-astra', effort: 'high' }); await tick();
  const { job } = await h.action('poll'); await h.action('complete', { requestId: job.id, claimToken: job.claimToken, result: { text: '{"saved":true}' } }); await promise;
  h.bridge.close();
  const restarted = createWorkerBridge({ db: structuredClone(h.db), persist() {}, secret, resultDirectory: h.resultDirectory }); t.after(() => restarted.close());
  assert.equal(restarted.run.lookup(requestKey).text, '{"saved":true}');
  const replay = await restarted.run({ requestKey, prompt: 'same', model: 'gpt-6-astra', effort: 'high' }); assert.equal(replay.text, '{"saved":true}'); assert.equal(h.db.workerRequests.length, 1);
});

test('offline preflight consumes no request allowance and a revoked queued request never reaches the worker', async t => {
  const h = harness(t), directory = mkdtempSync(join(tmpdir(), 'offline-allowance-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const transport = createSubscriptionTransport({ logFile: join(directory, 'requests.jsonl'), run: h.bridge.run });
  await assert.rejects(() => transport.call({ path: '/v1/responses', stage: 'story', body: { input: 'fictional' } }), error => error.preflight === true);
  assert.equal(transport.wireCount(), 0); assert.deepEqual(readdirSync(directory), []);
  await h.action('poll'); let allowed = true;
  const pending = h.bridge.run({ prompt: 'private', model: 'gpt-6-astra', effort: 'high', assertAllowed: () => { if (!allowed) throw Error('revoked'); } }); pending.catch(() => {}); await tick(); allowed = false;
  assert.equal((await h.action('poll')).job, null); await assert.rejects(() => pending, /turned off/);
});

test('worker outbox survives restart and retains acknowledged and orphaned generated evidence', t => {
  const directory = mkdtempSync(join(tmpdir(), 'worker-outbox-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = createWorkerOutbox(directory), requestId = randomUUID(); first.save({ requestId, claimToken: 'request-only', result: { text: 'Generated words.' }, prompt: 'SHOULD NOT BE SAVED', images: ['SOURCE PHOTO'] });
  const next = createWorkerOutbox(directory); assert.equal(next.workerId, first.workerId); assert.equal(next.pending().length, 1);
  const source = readFileSync(join(directory, `request-${requestId}.json`), 'utf8'); assert.ok(!source.includes('SOURCE PHOTO')); assert.ok(!source.includes('SHOULD NOT'));
  next.mark(requestId, 'acknowledged'); assert.equal(next.pending().length, 0); assert.ok(readFileSync(join(directory, `request-${requestId}.json`), 'utf8').includes('Generated words.'));
});

test('transport identity ignores retry counters but permits an explicitly rejected new attempt', async t => {
  const h = harness(t), directory = mkdtempSync(join(tmpdir(), 'retry-identity-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  await h.action('poll');
  const options = { logFile: join(directory, 'requests.jsonl'), run: h.bridge.run };
  const input = { path: '/v1/responses', stage: 'library-topic', kit: 'same-job', body: { input: 'same general topic' }, retry: 0 };
  const first = createSubscriptionTransport(options), pending = first.call(input); await tick(); const { job } = await h.action('poll');
  await h.action('complete', { requestId: job.id, claimToken: job.claimToken, result: { text: '{"topic":"original"}' } }); await pending;
  const resumed = createSubscriptionTransport(options); assert.equal(resumed.hasRecovery({ ...input, retry: 1 }), true);
  const reused = await resumed.call({ ...input, retry: 1 }); assert.equal(resumed.responseDetails(reused).reused, true); assert.equal(resumed.wireCount(), 1); assert.equal(h.db.workerRequests.length, 1);
  resumed.recordRejection(reused, 'Actual source validation rejected this answer.'); assert.equal(resumed.hasRecovery({ ...input, retry: 2 }), false);
  const replacement = resumed.call({ ...input, retry: 2 }); await tick(); const { job: second } = await h.action('poll'); assert.notEqual(second.id, job.id);
  await h.action('complete', { requestId: second.id, claimToken: second.claimToken, result: { text: '{"topic":"replacement"}' } }); await replacement; assert.equal(resumed.wireCount(), 2);
});

test('revocation during claim durability wait never returns executable work', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'claim-revoke-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  let allowed = true, flushes = 0;
  const bridge = createWorkerBridge({ db: {}, persist() {}, secret, resultDirectory: directory, flush: async () => { if (++flushes === 2) allowed = false; } }); t.after(() => bridge.close());
  await bridge.handle('/api/worker/poll', { workerId }, auth);
  const pending = bridge.run({ prompt: 'private', model: 'gpt-6-astra', effort: 'high', assertAllowed: () => { if (!allowed) throw Error('revoked'); } }); pending.catch(() => {}); await tick();
  const reply = await bridge.handle('/api/worker/poll', { workerId }, auth); assert.equal(reply.job, null); await assert.rejects(() => pending, /turned off/);
});

test('worker deletion instructions remove only that family or work from generated outbox evidence', t => {
  const directory = mkdtempSync(join(tmpdir(), 'outbox-delete-test-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const outbox = createWorkerOutbox(directory), rows = [{ accountId: 'family-one', workId: 'job-one' }, { accountId: 'family-one', workId: 'job-two' }, { accountId: 'family-two', workId: 'job-three' }];
  for (const owner of rows) outbox.save({ requestId: randomUUID(), claimToken: 'one-request', owner, result: { text: 'private generated words' } });
  outbox.deleteAccount('family-one', 'job-one'); assert.equal(outbox.pending().length, 2);
  outbox.deleteAccount('family-one'); assert.equal(outbox.pending().length, 1); assert.equal(outbox.pending()[0].owner.accountId, 'family-two');
});
