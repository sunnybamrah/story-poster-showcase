import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createLibrary, buildTeachingDocument, validateTeachingDraft, assertGeneralLibraryText } from '../server/library.js';
import { createLibraryCatalog, documentHash } from '../server/library-catalog.js';
import { primarySourceURL, parsePrimarySource, parsePubMedXML, validateSourceReceipt, searchPrimarySources, fetchPrimarySource, seedPrimarySourceURLs, seedSourceCandidatePolicy, sourceSearchPolicyVersion } from '../server/library-sources.js';
import { createMemory } from '../server/memory.js';
import { createAppBudget } from '../server/app-budget.js';
import { setupRecord } from '../server/app-data.js';
import { moves, root, readJSON, saveJSON } from '../server/files.js';
import { selectedRhymeFor } from '../server/rhyme.js';
import { libraryTopic, librarySource, libraryDraft, libraryReview, libraryTopicReview, libraryAnswer, libraryTransportFixture, librarySearchFixture, libraryHarness as harness, librarySettled as settled } from './library-fixture.mjs';

const fixtureRoot = join(root, 'context/library-tests'); mkdirSync(fixtureRoot, { recursive: true });
const seedRecord = () => setupRecord({ real: false, nickname: 'Pip', age: 10, pronouns: 'he/him', loves: ['kites', 'drawing', 'stars'], presetId: 'comet', familyContext: 'Pip lives in Privateville with Dad.', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] });
const tonight = 'Pip’s paper kite broke during play and the afternoon felt rough.';

test('a new generic document passes private topic gate, real-source checks and independent review before shared reuse', async t => {
  let searches = 0, fetched = 0;
  const h = harness(t, { searchSources: async topic => { searches++; assert.equal(topic, libraryTopic().topic); assert.doesNotMatch(topic, /Pip|Privateville|kite/); return librarySearchFixture(topic); }, fetchSource: async url => { fetched++; assert.ok([...seedPrimarySourceURLs(moves.find(move => move.id === 'name-it-exactly')), librarySource().url].includes(url)); return librarySource(new URL(url).pathname.split('/')[1]); } });
  const job = h.service.start(h.account, 'primary', tonight), done = await settled(h.service, h.account, job.id);
  if (done.status !== 'complete') assert.fail(JSON.stringify(readJSON(join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'failure.json'))));
  assert.equal(searches, 1); assert.equal(fetched, 3); assert.equal(h.calls.length, 5);
  const publicCalls = h.calls.filter(call => !['library-topic', 'library-topic-check'].includes(call.stage));
  assert.ok(publicCalls.every(call => !call.body.tools && call.body.store === false));
  for (const call of publicCalls) assert.doesNotMatch(JSON.stringify(call.body), /Pip|Privateville|paper kite|fictional-account/);
  assert.notEqual(h.calls[0].body.model, h.calls[1].body.model); assert.notEqual(h.calls[3].body.model, h.calls[4].body.model);
  const document = h.service.list()[0], move = h.service.getMove(done.moveId), base = moves.find(move => move.id === 'name-it-exactly');
  assert.equal(document.status, 'reusable'); assert.equal(document.review.ownerApproved, false); assert.equal(move.practiceScript, base.practiceScript);
  assert.equal(move.library.actionBaseMoveId, base.id); assert.equal(move.sources[0].pubmed, '99999991'); assert.deepEqual(move.library.actionProvenance.sourceIds, base.sources.map(source => source.pubmed ?? source.doi));
  assert.equal(selectedRhymeFor(move).approved, false); assert.equal(document.sourceReceipts[0].abstract, undefined);
  assert.equal(h.registered.length, 1);
  for (const name of readdirSync(join(h.dataDirectory, 'shared-library'))) assert.doesNotMatch(readFileSync(join(h.dataDirectory, 'shared-library', name), 'utf8'), /Pip|Privateville|paper kite|fictional-account|accountId|jobId/);
  assert.throws(() => h.service.status(h.other, job.id), /not in this family/);
  assert.throws(() => h.service.resume(h.other, job.id), /not in this family/);
});

test('private names, copied facts and independent privacy rejection never reach public search or shared storage', async t => {
  for (const mode of ['name', 'place', 'gate']) {
    let searched = 0;
    const h = harness(t, { searchSources: async () => { searched++; throw Error('Must not search'); }, override: request => request.stage === 'library-topic' && mode !== 'gate' ? libraryAnswer({ ...libraryTopic(), topic: mode === 'name' ? 'pip feels disappointed' : 'coping in privateville' }) : request.stage === 'library-topic-check' && mode === 'gate' ? libraryAnswer({ ...libraryTopicReview(), noPrivateDetails: false }) : undefined });
    const job = h.service.start(h.account, 'primary', tonight), done = await settled(h.service, h.account, job.id);
    assert.notEqual(done.status, 'complete'); assert.equal(searched, 0); assert.equal(h.service.list().length, 0);
    assert.ok(h.calls.every(call => ['library-topic', 'library-topic-check'].includes(call.stage)));
  }
  assert.throws(() => assertGeneralLibraryText({ topic: 'write to person@example.com' }, seedRecord(), tonight), /contact details/);
});

test('a protective route, no fitting action, sample preview and zero budget cannot buy research', async t => {
  let keys = 0;
  const h = harness(t, { readKey: () => { keys++; return 'fixture-key'; } });
  const protective = h.service.start(h.account, 'primary', 'She said she wanted to die.'); assert.equal(protective.status, 'parentResponse'); assert.equal(keys, 0);
  const none = harness(t, { searchSources: async () => { throw Error('No source search'); }, override: request => request.stage === 'library-topic' ? libraryAnswer({ ...libraryTopic(), actionBaseMoveId: null }) : undefined });
  const job = none.service.start(none.account, 'primary', tonight); assert.equal((await settled(none.service, none.account, job.id)).status, 'review'); assert.equal(none.service.list().length, 0);
  const preview = harness(t, { sampleOnly: true, readKey: () => { keys++; } }); assert.throws(() => preview.service.start(preview.account, 'primary', tonight), /preview/);
  const capped = harness(t, { budget: { status: () => ({ limit: 0, spent: 0, reserved: 0 }) }, readKey: () => { keys++; } }); assert.throws(() => capped.service.start(capped.account, 'primary', tonight), /budget/);
  assert.equal(keys, 0);
});

test('an invented source, unsupported claim, unsafe new advice or failed independent source review cannot publish', async t => {
  const scenarios = [
    ['source', request => request.stage === 'library-research' ? libraryAnswer({ sourceUrls: ['https://pubmed.ncbi.nlm.nih.gov/11111111/'], noRelevantSource: false }) : undefined],
    ['quote', request => request.stage === 'library-draft' ? libraryAnswer({ ...libraryDraft(), evidence: [{ ...libraryDraft().evidence[0], quote: 'This sentence was never in the actual source.' }] }) : undefined],
    ['advice', request => request.stage === 'library-draft' ? libraryAnswer({ ...libraryDraft(), explanation: 'Take medicine to fix the feeling.' }) : undefined],
    ['review', request => request.stage === 'library-review' ? libraryAnswer({ ...libraryReview(), sourceFit: false }) : undefined],
  ];
  for (const [name, override] of scenarios) {
    const h = harness(t, { override }); const job = h.service.start(h.account, 'primary', tonight), done = await settled(h.service, h.account, job.id);
    assert.notEqual(done.status, 'complete', name); assert.equal(h.service.list().length, 0, name); assert.equal(h.registered.length, 0, name);
  }
});

test('resume keeps accepted topic, primary search, source bytes and draft without rebuying them', async t => {
  let reviews = 0, searches = 0, sources = 0;
  const h = harness(t, { searchSources: async topic => { searches++; return librarySearchFixture(topic); }, fetchSource: async url => { sources++; return librarySource(new URL(url).pathname.split('/')[1]); }, override: request => { if (request.stage === 'library-review' && ++reviews === 1) throw Error('Simulated connection failure'); } });
  const job = h.service.start(h.account, 'primary', tonight); assert.equal((await settled(h.service, h.account, job.id)).status, 'failed');
  const firstStages = h.calls.map(call => call.stage);
  const resumed = createLibrary({ ...h });
  resumed.resume(h.account, job.id); assert.equal((await settled(resumed, h.account, job.id)).status, 'complete');
  assert.equal(searches, 1); assert.equal(sources, 3); assert.deepEqual(h.calls.map(call => call.stage).slice(firstStages.length), ['library-review']);
});

test('same general topic deduplicates after its independent fit gate and bad existing-document matches stay private', async t => {
  let searches = 0;
  const h = harness(t, { searchSources: async topic => { searches++; return librarySearchFixture(topic); } });
  const first = h.service.start(h.account, 'primary', tonight); const done = await settled(h.service, h.account, first.id);
  const second = h.service.start(h.account, 'primary', 'A made-up afternoon had a different small setback.');
  const reused = await settled(h.service, h.account, second.id); assert.equal(reused.moveId, done.moveId); assert.equal(searches, 1);
  assert.deepEqual(h.calls.slice(5).map(call => call.stage), ['library-topic', 'library-topic-check']);
  const third = createLibrary({ ...h, transportFactory: () => libraryTransportFixture({ override: request => request.stage === 'library-topic-check' ? libraryAnswer({ ...libraryTopicReview(), existingDocumentFits: false }) : undefined }) });
  const blocked = third.start(h.account, 'primary', 'Another made-up disappointment with a game.'); assert.equal((await settled(third, h.account, blocked.id)).status, 'review'); assert.equal(searches, 1);
});

test('source search and fetch use only fixed public endpoints and validate actual metadata plus abstract', async () => {
  for (const url of ['http://pubmed.ncbi.nlm.nih.gov/1/', 'https://evil.example/1/', 'https://127.0.0.1/1/', 'https://pubmed.ncbi.nlm.nih.gov.evil.example/1/', 'https://pubmed.ncbi.nlm.nih.gov/?url=http://127.0.0.1', 'https://user:pass@pubmed.ncbi.nlm.nih.gov/1/']) assert.throws(() => primarySourceURL(url));
  let called;
  const searched = await searchPrimarySources('coping with disappointment', { fetchImpl: async (url, options) => { called = new URL(url); assert.equal(options.redirect, 'error'); return new Response(JSON.stringify({ esearchresult: { idlist: ['99999991'] } })); } });
  assert.equal(called.hostname, 'eutils.ncbi.nlm.nih.gov'); assert.equal(called.searchParams.get('retmax'), '12'); assert.equal(searched.urls[0], librarySource().url);
  const source = librarySource(); assert.equal(validateSourceReceipt(source), source);
  assert.throws(() => validateSourceReceipt({ ...source, title: 'Changed title' }), /metadata/);
  assert.throws(() => validateSourceReceipt({ ...source, notices: ['Retraction in'] }), /notice/);
  assert.throws(() => parsePrimarySource('<meta name="citation_title" content="Search snippet only">', source.url), /primary record/);
  await assert.rejects(fetchPrimarySource('https://evil.example/1/', { fetchImpl: () => { throw Error('Must not fetch'); } }), /direct PubMed/);
});

test('shared catalogue verifies bytes and can register growing moves before family history is loaded', t => {
  const h = harness(t), draft = validateTeachingDraft(libraryDraft(), libraryTopic(), [librarySource()], moves);
  const document = buildTeachingDocument(libraryTopic(), draft, [librarySource()], libraryReview(), moves);
  const directory = join(h.dataDirectory, 'catalogue-copy'), loaded = [];
  const catalogue = createLibraryCatalog(directory, { preparedLibrary: h.preparedLibrary, registerMove: move => loaded.push(move) }); catalogue.publish(document);
  const fresh = createLibraryCatalog(directory, { preparedLibrary: h.preparedLibrary, registerMove: move => loaded.push(move) }); assert.equal(fresh.list().length, 1); assert.equal(loaded.length, 2);
  const mutated = structuredClone(document); mutated.move.practiceScript += ' New advice.';
  assert.throws(() => catalogue.publish(mutated), /changed/);
  assert.equal(document.sha256, documentHash(document));
});

test('official XML record parsing reads actual title, authors, date and abstract without fetching arbitrary URLs', async () => {
  const xml = `<?xml version="1.0"?><PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>99999991</PMID><Article><Journal><JournalIssue><PubDate><Year>2020</Year></PubDate></JournalIssue><Title>Fictional Fixture Journal</Title></Journal><ArticleTitle>Fictional source &amp; teaching test</ArticleTitle><Abstract><AbstractText>This fictional source says that naming emotions was linked with clearer descriptions. It reports an association and did not test a home teaching guide.</AbstractText></Abstract><AuthorList><Author><LastName>Researcher</LastName><ForeName>Fixture</ForeName></Author></AuthorList></Article></MedlineCitation><PubmedData><ArticleIdList><ArticleId IdType="doi">10.1234/fixture</ArticleId></ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>`;
  const parsed = validateSourceReceipt(parsePubMedXML(xml, librarySource().url));
  assert.equal(parsed.title, 'Fictional source & teaching test'); assert.deepEqual(parsed.authors, ['Fixture Researcher']); assert.equal(parsed.year, 2020); assert.equal(parsed.doi, '10.1234/fixture');
  assert.throws(() => parsePubMedXML(xml.replace('<PMID>99999991', '<PMID>99999992'), librarySource().url), /identifier/);
  const result = await fetchPrimarySource(librarySource().url, { fetchImpl: async (value, options) => { const url = new URL(value); assert.equal(url.hostname, 'eutils.ncbi.nlm.nih.gov'); assert.equal(url.pathname, '/entrez/eutils/efetch.fcgi'); assert.equal(url.searchParams.get('id'), '99999991'); assert.equal(options.redirect, 'error'); return new Response(xml, { headers: { 'Content-Type': 'application/xml' } }); } });
  assert.equal(result.contentHash, parsed.contentHash);
});

test('durable call exhaustion ends in truthful review status rather than offering an impossible resume', async t => {
  let calls = 0;
  const h = harness(t, { override: () => { calls++; throw Error('Fixture provider failure'); } });
  let status;
  for (let i = 0; i < 13; i++) { const job = h.service.start(h.account, 'primary', tonight); status = await settled(h.service, h.account, job.id); }
  assert.equal(calls, 12); assert.equal(status.status, 'review'); assert.equal(status.canResume, false); assert.match(status.message, /human review/);
  assert.equal(h.service.resume(h.account, status.id).canResume, false); assert.equal(calls, 12);
});

test('a rejected underlying action stays excluded from a newly researched topic and each transport has live permission', async t => {
  const record = seedRecord(); record.pastKits.push({ moveId: 'name-it-exactly', didItHelp: 'not for us', triedMove: 'yes' });
  let sawLivePermission = false, searched = 0;
  const calls = [], h = harness(t, { memoryFor: () => ({ exportRecord: () => structuredClone(record) }), searchSources: async () => { searched++; throw Error('Must not search'); }, transportFactory: options => { assert.equal(typeof options.familyRecordFor, 'function'); assert.equal(options.familyRecordFor().hero.nickname, 'Pip'); sawLivePermission = true; return libraryTransportFixture({ calls }); } });
  const job = h.service.start(h.account, 'primary', tonight); assert.equal((await settled(h.service, h.account, job.id)).status, 'review');
  assert.equal(sawLivePermission, true); assert.equal(searched, 0);
  assert.ok(!JSON.parse(calls[0].body.input[0].content).actionMenu.some(item => item.id === 'name-it-exactly'));
});

test('only a trusted zero-wire preflight failure restores library request and stage allowances', async t => {
  for (const marker of [true, false, undefined]) {
    const h = harness(t, { override: () => { const error = Error('Daily budget reached.'); if (marker !== undefined) error.preflight = marker; throw error; } });
    let job;
    for (let i = 0; i < 3; i++) { job = h.service.start(h.account, 'primary', tonight); await settled(h.service, h.account, job.id); }
    const checkpoint = readJSON(join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'checkpoint.json'));
    assert.equal(checkpoint.requests, marker === true ? 0 : 3); assert.equal(checkpoint.attempts['library-topic'], marker === true ? 0 : 3);
    assert.equal(h.service.status(h.account, job.id).canResume, true);
  }
});

test('seed candidates are only the first two unique server-owned PubMed ids, never URL or DOI fallbacks', () => {
  assert.deepEqual(seedPrimarySourceURLs({ sources: [{ url: 'https://evil.example/' }, { pubmed: '1/../../secret' }, { pubmed: '29878880' }, { pubmed: '29878880' }, { doi: '10.1234/fixture' }, { pubmed: '31246045' }, { pubmed: '17576282' }] }), ['https://pubmed.ncbi.nlm.nih.gov/29878880/', 'https://pubmed.ncbi.nlm.nih.gov/31246045/']);
});

test('a fetched seed finding can support a new general guide with strict scope and no duplicate fetch', async t => {
  const base = moves.find(move => move.id === 'name-it-exactly'), seedURLs = seedPrimarySourceURLs(base), selectedId = new URL(seedURLs[0]).pathname.split('/')[1];
  for (const duplicate of [false, true]) {
    const fetched = [];
    const draft = libraryDraft(); draft.evidence[0].sourceId = selectedId;
    const review = libraryReview(); review.claims[0].sourceId = selectedId;
    const h = harness(t, { searchSources: async topic => ({ ...await librarySearchFixture(topic), urls: duplicate ? [seedURLs[0], ...['99999991', '99999992', '99999993'].map(id => librarySource(id).url)] : [] }), fetchSource: async url => { fetched.push(url); return librarySource(new URL(url).pathname.split('/')[1]); }, override: request => request.stage === 'library-research' ? libraryAnswer({ sourceUrls: [seedURLs[0]], noRelevantSource: false }) : request.stage === 'library-draft' ? libraryAnswer(draft) : request.stage === 'library-review' ? libraryAnswer(review) : undefined });
    const job = h.service.start(h.account, 'primary', tonight), done = await settled(h.service, h.account, job.id);
    assert.equal(done.status, 'complete'); assert.equal(h.db.libraryJobs[0].sourceCandidatePolicy, seedSourceCandidatePolicy);
    assert.deepEqual(fetched.slice(0, 2), seedURLs); assert.equal(fetched.length, duplicate ? 5 : 2); assert.equal(new Set(fetched).size, fetched.length);
    const research = JSON.parse(h.calls.find(call => call.stage === 'library-research').body.input[0].content);
    assert.equal(research.sources.length, duplicate ? 5 : 2); assert.ok(research.sources.length <= 6);
    assert.deepEqual(research.sources[0].candidateOrigins.map(origin => origin.kind), duplicate ? ['selected-seed-reference', 'general-topic-search'] : ['selected-seed-reference']);
    for (const stage of ['library-draft', 'library-review']) {
      const request = h.calls.find(call => call.stage === stage), payload = JSON.parse(request.body.input[0].content);
      assert.equal(payload.sources[0].id, selectedId); assert.equal(payload.sources[0].candidateOrigins[0].actionBaseMoveId, base.id);
      assert.equal(payload.baseAction.practiceScript, base.practiceScript);
      for (const key of ['sources', 'science', 'detail', 'parentReceipt', 'source']) assert.equal(payload.baseAction[key], undefined);
      assert.match(request.body.instructions, /not proof|cannot become proof|never proof/);
    }
    const document = h.service.list()[0]; assert.equal(document.review.ownerApproved, false);
    assert.equal(document.move.practiceScript, base.practiceScript); assert.equal(document.move.sources[0].pubmed, selectedId);
    assert.match(document.move.science.limitation, /new home guide was not tested/);
  }
});

test('retracted, unread or mismatched seed receipts cannot be selected or published', async t => {
  const seedURLs = seedPrimarySourceURLs(moves.find(move => move.id === 'name-it-exactly'));
  for (const mode of ['retracted', 'unread', 'mismatched']) {
    const h = harness(t, { fetchSource: async url => {
      if (url === seedURLs[0]) {
        if (mode === 'unread') throw Error('Fixture source could not be read.');
        if (mode === 'mismatched') return librarySource('99999992');
        return { ...librarySource(new URL(url).pathname.split('/')[1]), notices: ['Retraction in'] };
      }
      return librarySource(new URL(url).pathname.split('/')[1]);
    }, override: request => request.stage === 'library-research' ? libraryAnswer({ sourceUrls: [seedURLs[0]], noRelevantSource: false }) : undefined });
    const job = h.service.start(h.account, 'primary', tonight), done = await settled(h.service, h.account, job.id);
    assert.equal(done.status, 'review'); assert.equal(done.canResume, false); assert.equal(h.service.list().length, 0); assert.equal(h.registered.length, 0);
    const research = h.calls.filter(call => call.stage === 'library-research'); assert.equal(research.length, 2);
    for (const call of research) assert.ok(!JSON.parse(call.body.input[0].content).sources.some(source => source.url === seedURLs[0]));
    assert.ok(!h.calls.some(call => call.stage === 'library-draft'));
    const checkpoint = readJSON(join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'checkpoint.json'));
    assert.equal(checkpoint.stages['seed-source-0'], undefined); assert.equal(checkpoint.attempts['library-research'], 2);
  }
});

test('a prior-policy terminal job keeps its source evidence and spent counters when the seed policy is added', async t => {
  const h = harness(t, { override: request => request.stage === 'library-research' ? libraryAnswer({ noRelevantSource: true, sourceUrls: [] }) : undefined });
  const job = h.service.start(h.account, 'primary', tonight); await settled(h.service, h.account, job.id);
  delete h.db.libraryJobs[0].sourceCandidatePolicy;
  const path = join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'checkpoint.json'), checkpoint = readJSON(path);
  delete checkpoint.stages['seed-source-0']; delete checkpoint.stages['seed-source-1'];
  checkpoint.sourceSearchPolicyVersion = sourceSearchPolicyVersion; checkpoint.requests = 5; checkpoint.attempts['library-research'] = 2;
  saveJSON(path, checkpoint); h.persist(); const bytes = readFileSync(path), calls = h.calls.length;
  const restarted = createLibrary({ ...h, fetchSource: async () => { throw Error('A prior review job must not fetch.'); } });
  assert.equal(restarted.start(h.account, 'primary', tonight).id, job.id);
  assert.equal(restarted.resume(h.account, job.id).canResume, false);
  assert.equal(h.calls.length, calls); assert.deepEqual(readFileSync(path), bytes);
  assert.equal(h.db.libraryJobs[0].sourceCandidatePolicy, undefined); assert.equal(restarted.list().length, 0);
});
