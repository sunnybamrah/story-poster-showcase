import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { preparedFixture } from './library-prepared-fixture.mjs';
import { buildTeachingDocument } from '../server/library.js';
import { validatePreparedDocument, preparedApplicability, isPreparedMove } from '../server/library-prepared.js';
import { valueHash, actionFromMove, validateDerivedAction, validateActionReview, knownActionMenu } from '../server/library-action.js';
import { moves } from '../server/files.js';
import { actionDraft, actionSource, actionReview } from './library-action-fixture.mjs';
import { printedSourcesFor } from '../server/kit-editorial.js';

function adaptationFixture() {
  const f = preparedFixture();
  const item = f.draft.instructionEvidence[0].evidence[0];
  f.draft.adaptation = { rationale: 'A synthetic home adaptation with an invented gesture, not a copied procedure.', limitations: 'Not tested as a home activity.', ingredientEvidence: [{ ...item, supports: 'Synthetic ingredient only.', limitations: 'Does not test this home practice.' }] };
  delete f.draft.adaptation.ingredientEvidence[0].role;
  f.proof = { ...f.proof, preparedVersion: 4, audience: 'child', applicability: { kind: 'home-adaptation', sourceId: f.source.id, label: 'Home practice suitability, not a study age claim.', actualSourcePopulation: f.source.actualPopulation, productScope: 'Home practice, not a tested intervention', suitabilityReason: 'Synthetic parent-led optional practice.' }, draftHash: valueHash(f.draft) };
  const provenance = { ...f.draft.adaptation, kind: 'evidence-informed-home-adaptation', contractVersion: 4, actionHash: valueHash(f.draft.action), label: 'BEST GUESS: home practice, not tested' };
  f.review = { ...f.review, adaptationReviewed: true, adaptationLabelHonest: true, sourcePopulationPreserved: true, actionHash: valueHash(f.draft.action), adaptationHash: valueHash(provenance), audience: 'child' };
  f.proof.preparation.reviewHash = valueHash(f.review);
  f.document = buildTeachingDocument(f.topic, f.draft, f.sources, f.review, moves.filter(move => !move.library), '2026-10-17T00:00:00Z', f.proof);
  return f;
}
test('v4 supports an explicitly untested home adaptation without eleven claimed procedure quotes', () => {
  const f = adaptationFixture();
  assert.equal(f.document.version, 4); assert.equal(isPreparedMove(f.document.move), true);
  assert.equal(f.document.move.library.actionProvenance.instructionEvidence, undefined);
  assert.equal(validatePreparedDocument(f.document, f.sources), f.document);
  assert.equal(preparedApplicability(f.document.move, { hero: { age: 8 }, kitContext: { focus: 'child' } }).eligible, true);
  assert.equal(preparedApplicability(f.document.move, { hero: { age: 10 }, kitContext: { focus: 'parent' } }).eligible, false);
});
test('v4 rejects unsupported quotes, changed home steps, false audience and missing independent review', () => {
  for (const edit of [
    f => { f.document.move.library.actionProvenance.ingredientEvidence[0].quote = 'Invented source quote'; },
    f => { f.document.move.practiceScript = 'A changed action'; },
    f => { f.document.move.library.audience = 'parent'; },
    f => { f.document.review.actionReview.adaptationReviewed = false; },
    f => { f.document.preparation.judge.model = f.document.preparation.writer.model; },
  ]) { const f = adaptationFixture(); edit(f); const { sha256, ...body } = f.document; f.document.sha256 = valueHash(body); assert.throws(() => validatePreparedDocument(f.document, f.sources)); }
});
test('runtime adaptation needs explicit server permission and a bound independent check', () => {
  const source = actionSource(), draft = actionDraft(), knownActions = knownActionMenu(moves.filter(move => !move.library));
  draft.instructionEvidence = [];
  draft.adaptation = { rationale: 'An untimed home adaptation of a source ingredient.', limitations: 'This home practice was not tested.', ingredientEvidence: [{ sourceId: source.id, quote: source.abstract.slice(0, source.abstract.indexOf('.') + 1), locator: 'Synthetic abstract', supports: 'Synthetic ingredient.', limitations: 'No home effect was tested.' }] };
  assert.throws(() => validateDerivedAction(draft, [source], knownActions));
  const normalized = { ...draft, ...validateDerivedAction(draft, [source], knownActions, { allowAdaptation: true }) };
  const review = { ...actionReview({ draft: actionDraft(), knownActions }), adaptationReviewed: true, adaptationLabelHonest: true, sourcePopulationPreserved: true, actionHash: valueHash(normalized.action), adaptationHash: valueHash(normalized.adaptation), audience: 'child' };
  assert.ok(validateActionReview(normalized, review, knownActions).id);
  assert.throws(() => validateActionReview(normalized, { ...review, adaptationHash: valueHash({}) }, knownActions));
});

test('the hosted edition’s twelve restored topics preserve their source limits, actual review and grief choice', { skip: !existsSync(new URL('../content/adaptation-library/bundle.json', import.meta.url)) ? 'Needs the excluded file content/adaptation-library/bundle.json and its hosted source bodies.' : false }, async () => {
  const { createPreparedLibrary, preparedMoveFits } = await import('../server/library-prepared.js');
  const bank = createPreparedLibrary(), docs = bank.documents().filter(document => document.version === 4);
  assert.equal(docs.length, 12);
  assert.deepEqual(docs.map(document => document.title), ['Spotlight Effect', 'Power of Yet', 'Mistake Magic', 'Flexible Mind', 'Wait Your Turn', 'Words Bounce', 'My No Is Brave', 'Truth First', 'The Comeback Lab', 'Spotting the Good Stuff', 'Bounce Back Power', 'Make Room for Missing']);
  for (const document of docs) {
    assert.equal(document.review.ownerApproved, false);
    assert.equal(document.review.writer, 'gpt-6-astra'); assert.equal(document.review.judge, 'gpt-6.1-sol');
    assert.equal(document.move.library.actionProvenance.label, 'BEST GUESS: home practice, not tested');
    assert.ok(document.move.library.applicability.actualSourcePopulation);
    assert.equal(document.review.knownActionIds.length, 30);
    bank.assertCurrent(document);
    const printed = printedSourcesFor(document.move);
    assert.equal(printed.length, document.move.library.printSourceIds.length);
    assert.ok(printed.every(source => document.move.sources[source.recordIndex].sourceId === source.sourceId));
  }
  const grief = docs.find(document => document.title === 'Make Room for Missing').move, wait = docs.find(document => document.title === 'Wait Your Turn').move;
  const record = { hero: { age: 10 }, kitContext: { focusPersonId: 'child', remembranceChildLed: true } };
  assert.equal(preparedMoveFits(grief, record, 'The child is missing homework.', { sourceVerified: true }), false);
  assert.equal(preparedMoveFits(grief, record, 'The child asked to remember a pet who died.', { sourceVerified: true }), true);
  assert.equal(preparedMoveFits(grief, { ...record, kitContext: {} }, 'The child asked to remember a pet who died.', { sourceVerified: true }), false);
  assert.equal(preparedMoveFits(wait, record, 'The child is waiting for scary news.', { sourceVerified: true }), false);
  assert.equal(preparedMoveFits(wait, record, 'The child finds waiting for a turn hard.', { sourceVerified: true }), true);
  assert.match(grief.whenNotToUse, /Do not put the death/);
});

test('adaptation prose accepts lists without dropping limits, but quotes and invalid items stay checked', async () => {
  const { validateHomeAdaptation } = await import('../server/library-action.js');
  const source = actionSource();
  const input = { rationale: ['A home adaptation.', 'Its steps are invented.'], limitations: ['Younger source population.', 'No tested home benefit.'], ingredientEvidence: [{ sourceId: source.id, quote: source.abstract.slice(0, source.abstract.indexOf('.') + 1), locator: ['Synthetic abstract'], supports: ['One studied ingredient.'], limitations: ['Different setting.', 'No home test.'] }] };
  const output = validateHomeAdaptation(input, [source]);
  assert.equal(output.rationale, input.rationale.join(' '));
  assert.equal(output.limitations, input.limitations.join(' '));
  assert.equal(output.ingredientEvidence[0].limitations, input.ingredientEvidence[0].limitations.join(' '));
  for (const limitations of [[], ['kept', null], ['kept', {}], [' '], ['x'.repeat(1001)]]) assert.throws(() => validateHomeAdaptation({ ...input, limitations }, [source]));
  assert.throws(() => validateHomeAdaptation({ ...input, ingredientEvidence: [{ ...input.ingredientEvidence[0], quote: 'A fabricated finding.' }] }, [source]));
  assert.throws(() => validateHomeAdaptation({ ...input, rationale: undefined }, [source]));
});
