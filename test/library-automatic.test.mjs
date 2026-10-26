import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryHarness, libraryAnswer } from './library-fixture.mjs';
import { buildKitRecord } from '../server/app-data.js';
import { config } from '../server/config.js';

test('embedded saved selection binds the moment before calls and keeps the parent lock', async t => {
  let started = false, searches = 0, keys = 0;
  const h = libraryHarness(t, { recordForRequest: (account, id, kitContext) => buildKitRecord(h.memory.exportRecord(), { kitContext, siblings: [] }), config: { ...config, subscriptionMode: true }, readKey() { keys++; throw Error('Subscription must not read an API key'); }, searchSources() { searches++; throw Error('Saved fit should not search'); }, override(request) {
    assert.equal(started, true);
    if (request.stage === 'library-topic') return libraryAnswer({ fits: true, moveId: 'name-it-exactly' });
  } });
  h.active.set(h.account.id, 'parent-job');
  const options = { parentJobId: 'parent-job', kitContext: { focus: 'child', storyMode: 'inspired' }, onLibraryJob(id) { started = true; assert.equal(h.db.libraryJobs[0].id, id); } };
  const result = await h.service.ensureForMoment(h.account, 'primary', 'I want a way to name a feeling.', options);
  assert.equal(result.status, 'complete'); assert.equal(result.moveId, 'name-it-exactly'); assert.equal(result.reused, true);
  assert.equal(h.calls.length, 1); assert.equal(searches, 0); assert.equal(keys, 0); assert.equal(h.active.get(h.account.id), 'parent-job');
  assert.equal(result.binding.moveId, 'name-it-exactly');
  const resumed = await h.service.ensureForMoment(h.account, 'primary', 'I want a way to name a feeling.', { ...options, libraryJobId: result.libraryJobId });
  assert.equal(resumed.status, 'complete'); assert.equal(h.calls.length, 1);
  const reordered = { storyMode: 'inspired', focus: 'child' };
  const restored = await h.service.ensureForMoment(h.account, 'primary', 'I want a way to name a feeling.', { ...options, kitContext: reordered, libraryJobId: result.libraryJobId });
  assert.equal(restored.status, 'complete'); assert.equal(h.calls.length, 1);
  const reused = await h.service.ensureForMoment(h.account, 'primary', 'I want a way to name a feeling.', { ...options, kitContext: reordered });
  assert.equal(reused.libraryJobId, result.libraryJobId); assert.equal(h.calls.length, 1);
  await assert.rejects(h.service.ensureForMoment(h.account, 'primary', 'A different moment.', { ...options, libraryJobId: result.libraryJobId }), /different moment/);
  await assert.rejects(h.service.ensureForMoment(h.account, 'primary', 'I want a way to name a feeling.', { ...options, kitContext: { focus: 'parent' }, libraryJobId: result.libraryJobId }), /different moment/);
});

test('embedded no-fit starts ordinary source work automatically and never renews a reviewed job', async t => {
  let selections = 0, searches = 0;
  const h = libraryHarness(t, { searchSources: async () => { searches++; return { provider: 'PubMed ESearch', urls: [], query: 'synthetic', searchedAt: '2026-10-17' }; }, fetchSource: async () => { throw Error('Synthetic no source'); }, override(request) {
    const input = JSON.parse(request.body.input[0].content);
    if (request.stage === 'library-topic' && input.menu) { selections++; return libraryAnswer({ fits: false, moveId: null }); }
  } });
  h.active.set(h.account.id, 'parent-job');
  const result = await h.service.ensureForMoment(h.account, 'primary', 'I want to understand a disappointment.', { parentJobId: 'parent-job', kitContext: { focus: 'child' } });
  assert.ok(['review', 'failed'].includes(result.status)); assert.equal(selections, 1); assert.equal(searches, 1); assert.equal(h.active.get(h.account.id), 'parent-job');
});

test('a stopped parent job leaves research paused without a model call', async t => {
  const h = libraryHarness(t);
  h.active.set(h.account.id, 'parent-job');
  const result = await h.service.ensureForMoment(h.account, 'primary', 'Learn to name a feeling.', { parentJobId: 'parent-job', shouldContinue: () => false });
  assert.equal(result.status, 'paused'); assert.equal(h.calls.length, 0); assert.equal(h.active.get(h.account.id), 'parent-job');
});

test('automatic no-fit can publish a source-bound untested adaptation through the existing research stages', async t => {
  const { actionTopic, actionSource, actionDraft, actionReview, actionTopicReview } = await import('./library-action-fixture.mjs');
  const { valueHash } = await import('../server/library-action.js');
  const h = libraryHarness(t, { searchSources: async () => ({ provider: 'PubMed ESearch', urls: [actionSource().url], query: 'synthetic', searchedAt: '2026-10-17' }), fetchSource: async () => actionSource(), override(request) {
    const payload = JSON.parse(request.body.input[0].content);
    if (request.stage === 'library-topic') return libraryAnswer(payload.menu ? { fits: false, moveId: null } : actionTopic());
    if (request.stage === 'library-topic-check') return libraryAnswer(actionTopicReview());
    if (request.stage === 'library-research') return libraryAnswer({ sourceUrls: [actionSource().url], noRelevantSource: false });
    if (request.stage === 'library-draft') {
      const draft = actionDraft(); delete draft.instructionEvidence;
      draft.adaptation = { rationale: 'An invented untimed home exercise using the grouping ingredient.', limitations: 'The home exercise was not tested.', ingredientEvidence: [{ sourceId: actionSource().id, quote: 'Children sorted objects by material, named each material, explained a group, and found an object that did not belong.', locator: 'Synthetic abstract', supports: 'Grouping familiar materials.', limitations: 'No home benefit is established.' }] };
      return libraryAnswer(draft);
    }
    if (request.stage === 'library-review') return libraryAnswer({ ...actionReview(payload), adaptationReviewed: true, adaptationLabelHonest: true, sourcePopulationPreserved: true, actionHash: payload.actionHash, adaptationHash: payload.adaptationHash, audience: 'child' });
  } });
  h.active.set(h.account.id, 'parent-job');
  const result = await h.service.ensureForMoment(h.account, 'primary', 'Practice grouping objects by material.', { parentJobId: 'parent-job', kitContext: { focus: 'child' } });
  assert.equal(result.status, 'complete', result.status === 'complete' ? '' : result.message + ' ' + (await import('node:fs')).readFileSync(h.dataDirectory + '/' + h.account.id + '/library-jobs/' + result.libraryJobId + '/failure.json', 'utf8'));
  const move = h.service.getMove(result.moveId);
  assert.equal(move.library.actionProvenance.kind, 'evidence-informed-home-adaptation');
  assert.match(move.science.limitation, /not tested/);
  assert.equal(h.service.matchingRecord(h.account, 'primary', 'Practice grouping objects by material.', result.libraryJobId).moveId, result.moveId);
  assert.equal(h.active.get(h.account.id), 'parent-job');
});

test('parent focus can reuse an original adult-evidence action without changing source claims', async t => {
  const { moves } = await import('../server/files.js');
  const { libraryMoveAudienceFits } = await import('../server/library-action.js');
  const context = { focusPersonId: 'grown-up-one', storyMode: 'inspired', siblingChildIds: [], remembranceChildLed: false };
  assert.deepEqual(moves.filter(move => !move.library && libraryMoveAudienceFits(move, context)).map(move => move.id), ['name-it-exactly', 'coach-voice', 'butterflies-mean-ready']);
  const h = libraryHarness(t, { searchSources: async () => { throw Error('Existing adult finding should be reusable'); }, override(request) {
    const input = JSON.parse(request.body.input[0].content);
    if (request.stage === 'library-topic' && input.menu) { assert.deepEqual(input.menu.map(move => move.id), ['name-it-exactly', 'coach-voice', 'butterflies-mean-ready']); return libraryAnswer({ fits: true, moveId: 'coach-voice' }); }
  } });
  h.active.set(h.account.id, 'parent-job');
  const before = JSON.stringify(moves.find(move => move.id === 'coach-voice'));
  const result = await h.service.ensureForMoment(h.account, 'primary', 'I want to speak to myself more kindly after a small mistake.', { parentJobId: 'parent-job', kitContext: context });
  assert.equal(result.status, 'complete'); assert.equal(result.moveId, 'coach-voice'); assert.equal(result.reused, true);
  assert.match(h.db.libraryJobs[0].audienceRationale, /ADULT ONLY/);
  assert.equal(JSON.stringify(moves.find(move => move.id === 'coach-voice')), before);
});

test('unknown saved-guide answers do not trigger public research', async t => {
  let searches = 0;
  const h = libraryHarness(t, { searchSources: async () => { searches++; throw Error('Unknown is not no fit'); }, override(request) {
    if (request.stage === 'library-topic') return libraryAnswer({});
  } });
  h.active.set(h.account.id, 'parent-job');
  const result = await h.service.ensureForMoment(h.account, 'primary', 'A difficult moment.', { parentJobId: 'parent-job' });
  assert.ok(['review', 'failed'].includes(result.status));
  assert.equal(searches, 0); assert.equal(h.calls.length, 2);
});

test('a saved topic match belongs to its current learner and story choice', async t => {
  const h = libraryHarness(t, { override(request) { if (request.stage === 'library-topic') return libraryAnswer({ fits: true, moveId: 'name-it-exactly' }); } });
  const kitContext = { focusPersonId: 'child', storyMode: 'inspired', siblingChildIds: [], remembranceChildLed: false };
  h.active.set(h.account.id, 'parent-job');
  const result = await h.service.ensureForMoment(h.account, 'primary', 'Name a feeling.', { parentJobId: 'parent-job', kitContext });
  assert.equal(result.status, 'complete');
  assert.equal(h.service.matchingRecord(h.account, 'primary', 'Name a feeling.', result.libraryJobId, { kitContext }).moveId, 'name-it-exactly');
  for (const changed of [{ ...kitContext, focusPersonId: 'grown-up-one' }, { ...kitContext, storyMode: 'factual' }, { ...kitContext, siblingChildIds: ['different-child'] }]) {
    assert.throws(() => h.service.matchingRecord(h.account, 'primary', 'Name a feeling.', result.libraryJobId, { kitContext: changed }), error => error.code === 'saved_lesson_fit_review_required');
  }
});

test('ordinary goal punctuation is allowed while identity and contact syntax remain rejected', async () => {
  const { generalGoal } = await import('../server/library-action.js');
  for (const goal of ['learn to judge information by its publisher, evidence and independent support', 'compare the sources (not their colour).', "check a publisher’s evidence; compare independent reporting"]) {
    assert.equal(generalGoal(goal, 'general learning goal', { allowPronouns: true }), goal);
  }
  for (const goal of ['email maya@example.test', 'visit https://private.example', 'help Maya check a claim', 'learn about a child aged 10', 'meet at willow street']) assert.throws(() => generalGoal(goal));
});

test('a legacy punctuation stop can retry inside its existing request allowance', async t => {
  const { mkdirSync } = await import('node:fs'); const { join } = await import('node:path');
  const { saveJSON } = await import('../server/files.js');
  const { libraryPolicyVersion } = await import('../server/library-action.js');
  const { actionTopic } = await import('./library-action-fixture.mjs');
  const h = libraryHarness(t), id = 'synthetic-held-topic';
  h.db.libraryJobs.push({ id, accountId: h.account.id, childId: 'primary', status: 'review', stage: 'library-topic', libraryPolicyVersion });
  const directory = join(h.dataDirectory, h.account.id, 'library-jobs', id); mkdirSync(directory, { recursive: true });
  const checkpoint = { requests: 3, attempts: { 'library-topic': 2 }, stages: {} };
  const answer = { ...actionTopic(), goal: 'learn to judge information by its publisher, evidence and independent support' };
  saveJSON(join(directory, 'checkpoint.json'), checkpoint);
  saveJSON(join(directory, 'failure.json'), { stage: 'library-topic', reason: 'The general learning goal must contain only general words without private details.' });
  saveJSON(join(directory, 'library-topic-2-answer.json'), libraryAnswer(answer));
  assert.equal(h.service.status(h.account, id).canResume, true);
  checkpoint.requests = 12; saveJSON(join(directory, 'checkpoint.json'), checkpoint);
  assert.equal(h.service.status(h.account, id).canResume, false);
  checkpoint.requests = 3; saveJSON(join(directory, 'checkpoint.json'), checkpoint);
  saveJSON(join(directory, 'library-topic-2-answer.json'), libraryAnswer({ ...answer, goal: 'help Maya at willow street' }));
  assert.equal(h.service.status(h.account, id).canResume, false);
  assert.equal(h.calls.length, 0, 'Inspecting recovery does not send a request.');
});
