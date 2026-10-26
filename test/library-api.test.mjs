import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app-server.mjs';
import { createLibraryCatalog } from '../server/library-catalog.js';
import { buildTeachingDocument } from '../server/library.js';
import { moves, readJSON, saveJSON } from '../server/files.js';
import { kitText } from './kit-text-fixture.mjs';
import { offlineSample } from './offline-kit-fixture.mjs';
import { createTransport } from '../server/transport.js';
import { privacyFor } from '../server/requests.js';
import { textModels } from '../server/text-models.js';
import { libraryTopic, librarySource, libraryDraft, libraryReview, libraryTransportFixture, librarySearchFixture } from './library-fixture.mjs';

// Entirely synthetic account, source and provider receipts. No network source
// is fetched and no real model/source review is asserted by this API test.
const family = (nickname = 'Mika') => ({ real: false, nickname, age: 10, pronouns: 'they/them', loves: ['comics', 'football', 'space'], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] });
const tonight = 'A setback felt heavy after a quiet afternoon.';
async function fixture(t, { transportOverride, runOverride, kitTransportFactory } = {}) {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'library-api-'));
  const document = buildTeachingDocument(libraryTopic(), libraryDraft(), [librarySource()], libraryReview(), moves.filter(move => !move.library), '2026-10-15T12:00:00Z');
  createLibraryCatalog(join(dataDirectory, 'shared-library')).publish(document);
  const sample = await offlineSample(join(dataDirectory, 'synthetic-export'));
  const calls = [], kitCalls = [], counters = { keyReads: 0 };
  const options = { dataDirectory, sample: null, sampleOnly: false, dailyLimit: 6, keyReader: () => { counters.keyReads++; return 'synthetic-key-never-sent'; }, transportFactory: transportOptions => kitTransportFactory && !transportOptions.logFile.includes('/library-jobs/') ? kitTransportFactory(transportOptions) : libraryTransportFixture({ calls, override: transportOverride }), librarySearch: librarySearchFixture, libraryFetch: async () => librarySource(),
    runKit: async (_transport, memory, moment, options) => {
      const record = memory.exportRecord(), move = moves.find(move => move.id === options.chosenMoveId);
      kitCalls.push({ record, moment, moveId: options.chosenMoveId });
      if (runOverride) await runOverride({ transport: _transport, record, moment, options });
      for (const name of ['poster.png', 'poster.pdf', 'kit_final.pdf']) copyFileSync(join(sample.directory, name), join(options.directory, name));
      return { ...kitText(move, { nickname: record.hero.nickname }), move, complete: true, world: 'comic strip', colourSet: 'warm', recordAtStart: record };
    } };
  let app = createApp(options);
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(dataDirectory, { recursive: true, force: true }); const index = moves.findIndex(move => move.id === document.id); if (index >= 0) moves.splice(index, 1); });
  let url = `http://127.0.0.1:${app.server.address().port}/api/`;
  const request = async (path, body, cookie, method = body === undefined ? 'GET' : 'POST', expectedAccount) => {
    const response = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(expectedAccount ? { 'X-Story-Poster-Account': expectedAccount } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const signup = (username, input = family()) => request('signup', { username, password: 'fictional-test-password', family: input });
  async function research(cookie, input = {}) {
    const started = await request('library/jobs', { tonight, childId: 'primary', ...input }, cookie);
    assert.equal(started.status, 202, JSON.stringify(started.data));
    for (let poll = 0; poll < 100; poll++) {
      const status = await request('library/jobs/' + started.data.id, undefined, cookie);
      if (status.data.status !== 'running') { assert.equal(status.data.status, 'complete', JSON.stringify(status.data)); return status.data; }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail('Synthetic research did not settle.');
  }
  const restart = async change => {
    await app.close();
    const path = join(dataDirectory, 'accounts.json'), state = readJSON(path);
    change(state); saveJSON(path, state);
    app = createApp(options);
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${app.server.address().port}/api/`;
  };
  return { request, signup, research, calls, kitCalls, counters, document, restart };
}

test('a requested shared general guide reuses only an existing exact-note child check without new paid work', async t => {
  const h = await fixture(t), owner = await h.signup('requested_owner'), other = await h.signup('requested_other');
  const input = { childId: 'primary', tonight, requestedMoveId: h.document.id };
  assert.equal((await h.request('pick', input, owner.cookie)).data.status, 'noMatch');
  assert.equal(h.counters.keyReads, 0);
  const checked = await h.research(owner.cookie), before = { keys: h.counters.keyReads, calls: h.calls.length };
  const picked = await h.request('pick', input, owner.cookie);
  assert.equal(picked.data.status, 'eligible'); assert.equal(picked.data.suggestions[0].id, h.document.id); assert.equal(picked.data.libraryJobId, checked.id);
  assert.equal((await h.request('pick', input, other.cookie)).data.status, 'noMatch');
  assert.equal((await h.request('pick', { ...input, tonight: 'A different moment.' }, owner.cookie)).data.status, 'noMatch');
  assert.deepEqual({ keys: h.counters.keyReads, calls: h.calls.length }, before);
});

test('research jobs, match use and resumptions are isolated by authenticated account', async t => {
  const { request, signup, research, document } = await fixture(t);
  assert.equal((await request('library')).status, 401);
  assert.equal((await request('library/jobs', { tonight })).status, 401);
  const owner = await signup('owner_family'), other = await signup('other_family');
  const job = await research(owner.cookie);
  assert.equal((await request('library/jobs/' + job.id, undefined, other.cookie)).status, 404);
  assert.equal((await request('library/jobs/' + job.id + '/resume', {}, other.cookie)).status, 404);
  assert.equal((await request('pick', { tonight, libraryJobId: job.id }, other.cookie)).status, 400);
  assert.equal((await request('jobs', { tonight, moveId: document.id, libraryJobId: job.id }, other.cookie)).status, 400);
  assert.equal((await request('library/jobs/' + job.id + '/resume', {}, owner.cookie)).data.status, 'complete');
});
test('only the completed same-child job for the exact same moment adds a researched move', async t => {
  const { request, signup, research, document, calls } = await fixture(t);
  const { cookie } = await signup('exact_family'); const job = await research(cookie);
  assert.deepEqual(calls.map(call => call.stage), ['library-topic', 'library-topic-check']);
  const picked = await request('pick', { tonight: '  ' + tonight + '  ', libraryJobId: job.id, childId: 'primary' }, cookie);
  assert.equal(picked.status, 200); assert.equal(picked.data.suggestions[0].id, document.id);
  for (const moment of ['A setback felt heavy after a loud afternoon.', tonight.toUpperCase()]) assert.equal((await request('pick', { tonight: moment, libraryJobId: job.id }, cookie)).status, 400);
  assert.equal((await request('pick', { tonight, libraryJobId: randomUUID() }, cookie)).status, 400);
  assert.equal((await request('library/jobs', { tonight, childId: randomUUID() }, cookie)).status, 400);
  const added = await request('children', { family: family('Lumi') }, cookie);
  assert.equal(added.status, 200); assert.notEqual(added.data.childId, 'primary');
  assert.deepEqual((await request('session', undefined, cookie)).data.libraryJobs, []);
  assert.equal((await request('pick', { tonight, libraryJobId: job.id, childId: added.data.childId }, cookie)).status, 400);
  assert.equal((await request('pick', { tonight, libraryJobId: job.id, childId: 'primary' }, cookie)).status, 400);
});
test('client-supplied libraryMatch is neither trusted nor saved, and valid server match reaches only its job', async t => {
  const { request, signup, research, document, kitCalls } = await fixture(t);
  const malicious = { ...family(), libraryMatch: { moveId: document.id, tonight } };
  const account = await signup('server_owned', malicious), { cookie } = account;
  assert.equal(account.data.record.libraryMatch, undefined);
  let picked = await request('pick', { tonight, libraryMatch: malicious.libraryMatch }, cookie);
  assert.ok(!picked.data.suggestions.some(move => move.id === document.id));
  assert.equal((await request('jobs', { tonight, moveId: document.id, libraryMatch: malicious.libraryMatch }, cookie)).status, 400);
  const job = await research(cookie);
  picked = await request('pick', { tonight, libraryJobId: job.id }, cookie);
  assert.equal(picked.data.suggestions[0].id, document.id);
  const started = await request('jobs', { tonight, childId: 'primary', moveId: document.id, libraryJobId: job.id }, cookie);
  assert.equal(started.status, 202, JSON.stringify(started.data));
  for (let poll = 0; poll < 100 && !kitCalls.length; poll++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(kitCalls.length, 1); assert.deepEqual(kitCalls[0].record.libraryMatch, { moveId: document.id, tonight });
  assert.equal(kitCalls[0].moment, tonight);
  let complete;
  for (let poll = 0; poll < 100; poll++) {
    complete = (await request('jobs/' + started.data.id, undefined, cookie)).data;
    if (complete.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(complete.status, 'complete', JSON.stringify(complete));
  assert.equal(complete.result.move.id, document.id);
  assert.equal((await request('session', undefined, cookie)).data.record.libraryMatch, undefined);
});
test('a pending research job cannot authorize a teaching move before the independent topic check', async t => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const { request, signup, document } = await fixture(t, { transportOverride: async request => { if (request.stage === 'library-topic') await gate; } });
  const { cookie } = await signup('pending_family');
  const started = await request('library/jobs', { tonight, childId: 'primary' }, cookie);
  try {
    assert.equal(started.status, 202);
    assert.equal((await request('pick', { tonight, libraryJobId: started.data.id }, cookie)).status, 400);
    assert.equal((await request('jobs', { tonight, moveId: document.id, libraryJobId: started.data.id }, cookie)).status, 409);
  } finally { release(); }
  let finished;
  for (let poll = 0; poll < 100; poll++) {
    finished = (await request('library/jobs/' + started.data.id, undefined, cookie)).data;
    if (finished.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(finished.status, 'complete');
});

test('a fitting researched repeat retains its server binding and still needs explicit repeat permission', async t => {
  const { request, signup, research, document } = await fixture(t);
  const { cookie } = await signup('bound_repeat');
  const job = await research(cookie);
  const started = await request('jobs', { tonight, childId: 'primary', moveId: document.id, libraryJobId: job.id }, cookie);
  assert.equal(started.status, 202);
  let completed;
  for (let poll = 0; poll < 100; poll++) {
    completed = (await request('jobs/' + started.data.id, undefined, cookie)).data;
    if (completed.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(completed.status, 'complete');
  const repeat = await request('pick', { tonight, childId: 'primary', libraryJobId: job.id }, cookie);
  assert.equal(repeat.data.status, 'eligible'); assert.ok(repeat.data.suggestions.some(item => item.id === document.id && item.repeated)); assert.equal(repeat.data.libraryJobId, job.id);
  const chosen = await request('pick', { tonight, childId: 'primary', libraryJobId: repeat.data.libraryJobId, allowRepeat: true }, cookie);
  assert.equal(chosen.data.suggestions[0].id, document.id); assert.equal(chosen.data.suggestions[0].repeated, true);
  assert.equal((await request('pick', { tonight: 'A different note.', childId: 'primary', libraryJobId: repeat.data.libraryJobId, allowRepeat: true }, cookie)).status, 400);
});

test('changed family context cannot use a previously checked private research request', async t => {
  const { request, signup, research, document, counters, kitCalls } = await fixture(t);
  const { cookie } = await signup('changed_context');
  const job = await research(cookie), keyReads = counters.keyReads;
  assert.equal((await request('family', { familyContext: 'A new general family note.' }, cookie, 'PATCH')).status, 200);
  const picked = await request('pick', { tonight, childId: 'primary', libraryJobId: job.id }, cookie);
  assert.equal(picked.status, 400);
  assert.match(picked.data.message, /same child and moment again/);
  assert.equal((await request('jobs', { tonight, childId: 'primary', moveId: document.id, libraryJobId: job.id }, cookie)).status, 400);
  assert.equal(counters.keyReads, keyReads);
  assert.equal(kitCalls.length, 0);
});

test('recreating the same username has a new account binding and no prior private data', async t => {
  const { request, signup } = await fixture(t);
  const first = await signup('reused_family_name');
  assert.match(first.data.accountId, /^[a-f0-9-]{36}$/);
  assert.equal((await request('family', { familyContext: 'Private note for the earlier fictional account.' }, first.cookie, 'PATCH')).status, 200);
  assert.equal((await request('family', undefined, first.cookie, 'DELETE')).status, 200);
  const second = await signup('reused_family_name');
  assert.equal(second.status, 200);
  assert.equal(second.data.username, first.data.username);
  assert.equal(second.data.childId, first.data.childId);
  assert.notEqual(second.data.accountId, first.data.accountId);
  assert.equal(second.data.record.familyContext, '');
  assert.deepEqual(second.data.jobs, []);
  assert.deepEqual(second.data.libraryJobs, []);
  assert.equal((await request('session', undefined, first.cookie)).data.record, null);
});

test('a stale tab cannot read, write or delete the newly logged-in family', async t => {
  const { request, signup, counters } = await fixture(t);
  const old = await signup('old_tab_family'), current = await signup('current_tab_family');
  for (const [path, body, method] of [
    ['portraits?childId=primary', undefined, 'GET'],
    ['family', { familyContext: 'A private note from the old tab.' }, 'PATCH'],
    ['jobs', { childId: 'primary', tonight, moveId: moves[0].id }, 'POST'],
    ['library/jobs', { childId: 'primary', tonight }, 'POST'],
    ['family', undefined, 'DELETE'],
    ['logout', {}, 'POST'],
  ]) {
    const response = await request(path, body, current.cookie, method, old.data.accountId);
    assert.equal(response.status, 409, path);
    assert.equal(response.data.code, 'FAMILY_SESSION_CHANGED');
  }
  const discovered = await request('session', undefined, current.cookie, 'GET', old.data.accountId);
  assert.equal(discovered.status, 200);
  assert.equal(discovered.data.accountId, current.data.accountId);
  assert.equal(discovered.data.record.familyContext, '');
  assert.deepEqual(discovered.data.jobs, []);
  assert.deepEqual(discovered.data.libraryJobs, []);
  assert.equal(counters.keyReads, 0);
  assert.equal((await request('family', { familyContext: 'The current family note.' }, current.cookie, 'PATCH', current.data.accountId)).status, 200);
  assert.equal((await request('session', undefined, current.cookie)).data.record.familyContext, 'The current family note.');
});

test('a saved kit whose pinned guide changed enters terminal review before reading a key', async t => {
  const { request, signup, research, document, restart, counters, kitCalls } = await fixture(t, { runOverride: () => { throw Error('Synthetic interrupted kit.'); } });
  const { cookie } = await signup('pinned_context');
  const researchJob = await research(cookie);
  const started = await request('jobs', { tonight, childId: 'primary', moveId: document.id, libraryJobId: researchJob.id }, cookie);
  assert.equal(started.status, 202);
  let failed;
  for (let poll = 0; poll < 100; poll++) {
    failed = (await request('jobs/' + started.data.id, undefined, cookie)).data;
    if (failed.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(failed.status, 'failed');
  assert.equal(failed.canResume, true);
  await restart(state => {
    const job = state.jobs.find(item => item.id === started.data.id);
    assert.equal(job.libraryBinding.documentId, document.id);
    assert.equal(job.libraryBinding.documentHash, document.sha256);
    job.libraryBinding.documentHash = '0'.repeat(64);
  });
  const keyReads = counters.keyReads;
  const resumed = await request('jobs/' + started.data.id + '/resume', {}, cookie);
  assert.equal(resumed.status, 409);
  assert.equal(resumed.data.job.canResume, false);
  assert.match(resumed.data.message, /Keep it and set it aside/);
  assert.equal((await request('jobs/' + started.data.id, undefined, cookie)).data.canResume, false);
  assert.equal((await request('jobs/' + started.data.id + '/resume', {}, cookie)).status, 409);
  assert.equal(counters.keyReads, keyReads);
  assert.equal(kitCalls.length, 1);
});

test('an explicitly rejected researched action cannot authorize another kit through its old binding', async t => {
  const { request, signup, research, document, counters, kitCalls } = await fixture(t);
  const { cookie } = await signup('rejected_context');
  const researchJob = await research(cookie);
  const started = await request('jobs', { tonight, childId: 'primary', moveId: document.id, libraryJobId: researchJob.id }, cookie);
  let completed;
  for (let poll = 0; poll < 100; poll++) {
    completed = (await request('jobs/' + started.data.id, undefined, cookie)).data;
    if (completed.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(completed.status, 'complete');
  assert.equal((await request('jobs/' + started.data.id + '/feedback', { triedMove: 'yes', didItHelp: 'not for us', wallChoice: 'Keep it off the wall' }, cookie)).status, 200);
  const keyReads = counters.keyReads;
  assert.equal((await request('pick', { tonight, childId: 'primary', libraryJobId: researchJob.id, allowRepeat: true }, cookie)).status, 400);
  assert.equal((await request('jobs', { tonight, childId: 'primary', moveId: document.id, libraryJobId: researchJob.id, allowRepeat: true }, cookie)).status, 400);
  assert.equal(counters.keyReads, keyReads);
  assert.equal(kitCalls.length, 1);
});

test('a rejection saved while a kit runs stops its next model call', async t => {
  let hold = false, release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const waiting = new Promise(resolve => { entered = resolve; });
  const { request, signup, research, document, calls } = await fixture(t, { runOverride: async ({ transport }) => {
    if (!hold) return;
    entered(); await gate;
    await transport.call({ stage: 'story' });
  } });
  const { cookie } = await signup('active_rejection');
  const researchJob = await research(cookie);
  const input = { tonight, childId: 'primary', moveId: document.id, libraryJobId: researchJob.id };
  const first = await request('jobs', input, cookie);
  for (let poll = 0; poll < 100; poll++) {
    if ((await request('jobs/' + first.data.id, undefined, cookie)).data.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  hold = true;
  const second = await request('jobs', { ...input, allowRepeat: true }, cookie);
  try {
    assert.equal(second.status, 202);
    await waiting;
    assert.equal((await request('jobs/' + first.data.id + '/feedback', { triedMove: 'yes', didItHelp: 'not for us', wallChoice: 'Keep it off the wall' }, cookie)).status, 200);
  } finally { release(); }
  let stopped;
  for (let poll = 0; poll < 100; poll++) {
    stopped = (await request('jobs/' + second.data.id, undefined, cookie)).data;
    if (stopped.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(stopped.status, 'failed');
  assert.equal(stopped.canResume, false);
  assert.deepEqual(calls.map(call => call.stage), ['library-topic', 'library-topic-check']);
});

test('a rejection saved during a real transport retry stops the next wire before reservation', async t => {
  let hold = false, wires = 0, reservations = 0, retryWaits = 0, rejectionSaved = false, ownerCookie, firstJobId, request, budgetStatus;
  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (!String(url).startsWith('https://api.openai.com/')) return nativeFetch(url, init);
    wires++;
    // Synthetic provider responses only. Explicit zero usage keeps the first
    // failed response known, so the unknown-charge gate cannot hide this bug.
    return new Response(JSON.stringify(wires === 1 ? { error: { message: 'Synthetic retry only.' }, usage: { input_tokens: 0, output_tokens: 0 } } : { status: 'completed', output: [], usage: { input_tokens: 0, output_tokens: 0 } }), { status: wires === 1 ? 500 : 200 });
  });
  const setup = await fixture(t, {
    kitTransportFactory: options => {
      budgetStatus = () => options.budget.status();
      return createTransport({ ...options, budget: { ...options.budget, reserve: amount => { reservations++; return options.budget.reserve(amount); } }, wait: async () => {
      retryWaits++;
      const response = await request('jobs/' + firstJobId + '/feedback', { triedMove: 'yes', didItHelp: 'not for us', wallChoice: 'Keep it off the wall' }, ownerCookie);
      rejectionSaved = response.status === 200;
      } });
    },
    runOverride: async ({ transport, record }) => {
      if (!hold) return;
      await transport.call({ provider: 'openai', path: '/v1/responses', stage: 'story', body: { model: textModels().story, store: false, max_output_tokens: 256, input: [{ role: 'user', content: 'Synthetic JSON transport fixture only.' }] }, familyRecord: record, privacy: privacyFor(record, tonight) });
    },
  });
  request = setup.request;
  const signedIn = await setup.signup('retry_rejection'); ownerCookie = signedIn.cookie;
  const researchJob = await setup.research(ownerCookie);
  const input = { tonight, childId: 'primary', moveId: setup.document.id, libraryJobId: researchJob.id };
  const first = await request('jobs', input, ownerCookie); firstJobId = first.data.id;
  for (let poll = 0; poll < 100; poll++) {
    if ((await request('jobs/' + firstJobId, undefined, ownerCookie)).data.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  hold = true;
  const second = await request('jobs', { ...input, allowRepeat: true }, ownerCookie);
  assert.equal(second.status, 202);
  let stopped;
  for (let poll = 0; poll < 100; poll++) {
    stopped = (await request('jobs/' + second.data.id, undefined, ownerCookie)).data;
    if (stopped.status !== 'running') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(retryWaits, 1); assert.equal(rejectionSaved, true);
  assert.equal(wires, 1, 'No retry wire may follow the saved action rejection.');
  assert.equal(reservations, 1, 'Rejection must stop before a second spending reservation.'); assert.equal(budgetStatus().reserved, 0);
  assert.equal(stopped.status, 'failed'); assert.equal(stopped.canResume, false);
  assert.deepEqual(setup.calls.map(call => call.stage), ['library-topic', 'library-topic-check']);
});
