import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createLibrary, canRepairAdaptationNotes } from '../server/library.js';
import { readJSON } from '../server/files.js';
import { valueHash } from '../server/library-action.js';
import { libraryHarness, librarySettled, libraryAnswer } from './library-fixture.mjs';
import { actionTopic, actionSource, actionDraft, actionReview, actionTopicReview } from './library-action-fixture.mjs';

// Synthetic evidence only. The model fixture reproduces the conflicting criteria
// from the real failure; it does not claim the test activity works for children.
const note = 'A made-up child wants to group familiar objects by their materials.';
const adaptedDraft = () => {
  const draft = actionDraft(), source = actionSource();
  delete draft.instructionEvidence;
  draft.adaptation = { rationale: 'An optional home activity inspired by sorting.', limitations: 'The home activity and its outcomes were not tested.', ingredientEvidence: [{ sourceId: source.id, quote: 'Children sorted objects by material, named each material, explained a group, and found an object that did not belong.', locator: 'Synthetic abstract', supports: 'Sorting is a source ingredient, not proof of this home practice.', limitations: 'The proposed home steps were not tested.' }] };
  return draft;
};
function harness(t, { reject, direct = false, ...extra } = {}) {
  return libraryHarness(t, { searchSources: async () => ({ provider: 'PubMed ESearch', query: 'sorting children', urls: [actionSource().url], searchedAt: '2026-10-16T10:00:00Z' }), fetchSource: async () => actionSource(), ...extra,
    override: (request, calls) => {
      const data = JSON.parse(request.body.input[0].content);
      const custom = extra.override?.(request, calls, data); if (custom !== undefined) return custom;
      if (request.stage === 'library-topic') return libraryAnswer(actionTopic());
      if (request.stage === 'library-search-plan') return libraryAnswer({ concepts: [['object sorting'], ['material classification'], ['home setting']] });
      if (request.stage === 'library-topic-check') {
        const result = actionTopicReview();
        if (data.proposedAction || data.existingDocument) {
          const fullPacket = data.proposedAction ? data.sources?.[0]?.abstract && data.proposedAction.adaptation?.ingredientEvidence?.length : data.savedEvidence?.provenance?.kind === 'evidence-informed-home-adaptation';
          const consistent = data.evidenceFitMode === 'home-adaptation' && /does NOT mean a study tested/i.test(request.body.instructions) && fullPacket;
          if (!direct && !consistent) Object.assign(result, { actionFits: false, reason: 'No supplied evidence proves these exact home steps for all product ages.' });
          if (reject === 'goal') result.goalPreserved = false;
          if (reject === 'action') Object.assign(result, { actionFits: false, reason: 'The activity does not suit this request.' });
          if (reject === 'privacy') result.noPrivateDetails = false;
          if (reject === 'safety') result.safeToSearch = false;
        }
        return libraryAnswer(result);
      }
      if (request.stage === 'library-research') return libraryAnswer({ sourceUrls: [actionSource().url], noRelevantSource: false });
      if (request.stage === 'library-draft') return libraryAnswer(direct ? actionDraft() : adaptedDraft());
      if (request.stage === 'library-review') {
        const review = actionReview({ ...data, draft: { ...data.draft, instructionEvidence: data.draft.instructionEvidence ?? [] } });
        if (!direct) Object.assign(review, { adaptationReviewed: true, adaptationLabelHonest: true, sourcePopulationPreserved: true, actionHash: valueHash(data.draft.action), adaptationHash: valueHash(data.draft.adaptation), audience: 'child' });
        if (reject === 'evidence') review.sourceFit = false;
        if (reject === 'population') review.populationFits = false;
        if (reject === 'bound-action') review.actionHash = '0'.repeat(64);
        return libraryAnswer(review);
      }
      throw Error('Unexpected fixture stage ' + request.stage);
    },
  });
}
async function finish(h, text = note) {
  const job = h.service.start(h.account, 'primary', text);
  return { job, done: await librarySettled(h.service, h.account, job.id) };
}
test('new home adaptations and saved reuse receive the same evidence-aware fit policy', async t => {
  const h = harness(t), { job, done } = await finish(h);
  assert.equal(done.status, 'complete', JSON.stringify(done));
  assert.equal(h.db.libraryJobs[0].goalFitPolicyVersion, 'evidence-aware-goal-fit-v1');
  const check = h.calls.map(c => ({ ...c, data: JSON.parse(c.body.input[0].content) })).find(c => c.data.proposedAction);
  assert.equal(check.data.evidenceFitMode, 'home-adaptation');
  assert.equal(check.data.sources[0].contentHash, actionSource().contentHash);
  assert.deepEqual(check.data.proposedAction.evidence, adaptedDraft().evidence);
  assert.doesNotMatch(check.body.instructions, /If the source cannot support the proposed instructions for this scope, fail/);
  const before = h.calls.length;
  const again = await finish(h, 'Another made-up child wants to group familiar things by their materials.');
  assert.equal(again.done.status, 'complete', JSON.stringify(again.done));
  assert.equal(again.done.moveId, done.moveId);
  assert.deepEqual(h.calls.slice(before).map(c => c.stage), ['library-topic', 'library-topic-check']);
  const cp = readJSON(join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'checkpoint.json'));
  assert.equal(cp.requests, 6);
});
test('directly described procedures retain strict source-population review', async t => {
  const h = harness(t, { direct: true }), { done } = await finish(h);
  assert.equal(done.status, 'complete', JSON.stringify(done));
  const check = h.calls.find(c => JSON.parse(c.body.input[0].content).proposedAction);
  assert.match(check.body.instructions, /If the source cannot support the proposed instructions for this scope, fail/);
  assert.equal(JSON.parse(check.body.input[0].content).evidenceFitMode, 'described-procedure-or-saved-action');
});
test('an adaptation label never overrides rejected evidence, suitability, bindings or goal/privacy/safety fit', async t => {
  for (const reject of ['evidence', 'population', 'bound-action', 'goal', 'action', 'privacy', 'safety']) {
    const h = harness(t, { reject }), { job, done } = await finish(h);
    assert.equal(done.status, 'review', reject + ': ' + JSON.stringify(done));
    assert.equal(h.service.list().length, 0, reject);
    if (reject === 'action') {
      assert.match(done.message, /practice.*fit/);
      assert.doesNotMatch(done.message, /preserve your learning goal/);
      const cp = readJSON(join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'checkpoint.json'));
      assert.equal(cp.stages['library-action-check'].reason, 'The activity does not suit this request.');
    }
    if (reject === 'goal') assert.match(done.message, /learning goal/);
    if (['privacy', 'safety'].includes(reject)) assert.match(done.message, /privacy or safety/);
  }
});
test('an older failed job keeps its original contract and spent requests on service reload', async t => {
  const h = harness(t, { override: (request) => {
    // Model a job that predates the fix before its first request is built.
    delete h.db.libraryJobs[0].goalFitPolicyVersion;
  } });
  const { job, done } = await finish(h);
  assert.equal(done.status, 'review');
  const path = join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'checkpoint.json');
  const before = readJSON(path), calls = h.calls.length;
  const restored = createLibrary({ ...h });
  assert.equal(restored.status(h.account, job.id).canResume, false);
  assert.equal(restored.resume(h.account, job.id).status, 'review');
  assert.deepEqual(readJSON(path), before);
  assert.equal(h.calls.length, calls);
});

test('a fresh automatic kit never inherits an older failed research record or its verdict', async t => {
  let legacy = true;
  const h = harness(t, { override: (request, calls, data) => {
    if (legacy) delete h.db.libraryJobs[0].goalFitPolicyVersion;
    if (request.stage === 'library-topic' && data.menu) return libraryAnswer({ moveId: null, fits: false });
  } });
  const first = await finish(h);
  assert.equal(first.done.status, 'review');
  const oldJob = structuredClone(h.db.libraryJobs[0]);
  const path = join(h.dataDirectory, h.account.id, 'library-jobs', first.job.id, 'checkpoint.json');
  const oldCheckpoint = readJSON(path);
  legacy = false;
  const next = await h.service.ensureForMoment(h.account, 'primary', note, { parentJobId: 'new-kit' });
  assert.equal(next.status, 'complete', JSON.stringify(next));
  assert.notEqual(next.libraryJobId, first.job.id);
  assert.equal(h.db.libraryJobs.length, 2);
  assert.deepEqual(h.db.libraryJobs[0], oldJob);
  assert.deepEqual(readJSON(path), oldCheckpoint);
  assert.equal(h.db.libraryJobs[1].parentJobId, 'new-kit');
});

test('explicit new research also skips an old-policy rejection without changing its spent record', async t => {
  let legacy = true;
  const h = harness(t, { override: () => { if (legacy) delete h.db.libraryJobs[0].goalFitPolicyVersion; } });
  const first = await finish(h);
  const old = structuredClone(h.db.libraryJobs[0]);
  const path = join(h.dataDirectory, h.account.id, 'library-jobs', first.job.id, 'checkpoint.json');
  const spent = readJSON(path);
  legacy = false;
  const next = await finish(h);
  assert.equal(next.done.status, 'complete', JSON.stringify(next.done));
  assert.notEqual(next.job.id, first.job.id);
  assert.deepEqual(h.db.libraryJobs[0], old);
  assert.deepEqual(readJSON(path), spent);
  const before = h.calls.length;
  assert.equal(h.service.start(h.account, 'primary', note).id, next.job.id);
  assert.equal(h.calls.length, before, 'same-policy explicit start still deduplicates');
});
test('different current-policy parent kits do not inherit a rejected private research attempt', async t => {
  let rejectFirst = true;
  const h = harness(t, { override: (request, calls, data) => {
    if (request.stage === 'library-topic' && data.menu) return libraryAnswer({ moveId: null, fits: false });
    if (rejectFirst && data.proposedAction) return libraryAnswer({ ...actionTopicReview(), actionFits: false });
  } });
  const first = await h.service.ensureForMoment(h.account, 'primary', note, { parentJobId: 'first-kit' });
  assert.equal(first.status, 'review');
  const old = structuredClone(h.db.libraryJobs[0]);
  rejectFirst = false;
  const next = await h.service.ensureForMoment(h.account, 'primary', note, { parentJobId: 'second-kit' });
  assert.equal(next.status, 'complete', JSON.stringify(next));
  assert.notEqual(next.libraryJobId, first.libraryJobId);
  assert.deepEqual(h.db.libraryJobs[0], old);
});

test('empty required-concept searches broaden once using only the independently cleared topic phrases', async t => {
  const searches = [];
  const h = harness(t, { searchSources: async (topic, options) => {
    searches.push({ topic, options });
    return { provider: 'PubMed ESearch', query: 'synthetic query ' + searches.length, urls: searches.length === 3 ? [actionSource().url] : [], searchedAt: '2026-10-24T00:00:00Z' };
  } });
  const { job, done } = await finish(h);
  assert.equal(done.status, 'complete', JSON.stringify(done));
  assert.equal(searches.length, 3);
  assert.deepEqual(searches[2], { topic: actionTopic().topic, options: { terms: actionTopic().matchTerms } });
  const directory = join(h.dataDirectory, h.account.id, 'library-jobs', job.id);
  const cp = readJSON(join(directory, 'checkpoint.json'));
  assert.equal(cp.stages['refined-search'].urls.length, 0);
  assert.deepEqual(cp.stages['broad-search'].urls, [actionSource().url]);
  assert.equal(readJSON(join(directory, 'checkpoint-before-source-refinement.json')).stages['primary-search'].query, 'synthetic query 1');
  assert.equal(cp.requests, 8); assert.equal(cp.attempts['library-research'], 1);
  const plan = h.calls.find(c => c.stage === 'library-search-plan');
  assert.deepEqual(JSON.parse(plan.body.input[0].content).previousSearch, { queries: ['synthetic query 1'], candidateCount: 0 });
  assert.match(plan.body.instructions, /fewer required concepts/);
});
test('broader candidates still fail evidence review, and empty fallback never loops or resets calls', async t => {
  for (const rejectEvidence of [true, false]) {
    let searches = 0;
    const h = harness(t, { reject: rejectEvidence ? 'evidence' : undefined, searchSources: async () => ({ provider: 'PubMed ESearch', query: 'synthetic ' + (++searches), urls: searches === 3 && rejectEvidence ? [actionSource().url] : [], searchedAt: '2026-10-24T00:00:00Z' }) });
    const { job, done } = await finish(h);
    assert.equal(done.status, 'review'); assert.equal(h.service.list().length, 0);
    assert.equal(searches, 3);
    const path = join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'checkpoint.json'), before = readJSON(path), calls = h.calls.length;
    h.service.resume(h.account, job.id); h.service.start(h.account, 'primary', note);
    assert.equal(searches, 3); assert.equal(h.calls.length, calls); assert.deepEqual(readJSON(path), before);
  }
});
test('broad search receipt and spent calls survive a later draft transport failure', async t => {
  let searches = 0, drafts = 0;
  const h = harness(t, { searchSources: async () => ({ provider: 'PubMed ESearch', query: 'synthetic ' + (++searches), urls: searches === 3 ? [actionSource().url] : [], searchedAt: '2026-10-24T00:00:00Z' }), override: request => {
    if (request.stage === 'library-draft' && ++drafts === 1) throw Error('Synthetic transient draft failure');
  } });
  const { job, done } = await finish(h); assert.equal(done.status, 'failed');
  const path = join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'checkpoint.json'), before = readJSON(path);
  h.service.resume(h.account, job.id); const after = await librarySettled(h.service, h.account, job.id);
  assert.equal(after.status, 'complete', JSON.stringify(after)); assert.equal(searches, 3);
  const cp = readJSON(path); assert.equal(cp.attempts['library-draft'], 2); assert.ok(cp.requests > before.requests);
  assert.deepEqual(cp.stages['broad-search'], before.stages['broad-search']);
});
test('an older research attempt does not acquire the new broader-search allowance on Resume', async t => {
  let searches = 0;
  const h = harness(t, { searchSources: async () => ({ provider: 'PubMed ESearch', query: 'synthetic ' + (++searches), urls: [], searchedAt: '2026-10-24T00:00:00Z' }), override: () => { delete h.db.libraryJobs[0].broadSearchPolicyVersion; } });
  const { job, done } = await finish(h); assert.equal(done.status, 'review'); assert.equal(searches, 2);
  const path = join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'checkpoint.json'), before = readJSON(path), calls = h.calls.length;
  h.service.resume(h.account, job.id); assert.equal(h.calls.length, calls); assert.equal(searches, 2); assert.deepEqual(readJSON(path), before);
});

function noteReview(data, blocked = true) {
  const review = actionReview({ ...data, draft: { ...data.draft, instructionEvidence: [] } });
  return { ...review, passed: !blocked, adaptationReviewed: true, adaptationLabelHonest: true, sourcePopulationPreserved: true, actionHash: valueHash(data.draft.action), adaptationHash: valueHash(data.draft.adaptation), audience: 'child', blockingIssues: blocked ? [{ field: 'adaptation.limitations', reason: 'Explain study population in everyday words.' }] : [], wordingNotes: [], reason: blocked ? 'Only the parent note needs simpler words.' : 'The revised notes preserve all facts and limits.' };
}
const plainNote = 'These home steps were not tested with children in the study.';
function noteHarness(t, { failCheck = false, rejectRepair = false, pauseRepair = false, evidenceFails = false, fitFails = false } = {}) {
  let paused = false;
  return harness(t, { override(request, calls, data) {
    if (request.stage === 'library-draft' && data.issues) {
      if (pauseRepair && !paused) { paused = true; throw Object.assign(Error('Synthetic repair unavailable before send.'), { preflight: true }); }
      return libraryAnswer({ rationale: data.draft.adaptation.rationale, limitations: plainNote, ...(rejectRepair ? { action: { positiveAction: 'Changed practice' } } : {}) });
    }
    if (request.stage === 'library-review') {
      const repaired = data.draft.adaptation.limitations === plainNote;
      const result = noteReview(data, !repaired || failCheck);
      if (evidenceFails) result.sourceFit = false;
      return libraryAnswer(result);
    }
    if (fitFails && request.stage === 'library-topic-check' && data.proposedAction?.adaptation?.limitations === plainNote) return libraryAnswer({ ...actionTopicReview(), actionFits: false });
  } });
}
test('plain parent-note repair keeps all original work and requires two fresh independent checks', async t => {
  const h = noteHarness(t), { job, done } = await finish(h);
  assert.equal(done.status, 'complete', JSON.stringify(done));
  const cp = readJSON(join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'checkpoint.json'));
  assert.equal(cp.requests, 9, 'Six original calls plus three repair calls.');
  assert.equal(cp.stages['library-review'].passed, false);
  assert.equal(cp.stages['library-note-review'].passed, true);
  assert.equal(cp.stages['library-note-fit'].actionFits, true);
  assert.deepEqual(cp.stages['library-note-draft'].action, cp.stages['library-draft'].action);
  assert.deepEqual(cp.stages['library-note-draft'].evidence, cp.stages['library-draft'].evidence);
  assert.deepEqual(cp.stages['library-note-draft'].rhymeLines, cp.stages['library-draft'].rhymeLines);
  assert.equal(cp.stages['library-note-draft'].adaptation.limitations, plainNote);
  assert.ok(canRepairAdaptationNotes(cp));
  const exhausted = structuredClone(cp); delete exhausted.noteRepair;
  for (const key of ['library-note-draft','library-note-review','library-note-fit']) { delete exhausted.stages[key]; delete exhausted.stageReceipts[key]; delete exhausted.attempts[key]; }
  exhausted.requests = 10;
  assert.equal(canRepairAdaptationNotes(exhausted), false, 'Never extend the twelve-call allowance.');
  exhausted.requests = 9;
  assert.equal(canRepairAdaptationNotes(exhausted), true);
  exhausted.stages['library-draft'].action.positiveAction = 'Tampered action';
  assert.equal(canRepairAdaptationNotes(exhausted), false, 'Original value binding is mandatory.');
});
test('note repair never publishes changed practice, failed evidence, failed review or failed goal fit', async t => {
  for (const mode of ['rejectRepair','evidenceFails','failCheck','fitFails']) {
    const h = noteHarness(t, { [mode]: true }), { job, done } = await finish(h);
    assert.equal(done.status, 'review', mode + ': ' + JSON.stringify(done));
    assert.equal(h.service.list().length, 0);
    const before = h.calls.length;
    if (mode === 'evidenceFails') assert.equal(before, 6, 'Bad evidence gets no wording rescue.');
    const cp = readJSON(join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'checkpoint.json'));
    assert.ok(cp.requests <= 12);
    if (mode === 'rejectRepair') assert.equal(cp.attempts['library-note-draft'], 1);
    assert.equal(done.canResume, false, 'A spent or rejected repair is not offered again.');
    assert.equal(h.service.resume(h.account, job.id).status, 'review');
    assert.equal(h.calls.length, before, 'Repeated Resume does not renew repair calls.');
  }
});
test('Resume reuses original draft and reviews when the note repair was unavailable before send', async t => {
  const h = noteHarness(t, { pauseRepair: true }), { job, done } = await finish(h);
  assert.notEqual(done.status, 'complete');
  const path = join(h.dataDirectory, h.account.id, 'library-jobs', job.id, 'checkpoint.json');
  const before = readJSON(path); assert.equal(before.requests, 6);
  h.service.resume(h.account, job.id);
  const afterJob = await librarySettled(h.service, h.account, job.id);
  assert.equal(afterJob.status, 'complete', JSON.stringify(afterJob));
  const after = readJSON(path); assert.equal(after.requests, 9);
  for (const key of ['library-draft','library-review','library-action-check']) {
    assert.deepEqual(after.stages[key], before.stages[key]); assert.deepEqual(after.stageReceipts[key], before.stageReceipts[key]);
  }
});
