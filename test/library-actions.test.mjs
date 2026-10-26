import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLibrary, buildTeachingDocument, validateTeachingDraft, assertGeneralLibraryText } from '../server/library.js';
import { createLibraryCatalog, documentHash } from '../server/library-catalog.js';
import { libraryPolicyVersion, actionFingerprint, instructionEntries, canonicalActionId, sourceActionPopulation } from '../server/library-action.js';
import { moves, readJSON, saveJSON } from '../server/files.js';
import { usedMoveIds, latestMoveFeedback } from '../server/memory.js';
import { eligibleMoves } from '../server/picker.js';
import { libraryHarness, librarySettled, libraryAnswer, libraryTopic, libraryDraft, librarySource, libraryReview } from './library-fixture.mjs';
import { actionTopic, actionSource, actionDraft, actionTopicReview, actionReview } from './library-action-fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { savedKit } from './fixture.mjs';
import { validateStory } from '../server/story.js';
import { tinyTryOptionsFor } from '../server/format.js';
import { makePages, verifyOwnedWords, visibleText } from '../server/layout.js';
import { posterTypePlan } from '../server/poster-template.js';

const note = 'A made-up child wants to understand why familiar things belong in different groups.';
const originalBytes = readFileSync(new URL('../content/moves.json', import.meta.url));
function harness(t, extra = {}) {
  return libraryHarness(t, { searchSources: async (topic, { terms = [] }) => ({ provider: 'PubMed ESearch', query: `${topic}: ${terms.join(', ')}`, urls: [actionSource().url], searchedAt: '2026-10-16T10:00:00Z' }), fetchSource: async () => actionSource(),
    ...extra, override: async (request, calls) => {
      const changed = await extra.override?.(request, calls); if (changed !== undefined) return changed;
      const payload = JSON.parse(request.body.input[0].content);
      return libraryAnswer(({ 'library-search-plan': () => ({ concepts: [['categorization'], ['learning', 'sorting']] }), 'library-topic': actionTopic, 'library-topic-check': actionTopicReview, 'library-research': () => ({ sourceUrls: [actionSource().url], noRelevantSource: false }), 'library-draft': actionDraft, 'library-review': () => actionReview(payload) })[request.stage]());
    } });
}
const checkpointFor = (h, id) => join(h.dataDirectory, h.account.id, 'library-jobs', id, 'checkpoint.json');
async function finish(h, tonight = note) { const job = h.service.start(h.account, 'primary', tonight); return { job, done: await librarySettled(h.service, h.account, job.id) }; }

test('synthetic new action follows a goal, exact instruction evidence and independent reviews without a false seed', async t => {
  const h = harness(t), { job, done } = await finish(h);
  if (done.status !== 'complete') assert.fail(JSON.stringify({ done, failure: readJSON(join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'failure.json')) }));
  const document = h.service.list()[0], move = document.move, checkpoint = readJSON(checkpointFor(h, job.id));
  assert.equal(document.version, 2); assert.equal(document.goal, actionTopic().goal);
  assert.equal(move.library.actionKind, 'source-derived'); assert.equal(move.library.actionBaseMoveId, null); assert.equal(move.approvedBackup, null);
  assert.equal(move.library.practiceMode, 'untimed'); assert.ok(move.tryItDraft.options.every(option => option.seconds === null));
  assert.equal(move.practiceScript, actionDraft().action.practiceScript); assert.ok(!moves.slice(0, 14).some(seed => seed.practiceScript === move.practiceScript));
  assert.equal(move.library.actionProvenance.instructionEvidence.length, instructionEntries(actionDraft().action).length);
  assert.equal(document.review.ownerApproved, false); assert.notEqual(document.review.writer, document.review.judge);
  assert.equal(h.calls.length, 6); assert.equal(checkpoint.requests, 6); assert.equal(checkpoint.libraryPolicyVersion, libraryPolicyVersion);
  assert.equal(checkpoint.stageReceipts['library-draft'].model, document.review.writer);
  assert.equal(checkpoint.stageReceipts['library-review'].model, document.review.judge);
  assert.equal(document.review.binding.writerModelBasis, 'requested-model'); assert.equal(document.review.binding.judgeModelBasis, 'requested-model');
  for (const request of h.calls.filter(request => ['library-topic', 'library-topic-check', 'library-draft', 'library-review'].includes(request.stage))) {
    assert.ok(request.body.instructions.includes(sourceActionPopulation));
    assert.match(request.body.instructions, /actual ages|actual source ages/);
    assert.match(request.body.instructions, /subset does not show/);
  }
  assert.equal(document.review.actionReview.populationScope, sourceActionPopulation);
  assert.match(document.move.library.actionProvenance.instructionEvidence[0].populationQuote, /eight to twelve/);
  assert.deepEqual(readFileSync(new URL('../content/moves.json', import.meta.url)), originalBytes);
  for (const request of h.calls.filter(request => !['library-topic', 'library-topic-check'].includes(request.stage))) {
    assert.doesNotMatch(JSON.stringify(request.body), /Pip|Privateville|fictional-account|made-up child wants/);
    assert.equal(request.body.store, false); assert.equal(request.body.tools, undefined);
    assert.ok(JSON.parse(request.body.input[0].content).goal === actionTopic().goal || JSON.parse(request.body.input[0].content).topic.goal === actionTopic().goal);
  }
  assert.equal(h.service.matchingRecord(h.account, 'primary', note, job.id).documentHash, document.sha256);
  moves.push(move); t.after(() => moves.splice(moves.indexOf(move), 1));
  const text = kitText(move); text.tinyTryOptions = tinyTryOptionsFor(move); text.pagination = validateStory(text).pagination;
  const pages = makePages(move, text);
  assert.deepEqual(Object.keys(pages).filter(name => name.endsWith('.html')).sort(), ['for-you.html', 'poster.html', 'story-2.html', 'story.html', 'try.html']);
  assert.equal(verifyOwnedWords(pages, move), true); assert.match(visibleText(pages['try.html']), /Leave this for later/);
  assert.match(pages['try.html'], /data-writing-frame="empty"/); assert.ok(posterTypePlan(move, text).cards.plan.handwritingHeight >= 24);
});

test('v1 documents remain immutable and readable beside a new source-derived v2 guide', async t => {
  const h = harness(t), catalogue = createLibraryCatalog(join(h.dataDirectory, 'shared-library'), { preparedLibrary: h.preparedLibrary, registerMove() {} });
  const topic = libraryTopic(), draft = validateTeachingDraft(libraryDraft(), topic, [librarySource()], moves);
  const old = buildTeachingDocument(topic, draft, [librarySource()], libraryReview(), moves);
  assert.equal(old.version, 1); catalogue.publish(old);
  const path = join(h.dataDirectory, 'shared-library', `${old.id}.json`), before = readFileSync(path);
  h.service = createLibrary({ ...h, catalog: catalogue });
  assert.equal((await finish(h)).done.status, 'complete');
  const loaded = createLibraryCatalog(join(h.dataDirectory, 'shared-library'), { preparedLibrary: h.preparedLibrary, registerMove() {} });
  assert.equal(loaded.list().length, 2); assert.deepEqual(readFileSync(path), before); assert.deepEqual(loaded.get(old.id), old);
});

test('a specific practical goal and uncertain or non-practice purposes never become invented distress', async t => {
  for (const mode of ['goal-drift', 'unclear', 'comfort', 'curiosity', 'clinical']) {
    let searches = 0;
    const h = harness(t, { searchSources: async () => { searches++; throw Error('No public search is allowed'); }, override: request => {
      if (request.stage === 'library-topic' && mode !== 'goal-drift') return libraryAnswer({ ...actionTopic(), requestKind: mode === 'unclear' ? 'practice' : mode, goalClear: mode !== 'unclear' });
      if (request.stage === 'library-topic-check' && mode === 'goal-drift') return libraryAnswer({ ...actionTopicReview(), goalPreserved: false });
    } });
    const { done } = await finish(h, 'The fictional child needs a way to remember a book for class.');
    assert.equal(done.status, 'review', mode); assert.equal(searches, 0, mode); assert.equal(h.service.list().length, 0);
  }
});

test('an unrelated existing seed cannot be hidden behind a new action and a suitable seed is still preferred', async t => {
  const h = harness(t, { override: request => request.stage === 'library-topic-check' ? libraryAnswer({ ...actionTopicReview(), noFittingSeed: false }) : undefined });
  const { done } = await finish(h); assert.equal(done.status, 'review'); assert.equal(h.calls.length, 2);
  const topic = { ...actionTopic(), policyVersion: libraryPolicyVersion };
  assert.throws(() => validateTeachingDraft({ ...actionDraft(), actionBaseMoveId: 'name-it-exactly' }, topic, [actionSource()], moves), /falsely names a seed/);
});

test('new clinical advice, timed recipes, numeric timers and promises cannot enter the action contract', () => {
  const topic = { ...actionTopic(), policyVersion: libraryPolicyVersion };
  for (const mutate of [draft => { draft.action.practiceScript = 'Take medicine before trying.'; }, draft => { draft.action.bodyAction = 'Hold your breath for twenty seconds.'; }, draft => { draft.action.tinyTries[0].seconds = 30; }, draft => { draft.action.positiveAction = 'This will improve your learning.'; }, draft => { draft.action.keyword.example = 'Measure the hormone level.'; }]) {
    const draft = actionDraft(); mutate(draft);
    assert.throws(() => validateTeachingDraft(draft, topic, [actionSource()], moves));
  }
});

test('each actual instruction needs a fetched procedure quote and population evidence', () => {
  const topic = { ...actionTopic(), policyVersion: libraryPolicyVersion };
  for (const mutate of [draft => draft.instructionEvidence.pop(), draft => { draft.instructionEvidence[0].quote = 'An invented procedure not in the abstract.'; }, draft => { draft.instructionEvidence[0].populationQuote = 'Adults in a laboratory.'; }, draft => { draft.instructionEvidence[0].sourceId = '11111111'; }, draft => { draft.instructionEvidence[0].supportType = 'mechanism'; }, draft => { draft.instructionEvidence[1].field = draft.instructionEvidence[0].field; }]) {
    const draft = actionDraft(); mutate(draft);
    assert.throws(() => validateTeachingDraft(draft, topic, [actionSource()], moves));
  }
});

test('unsupported instructions, population transfers, effect inference and uncertain identity fail independent review', async t => {
  for (const mode of ['instruction', 'population', 'wrong-population-scope', 'effect', 'missing', 'hash', 'identity', 'extra-prose', 'comparison']) {
    const h = harness(t, { override: request => {
      if (request.stage !== 'library-review') return;
      const review = actionReview(JSON.parse(request.body.input[0].content));
      if (mode === 'instruction') review.instructionChecks[0].supported = false;
      if (mode === 'population') review.instructionChecks[0].populationFits = false;
      if (mode === 'wrong-population-scope') review.populationScope = 'Children below school age.';
      if (mode === 'effect') review.instructionChecks[0].noBenefitInference = false;
      if (mode === 'missing') review.instructionChecks.pop();
      if (mode === 'hash') review.instructionChecks[0].textHash = '0'.repeat(64);
      if (mode === 'identity') review.identityCertain = false;
      if (mode === 'extra-prose') review.noAdditionalInstructions = false;
      if (mode === 'comparison') review.comparedActionIds.pop();
      return libraryAnswer(review);
    } });
    assert.equal((await finish(h)).done.status, 'review', mode); assert.equal(h.service.list().length, 0, mode);
  }
});

test('abstracts without action detail stop honestly and retain their evidence', async t => {
  for (const stage of ['library-research', 'library-draft']) {
    const h = harness(t, { override: request => request.stage === stage ? libraryAnswer(stage === 'library-research' ? { sourceUrls: [], noRelevantSource: true } : { needsHumanReview: true, reason: 'No procedure detail.' }) : undefined });
    const { job, done } = await finish(h); assert.equal(done.status, 'review'); assert.equal(h.service.list().length, 0);
    assert.ok(readJSON(checkpointFor(h, job.id)).stages['source-0']);
  }
});

test('a final private comparison catches a new action that lost the original goal', async t => {
  const h = harness(t, { override: request => request.stage === 'library-topic-check' && JSON.parse(request.body.input[0].content).proposedAction ? libraryAnswer({ ...actionTopicReview(), goalPreserved: false }) : undefined });
  assert.equal((await finish(h)).done.status, 'review'); assert.equal(h.service.list().length, 0);
});

test('private note fragments and identities cannot hide in a new small choice', async t => {
  const h = harness(t, { override: request => {
    if (request.stage !== 'library-draft') return;
    const draft = actionDraft(); draft.action.tinyTries[0].text = 'Remember the purple attic shelf.'; return libraryAnswer(draft);
  } });
  const { done } = await finish(h, 'A fictional child put objects on the purple attic shelf and wants to learn grouping.');
  assert.notEqual(done.status, 'complete'); assert.equal(h.service.list().length, 0); assert.ok(!h.calls.some(request => request.stage === 'library-review'));
  assert.throws(() => assertGeneralLibraryText({ goal: 'work near the purple attic shelf' }, h.memory.exportRecord(), 'Objects were left on the purple attic shelf yesterday.', { noteFragments: true }), /familyContext phrase/);
});

test('resume preserves accepted action and sources and uses actual model identities', async t => {
  let reviews = 0;
  const h = harness(t, { override: request => { if (request.stage === 'library-review' && ++reviews === 1) throw Error('Synthetic connection loss.'); } });
  const { job, done } = await finish(h); assert.equal(done.status, 'failed');
  const before = readJSON(checkpointFor(h, job.id));
  h.service.resume(h.account, job.id); assert.equal((await librarySettled(h.service, h.account, job.id)).status, 'complete');
  const after = readJSON(checkpointFor(h, job.id));
  assert.deepEqual(after.stages['library-draft'], before.stages['library-draft']); assert.deepEqual(after.stages['source-0'], before.stages['source-0']);
  assert.equal(after.attempts['library-draft'], 1); assert.equal(after.attempts['library-review'], 2);
  assert.deepEqual(h.calls.slice(5).map(request => request.stage), ['library-review', 'library-topic-check']);
});

test('a same actual model cannot approve a saved draft even if current roles differ', async t => {
  let draftModel;
  const h = harness(t, { override: request => {
    if (request.stage === 'library-draft') draftModel = request.body.model;
    if (request.stage === 'library-review') return { ...libraryAnswer(actionReview(JSON.parse(request.body.input[0].content))), model: draftModel };
  } });
  const { done } = await finish(h); assert.equal(done.status, 'review'); assert.equal(done.canResume, false); assert.equal(h.service.list().length, 0);
});

test('a version or content change cannot renew a saved attempt or reuse an unbound answer', async t => {
  const h = harness(t, { override: request => { if (request.stage === 'library-review') throw Error('Synthetic pause.'); } });
  const { job } = await finish(h), path = checkpointFor(h, job.id), checkpoint = readJSON(path), requests = checkpoint.requests;
  checkpoint.stages['library-draft'].action.practiceScript += ' Another instruction.'; saveJSON(path, checkpoint);
  const calls = h.calls.length; h.service.resume(h.account, job.id);
  const done = await librarySettled(h.service, h.account, job.id); assert.equal(done.status, 'review'); assert.equal(h.calls.length, calls); assert.equal(readJSON(path).requests, requests);
});

test('canonical identities preserve used and rejected actions across renamed guides and unanswered feedback', t => {
  const seed = moves.find(move => move.id === 'name-it-exactly');
  const aliases = ['lib-fixture-alias-one', 'lib-fixture-alias-two'].map(id => ({ ...structuredClone(seed), id, library: { status: 'reusable', actionBaseMoveId: seed.id, actionIdentity: { id: seed.id } } }));
  moves.push(...aliases); t.after(() => { for (const alias of aliases) moves.splice(moves.findIndex(move => move.id === alias.id), 1); });
  const record = { pastKits: [{ moveId: seed.id, didItHelp: 'not for us', triedMove: 'yes' }, { moveId: aliases[0].id, didItHelp: 'unanswered', triedMove: 'unanswered' }], libraryMatch: { moveId: aliases[1].id, tonight: 'A general example.' } };
  assert.ok(usedMoveIds(record).includes(aliases[1].id)); assert.equal(latestMoveFeedback(record, aliases[1].id).didItHelp, 'not for us');
  assert.equal(eligibleMoves(record, 'A general example.', { allowRepeat: true }).length, 0);
  record.pastKits.push({ moveId: aliases[0].id, didItHelp: 'a little', triedMove: 'yes' });
  assert.equal(eligibleMoves(record, 'A general example.').length, 0); assert.equal(eligibleMoves(record, 'A general example.', { allowRepeat: true })[0].repeated, true);
});

test('a cosmetic rename keeps an action fingerprint and an unknown alias is refused', () => {
  const first = actionDraft(), second = actionDraft(); second.action.name = 'Group the materials'; second.action.keyWord = 'GROUP';
  assert.equal(actionFingerprint(first.action), actionFingerprint(second.action));
  second.sameActionAs = 'action-' + '0'.repeat(24);
  assert.throws(() => validateTeachingDraft(second, { ...actionTopic(), policyVersion: libraryPolicyVersion }, [actionSource()], moves), /identity/);
});

test('reviewed paraphrases share a canonical new action and cannot bypass rejection or repeat permission', async t => {
  let alias = null, phase = 0; const registered = [];
  const h = harness(t, { registerMove: move => { moves.push(move); registered.push(move); }, override: request => {
    if (request.stage === 'library-topic' && phase) return libraryAnswer({ ...actionTopic(), topic: phase === 1 ? 'explaining material groups' : 'comparing material categories' });
    if (request.stage === 'library-draft' && phase) { const draft = actionDraft(); draft.sameActionAs = alias; draft.action.name = 'Group familiar materials'; draft.action.positiveAction = 'Put familiar things into groups by material.'; return libraryAnswer(draft); }
  } });
  t.after(() => { for (const move of registered) moves.splice(moves.indexOf(move), 1); });
  const first = await finish(h); assert.equal(first.done.status, 'complete');
  alias = canonicalActionId(h.service.getMove(first.done.moveId)); phase = 1;
  const secondNote = 'A made-up child asks how wooden and metal things differ.';
  const second = await finish(h, secondNote); assert.equal(second.done.status, 'complete');
  const secondMove = h.service.getMove(second.done.moveId);
  assert.equal(canonicalActionId(secondMove), alias); assert.notEqual(first.done.moveId, second.done.moveId);
  h.memory.addKit(savedKit({ moveId: first.done.moveId, didItHelp: 'not for us' }));
  h.memory.addKit(savedKit({ moveId: second.done.moveId, chapterNumber: 2, didItHelp: 'unanswered', triedMove: 'unanswered' }));
  const record = { ...h.memory.exportRecord(), libraryMatch: { moveId: second.done.moveId, tonight: secondNote } };
  assert.ok(usedMoveIds(record).includes(second.done.moveId)); assert.equal(eligibleMoves(record, secondNote, { allowRepeat: true }).length, 0);
  assert.throws(() => h.service.matchingRecord(h.account, 'primary', secondNote, second.job.id), error => error.code === 'saved_lesson_fit_review_required');
  phase = 2; assert.equal((await finish(h, 'A fictional learner asks about the stuff everyday items are made from.')).done.status, 'review');
  assert.equal(h.service.list().length, 2);
});

test('cached model reviews cannot be reused after the fetched source inputs change', async t => {
  const h = harness(t, { override: request => { if (request.stage === 'library-topic-check' && JSON.parse(request.body.input[0].content).proposedAction) throw Error('Synthetic final-check connection loss.'); } });
  const { job, done } = await finish(h); assert.equal(done.status, 'failed');
  const path = checkpointFor(h, job.id), checkpoint = readJSON(path), originalCount = checkpoint.requests;
  // A valid but different source receipt is a new input, even with the same PubMed id.
  const source = checkpoint.stages['source-0']; source.candidateNote = 'Synthetic changed source context'; saveJSON(path, checkpoint);
  const before = h.calls.length; h.service.resume(h.account, job.id);
  assert.equal((await librarySettled(h.service, h.account, job.id)).status, 'review'); assert.equal(h.calls.length, before); assert.equal(readJSON(path).requests, originalCount);
});

test('a cross-topic catalog change cannot publish an action reviewed against an incomplete identity list', async t => {
  const waiting = [];
  const h = harness(t, { override: request => {
    const payload = JSON.parse(request.body.input[0].content);
    if (request.stage === 'library-topic' && payload.tonight.includes('second')) return libraryAnswer({ ...actionTopic(), topic: 'classification of common materials' });
    if (request.stage === 'library-review') return new Promise(resolve => waiting.push(() => resolve(libraryAnswer(actionReview(payload)))));
  } });
  const first = h.service.start(h.account, 'primary', 'A fictional learner requests the first sorting example.');
  const second = h.service.start(h.other, 'primary', 'A fictional learner requests the second sorting example.');
  for (let step = 0; step < 150 && waiting.length < 2; step++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(waiting.length, 2); waiting[0]();
  assert.equal((await librarySettled(h.service, h.account, first.id)).status, 'complete');
  waiting[1](); const later = await librarySettled(h.service, h.other, second.id);
  assert.equal(later.status, 'review'); assert.equal(later.canResume, false); assert.equal(h.service.list().length, 1);
  assert.equal(readJSON(join(h.dataDirectory, h.other.id, 'library-jobs', second.id, 'checkpoint.json')).attempts['library-review'], 1);
});

test('an extra ingredient review does not reject the exact approved printed claim', async t => {
  const h = harness(t, { override: request => {
    if (request.stage !== 'library-review') return;
    const payload = JSON.parse(request.body.input[0].content), review = actionReview(payload);
    review.claims.push({ sourceId: actionSource().id, claim: 'The source also describes grouping objects.', entailed: true, fitLabelCorrect: true });
    return libraryAnswer(review);
  } });
  const { done } = await finish(h);
  assert.equal(done.status, 'complete');
  assert.equal(h.service.list()[0].evidence.length, 1, 'An auxiliary review is not a new printed claim.');
});

test('extra review notes cannot replace missing, false or conflicting printed-claim verdicts', () => {
  const source = librarySource(), topic = libraryTopic(), draft = validateTeachingDraft(libraryDraft(), topic, [source], moves);
  for (const mode of ['missing', 'false', 'conflicting']) {
    const review = libraryReview();
    const extra = { sourceId: source.id, claim: 'An extra ingredient note.', entailed: true, fitLabelCorrect: true };
    if (mode === 'missing') review.claims = [extra];
    if (mode === 'false') { review.claims[0].entailed = false; review.claims.push(extra); }
    if (mode === 'conflicting') review.claims.push({ ...review.claims[0], entailed: false });
    assert.throws(() => buildTeachingDocument(topic, draft, [source], review, moves), /independent review/);
  }
});

test('a previously stopped approved draft finishes from its saved answers without new requests', async t => {
  const { canFinishSavedLibraryDraft } = await import('../server/library.js');
  const { mkdirSync } = await import('node:fs');
  const first = harness(t, { override: request => {
    if (request.stage !== 'library-review') return;
    const payload = JSON.parse(request.body.input[0].content), review = actionReview(payload);
    review.claims.push({ sourceId: actionSource().id, claim: 'The source also describes grouping objects.', entailed: true, fitLabelCorrect: true });
    return libraryAnswer(review);
  } });
  const { job, done } = await finish(first); assert.equal(done.status, 'complete');
  const saved = readJSON(checkpointFor(first, job.id));
  assert.equal(canFinishSavedLibraryDraft(saved, moves), true);
  const row = { ...first.db.libraryJobs[0], status: 'review', message: 'The independent check found a problem. This teaching draft is saved privately and is not in the shared library.' };
  delete row.documentId; delete row.documentHash; delete row.actionIdentity;
  const resumed = harness(t, { db: { libraryJobs: [row] }, override: () => { throw Error('No model request should be repeated.'); }, searchSources: () => { throw Error('No public search should be repeated.'); }, fetchSource: () => { throw Error('No source fetch should be repeated.'); } });
  mkdirSync(join(resumed.dataDirectory, resumed.account.id, 'library-jobs', job.id), { recursive: true });
  saveJSON(checkpointFor(resumed, job.id), saved);
  assert.equal(resumed.service.status(resumed.account, job.id).canResume, true);
  resumed.service.resume(resumed.account, job.id);
  const after = await librarySettled(resumed.service, resumed.account, job.id);
  assert.equal(after.status, 'complete', after.message);
  assert.equal(resumed.calls.length, 0);
  const checkpoint = readJSON(checkpointFor(resumed, job.id));
  assert.equal(checkpoint.requests, saved.requests); assert.deepEqual(checkpoint.attempts, saved.attempts);
  const rejected = structuredClone(saved); rejected.stages['library-review'].sourceFit = false;
  assert.equal(canFinishSavedLibraryDraft(rejected, moves), false);
});
