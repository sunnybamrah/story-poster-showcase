import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app-server.mjs';
import { createTransport } from '../server/transport.js';
import { buildStoryRequest, privacyFor } from '../server/requests.js';
import { moves, readJSON, saveJSON } from '../server/files.js';
import { parentJobFailure, savedLessonFitFailure } from '../server/job-failure.js';
import { preparedFixture, savePreparedFixture } from './library-prepared-fixture.mjs';

const note = 'The child wants to learn to sort objects by material.';
const family = age => ({ real: false, nickname: 'Mika', age, pronouns: 'they/them', loves: ['comics', 'football', 'space'], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] });
async function harness(t, { runKit, transportFactory } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'prepared-api-fixture-'));
  const fixture = savePreparedFixture(join(directory, 'source-bank'));
  const counts = { keys: 0, searches: 0, transports: 0 };
  const state = { accounts: [], sessions: [], jobs: [] };
  const app = createApp({ stateStore: { initialState: state, assertWritable() {}, save() {}, flush: async () => {} }, dataDirectory: join(directory, 'app'), sample: null, sampleOnly: false, preparedLibrary: fixture.bank, keyReader: () => { counts.keys++; return 'synthetic-fixture-key'; }, librarySearch: () => { counts.searches++; throw Error('Synthetic search was not expected.'); }, transportFactory: options => { counts.transports++; return transportFactory ? transportFactory(options, fixture, counts) : { call: async () => { throw Error('Synthetic paid call was not expected.'); } }; }, runKit: runKit ?? (async () => { throw Error('Synthetic kit stopped after its guard, no generation or export.'); }) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); const index = moves.findIndex(move => move.id === fixture.document.id); if (index >= 0) moves.splice(index, 1); rmSync(directory, { recursive: true, force: true }); });
  const url = `http://127.0.0.1:${app.server.address().port}/api/`;
  const request = async (path, body, cookie) => {
    const response = await fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const signup = await request('signup', { username: 'fictional_family', password: 'fictional-fixture-password', family: family(10) });
  assert.equal(signup.status, 200);
  return { ...fixture, state, app, directory, counts, request, cookie: signup.cookie };
}
async function settled(h, id) {
  for (let index = 0; index < 100; index++) { const { data } = await h.request('jobs/' + id, undefined, h.cookie); if (data.status !== 'running') return data; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw Error('Synthetic job did not settle.');
}
test('an automatically selected prepared guide is pinned before later calls and rechecks withdrawals', async t => {
  let h, wires = 0;
  h = await harness(t, {
    transportFactory: options => ({ call: async () => { options.familyRecordFor(); wires++; return {}; } }),
    runKit: async (transport, memory, tonight, options) => {
      assert.equal(options.chosenMoveId, undefined);
      assert.equal(options.allowRepeat, true, 'Automatic stories can reuse a fitting skill.');
      const payload = JSON.parse(buildStoryRequest(memory.exportRecord(), tonight).input[0].content);
      assert.ok(payload.moves.some(move => move.id === h.document.id));
      await transport.onLessonSelected(h.document.id);
      const before = readJSON(join(h.directory, 'app/accounts.json')).jobs[0];
      assert.equal(before.moveId, h.document.id); assert.ok(before.preparedBinding.sourceStatusHash);
      await transport.call({ stage: 'story-check' });
      saveJSON(join(h.directory, 'source-bank/source-status.json'), { [h.source.id]: { ...h.source.status, state: 'needs-review' } });
      await transport.call({ stage: 'poster' });
      assert.fail('A withdrawn guide must not reach another wire');
    },
  });
  const started = await h.request('jobs', { childId: 'primary', tonight: 'A calm learning moment.' }, h.cookie);
  assert.equal(started.status, 202);
  const result = await settled(h, started.data.id);
  assert.equal(result.status, 'failed'); assert.equal(result.canResume, false); assert.equal(wires, 1);
});
test('browse and prepared fit are free, include original fourteen, and distrust requested IDs and age claims', async t => {
  const h = await harness(t);
  const browse = await h.request('library', undefined, h.cookie);
  assert.equal(browse.status, 200);
  assert.equal(browse.data.entries.filter(entry => entry.kind === 'original').length, 14);
  assert.ok(browse.data.entries.some(entry => entry.kind === 'prepared' && entry.id === h.document.id));
  assert.equal(JSON.stringify(browse.data.entries).includes('bodyText'), false);
  assert.equal(JSON.stringify(browse.data.entries).includes('Mika'), false);
  const choose = await h.request('pick', { childId: 'primary', tonight: note, requestedMoveId: h.document.id }, h.cookie);
  assert.equal(choose.data.status, 'eligible'); assert.equal(choose.data.suggestions[0].id, h.document.id);
  const local = await h.request('library/jobs', { childId: 'primary', tonight: note, preferPrepared: true }, h.cookie);
  assert.equal(local.status, 200); assert.equal(local.data.status, 'eligible'); assert.equal(local.data.id, undefined);
  for (const input of [{ tonight: 'A calm purple comet.', requestedMoveId: h.document.id }, { tonight: note, requestedMoveId: 'missing-id' }, { tonight: 'A calm purple comet.', requestedMoveId: h.document.id, sourceFits: true, age: 10 }, { tonight: 'A calm purple comet.', preferPrepared: true, researchNewGoal: 'true' }]) {
    const result = await h.request(input.preferPrepared ? 'library/jobs' : 'pick', { childId: 'primary', ...input }, h.cookie);
    assert.equal(result.status, 200); assert.equal(result.data.status, input.requestedMoveId === 'missing-id' ? 'noMatch' : 'eligible');
  }
  const guarded = await h.request('library/jobs', { childId: 'primary', tonight: 'An adult hit my child.', preferPrepared: true }, h.cookie);
  assert.equal(guarded.data.status, 'parentResponse');
  assert.deepEqual(h.counts, { keys: 0, searches: 0, transports: 0 });
});
test('forged child selection and changed source status cannot start prepared paid work', async t => {
  const h = await harness(t);
  const staleChild = await h.request('jobs', { childId: 'a-different-child', tonight: note, moveId: h.document.id }, h.cookie);
  assert.equal(staleChild.status, 400);
  saveJSON(join(h.directory, 'source-bank/source-status.json'), { [h.source.id]: { ...h.source.status, state: 'needs-review' } });
  const job = await h.request('jobs', { childId: 'primary', tonight: note, moveId: h.document.id, preparedBinding: { pretend: 'approved' } }, h.cookie);
  assert.equal(job.data.status, 'noMatch'); assert.equal(h.counts.keys, 0);
});
test('every real transport retry rechecks pinned prepared source status before another wire', async t => {
  let wires = 0;
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let h;
  h = await harness(t, {
    transportFactory: options => createTransport({ ...options, wait: async () => { saveJSON(join(h.directory, 'source-bank/source-status.json'), { [h.source.id]: { ...h.source.status, state: 'needs-review' } }); } }),
    runKit: async (transport, memory, tonight, options) => {
      const record = memory.exportRecord();
      await transport.call({ provider: 'openai', path: '/v1/responses', stage: 'story', body: buildStoryRequest(record, tonight, { lockedMoveId: options.chosenMoveId }), familyRecord: record, privacy: privacyFor(record, tonight) });
      throw Error('A source withdrawal must stop the synthetic second wire.');
    },
  });
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://api.openai.com/')) { wires++; return new Response(JSON.stringify({ error: { message: 'Synthetic server retry fixture' } }), { status: 503 }); }
    return originalFetch(url, options);
  };
  const started = await h.request('jobs', { childId: 'primary', tonight: note, moveId: h.document.id }, h.cookie);
  assert.equal(started.status, 202, JSON.stringify(started.data));
  const failed = await settled(h, started.data.id);
  assert.equal(failed.status, 'failed'); assert.equal(wires, 1);
  const db = readJSON(join(h.directory, 'app/accounts.json'));
  assert.ok(db.jobs[0].preparedBinding.sourceStatusHash);
  const before = h.counts.keys;
  const resumed = await h.request('jobs/' + started.data.id + '/resume', {}, h.cookie);
  assert.equal(resumed.status, 409); assert.equal(h.counts.keys, before); assert.equal(wires, 1);
});

test('legacy order-only binding rejection can resume, without accepting a real source change', async t => {
  let runs = 0;
  const h = await harness(t, { runKit: async () => { runs++; throw Error('Synthetic render interruption'); } });
  const started = await h.request('jobs', { childId: 'primary', tonight: note, moveId: h.document.id }, h.cookie);
  assert.equal(started.status, 202);
  await settled(h, started.data.id);
  const saved = h.state.jobs.find(job => job.id === started.data.id);
  const original = structuredClone(saved.preparedBinding);
  saved.preparedBinding = Object.fromEntries(Object.entries(original).reverse());
  Object.assign(saved, { status: 'failed', failureKind: 'review', canResume: false, message: parentJobFailure(savedLessonFitFailure()).message });
  const before = h.counts.keys;
  const good = await h.request('jobs/' + saved.id, undefined, h.cookie);
  assert.equal(good.data.canResume, true);
  assert.equal(h.counts.keys, before, 'Reading recovery eligibility must not start generation.');
  saved.preparedBinding.sourceStatusHash = 'changed';
  assert.equal((await h.request('jobs/' + saved.id, undefined, h.cookie)).data.canResume, false);
  assert.equal((await h.request('jobs/' + saved.id + '/resume', {}, h.cookie)).status, 409);
  saved.preparedBinding.sourceStatusHash = original.sourceStatusHash;
  const resumed = await h.request('jobs/' + saved.id + '/resume', {}, h.cookie);
  assert.equal(resumed.status, 202);
  await settled(h, saved.id);
  assert.equal(runs, 2);
  assert.deepEqual(saved.preparedBinding, Object.fromEntries(Object.entries(original).reverse()), 'Recovery never replaces the old binding.');
});
