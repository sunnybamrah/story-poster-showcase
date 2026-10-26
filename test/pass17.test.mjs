import { expectReview } from './review-assertions.mjs';
import { selectedRhymeFor } from '../server/rhyme.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJSON, moves } from '../server/files.js';
import { posterBoxes } from '../server/format.js';
import { parsePictureCheck } from '../server/check-picture.js';
import { parseWordCheck, checkWords } from '../server/check-words.js';
import { geometryRects, validateGeometryReceipt, templatePrompt, posterTemplate } from '../server/poster-template.js';
import { buildStoryRequest, buildWordCheckRequest, buildPictureCheckRequest } from '../server/requests.js';
import { writeStory } from '../server/story.js';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { withKitEvidence } from '../server/kit-evidence.js';
import { readLog } from '../server/transport.js';
import { syntheticCastEvidence, pictureCheckAnswer, wordCheckAnswer, geometryAnswer, sourceGeometryAnswer, markFault } from './checker-fixture.mjs';
import { offlineTransport, offlineExports, textAnswer, openaiAnswer, run5 } from './offline-kit-fixture.mjs';
import { family, sentences } from './fixture.mjs';

const poster3 = readJSON(new URL('./fixtures/run9-poster-3-answer.json', import.meta.url));
const poster1 = readJSON(new URL('./fixtures/run9-poster-1-answer.json', import.meta.url));
const approved = readJSON(new URL('./fixtures/run9-approved-words.json', import.meta.url)).boxes;
const boxes = posterBoxes(moves[0], run5);
const temp = t => { const d = mkdtempSync(join(tmpdir(), 'pass17-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} versus ${b}`);
const parse = answer => parseWordCheck(JSON.stringify(answer), boxes);

test('run 9 poster 3 keeps its original words and measurements but needs actual writable-row evidence', () => {
  const original = structuredClone(poster3);
  const checked = parseWordCheck(JSON.stringify(poster3), approved);
  assert.equal(checked.ready, false); assert.equal(checked.needsRecheck, true); assert.equal(checked.geometry.writingAssessment.verified, false);
  assert.deepEqual(checked.faults, []); assert.ok(checked.wordVerdicts.every(box => box.matches));
  assert.deepEqual(checked.answers, original);
  assert.ok(checked.ignoredFaults.some(row => row.key === 'outfitMismatch'));
  assert.ok(!checked.geometry.fit.residuals.some(row => row.id === 'joke'));
  const measurement = checked.geometry.textMeasurement;
  assert.equal(measurement.excludedRules.length, 2);
  near(measurement.pointsPerSourceUnit, 720 / 1536);
  near(measurement.smallestBodyTextHeight, 24 * 720 / 1536);
  assert.ok(measurement.smallestBodyTextHeight >= 8 && measurement.smallestBodyTextHeight <= 12);
  assert.ok(measurement.lines.every(line => line.points >= 11.25 && line.working.includes('points per source unit')));
  // Ink size comes from the rendered whole canvas, not the fitted anchor span.
  near(Math.max(...measurement.lines.map(line => line.points)), 27 * 720 / 1536);
});

test('run 9 hidden shoes and table prop evidence is not an outfit fault in hero, poster or panels', () => {
  const picture = pictureCheckAnswer(), panelBoxes = [{ id: 'bubble', text: 'Name it.' }], panel = wordCheckAnswer(panelBoxes);
  for (const answer of [picture, panel]) { answer.outfitMismatch = true; answer.evidence.outfitMismatch = poster3.evidence.outfitMismatch; }
  assert.equal(parsePictureCheck(JSON.stringify(picture)).ready, true);
  assert.equal(parseWordCheck(JSON.stringify(panel), panelBoxes).ready, true);
  assert.ok(!parseWordCheck(JSON.stringify(poster3), approved).faults.some(fault => /outfit|clothing/.test(fault)));
});

test('shared outfit rule ignores hidden clothing and props but keeps a visible wrong garment or colour', () => {
  for (const kind of ['hero', 'poster', 'panel']) {
    const expected = kind === 'poster' ? boxes : [{ id: 'bubble', text: 'Name it.' }];
    const answer = kind === 'hero' ? pictureCheckAnswer() : wordCheckAnswer(expected);
    const check = () => kind === 'hero' ? parsePictureCheck(JSON.stringify(answer)) : parseWordCheck(JSON.stringify(answer), expected);
    markFault(answer, 'outfitMismatch', 'The visible hoodie is purple instead of green.');
    expectReview(check, /outfitMismatch/);
    answer.outfitObservations[0].visible = false;
    assert.equal(check().ready, true, kind);
    Object.assign(answer.outfitObservations[0], { visible: true, kind: 'prop', item: 'sketchbook' });
    assert.equal(check().ready, true, kind);
    answer.outfitObservations[0].kind = 'clothing';
    assert.equal(check().ready, true, 'A prop mislabeled as clothing still cannot fail');
    answer.outfitObservations.push({ item: 'hoodie', kind: 'clothing', visible: true, differs: true, expected: 'green', observed: 'purple', evidence: 'A purple hoodie is visible.' });
    expectReview(check, /outfitMismatch/);
  }
});

test('legacy visible colour difference still fails without the new structured observations', () => {
  const answer = pictureCheckAnswer(); answer.outfitMismatch = true;
  answer.evidence.outfitMismatch = 'The visible hoodie is purple instead of green.';
  expectReview(() => parsePictureCheck(JSON.stringify(answer)), /outfitMismatch/);
});

test('ink size uses export scale and calibration flags, with empty rules excluded', () => {
  for (const height of [6.99, 7, 9]) {
    const receipt = geometryAnswer(); receipt.textLines[0].h = height;
    receipt.textLines.push({ boxId: 'plan.body', text: '______', x: 420, y: 440, w: 140, h: 1 });
    const result = validateGeometryReceipt(receipt);
    assert.equal(result.ready, true);
    near(result.textMeasurement.smallestBodyTextHeight, height);
    assert.equal(result.textMeasurement.excludedRules.length, 1);
  }
  const answer = structuredClone(poster3);
  // Thin text cannot be discarded just for being small or wide.
  answer.geometry.textLines[0].h = 3; answer.geometry.textLines[0].text = 'Tonight, name one';
  assert.ok(parseWordCheck(JSON.stringify(answer), approved).observations.some(row => row.key === 'small_ink_review'));
});

test('empty or unrelated readback cannot turn unknown thin lines into harmless writing rules', () => {
  const answer = structuredClone(poster3);
  answer.boxes.find(box => box.id === 'move').text = 'WHAT I CAN DO\nWrong words';
  const result = parseWordCheck(JSON.stringify(answer), approved);
  assert.match([...result.faults, ...result.reviewFlags.map(flag => flag.evidence)].join('; '), /words_differ/); assert.equal(result.geometry.textMeasurement.excludedRules.length, 0);
});

test('joke has no fixed geometry and its evidence-backed observation never stops these two runs', () => {
  assert.ok(!Object.hasOwn(geometryRects(), 'joke'));
  assert.doesNotMatch(templatePrompt(), /reserved scene slot/);
  for (const value of [true, false]) {
    const answer = wordCheckAnswer(boxes); answer.jokeInScene = value;
    answer.evidence.jokeInScene = value ? 'The sketchbook wears a blank name sticker inside the room scene.' : 'I see no joke in the room.';
    const result = parse(answer);
    assert.equal(result.ready, true); const observation = result.observations.find(row => row.key === 'jokeInScene');
    assert.equal(observation.supported, true); assert.equal(observation.reportOnly, true); assert.equal(observation.reviewAfterPaidRun, 11);
  }
  const empty = wordCheckAnswer(boxes); empty.jokeInScene = true; empty.evidence.jokeInScene = '';
  assert.equal(parse(empty).observations.find(row => row.key === 'jokeInScene').value, false);
  assert.ok(parse(empty).ignoredFaults.some(row => row.key === 'jokeInScene'));
});

test('a centred pill may sit in its title band and range from forty to one hundred percent of target width', () => {
  for (const ratio of [.4, .65, .83, 1]) {
    const receipt = geometryAnswer(posterTemplate.version), title = receipt.observed.find(row => row.id === 'title'), pill = receipt.observed.find(row => row.id === 'tagline');
    title.h = 110; pill.w *= ratio; pill.x = 306 - pill.w / 2;
    const result = validateGeometryReceipt(receipt);
    assert.equal(result.ready, true, JSON.stringify(result.faults));
  }
  for (const change of [pill => { pill.w *= .2; pill.x = 306 - pill.w / 2; }, pill => { pill.x += 80; }]) {
    const receipt = geometryAnswer(posterTemplate.version); change(receipt.observed.find(row => row.id === 'tagline'));
    assert.ok(validateGeometryReceipt(receipt).observations.some(row => row.evidence.startsWith('geometry_deviation_tagline')));
  }
  const receipt = geometryAnswer(posterTemplate.version); receipt.observed.find(row => row.id === 'science').x -= 25;
  assert.ok(validateGeometryReceipt(receipt).observations.some(row => row.evidence.startsWith('geometry_overlap:')));
});

test('body text checks the card edge with three percent tolerance on each axis', () => {
  for (const axis of ['x', 'y']) for (const fraction of [.029, .03, .031]) {
    const answer = wordCheckAnswer(boxes), card = answer.geometry.observed.find(row => row.id === 'science');
    const line = answer.geometry.textLines[1], dimension = axis === 'x' ? 'w' : 'h';
    line[axis] = card[axis] - card[dimension] * fraction;
    markFault(answer, 'textCrossesBoundary', 'Words touch the drawn card edge.');
    const result = parse(answer);
    assert.equal(result.faults.some(fault => fault.startsWith('text_crosses_boundary: science.body')), fraction > .03, `${axis} ${fraction}`);
    assert.equal(result.ready, fraction <= .03);
  }
  const panelBoxes = [{ id: 'bubble', text: 'Name it.' }], panel = wordCheckAnswer(panelBoxes);
  markFault(panel, 'textCrossesBoundary', 'Name crosses the speech bubble outline.');
  assert.equal(parseWordCheck(JSON.stringify(panel), panelBoxes).ready, false);
});

const omitSubBoxes = answer => {
  answer.geometry.observed = answer.geometry.observed.filter(row => !row.id.includes('.') || row.id === 'plan.handwriting');
  return answer;
};
test('run 9 poster 1 missing card sub boxes request measurements, never missing-box drawing faults', () => {
  const result = parseWordCheck(JSON.stringify(poster1), approved);
  assert.equal(result.needsRecheck, true);
  assert.ok(result.measurementFaults.some(fault => fault.includes('missing sub box')));
  assert.ok(!result.faults.some(fault => /^missing_geometry_box: .*\.(heading|icon|body)/.test(fault)));
});

test('missing sub boxes stay saved as unverified observations after one image check', async t => {
  const directory = temp(t), answer = omitSubBoxes(wordCheckAnswer(boxes));
  const transport = offlineTransport(t, directory, request => openaiAnswer({ ...syntheticCastEvidence(request), ...answer }));
  const result = await checkWords(withKitEvidence(transport, directory), family, moves[0], sentences[0], 'data:image/png;base64,AA==', boxes);
  assert.equal(result.ready, true); assert.equal(result.checkerAttempt, 1); assert.equal(result.verified, false);
  assert.equal(transport.calls.length, 1); assert.equal(transport.calls[0].stage, 'poster-word-check');
  assert.ok(result.unresolvedMeasurements.some(row => row.includes('missing sub box')));
  const saved = readJSON(join(directory, 'picture-check-poster-1.json'));
  assert.match(saved.verdict, /unverified/); assert.equal(saved.check.geometry.subBoxesRechecked, false);
  assert.deepEqual(saved.answer.geometry, answer.geometry);
  assert.ok(result.reviewFlags.some(row => row.key === 'checker_unverified'));
  assert.match(readFileSync(join(directory, 'kit-log.md'), 'utf8'), /unverified/);
});

test('missing measurements cannot hide a missing card or a real word error after recheck', () => {
  for (const change of [answer => { answer.geometry.observed = answer.geometry.observed.filter(row => row.id !== 'science'); }, answer => { answer.boxes.find(box => box.id === 'science').text += 'Extra'; }]) {
    // A saved fixed-layout receipt names the missing box for review.
    const answer = omitSubBoxes({ ...wordCheckAnswer(boxes), geometry: sourceGeometryAnswer(posterTemplate.version) }); change(answer);
    expectReview(() => parseWordCheck(JSON.stringify(answer), boxes, { subBoxesRechecked: true }), /missing_geometry_box:/);
  }
  // A composed page reports an unmeasured card for review; its readable words still pass.
  const composed = omitSubBoxes(wordCheckAnswer(boxes)); composed.geometry.observed = composed.geometry.observed.filter(row => row.id !== 'science');
  expectReview(() => parseWordCheck(JSON.stringify(composed), boxes, { subBoxesRechecked: true }), /science Not measured after one recheck/);
});

test('an omitted body measurement after its recheck is reported without inventing a text height', () => {
  const answer = omitSubBoxes(wordCheckAnswer(boxes)); answer.geometry.textLines = [];
  const result = parseWordCheck(JSON.stringify(answer), boxes, { subBoxesRechecked: true });
  assert.equal(result.ready, true); assert.equal(result.geometry.textMeasurement.smallestBodyTextHeight, null);
  assert.ok(result.observations.some(row => row.key === 'textSizeUnmeasured'));
});

test('a whole offline kit retains the accepted missing-sub-box decision through layout and exports', async t => {
  const directory = temp(t), memory = createMemory(join(directory, 'family.json')); memory.store(structuredClone(family));
  const transport = offlineTransport(t, directory, request => request.stage === 'poster-word-check' ? openaiAnswer({ ...syntheticCastEvidence(request), ...omitSubBoxes(wordCheckAnswer(posterBoxes(moves[0], { ...run5, tagline: selectedRhymeFor(moves[0]).tagline }))) }) : undefined);
  const result = await createKit(transport, memory, sentences[0], { directory, kit: 1, exports: offlineExports() });
  assert.equal(result.complete, true); assert.equal(Object.keys(result.pages).length, 5);
  assert.equal(result.pdf.fixture, true); assert.ok(existsSync(join(directory, 'index.html')));
  assert.equal(transport.calls.filter(row => row.stage === 'poster').length, 1);
  assert.equal(transport.calls.filter(row => row.stage === 'poster-word-check').length, 1);
  const fit = readJSON(join(directory, 'poster-fit.json'));
  assert.equal(fit.subBoxesRechecked, false); assert.equal(fit.ready, false);
  assert.equal(readJSON(join(directory, 'interactive-acceptance-draft.json')).geometryReview.subBoxesRechecked, false);
  assert.ok(readJSON(join(directory, 'review-flags.json')).reviewFlags.some(row => row.key === 'checker_unverified'));
  assert.equal(readJSON(join(directory, 'interactive-content.json')).sections.hero.jokeCrop, null, 'No invented crop from the retired joke slot');
});

test('all checker prompts ask for visible clothing and poster measurement rules', () => {
  for (const request of [buildPictureCheckRequest(family, moves[0], sentences[0], 'data:image/png;base64,AA=='), buildWordCheckRequest(family, moves[0], sentences[0], 'data:image/png;base64,AA=='), buildWordCheckRequest(family, moves[0], sentences[0], 'data:image/png;base64,AA==', { panel: { scene: 'The fox sits.', line: 'Name it.' } })]) {
    assert.match(JSON.stringify(request), /Hidden feet or clothing are not faults/);
    assert.ok(request.text.format.schema.required.includes('outfitObservations'));
  }
  const request = buildWordCheckRequest(family, moves[0], sentences[0], 'data:image/png;base64,AA==');
  assert.ok(request.text.format.schema.properties.geometry.properties.textLines.items.required.includes('text'));
  for (const text of ['ink height is not font size', '3 percent', 'no fixed joke rectangle', 'no target layout']) assert.ok(JSON.stringify(request).includes(text), text);
  // A saved kit's older poster keeps its fixed-layout measuring words.
  assert.ok(JSON.stringify(buildWordCheckRequest(family, moves[0], sentences[0], 'data:image/png;base64,AA==', { templateVersion: posterTemplate.version })).includes('40 to 100 percent'));
});

test('max_tokens consumes attempt one then retries adaptive at low effort with complete saved evidence', async t => {
  const directory = temp(t), transport = offlineTransport(t, directory, request => request.retry === 0 ? { ...textAnswer('{"moveId":'), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } : textAnswer(run5));
  const result = await writeStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.story, run5.story); assert.equal(transport.calls.length, 2);
  assert.deepEqual(transport.calls.map(row => row.body.reasoning.effort), ['medium', 'low']);
  assert.ok(transport.calls.every(row => row.body.max_output_tokens === 24000 && row.body.store === false));
  assert.match(JSON.parse(transport.calls[1].body.input[0].content).correction.error, /story_max_tokens/);
  assert.ok(existsSync(join(directory, 'story-attempt-1.raw.txt')));
  assert.match(readFileSync(join(directory, 'story-attempt-1.reason.txt'), 'utf8'), /story_max_tokens/);
  const note = readJSON(join(directory, 'story-thinking-retry-1.json')); assert.equal(note.nextEffort, 'low');
  assert.equal(statSync(join(directory, 'story-thinking-retry-1.json')).mode & 0o777, 0o600);
  assert.deepEqual(readJSON(join(directory, 'kit-text-final.json')), result);
  assert.ok(readLog(transport.logFile).some(row => row.event === 'validation-reject' && JSON.stringify(row).includes('story_max_tokens')));
});

test('two truncated stories stop at two attempts and ordinary rejection keeps medium effort', async t => {
  const directory = temp(t), transport = offlineTransport(t, directory, () => ({ ...textAnswer(''), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }));
  await assert.rejects(writeStory(withKitEvidence(transport, directory), family, sentences[0]), /after 2 attempt/);
  assert.equal(transport.calls.length, 2);
  const request = buildStoryRequest(family, sentences[0], { reason: 'Fix this small field.' });
  assert.equal(request.max_output_tokens, 24000); assert.equal(request.reasoning.effort, 'medium');
});

test('a truncated field correction retries at low effort without counting as a failed fresh rhyme', async t => {
  const directory = temp(t), rhymeState = { failures: 1, reasons: ['Earlier rhyme fault.'] };
  const transport = offlineTransport(t, directory, request => request.retry === 0 ? { ...textAnswer(''), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } : textAnswer({ story: run5.story, tagline: run5.tagline }));
  const result = await writeStory(withKitEvidence(transport, directory), family, sentences[0], { correction: 'Fix the rhyme.', correctionFields: ['tagline'], priorStory: run5, lockedMoveId: run5.moveId, rhymeState });
  assert.equal(result.story, run5.story); assert.equal(result.rhymeFallback, undefined);
  assert.equal(rhymeState.failures, 1); assert.equal(transport.calls.length, 2);
  assert.equal(transport.calls[1].body.reasoning.effort, 'low');
  assert.deepEqual(JSON.parse(transport.calls[1].body.input[0].content).correction.fields, ['tagline']);
});
