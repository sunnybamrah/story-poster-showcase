import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { moves, saveJSON } from '../server/files.js';
import { valueHash } from '../server/library-action.js';
import { buildTeachingDocument } from '../server/library.js';
import { createPreparedLibrary, validatePreparedDocument, validatePreparedSource, preparedApplicability, preparedMoveFits } from '../server/library-prepared.js';
import { createLibraryCatalog, documentHash } from '../server/library-catalog.js';
import { preparePick } from '../server/picker.js';
import { buildStoryRequest } from '../server/requests.js';
import { printedSourcesFor } from '../server/kit-editorial.js';
import { isUntimedSourceAction, posterBoxes, tinyTryOptionsFor } from '../server/format.js';
import { preparedFixture, savePreparedFixture } from './library-prepared-fixture.mjs';
import { family } from './fixture.mjs';
import { makePages, visibleText } from '../server/layout.js';
import { kitText } from './kit-text-fixture.mjs';
import { validateStory } from '../server/story.js';
import { validateTeachingDraft } from '../server/library.js';
import { actionTopic, actionSource, actionDraft } from './library-action-fixture.mjs';
import { libraryPolicyVersion } from '../server/library-action.js';

const note = 'The child wants to learn to sort objects by material.';
const child = age => ({ ...structuredClone(family), hero: { ...family.hero, age }, pastKits: [] });
function setup(t, fixture) {
  const directory = mkdtempSync(join(tmpdir(), 'prepared-source-fixture-'));
  const saved = savePreparedFixture(join(directory, 'bank'), fixture);
  const catalog = createLibraryCatalog(join(directory, 'catalog'), { preparedLibrary: saved.bank });
  const move = moves.find(item => item.id === saved.document.id);
  t.after(() => { const index = moves.indexOf(move); if (index >= 0) moves.splice(index, 1); rmSync(directory, { recursive: true, force: true }); });
  return { ...saved, catalog, move };
}
test('automatic writing receives age-eligible prepared guides and saved topic reminders, including calm notes', t => {
  const { move } = setup(t);
  const calm = 'Lila had her sex education class today in 5th grade and she is comfortable.';
  const payload = JSON.parse(buildStoryRequest(child(10), calm).input[0].content);
  assert.ok(payload.moves.some(item => item.id === move.id));
  assert.ok(payload.topicReminders.some(item => item.moveId === move.id));
  const tooYoung = JSON.parse(buildStoryRequest(child(8), calm).input[0].content);
  assert.equal(tooYoung.moves.some(item => item.id === move.id), false);
});
test('v3 needs exact offline source bodies, truthful different subscription models and frozen root hash', t => {
  const fixture = preparedFixture();
  assert.equal(validatePreparedDocument(fixture.document, [fixture.source]), fixture.document);
  for (const mutate of [source => { source.bodyText += ' changed'; }, source => { source.status.state = 'needs-review'; }, source => { source.status.notices = ['Retracted publication']; }, source => { source.status.notices = ['ErratumIn']; }, source => { delete source.actualPopulation; }]) {
    const source = structuredClone(fixture.source); mutate(source); assert.throws(() => validatePreparedSource(source));
  }
  for (const mutate of [document => { document.preparation.writer.modelBasis = 'provider-response'; }, document => { document.preparation.judge.model = document.preparation.writer.model; }, document => { document.move.library.actionProvenance.instructionEvidence[0].evidence[0].quote = 'Never fetched invented text'; }, document => { document.review.actionReview.instructionChecks[0].supported = false; }, document => { document.move.library.applicability.maxAge = 17; }, document => { document.sourceReceipts[0].url = 'https://wrong.example/'; }]) {
    const document = structuredClone(fixture.document); mutate(document); document.sha256 = documentHash(document); assert.throws(() => validatePreparedDocument(document, [fixture.source]));
  }
  const directory = mkdtempSync(join(tmpdir(), 'prepared-unapproved-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  savePreparedFixture(directory, fixture);
  assert.throws(() => createPreparedLibrary({ directory }), /no frozen independent review/);
});

test('a source used only for checked applicability remains bound to the prepared guide', () => {
  const fixture = preparedFixture();
  const population = { ...structuredClone(fixture.source), id: 'only-eligibility', title: 'Synthetic population-only source', url: 'https://example.org/synthetic-population-only' };
  const applicability = { ...fixture.proof.applicability, sourceId: population.id };
  const document = buildTeachingDocument(fixture.topic, fixture.draft, [...fixture.sources, population], fixture.review, moves.filter(move => !move.library), '2026-10-16T12:00:00Z', { ...fixture.proof, applicability });
  assert.ok(document.sourceReceipts.some(source => source.id === population.id));
  assert.equal(document.move.sources.find(source => source.sourceId === population.id).limitation, applicability.label);
  assert.equal(validatePreparedDocument(document, [...fixture.sources, population]), document);
});
test('server prepared fit respects local age, negation, actor, safety, repeat and rejection', t => {
  const { move } = setup(t);
  assert.ok(preparePick(child(10), note).eligible.some(item => item.move.id === move.id));
  for (const age of [8, 9, 13, undefined]) assert.equal(preparedMoveFits(move, child(age), note), false);
  for (const text of ['The child does not want to sort objects by material.', 'Dad wants to sort objects by material.', 'The child saw a film where a child wants to sort objects by material.', 'The child wants to sort objects by material, but an adult hit the child.']) assert.equal(preparedMoveFits(move, child(10), text), false, text);
  const used = { ...child(10), pastKits: [{ moveId: move.id, didItHelp: 'yes' }] };
  assert.equal(preparePick(used, note).status, 'eligible');
  assert.ok(preparePick(used, note).eligible.some(item => item.move.id === move.id && item.repeated));
  assert.ok(preparePick(used, note, { allowRepeat: true }).eligible.some(item => item.move.id === move.id));
  used.pastKits[0].didItHelp = 'not for us';
  assert.ok(!preparePick(used, note, { allowRepeat: true }).eligible.some(item => item.move.id === move.id));
});
test('grade-only records stay browse-only, without translating grades to ages', t => {
  const fixture = preparedFixture({ applicability: { kind: 'grade-only', label: 'Synthetic grade four and above', sourceId: '99999994' } });
  const { move } = setup(t, fixture);
  for (const age of [8, 10, 13]) { assert.equal(preparedApplicability(move, child(age)).eligible, false); assert.equal(preparedMoveFits(move, child(age), note), false); }
});
test('current source status invalidates free fit and bound work while immutable history remains loaded', t => {
  const { move, bank, source, directory, document, catalog } = setup(t);
  const binding = bank.binding(move, child(10), note);
  assert.equal(bank.assertBinding(binding, move, child(10), note).sourceStatusHash, binding.sourceStatusHash);
  saveJSON(join(directory, 'source-status.json'), { [source.id]: { ...source.status, state: 'needs-review' } });
  assert.equal(preparedMoveFits(move, child(10), note), false);
  assert.throws(() => bank.assertBinding(binding, move, child(10), note));
  assert.equal(catalog.get(document.id).sha256, document.sha256);
  assert.equal(createLibraryCatalog(join(directory, '..', 'catalog'), { preparedLibrary: bank }).get(document.id).sha256, document.sha256);
  saveJSON(join(directory, 'source-status.json'), { [source.id]: { ...source.status, checkedAt: '2026-10-17' } });
  assert.throws(() => bank.assertBinding(binding, move, child(10), note), /changed after/);
  assert.ok(bank.binding(move, child(10), note).sourceStatusHash !== binding.sourceStatusHash);
  assert.throws(() => bank.assertBinding(binding, move, child(11), 'A different moment.'));
});
test('v3 uses untimed existing writer and print consumers with exact official source IDs', t => {
  const { move } = setup(t);
  assert.equal(isUntimedSourceAction(move), true);
  assert.equal(printedSourcesFor(move)[0].sourceId, '99999994');
  assert.match(posterBoxes(move).find(box => box.id === 'move').text, /Leave this for later/);
  const request = buildStoryRequest(child(10), note, { lockedMoveId: move.id });
  assert.match(request.instructions, /UNTIMED ACTION OVERRIDE/);
  assert.deepEqual(request.text.format.schema.properties.tinyTryOptions.items.properties.seconds, { type: ['number', 'null'] });
});
test('undated official guidance keeps publication date unknown on every printed source surface', t => {
  const { move, source } = setup(t, preparedFixture({ undated: true }));
  assert.equal(source.year, null);
  assert.equal(printedSourcesFor(move)[0].dateLabel, 'No publication date shown');
  assert.match(move.whereItCameFromShort, /No publication date shown/);
  const text = kitText(move); text.tinyTryOptions = tinyTryOptionsFor(move); text.pagination = validateStory(text).pagination;
  const pages = makePages(move, text);
  assert.equal(Object.keys(pages).filter(name => name.endsWith('.html')).length, 5);
  assert.match(visibleText(pages['for-you.html']), /No publication date shown/);
  assert.doesNotMatch(visibleText(pages['for-you.html']), /null|undefined/);
});
test('one whole instruction can bind separate procedure passages and a different population source', t => {
  const fixture = preparedFixture({ multiSource: true });
  assert.equal(validatePreparedDocument(fixture.document, fixture.sources), fixture.document);
  const { move, bank } = setup(t, fixture);
  assert.ok(bank.binding(move, child(10), note).sourceSetHash);
  const practice = fixture.document.move.library.actionProvenance.instructionEvidence.find(item => item.field === 'practiceScript');
  assert.equal(practice.evidence.filter(row => row.role === 'procedure').length, 2);
  assert.equal(new Set(practice.evidence.map(row => row.sourceId)).size, 2);
  for (const mutate of [document => { document.move.library.actionProvenance.instructionEvidence[0].evidence[0].quote += ' invented'; }, document => { document.move.library.actionProvenance.instructionEvidence[0].evidence[1].sourceContentHash = '0'.repeat(64); }, document => { document.move.library.actionProvenance.instructionEvidence[0].evidence.pop(); }, document => { document.review.actionReview.instructionChecks[0].evidenceHash = '0'.repeat(64); }]) {
    const document = structuredClone(fixture.document); mutate(document); document.sha256 = documentHash(document);
    assert.throws(() => validatePreparedDocument(document, fixture.sources));
  }
  const changedScope = structuredClone(fixture.sources); changedScope[1].scope = 'Changed population scope';
  assert.throws(() => validatePreparedDocument(fixture.document, changedScope));
});
test('the prepared GUIDANCE label cannot pass the unchanged version two abstract contract', () => {
  const topic = { ...actionTopic(), policyVersion: libraryPolicyVersion }, draft = actionDraft();
  draft.evidence[0].fitLabel = 'GUIDANCE';
  assert.throws(() => validateTeachingDraft(draft, topic, [actionSource()], moves.filter(move => !move.library)), /valid evidence label/);
});

test('the hosted edition’s reviewed bank loads five prepared and twelve adapted guides', { skip: !existsSync(new URL('../content/prepared-library/bundle.json', import.meta.url)) ? 'Needs the excluded files content/prepared-library/bundle.json and content/adaptation-library/bundle.json.' : false }, t => {
  const directory = mkdtempSync(join(tmpdir(), 'installed-prepared-bank-'));
  const before = new Set(moves), bank = createPreparedLibrary();
  t.after(() => {
    for (let index = moves.length - 1; index >= 0; index--) if (!before.has(moves[index])) moves.splice(index, 1);
    rmSync(directory, { recursive: true, force: true });
  });
  const catalog = createLibraryCatalog(directory, { preparedLibrary: bank });
  assert.equal(bank.documents().filter(document => document.version === 3).length, 5);
  assert.equal(bank.documents().filter(document => document.version === 4).length, 12);
  assert.equal(bank.documents().length, 17);
  assert.deepEqual(catalog.list().filter(document => document.version >= 3).map(document => document.sha256), bank.documents().map(document => document.sha256));
  const listening = catalog.list().find(document => document.title === 'Hear what someone means');
  assert.ok(listening);
  const move = moves.find(item => item.id === listening.id);
  const moment = 'My child wants to learn to listen to friends and understand what they mean.';
  assert.ok(preparePick(child(10), moment).eligible.some(item => item.move.id === move.id));
  assert.equal(bank.binding(move, child(10), moment).documentHash, listening.sha256);
  assert.equal(preparedMoveFits(move, child(8), moment), false);
  const rejected = { ...child(10), pastKits: [{ moveId: move.id, didItHelp: 'not for us' }] };
  assert.ok(!preparePick(rejected, moment, { allowRepeat: true }).eligible.some(item => item.move.id === move.id));
  for (const document of catalog.list().filter(item => item.move.library.applicability?.kind === 'grade-only')) {
    assert.equal(preparedApplicability(document.move, child(10)).eligible, false);
  }
});

test('prepared bindings survive database key ordering but reject changed, missing and extra values', t => {
  const { move, bank } = setup(t);
  const binding = bank.binding(move, child(10), note);
  const reordered = Object.fromEntries(Object.entries(binding).reverse());
  assert.deepEqual(bank.assertBinding(reordered, move, child(10), note), binding);
  for (const key of Object.keys(binding)) {
    assert.throws(() => bank.assertBinding({ ...reordered, [key]: 'changed' }, move, child(10), note));
    const missing = { ...reordered }; delete missing[key];
    assert.throws(() => bank.assertBinding(missing, move, child(10), note));
  }
  assert.throws(() => bank.assertBinding({ ...reordered, extra: true }, move, child(10), note));
});
