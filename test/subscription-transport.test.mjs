import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSubscriptionTransport } from '../server/subscription-transport.js';
import { createApp } from '../server/app-server.mjs';
import { subscriptionDataPolicyVersion, hostedSubscriptionDataPolicyVersion, hostedSubscriptionDataPolicyNotice } from '../app/data-policy.js';
import { family } from './fixture.mjs';
import { parentJobFailure } from '../server/job-failure.js';

const temporary = t => { const path = mkdtempSync(join(tmpdir(), 'story-subscription-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; };
const consent = { accepted: true, version: subscriptionDataPolicyVersion, acceptedAt: new Date().toISOString() };

test('hosted subscription consent names server storage and cannot reuse an older local acceptance', async t => {
  const logFile = join(temporary(t), 'requests.jsonl'); let calls = 0;
  const transport = createSubscriptionTransport({ logFile, config: { standardDataPolicyAllowed: true, dataPolicyVersion: hostedSubscriptionDataPolicyVersion }, run: async () => { calls++; return { text: '{"ok":true}' }; } });
  const request = { path: '/v1/responses', stage: 'story', body: { input: [] }, familyRecord: { real: true, hero: { age: 8 }, dataPolicyConsent: consent } };
  await assert.rejects(transport.call(request), /permission|notice|consent/i);
  assert.equal(calls, 0);
  await transport.call({ ...request, familyRecord: { ...request.familyRecord, dataPolicyConsent: { ...consent, version: hostedSubscriptionDataPolicyVersion } } });
  assert.equal(calls, 1);
  assert.match(hostedSubscriptionDataPolicyNotice, /saved privately on the app’s server/);
  assert.doesNotMatch(hostedSubscriptionDataPolicyNotice, /This local app/);
});

test('subscription text returns the existing answer shape and records no API charge', async t => {
  const path = temporary(t); let work, sentPrompt;
  const transport = createSubscriptionTransport({ logFile: join(path, 'requests.jsonl'), run: async options => { work = options.directory; sentPrompt = options.prompt; return { text: '{"freshStory":true}', usage: { input_tokens: 10, output_tokens: 5 } }; }, keys: new Proxy({}, { get() { throw Error('API key was read'); } }) });
  const response = await transport.call({ path: '/v1/responses', body: { instructions: 'Use the saved teaching.', input: [{ role: 'user', content: 'Today was hard.' }], text: { format: { schema: { type: 'object' } } } }, stage: 'story', familyRecord: { real: false } });
  assert.equal(response.output[0].content[0].text, '{"freshStory":true}');
  assert.equal(transport.responseDetails(response).cost.usd, 0);
  assert.equal(existsSync(work), false);
  const request = JSON.parse(readFileSync(join(path, 'requests.jsonl'), 'utf8').split('\n')[0]);
  assert.equal(request.prompt, sentPrompt);
  assert.equal(request.body.input[0].content, 'Today was hard.');
  assert.match(readFileSync(join(path, 'requests.jsonl'), 'utf8'), /codex-subscription/);
});

test('photo references are private temporary inputs and are removed on success and failure', async t => {
  const path = temporary(t), bytes = readFileSync(new URL('./fixtures/offline-art.png', import.meta.url));
  for (const fails of [false, true]) {
    let reference;
    const transport = createSubscriptionTransport({ logFile: join(path, `request-${fails}.jsonl`), run: async options => {
      reference = options.images[0]; assert.deepEqual(readFileSync(reference), bytes);
      assert.doesNotMatch(options.prompt, /data:image|base64/);
      if (fails) throw Error('measured failure');
      return { bytes, usage: { output_tokens: 1 } };
    } });
    const call = transport.call({ path: '/v1/images/edits', stage: 'portrait-render', familyRecord: { real: false }, body: { image: `data:image/png;base64,${bytes.toString('base64')}`, prompt: 'Draw this fictional person.', size: '1024x1536' } });
    if (fails) await assert.rejects(call, /measured failure/); else assert.equal((await call).data.length, 1);
    assert.equal(existsSync(reference), false);
    assert.doesNotMatch(readFileSync(join(path, `request-${fails}.jsonl`), 'utf8'), /base64|Draw this fictional person/);
  }
});

test('parent permission is rechecked and a finite request allowance still applies', async t => {
  const path = temporary(t); let record = { real: true, hero: { age: 8 }, dataPolicyConsent: consent }, calls = 0;
  const transport = createSubscriptionTransport({ logFile: join(path, 'requests.jsonl'), maxCalls: 1, familyRecordFor: () => record, run: async () => { calls++; return { text: '{}' }; } });
  const request = { path: '/v1/responses', stage: 'story', body: { input: [] } };
  await transport.call(request); await assert.rejects(transport.call(request), /allowance/); assert.equal(calls, 1);
  record = { ...record, dataPolicyConsent: { ...consent, revokedAt: new Date().toISOString() } };
  const revoked = createSubscriptionTransport({ familyRecordFor: () => record, run: async () => { throw Error('must not run'); } });
  await assert.rejects(revoked.call(request), /permission/);
});

for (const kind of ['kit', 'portraits', 'library-jobs']) test(`the ${kind} request allowance survives failure and Resume`, async t => {
  const path = temporary(t), logFile = join(path, kind, 'requests.jsonl'); let sent = 0;
  const options = { logFile, maxCalls: 2, run: async () => { sent++; throw Error('Synthetic connection stopped after send'); } };
  const request = { path: '/v1/responses', stage: 'story', body: { input: [] }, familyRecord: { real: false } };
  for (let attempt = 0; attempt < 2; attempt++) await assert.rejects(createSubscriptionTransport(options).call(request), /Synthetic connection/);
  const before = readFileSync(logFile, 'utf8');
  for (let attempt = 0; attempt < 3; attempt++) {
    const resumed = createSubscriptionTransport(options);
    assert.equal(resumed.wireCount(), 2);
    await assert.rejects(resumed.call(request), error => {
      assert.match(error.message, /request allowance/);
      const view = parentJobFailure(error, 'story');
      assert.equal(view.canResume, false); assert.equal(view.kind, 'limit');
      assert.match(view.message, /saved work is safe/);
      return true;
    });
  }
  assert.equal(sent, 2); assert.equal(readFileSync(logFile, 'utf8'), before);
});

test('the subscription app starts an automatic story without reading any API key', async t => {
  const path = temporary(t); let keyReads = 0, started = 0, selected;
  const app = createApp({ generationRoute: 'subscription', dataDirectory: path, sample: null, keyReader: () => { keyReads++; throw Error('API key must not be read'); }, runKit: async (transport, memory, note, options) => { started++; selected = options.chosenMoveId; throw Error('Offline test stop after entry'); } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const signup = await fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'offlinefamily', password: 'offlinepass', family: { real: true, nickname: 'Pip', age: 8, pronouns: 'he/him', loves: ['books','stars','music'], presetId: 'comet', familyContext: '', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }], dataPolicyConsent: consent } }) });
  assert.equal(signup.status, 200); const cookie = signup.headers.get('set-cookie').split(';')[0];
  // Existing picture prerequisite still applies to real families. This test
  // switches only its offline fixture to made-up people through normal setup.
  const madeUp = await fetch(base + '/api/family', { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ family: { real: false, nickname: 'Pip', age: 8, pronouns: 'he/him', loves: ['books','stars','music'], presetId: 'comet', familyContext: '', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] } }) });
  assert.equal(madeUp.status, 200);
  const response = await fetch(base + '/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ tonight: 'The reading was hard and he came home in tears.', allowRepeat: true }) });
  assert.equal(response.status, 202); await response.json();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(started, 1); assert.equal(selected, undefined); assert.equal(keyReads, 0);
});

for (const inputMode of ['description', 'photo']) test(`a real-family ${inputMode} route uses the accepted ChatGPT-plan notice, without an API key`, async t => {
  const path = temporary(t); let keyReads = 0, entered = 0;
  const app = createApp({ generationRoute: 'subscription', dataDirectory: path, sample: null,
    keyReader: () => { keyReads++; throw Error('API key must not be read'); },
    transportFactory: options => createSubscriptionTransport({ ...options, run: async () => { entered++; throw Error('Offline stop after the permitted worker entry'); } }) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const signup = await fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'realfamilyfixture', password: 'offlinepass', family: { real: true, nickname: 'Pip', age: 8, pronouns: 'he/him', loves: [], presetId: 'comet', familyContext: '', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }], dataPolicyConsent: consent } }) });
  assert.equal(signup.status, 200); const cookie = signup.headers.get('set-cookie').split(';')[0];
  const session = await signup.json();
  const bytes = readFileSync(new URL('./fixtures/offline-art.png', import.meta.url));
  const input = inputMode === 'photo' ? { photo: { mime: 'image/png', base64: bytes.toString('base64') } } : { description: 'A child with short dark hair and a round face.' };
  const response = await fetch(base + '/api/portraits/child', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ childId: session.childId, inputMode, ...input }) });
  assert.equal(response.status, 202, await response.text());
  for (let wait = 0; !entered && wait < 20; wait++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(entered, 1, 'the synthetic worker ran after consent; no cloud call was made');
  assert.equal(keyReads, 0);
});
