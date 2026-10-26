import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { primarySearchQuery, searchPrimarySources, createNCBIScheduler, sourceSearchPolicyVersion, searchConcepts } from '../server/library-sources.js';
import { canRefreshSourceSearch, refreshSourceSearchPolicy, createLibrary } from '../server/library.js';
import { createPreparedLibrary } from '../server/library-prepared.js';
import { createMemory } from '../server/memory.js';
import { createAppBudget } from '../server/app-budget.js';
import { setupRecord } from '../server/app-data.js';
import { root, readJSON, saveJSON } from '../server/files.js';
import { libraryTopic, libraryTopicReview, libraryTransportFixture, libraryAnswer, librarySearchFixture, librarySource } from './library-fixture.mjs';

const temporary = t => { const base = join(root, 'context/library-source-policy-tests'); mkdirSync(base, { recursive: true }); const directory = mkdtempSync(join(base, 'fixture-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; };
const endpoint = name => `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/${name}.fcgi?db=pubmed`;
const oldCheckpoint = () => ({ stages: { 'library-topic': libraryTopic(), 'library-topic-check': libraryTopicReview(), 'primary-search': { provider: 'PubMed ESearch', query: 'old natural topic query', urls: [librarySource().url] }, 'source-0': librarySource(), 'library-research': { urls: [] } }, requests: 4, attempts: { 'library-topic': 2, 'library-topic-check': 1, 'library-research': 1 } });

test('cleared phrases are quoted Title/Abstract OR clauses, without ambiguous bare expressing or query injection', async () => {
  const terms = ['emotional awareness', 'friendship challenges', 'disappointment', 'sadness', 'expressing feelings'];
  const query = primarySearchQuery('recognizing and expressing emotions in friendships', terms);
  for (const term of terms) assert.ok(query.includes(`"${term}"[Title/Abstract]`));
  assert.ok(query.includes(' OR ')); assert.match(query, /AND \(child\[MeSH Terms\]/); assert.ok(!query.includes('recognizing and expressing'));
  for (const terms of [['x" OR all[Title]'], ['https://private.example'], ['a; b'], ['twelve 12']]) assert.throws(() => primarySearchQuery('general feelings', terms));
  let time = 0, fetched;
  const scheduler = createNCBIScheduler({ now: () => time, wait: async ms => { time += ms; } });
  const receipt = await searchPrimarySources('general feelings', { terms, scheduler, fetchImpl: async url => { fetched = new URL(url); return new Response(JSON.stringify({ esearchresult: { idlist: ['99999991'] } })); } });
  assert.equal(fetched.searchParams.get('term'), query); assert.equal(receipt.policyVersion, sourceSearchPolicyVersion);
});

test('one shared scheduler spaces ESearch and EFetch and respects bounded 429 Retry-After without retrying other statuses', async () => {
  let time = 0; const starts = [], waits = [];
  const scheduler = createNCBIScheduler({ now: () => time, wait: async ms => { waits.push(ms); time += ms; } });
  const fetchImpl = async url => { starts.push({ path: new URL(url).pathname, time }); return new Response('ok'); };
  await Promise.all([scheduler.request(endpoint('esearch'), {}, fetchImpl), scheduler.request(endpoint('efetch'), {}, fetchImpl), scheduler.request(endpoint('efetch'), {}, fetchImpl)]);
  assert.deepEqual(starts.map(row => row.time), [0, 350, 700]);
  let attempts = 0;
  const retried = await scheduler.request(endpoint('esearch'), {}, async () => ++attempts === 1 ? new Response('rate', { status: 429, headers: { 'Retry-After': '2' } }) : new Response('ok'));
  assert.equal(retried.receipt.attempts, 2); assert.deepEqual(retried.receipt.retries, [{ httpStatus: 429, retryAfter: '2', delayMs: 2000 }]); assert.ok(waits.includes(2000));
  attempts = 0;
  const failed = await scheduler.request(endpoint('efetch'), {}, async () => { attempts++; return new Response('server issue', { status: 503 }); });
  assert.equal(failed.receipt.httpStatus, 503); assert.equal(attempts, 1);
  await assert.rejects(scheduler.request(endpoint('efetch'), {}, async () => new Response('rate', { status: 429, headers: { 'Retry-After': '3600' } })), error => error.httpStatus === 429 && error.attempts === 1);
  time += 3600000;
  attempts = 0;
  await assert.rejects(scheduler.request(endpoint('efetch'), {}, async () => { attempts++; return new Response('rate', { status: 429 }); }), error => error.httpStatus === 429 && error.attempts === 3);
  assert.equal(attempts, 3);
  await assert.rejects(scheduler.request('https://evil.example/entrez/eutils/efetch.fcgi', {}, fetchImpl), /Only fixed NCBI/);
});

test('a long Retry-After blocks both queued and later source requests without sending or sleeping for an hour', async () => {
  let time = 0, sends = 0; const waits = [];
  const scheduler = createNCBIScheduler({ now: () => time, wait: async ms => { waits.push(ms); time += ms; } });
  const fetchImpl = async () => { sends++; return sends === 1 ? new Response('rate', { status: 429, headers: { 'Retry-After': '3600' } }) : new Response('ok'); };
  const results = await Promise.allSettled([scheduler.request(endpoint('efetch'), {}, fetchImpl), scheduler.request(endpoint('esearch'), {}, fetchImpl)]);
  assert.equal(results[0].status, 'rejected'); assert.equal(results[0].reason.httpStatus, 429); assert.equal(results[0].reason.attempts, 1);
  assert.equal(results[1].status, 'rejected'); assert.equal(results[1].reason.attempts, 0); assert.equal(results[1].reason.retryable, true);
  await assert.rejects(scheduler.request(endpoint('efetch'), {}, fetchImpl), error => error.httpStatus === 429 && error.attempts === 0 && error.retryAfter === '3600');
  assert.equal(sends, 1); assert.deepEqual(waits, []); assert.equal(time, 0);
  time = 3600000;
  assert.equal((await scheduler.request(endpoint('esearch'), {}, fetchImpl)).receipt.httpStatus, 200); assert.equal(sends, 2);
});

test('old no-source search refresh keeps exact checkpoint bytes, private stages and every spent allowance, once', t => {
  const directory = temporary(t), path = join(directory, 'checkpoint.json'), checkpoint = oldCheckpoint();
  saveJSON(path, checkpoint); const bytes = readFileSync(path), privateTopic = structuredClone(checkpoint.stages['library-topic']);
  assert.equal(canRefreshSourceSearch(checkpoint), true); assert.equal(refreshSourceSearchPolicy(checkpoint, path), true);
  assert.deepEqual(readFileSync(join(directory, `checkpoint-before-${sourceSearchPolicyVersion}.json`)), bytes);
  assert.deepEqual(checkpoint.stages['library-topic'], privateTopic); assert.deepEqual(checkpoint.stages['library-topic-check'], libraryTopicReview());
  assert.equal(checkpoint.requests, 4); assert.deepEqual(checkpoint.attempts, oldCheckpoint().attempts);
  assert.equal(checkpoint.stages['primary-search'], undefined); assert.equal(checkpoint.stages['source-0'], undefined); assert.equal(checkpoint.stages['library-research'], undefined);
  assert.equal(checkpoint.sourceSearchPolicyVersion, sourceSearchPolicyVersion); assert.equal(refreshSourceSearchPolicy(checkpoint, path), false);
  assert.equal(readdirSync(directory).filter(name => name.startsWith('checkpoint-before-')).length, 1);
  for (const mutate of [cp => { cp.sourceSearchPolicyVersion = sourceSearchPolicyVersion; }, cp => { cp.stages['library-topic-check'].safeToSearch = false; }, cp => { delete cp.stages['primary-search']; }, cp => { cp.requests = 12; }, cp => { cp.attempts['library-research'] = 2; }, cp => { cp.stages['library-research'].urls = [librarySource().url]; }]) { const rejected = oldCheckpoint(); mutate(rejected); assert.equal(canRefreshSourceSearch(rejected), false); }
  const failedBeforeSelection = oldCheckpoint(); delete failedBeforeSelection.stages['library-research']; assert.equal(canRefreshSourceSearch(failedBeforeSelection), true);
});

async function settle(service, account, id) { for (let i = 0; i < 200; i++) { const job = service.status(account, id); if (job.status !== 'running') return job; await new Promise(resolve => setTimeout(resolve, 5)); } throw Error('Fixture did not settle.'); }
function setup(t) {
  const dataDirectory = temporary(t), account = { id: 'fictional-owner' }, memory = createMemory(join(dataDirectory, account.id, 'family.json'));
  memory.store(setupRecord({ real: false, nickname: 'Pip', age: 10, pronouns: 'he/him', loves: ['kites', 'stars', 'art'], presetId: 'comet', familyContext: '', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] }));
  const db = { libraryJobs: [] }, calls = [], searches = [], active = new Map(); let empty = true;
  const preparedLibrary = createPreparedLibrary({ directory: join(dataDirectory, 'empty-prepared-bank') });
  const service = createLibrary({ db, persist: () => saveJSON(join(dataDirectory, 'accounts.json'), db), dataDirectory, active, preparedLibrary, budget: createAppBudget(join(dataDirectory, 'budget.json')), memoryFor: () => memory, childIdFor: () => 'primary', readKey: () => 'fixture-key', registerMove() {},
    transportFactory: () => libraryTransportFixture({ calls, override: request => request.stage === 'library-research' && empty ? libraryAnswer({ noRelevantSource: true, sourceUrls: [] }) : undefined }),
    searchSources: async (topic, options) => { searches.push(options); return librarySearchFixture(topic); }, fetchSource: async () => librarySource() });
  return { service, account, db, calls, searches, dataDirectory, setEmpty: value => { empty = value; } };
}
test('same old review job resumes only public source work with one source-choice attempt remaining', async t => {
  const h = setup(t), tonight = 'A fictional kite fell apart and the afternoon felt rough.';
  const job = h.service.start(h.account, 'primary', tonight); assert.equal((await settle(h.service, h.account, job.id)).canResume, false);
  delete h.db.libraryJobs[0].libraryPolicyVersion; // This fixture represents a job created before v2.
  const path = join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'checkpoint.json'); saveJSON(path, oldCheckpoint());
  assert.equal(h.service.status(h.account, job.id).canResume, true); h.setEmpty(false);
  const before = h.calls.length, resumed = h.service.start(h.account, 'primary', tonight); assert.equal(resumed.id, job.id);
  const done = await settle(h.service, h.account, job.id); assert.equal(done.status, 'complete');
  assert.deepEqual(h.calls.slice(before).map(call => call.stage), ['library-research', 'library-draft', 'library-review']);
  const checkpoint = readJSON(path); assert.equal(checkpoint.requests, 7); assert.equal(checkpoint.attempts['library-topic'], 2); assert.equal(checkpoint.attempts['library-topic-check'], 1); assert.equal(checkpoint.attempts['library-research'], 2);
  assert.deepEqual(h.searches.at(-1), { terms: libraryTopic().matchTerms }); assert.equal(h.service.status(h.account, job.id).canResume, false);
});
test('fresh-policy no-fit remains terminal after the one refresh and does not renew counters again', async t => {
  const h = setup(t), tonight = 'Another fictional small setback happened.';
  const job = h.service.start(h.account, 'primary', tonight); await settle(h.service, h.account, job.id);
  delete h.db.libraryJobs[0].libraryPolicyVersion; // Keep this historical policy-refresh case on its original contract.
  const path = join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'checkpoint.json'); saveJSON(path, oldCheckpoint());
  h.service.resume(h.account, job.id); const refreshed = await settle(h.service, h.account, job.id);
  assert.equal(refreshed.status, 'review'); assert.equal(refreshed.canResume, false);
  const count = h.calls.length; h.service.start(h.account, 'primary', tonight); h.service.resume(h.account, job.id);
  assert.equal(h.calls.length, count); assert.equal(readJSON(path).requests, 5); assert.equal(readJSON(path).attempts['library-research'], 2);
});


test('required search concepts keep the skill and context together and reject query syntax', () => {
  const concepts = [['online', 'internet'], ['credibility', 'lateral reading']];
  const query = primarySearchQuery('evaluating online information', undefined, concepts);
  assert.match(query, /\("online"\[Title\/Abstract\] OR "internet"\[Title\/Abstract\]\) AND \("credibility"/);
  assert.match(query, /school\*/);
  for (const invalid of [[['online']], [['online'], ['x" OR all[Title]']], [['online'], ['https://private.example']], [['online'], ['age ten 10']]]) assert.throws(() => searchConcepts(invalid));
});

test('a no-fit search is refined once, preserving the first evidence and spent calls', async t => {
  const { libraryHarness, librarySettled } = await import('./library-fixture.mjs');
  const queries = []; let selections = 0;
  const h = libraryHarness(t, {
    searchSources: async (topic, options) => { queries.push(options); return librarySearchFixture(topic); },
    override: request => request.stage === 'library-research' ? libraryAnswer(++selections === 1 ? { sourceUrls: [], noRelevantSource: true } : { sourceUrls: [librarySource().url], noRelevantSource: false }) : undefined,
  });
  const job = h.service.start(h.account, 'primary', 'Practice naming a feeling after a setback.');
  const done = await librarySettled(h.service, h.account, job.id);
  assert.equal(done.status, 'complete', done.message);
  assert.equal(queries.length, 2); assert.deepEqual(queries[1].concepts, [['emotional awareness'], ['feelings', 'labeling']]);
  const directory = join(h.dataDirectory, h.account.id, 'library-jobs', job.id);
  const cp = readJSON(join(directory, 'checkpoint.json'));
  const original = readJSON(join(directory, cp.sourceRefinement.backup));
  assert.deepEqual(original.stages['library-research'].urls, []);
  assert.equal(original.attempts['library-research'], 1);
  assert.equal(cp.attempts['library-research'], 2);
  assert.equal(cp.requests, h.calls.length); assert.equal(cp.requests, 8);
  assert.notEqual(cp.stageReceipts['library-search-plan'].model, cp.stageReceipts['library-search-check'].model);
  assert.equal(cp.stageReceipts['library-research'].attempt, 2);
  assert.ok(original.stages['source-0'].contentHash);
  const before = h.calls.length; h.service.resume(h.account, job.id); assert.equal(h.calls.length, before);
});

test('an unsafe refined search is never sent and cannot repeat its rejected plan', async t => {
  const { libraryHarness, librarySettled } = await import('./library-fixture.mjs');
  let searches = 0;
  const h = libraryHarness(t, { searchSources: async topic => { searches++; return librarySearchFixture(topic); }, override(request) {
    if (request.stage === 'library-research') return libraryAnswer({ sourceUrls: [], noRelevantSource: true });
    if (request.stage === 'library-topic-check' && JSON.parse(request.body.input[0].content).searchPlan) return libraryAnswer({ safeToSearch: false, noPrivateDetails: false, goalPreserved: true });
  } });
  const job = h.service.start(h.account, 'primary', 'Practice naming a feeling after a setback.');
  const done = await librarySettled(h.service, h.account, job.id);
  assert.equal(done.status, 'review'); assert.equal(done.canResume, false); assert.equal(searches, 1);
  assert.equal(h.service.list().length, 0);
});

test('a temporary refined-source outage resumes the same query without another plan', async t => {
  const { libraryHarness, librarySettled } = await import('./library-fixture.mjs');
  let searches = 0, outage = true;
  const h = libraryHarness(t, {
    searchSources: async topic => { searches++; return librarySearchFixture(topic); },
    fetchSource: async () => { if (searches === 2 && outage) throw Error('Synthetic HTTP 503'); return librarySource(); },
    override(request) {
      if (request.stage === 'library-topic') return libraryAnswer({ ...libraryTopic(), actionBaseMoveId: null });
      if (request.stage === 'library-topic-check') return libraryAnswer({ ...libraryTopicReview(), noFittingSeed: true });
      if (request.stage === 'library-research') return libraryAnswer({ sourceUrls: [], noRelevantSource: true });
    },
  });
  const job = h.service.start(h.account, 'primary', 'Learn a general skill after a setback.');
  const failed = await librarySettled(h.service, h.account, job.id);
  assert.equal(failed.status, 'failed'); assert.equal(failed.canResume, true); assert.equal(searches, 2);
  const before = h.calls.length; outage = false; h.service.resume(h.account, job.id);
  const done = await librarySettled(h.service, h.account, job.id);
  assert.equal(done.status, 'review'); assert.equal(done.canResume, false); assert.equal(searches, 2);
  assert.deepEqual(h.calls.slice(before).map(call => call.stage), ['library-research']);
  const cp = readJSON(join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'checkpoint.json'));
  assert.equal(cp.attempts['library-research'], 2); assert.equal(cp.attempts['library-search-plan'], 1);
});

test('zero-hit searches use one cleared-term fallback without buying an empty source review', async t => {
  const { libraryHarness, librarySettled } = await import('./library-fixture.mjs');
  let searches = 0;
  const h = libraryHarness(t, { searchSources: async topic => { searches++; return { ...await librarySearchFixture(topic), urls: [] }; }, override(request) {
    if (request.stage === 'library-topic') return libraryAnswer({ ...libraryTopic(), actionBaseMoveId: null });
    if (request.stage === 'library-topic-check') return libraryAnswer({ ...libraryTopicReview(), noFittingSeed: true });
  } });
  const job = h.service.start(h.account, 'primary', 'Learn a general skill after a setback.');
  const done = await librarySettled(h.service, h.account, job.id);
  assert.equal(done.status, 'review'); assert.equal(done.canResume, false); assert.equal(searches, 3);
  assert.equal(h.calls.filter(call => call.stage === 'library-research').length, 0);
});


test('the source search reads twelve ranked records and rejects an oversized receipt', async () => {
  const ids = Array.from({ length: 12 }, (_, index) => String(90000000 + index));
  let time = 0; const scheduler = createNCBIScheduler({ now: () => time, wait: async ms => { time += ms; } });
  const fetchImpl = async url => { assert.equal(new URL(url).searchParams.get('retmax'), '12'); return new Response(JSON.stringify({ esearchresult: { idlist: ids } })); };
  const result = await searchPrimarySources('a general learning skill', { scheduler, fetchImpl });
  assert.equal(result.urls.length, 12);
  ids.push('90000012');
  await assert.rejects(searchPrimarySources('a general learning skill', { scheduler, fetchImpl }), /bounded list/);
});
