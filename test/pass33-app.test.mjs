import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../server/app-server.mjs';
import { offlineSample } from './offline-kit-fixture.mjs';
import { createAppBudget, centralDay, wireCeiling } from '../server/app-budget.js';
import { setupRecord } from '../server/app-data.js';
import { createMemory } from '../server/memory.js';
import { readJSON, root, moves } from '../server/files.js';
import { fitDocument } from '../server/layout-fit.js';
import { kitText } from './kit-text-fixture.mjs';

// Mutable HTTP/account fixtures must not race the historical kit replay, which
// scans test/out in a separate test process while account deletion is exercised.
const out = join(root, 'context/pass33-test-state'); mkdirSync(out, { recursive: true });
const temp = () => mkdtempSync(join(out, 'pass33-'));
const family = () => ({ real: false, nickname: 'Pip', age: 10, pronouns: 'he/him', loves: ['comics', 'soccer', 'space'], presetId: 'comet', familyContext: 'A fictional grandparent moved in recently.', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] });
const credentials = username => ({ username, password: 'fictional-test-password', family: family() });
async function start(t, options = {}) {
  const app = createApp({ dataDirectory: temp(), sample: await offlineSample(temp()), ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, data, { cookie, method = data === undefined ? 'GET' : 'POST', headers = {} } = {}) => {
    const response = await fetch(base + '/api/' + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? await response.json() : null, cookie: response.headers.get('set-cookie')?.split(';')[0], response };
  };
  return { ...app, request };
}
async function waitJob(request, id, cookie) {
  for (let i = 0; i < 60; i++) { const result = await request('jobs/' + id, undefined, { cookie }); if (result.data.status !== 'running') return result.data; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Job did not settle.');
}

test('real families, invalid people and photos cannot enter local setup', () => {
  assert.throws(() => setupRecord({ ...family(), real: true }), /Real family details need your permission/);
  assert.throws(() => setupRecord({ ...family(), real: undefined }), /made-up family/);
  assert.throws(() => setupRecord({ ...family(), age: 7 }), /age/);
  assert.throws(() => setupRecord({ ...family(), presetId: 'uploaded-photo' }), /hero look/);
  const record = setupRecord({ ...family(), parents: [...family().parents, { label: 'Mom', pronouns: 'she/her', hair: 'curly brown hair' }] });
  assert.equal(record.cast.length, 3); assert.equal(record.cast[2].pronouns, 'she/her'); assert.equal(record.real, false);
});

test('daily reservations survive restart, account unknown charges at their ceilings, and use Chicago midnight', () => {
  const file = join(temp(), 'budget.json'); let now = new Date('2026-10-15T04:59:00Z');
  const budget = createAppBudget(file, { limit: 2, now: () => now });
  const slot = budget.reserve(1.25); assert.throws(() => budget.reserve(1), /Daily budget/);
  assert.equal(createAppBudget(file, { limit: 2, now: () => now }).status().reserved, 1.25);
  now = new Date('2026-10-15T05:01:00Z'); assert.equal(centralDay(now), '2026-10-15');
  budget.settle(slot, .4); assert.equal(budget.status().spent, 0);
  const uncertain = budget.reserve(.5); budget.settle(uncertain, null);
  assert.equal(budget.status().spent, .5); assert.equal(budget.status().reserved, 0);
  assert.doesNotThrow(() => budget.reserve(.01));
  assert.throws(() => createAppBudget(join(temp(), 'invalid.json'), { limit: NaN }));
  const zero = createAppBudget(join(temp(), 'zero.json'), { limit: 0 }); assert.throws(() => zero.reserve(.01), /Daily budget/);
});

test('wire budget counts images without their base64 and rejects unbounded output', () => {
  const catalog = readJSON(new URL('../content/prices.json', import.meta.url));
  const body = { model: catalog.selected.pictureCheck, max_output_tokens: 2000, input: [{ content: 'data:image/png;base64,' + 'A'.repeat(1000000) }] };
  assert.ok(wireCeiling({ body, path: '/v1/responses' }, catalog) < 1);
  assert.throws(() => wireCeiling({ body: { model: catalog.selected.story }, path: '/v1/responses' }, catalog), /safely/);
});

test('local logins protect records and kit files; no API key or filesystem path is exposed', async t => {
  const { request } = await start(t, { sampleOnly: true });
  assert.equal((await request('session')).data.record, null);
  const user = await request('signup', credentials('family_one')); assert.equal(user.status, 200); assert.ok(user.cookie);
  assert.equal(user.data.record.hero.heroPicturePath, undefined); assert.equal(user.data.record.cast[0].referencePath, undefined);
  assert.doesNotMatch(JSON.stringify(user.data), /hash|salt|API_KEY|local-app/);
  assert.equal((await request('signup', credentials('family_one'))).status, 409);
  assert.equal((await request('login', { username: 'family_one', password: 'wrong-password' })).status, 401);
  assert.equal((await request('login', credentials('family_one'))).status, 200);
  const cookie = user.cookie;
  assert.equal((await request('pick', { tonight: 'Homework felt hard.' })).status, 401);
  assert.equal((await request('pick', { tonight: 'Homework felt hard.' }, { cookie, headers: { Origin: 'https://example.com' } })).status, 403);
  assert.equal((await request('jobs/not-real/files/checkpoint.json', undefined, { cookie })).status, 404);
  assert.equal((await request('logout', {}, { cookie })).status, 200);
  assert.equal((await request('session', undefined, { cookie })).data.record, null);
});

test('safety routing and sample-only mode finish before any provider work', async t => {
  let keys = 0, runs = 0;
  const { request } = await start(t, { sampleOnly: true, keyReader: () => { keys++; throw new Error('must not read'); }, runKit: async () => { runs++; } });
  const { cookie } = await request('signup', credentials('routes_family'));
  for (const tonight of ['Just listen tonight.', 'My child says she wants to kill herself.', 'My child is worried about being fat.']) {
    const picked = await request('pick', { tonight }, { cookie }); assert.equal(picked.status, 200); assert.equal(picked.data.status, 'parentResponse');
  }
  const pick = await request('pick', { tonight: 'The homework felt hard and the notebook went across the room.' }, { cookie }); assert.equal(pick.data.status, 'eligible'); assert.ok(pick.data.suggestions.length);
  const job = await request('jobs', { tonight: 'Homework felt hard.', moveId: pick.data.suggestions[0].id }, { cookie }); assert.equal(job.status, 503);
  assert.equal(keys, 0); assert.equal(runs, 0);
  const sample = await request('sample'); assert.equal(sample.data.sample, true);
  assert.equal((await request('sample/files/checkpoint.json')).status, 404);
  assert.equal((await request('sample/files/poster.pdf')).status, 200);
});

test('zero daily budget blocks new jobs before credentials and calls', async t => {
  let keys = 0;
  const { request } = await start(t, { sampleOnly: false, dailyLimit: 0, keyReader: () => { keys++; } });
  const { cookie } = await request('signup', credentials('budget_family'));
  const pick = await request('pick', { tonight: 'The homework felt hard.' }, { cookie });
  const result = await request('jobs', { tonight: 'The homework felt hard.', moveId: pick.data.suggestions[0].id }, { cookie });
  assert.equal(result.status, 429); assert.equal(keys, 0);
});

test('a background kit survives navigation, stores unanswered feedback and can be reopened', async t => {
  const sample = await offlineSample(temp()); assert.equal(sample.fixture, true);
  let release; const gate = new Promise(resolve => { release = resolve; }); let chosen;
  const { request } = await start(t, { sampleOnly: false, keyReader: () => 'fixture-key-never-sent', transportFactory: () => ({ call: () => { throw new Error('No calls allowed.'); } }), runKit: async (transport, memory, tonight, options) => {
    chosen = options.chosenMoveId; await gate; mkdirSync(options.directory, { recursive: true });
    for (const file of ['poster.png', 'poster.pdf', 'kit_final.pdf']) copyFileSync(join(sample.directory, file), join(options.directory, file));
    return { ...kitText(moves.find(move => move.id === chosen)), moveId: chosen, recordAtStart: memory.exportRecord(), complete: true, move: moves.find(move => move.id === chosen), world: 'comic strip', colourSet: 'warm' };
  } });
  const { cookie } = await request('signup', credentials('job_family'));
  const tonight = 'The homework felt hard.';
  const pick = await request('pick', { tonight }, { cookie }), moveId = pick.data.suggestions[0].id;
  const accepted = await request('jobs', { tonight, moveId }, { cookie }); assert.equal(accepted.status, 202);
  assert.equal((await request('jobs', { tonight, moveId }, { cookie })).status, 409);
  assert.equal((await request('family', { familyContext: 'Changed.' }, { cookie, method: 'PATCH' })).status, 409);
  assert.equal((await request('session', undefined, { cookie })).data.jobs[0].status, 'running');
  release(); const completed = await waitJob(request, accepted.data.id, cookie); assert.equal(completed.status, 'complete'); assert.equal(chosen, moveId);
  const state = (await request('session', undefined, { cookie })).data; assert.equal(state.record.pastKits[0].triedMove, 'unanswered'); assert.equal(state.record.pastKits[0].didItHelp, 'unanswered');
  const second = await request('signup', credentials('other_family'));
  assert.equal((await request('jobs/' + completed.id, undefined, { cookie: second.cookie })).status, 404);
  assert.equal((await request('jobs/' + completed.id + '/files/poster.pdf', undefined, { cookie: second.cookie })).status, 404);
  assert.equal((await request('jobs/' + completed.id + '/files/checkpoint.json', undefined, { cookie })).status, 404);
  const feedback = await request('jobs/' + completed.id + '/feedback', { triedMove: 'yes', didItHelp: 'a little', wallChoice: 'Keep it off the wall' }, { cookie }); assert.equal(feedback.status, 200); assert.equal(feedback.data.record.pastKits[0].didItHelp, 'a little');
  const changed = await request('family', { familyContext: 'New fictional note.' }, { cookie, method: 'PATCH' }); assert.equal(changed.status, 200); assert.equal(changed.data.record.pastKits[0].adventureLine, '');
  assert.equal((await request('family', {}, { cookie, method: 'DELETE' })).status, 200); assert.equal((await request('session', undefined, { cookie })).data.record, null);
});

test('small spills recover discretionary gaps on either chapter page without shortening', t => {
  const previous = globalThis.document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  for (const name of ['story', 'story-2', 'try', 'for-you']) {
    const sheet = { dataset: { page: name }, querySelector: selector => selector === '.page-heading' ? {} : null };
    globalThis.document = { querySelectorAll: () => [sheet] };
    const result = fitDocument(() => ({ measured: true, ready: sheet.dataset.gapFit === 'small', faults: sheet.dataset.gapFit ? [] : ['12.27 points'], pages: [{ page: name, footerOverflowPoints: sheet.dataset.gapFit ? 0 : 12.27, overflowPoints: sheet.dataset.gapFit ? 0 : 12.27, elements: [{ generated: 'story', text: 'Saved words unchanged.', overflowPoints: sheet.dataset.gapFit ? 0 : 5.78 }] }] }));
    assert.equal(result.ready, true); assert.equal(result.fitting.typeShrunk, false); assert.equal(result.fitting.textHidden, false); assert.match(result.fitting.changes[0].action, /all words/);
  }
});

test('both grown-up names belong to text requests and are protected from pictures', async () => {
  const { buildStoryRequest, privacyFor, assertNoFamilyText } = await import('../server/requests.js');
  const record = setupRecord({ ...family(), parents: [{ label: 'Zelly', pronouns: 'she/her', hair: 'curly brown hair' }, { label: 'Tavik', pronouns: 'he/him', hair: 'short grey hair' }] });
  const memory = createMemory(join(temp(), 'family.json')); memory.store(record);
  const stored = memory.exportRecord(), request = buildStoryRequest(stored, 'The homework felt hard.');
  const payload = JSON.parse(request.input[0].content);
  assert.deepEqual(payload.storyPeople, record.storyPeople);
  assert.throws(() => assertNoFamilyText({ prompt: 'Tavik helps the child.' }, privacyFor(stored, 'The homework felt hard.')), /familyContext name/);
  assert.throws(() => assertNoFamilyText({ prompt: 'Zelly helps the child.' }, privacyFor(stored, 'The homework felt hard.')), /parent label|familyContext name/);
});

test('failed work resumes its saved checkpoint; edited family notes cannot leak through resume', async t => {
  let runs = 0, sawResume = false;
  const directory = temp();
  const { request } = await start(t, { dataDirectory: directory, sampleOnly: false, keyReader: () => 'fixture-never-sent', transportFactory: () => ({ call: () => { throw Error('No calls allowed.'); } }), runKit: async (transport, memory, tonight, options) => {
    runs++; sawResume ||= options.resume;
    mkdirSync(options.directory, { recursive: true });
    const { saveJSON } = await import('../server/files.js'); saveJSON(join(options.directory, 'checkpoint.json'), { acceptedStory: 'fixture story already saved' });
    throw Error('A simulated downstream export failure.');
  } });
  const { cookie } = await request('signup', credentials('resume_family'));
  const tonight = 'The homework felt hard.';
  const pick = await request('pick', { tonight }, { cookie });
  const made = await request('jobs', { tonight, moveId: pick.data.suggestions[0].id }, { cookie });
  assert.equal((await waitJob(request, made.data.id, cookie)).status, 'failed');
  const resumed = await request('jobs/' + made.data.id + '/resume', {}, { cookie }); assert.equal(resumed.status, 202); assert.equal(resumed.data.status, 'running');
  await waitJob(request, made.data.id, cookie); assert.equal(sawResume, true); assert.equal(runs, 2);
  await request('family', { familyContext: 'A corrected fictional fact.' }, { cookie, method: 'PATCH' });
  const stale = await request('jobs/' + made.data.id + '/resume', {}, { cookie }); assert.equal(stale.status, 409); assert.match(stale.data.message, /notes changed/); assert.equal(runs, 2);
});

test('each transport retry reserves and settles before more wire work', async t => {
  const { createTransport } = await import('../server/transport.js');
  const { privacyFor } = await import('../server/requests.js');
  const record = setupRecord(family()); const file = join(temp(), 'wire-budget.json');
  const budget = createAppBudget(file, { limit: 2 }), catalog = readJSON(new URL('../content/prices.json', import.meta.url));
  const previousFetch = globalThis.fetch; t.after(() => { globalThis.fetch = previousFetch; });
  let calls = 0;
  globalThis.fetch = async () => { calls++; assert.ok(budget.status().reserved > 0); return new Response(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 10 } }), { status: calls === 1 ? 429 : 200 }); };
  const transport = createTransport({ keys: { openai: 'fixture-key-never-sent' }, logFile: join(temp(), 'requests.jsonl'), budget, wait: async () => {} });
  await transport.call({ provider: 'openai', path: '/v1/responses', body: { model: catalog.selected.pictureCheck, max_output_tokens: 1000, store: false, input: [] }, stage: 'picture-check', privacy: privacyFor(record, 'Homework was hard.') });
  assert.equal(calls, 2); assert.equal(budget.status().reserved, 0); assert.ok(budget.status().spent > 0);
  const zeroBudget = createAppBudget(join(temp(), 'zero-wire.json'), { limit: 0 });
  const zero = createTransport({ keys: { openai: 'fixture-key-never-sent' }, logFile: join(temp(), 'requests.jsonl'), budget: zeroBudget });
  await assert.rejects(zero.call({ provider: 'openai', path: '/v1/responses', body: { model: catalog.selected.pictureCheck, max_output_tokens: 1000, store: false, input: [] }, stage: 'picture-check', privacy: privacyFor(record, 'Homework was hard.') }), /Daily budget/); assert.equal(calls, 2);
});
