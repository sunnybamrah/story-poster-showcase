import { parsePrimarySource } from '../server/library-sources.js';
import { assertNoFamilyText } from '../server/requests.js';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createLibrary } from '../server/library.js';
import { createPreparedLibrary } from '../server/library-prepared.js';
import { createMemory } from '../server/memory.js';
import { createAppBudget } from '../server/app-budget.js';
import { setupRecord } from '../server/app-data.js';
import { root, saveJSON } from '../server/files.js';

export const libraryTopic = () => ({ topic: 'coping with disappointment', goal: 'recognize a feeling after disappointment', actionTarget: 'use a precise feeling word', requestKind: 'practice', goalClear: true, matchTerms: ['setback', 'disappointed'], actionBaseMoveId: 'name-it-exactly', existingDocumentId: null });
export const librarySource = (pmid = '99999991') => parsePrimarySource(`<html><head><meta name="citation_title" content="Fictional teaching-library test record"><meta name="citation_author" content="Fixture Researcher"><meta name="citation_journal_title" content="Fictional Fixture Journal"><meta name="citation_publication_date" content="2020"><meta name="citation_pmid" content="${pmid}"></head><body><div class="abstract-content selected"><p>Fictional fixture only. Naming emotions was linked with clearer descriptions. This record describes an association and did not test teaching the home activity.</p></div></body></html>`, `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`, '2026-10-15T12:00:00Z');
export const libraryDraft = () => ({ title: 'Feelings after setbacks', actionBaseMoveId: 'name-it-exactly', explanation: 'A family can notice a feeling after a small setback. This guide uses the saved naming activity.', whyThisActionFits: 'The activity gives a name to the feeling after a setback.', scienceClaim: 'Naming emotions was linked with clearer descriptions.', scienceLimitation: 'This was a link, not proof that teaching this home activity helps.', rhymeLines: ['Name it,', 'claim it.'], evidence: [{ sourceId: '99999991', claim: 'Naming emotions was linked with clearer descriptions.', quote: 'Naming emotions was linked with clearer descriptions.', fitLabel: 'ADJACENT', limitation: 'The fictional fixture describes a link, not a test of this home guide.' }] });
export const libraryReview = () => ({ passed: true, sourceFit: true, actionFits: true, noNewClinicalAdvice: true, noPrivateDetails: true, noUnsupportedPromise: true, rhymeCorrect: true, goalPreserved: true, claims: libraryDraft().evidence.map(item => ({ sourceId: item.sourceId, claim: item.claim, entailed: true, fitLabelCorrect: true })) });
export const libraryTopicReview = () => ({ safeToSearch: true, noPrivateDetails: true, actionFits: true, existingDocumentFits: true, goalPreserved: true, goalClear: true, requestAppropriate: true, noFittingSeed: false });
export const libraryAnswer = value => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }], usage: { input_tokens: 10, output_tokens: 10 } });
export function libraryTransportFixture({ calls = [], override } = {}) {
  return { call: async request => {
    calls.push(request);
    if (!['library-topic', 'library-topic-check'].includes(request.stage)) assertNoFamilyText(request.body, request.privacy);
    if (override) { const value = await override(request, calls); if (value !== undefined) return value; }
    return libraryAnswer(({ 'library-search-plan': () => ({ concepts: [['emotional awareness'], ['feelings', 'labeling']] }), 'library-topic': libraryTopic, 'library-topic-check': libraryTopicReview, 'library-research': () => ({ sourceUrls: [librarySource().url], noRelevantSource: false }), 'library-draft': libraryDraft, 'library-review': libraryReview })[request.stage]());
  } };
}
export const librarySearchFixture = async topic => ({ provider: 'PubMed ESearch', query: `${topic} AND (child OR adolescent)`, urls: [librarySource().url], searchedAt: '2026-10-15T12:00:00Z' });

// Shared service harness for the original and versioned guide cases. All I/O is local.
export function libraryHarness(t, extra = {}) {
  const fixtureRoot = join(root, 'context/library-tests'); mkdirSync(fixtureRoot, { recursive: true });
  const dataDirectory = extra.dataDirectory ?? mkdtempSync(join(fixtureRoot, 'fixture-'));
  if (!extra.dataDirectory) t.after(() => rmSync(dataDirectory, { recursive: true, force: true }));
  const account = { id: 'fictional-account', childIds: ['primary'] }, other = { id: 'other-account', childIds: ['primary'] };
  const memory = createMemory(join(dataDirectory, account.id, 'family.json'));
  if (!extra.dataDirectory) memory.store(setupRecord({ real: false, nickname: 'Pip', age: 10, pronouns: 'he/him', loves: ['kites', 'drawing', 'stars'], presetId: 'comet', familyContext: 'Pip lives in Privateville with Dad.', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] }));
  const db = extra.db ?? { libraryJobs: [] }, calls = [], registered = [];
  const persist = () => saveJSON(join(dataDirectory, 'accounts.json'), db), active = new Map();
  const budget = createAppBudget(join(dataDirectory, 'daily-budget.json'), { limit: 6 });
  // These legacy research fixtures start with no prepared guides. Explicit callers can supply a bank.
  const preparedLibrary = createPreparedLibrary({ directory: join(dataDirectory, 'empty-prepared-bank') });
  const opts = { db, persist, dataDirectory, active, budget, preparedLibrary, memoryFor: () => memory, childIdFor: (account, childId = 'primary') => { if (!account.childIds.includes(childId)) throw Error('Unknown child'); return childId; }, readKey: () => 'fixture-key', transportFactory: () => libraryTransportFixture({ calls, override: extra.override }), searchSources: librarySearchFixture, fetchSource: async url => librarySource(new URL(url).pathname.split('/')[1]), registerMove: move => registered.push(move), ...extra };
  const service = createLibrary(opts);
  return { ...opts, service, account, other, memory, calls, registered };
}
export async function librarySettled(service, account, id) {
  for (let i = 0; i < 150; i++) { const status = service.status(account, id); if (status.status !== 'running') return status; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw Error('The library fixture did not settle.');
}
