import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeOwnerAlert, validateOwnerAlert, ownerNotifierPath } from '../server/owner-alert-worker.js';
import { createWorkerBridge } from '../server/worker-bridge.js';

const fixture = () => ({ id: randomUUID(), requestId: randomUUID(), kind: 'owner-access-alert', email: 'adult@example.test', adultName: 'Ari', claimToken: 'a'.repeat(64) });
const temp = t => { const p = mkdtempSync(join(tmpdir(), 'owner-alert-fixture-')); t.after(() => rmSync(p, { recursive: true, force: true })); return p; };

test('owner alerts execute only the fixed notifier with argument boundaries and a non-approving configured link', async t => {
  const alert = fixture(), directory = temp(t); let calls = 0;
  const execute = async (binary, args, options) => { calls++; assert.equal(binary, ownerNotifierPath); assert.equal(args.length, 2); assert.equal(options.shell, undefined); assert.equal(args[0], `Story Poster access request ${alert.requestId}`); assert.match(args[1], /https:\/\/example.test\/#owner/); assert.doesNotMatch(args[1], /decision|claimToken|approve=/); return { stdout: `delivered: ${args[0]}\n` }; };
  const result = await executeOwnerAlert(alert, { directory, origin: 'https://example.test', execute }); assert.equal(result.delivered, true);
  const replay = await executeOwnerAlert({ ...alert, claimToken: 'b'.repeat(64) }, { directory, origin: 'https://example.test', execute }); assert.deepEqual(replay, result); assert.equal(calls, 1);
  await assert.rejects(() => executeOwnerAlert({ ...alert, email: 'changed@example.test' }, { directory, origin: 'https://example.test', execute }), /changed/);
});

test('exit zero held-back, failed or muted output is not a delivered Telegram alert', async t => {
  for (const stdout of ['held back: already sent', 'muted: disabled', 'NOT DELIVERED', 'delivered: a different subject']) {
    const result = await executeOwnerAlert(fixture(), { directory: temp(t), origin: 'https://example.test', execute: async () => ({ stdout }) }); assert.equal(result.delivered, false);
  }
  assert.equal((await executeOwnerAlert(fixture(), { directory: temp(t), origin: 'https://example.test', execute: async () => { throw Error('offline'); } })).delivered, false);
});

test('arbitrary commands, URLs, names and model messages cannot enter the owner alert executor', async t => {
  for (const patch of [{ command: 'rm -rf /' }, { path: '/bin/sh' }, { url: 'http://127.0.0.1/private' }, { kind: 'text' }, { adultName: 'https://evil.example' }, { adultName: 'Ari\n--force' }, { email: 'not-an-email' }, { email: null }, { id: '../../file' }]) assert.throws(() => validateOwnerAlert({ ...fixture(), ...patch }), /Invalid fixed/);
  for (const origin of ['file:///tmp/', 'http://example.test', 'https://user:password@example.test', 'https://example.test/approve']) await assert.rejects(() => executeOwnerAlert(fixture(), { directory: temp(t), origin }), /configured/);
});

test('fixed owner-alert bridge authenticates worker and never touches model receipts or allowances', async t => {
  const db = {}, secret = 'fixture-only-worker-secret'.repeat(2), workerId = 'fixture-worker', calls = [];
  const bridge = createWorkerBridge({ db, secret, persist() {}, resultDirectory: temp(t), ownerAlerts: { claim: async id => { calls.push(['claim', id]); return fixture(); }, complete: async (id, data) => { calls.push(['complete', id, data.alertId]); return { ok: true }; } } }); t.after(bridge.close);
  await assert.rejects(() => bridge.handle('/api/worker/alerts/poll', { workerId }, 'Bearer wrong'), /denied/);
  const { alert } = await bridge.handle('/api/worker/alerts/poll', { workerId }, `Bearer ${secret}`);
  assert.equal(alert.kind, 'owner-access-alert'); await bridge.handle('/api/worker/alerts/complete', { workerId, alertId: alert.id }, `Bearer ${secret}`);
  assert.equal(calls.length, 2); assert.deepEqual(db.workerRequests, []); assert.equal(bridge.status().waiting, 0);
});

test('a confirmed alert completes while the same worker process is still waiting on model generation', async t => {
  const { runGenerationWorker, createWorkerOutbox } = await import('../server/generation-worker.mjs');
  const directory = temp(t), controller = new AbortController(), alert = fixture();
  let startModel, releaseModel, modelRunning = false, modelCalls = 0, alerts = 0, acknowledged = false;
  const started = new Promise(resolve => { startModel = resolve; }), held = new Promise(resolve => { releaseModel = resolve; });
  const job = { id: randomUUID(), claimToken: 'b'.repeat(64), kind: 'text', owner: { accountId: 'fixture', workId: 'fixture-job' } };
  const response = data => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  await runGenerationWorker({ origin: 'https://example.test', secret: 'fixture-worker-secret'.repeat(2), outboxDirectory: directory, signal: controller.signal,
    execute: async () => { modelCalls++; modelRunning = true; startModel(); await held; modelRunning = false; return { text: 'saved fixture output' }; },
    executeAlert: async received => { alerts++; assert.equal(received.id, alert.id); assert.equal(modelRunning, true); return { delivered: true, receipt: `delivered: Story Poster access request ${alert.requestId}` }; },
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname;
      if (path === '/api/worker/alerts/poll') { await started; return response({ alert }); }
      if (path === '/api/worker/poll') return response({ job });
      if (path === '/api/worker/alerts/complete') { assert.equal(JSON.parse(options.body).delivered, true); assert.equal(modelRunning, true); acknowledged = true; controller.abort(); releaseModel(); return response({ ok: true }); }
      throw Error('Unexpected fixture route: ' + path);
    },
  });
  assert.equal(modelCalls, 1); assert.equal(alerts, 1); assert.equal(acknowledged, true);
  assert.equal(createWorkerOutbox(directory).pending().length, 1, 'The model answer remains in its own durable outbox after shutdown.');
});
