import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { syntheticCastEvidence, geometryAnswer, wordCheckAnswer } from './checker-fixture.mjs';
import { family, sentences } from './fixture.mjs';
import { moves } from '../server/files.js';
import { posterBoxes, emptyMove, posterCountReport } from '../server/format.js';
import { validateGeometryReceipt, assessWritableRows, rectangleRoundingUnits, minimumWritingPixels, templatePrompt, geometryRuleVersion, physicalPosterPlacement, posterImageTransform } from '../server/poster-template.js';
import { checkWords, parseWordCheck } from '../server/check-words.js';
import { buildWordCheckRequest, buildPictureCheckRequest, buildCastCheckRequest } from '../server/requests.js';
import { kitText } from './kit-text-fixture.mjs';

const paid = JSON.parse(readFileSync(new URL('./fixtures/paid-writing-geometry.json', import.meta.url))).records;
test('paid coordinate contacts become rounding observations, never proof that the old writing areas fit', () => {
  for (const record of paid) {
    const result = validateGeometryReceipt(record.geometry, { readback: record.boxes, wordVerdicts: record.boxes.map(box => ({ id: box.id, matches: true })), subBoxesRechecked: true });
    assert.ok(!result.faults.some(fault => /^text_icon_collision|^insufficient_handwriting_space/.test(fault)), `poster ${record.posterAttempt}: ${result.faults}`);
    assert.equal(result.writingAssessment.verified, false); assert.equal(result.ready, false); assert.equal(result.needsRecheck, true);
    assert.ok(result.measurementFaults.some(fault => /two writing rows/.test(fault)));
    if (record.posterAttempt !== 3) assert.ok(result.observations.some(row => row.key === 'coordinate_rounding_contact'));
  }
});

const area = (blank, x, y, w, h) => ({ blank, x, y, w, h, baselineY: y + h, measurementKind: 'writable-area', certainty: 'confirmed', evidence: 'Synthetic explicit empty-area bounds above this visible baseline, excluding labels.' });
const inspectRows = rows => assessWritableRows(rows, { scale: .5, offset: { x: 0, y: 0 } }, { x: 0, y: 0, w: 500, h: 500 }, { width: 1024, height: 1536 });
test('two measured writable rows pass; genuinely narrow, short, inline or ink-only rows cannot pass', () => {
  const good = [area('notice', 150, 100, 200, 26), area('action', 30, 140, 320, 26)];
  assert.equal(inspectRows(good).verified, true); assert.deepEqual(inspectRows(good).faults, []);
  for (const bad of [[area('notice', 150, 100, 90, 26), good[1]], [area('notice', 150, 100, 200, 15), good[1]], [good[0], area('action', 370, 100, 100, 26)]]) assert.ok(inspectRows(bad).faults.some(fault => fault.startsWith('insufficient_handwriting_space')));
  const ink = [{ ...good[0], measurementKind: 'underline-ink', h: 3, baselineY: 103 }, good[1]];
  assert.equal(inspectRows(ink).verified, false); assert.ok(inspectRows(ink).measurementFaults.length);
  assert.equal(inspectRows([{ ...good[0], certainty: 'uncertain' }, good[1]]).verified, false);
});

test('rectangle rounding is derived from three half-unit errors; substantial visible collisions still fail', () => {
  assert.equal(rectangleRoundingUnits, 1.5);
  const slight = geometryAnswer(), line = slight.textLines[0], icon = slight.observed.find(box => box.id === 'tinyTry.icon');
  Object.assign(icon, { x: line.x, y: line.y - 19, w: 20, h: 20 });
  const contact = validateGeometryReceipt(slight); assert.ok(!contact.faults.some(fault => fault.startsWith('text_icon_collision'))); assert.ok(contact.observations.some(row => row.key === 'coordinate_rounding_contact'));
  const large = geometryAnswer(), target = large.textLines[0];
  Object.assign(large.observed.find(box => box.id === 'tinyTry.icon'), { x: target.x, y: target.y, w: 20, h: target.h });
  assert.ok(validateGeometryReceipt(large).measurementFaults.some(fault => /actual ink/.test(fault)));
  large.textIconCollision = true; large.evidence.textIconCollision = 'tinyTry.body / tinyTry.icon: visible icon ink covers the first letters of the text.';
  assert.ok(validateGeometryReceipt(large).faults.some(fault => fault.startsWith('text_icon_collision')));
  const clipped = geometryAnswer(); clipped.textLines[0].x = 0;
  assert.ok(validateGeometryReceipt(clipped).faults.some(fault => fault.startsWith('text_clipped_at_safe_area')));
});

test('physical size and the renderer use the whole canvas, regardless of fitted card-anchor positions', () => {
  const first = structuredClone(paid[0].geometry), second = structuredClone(first);
  for (const row of second.observed) { row.x = row.x * .8 + 60; row.y = row.y * .8 + 80; row.w *= .8; row.h *= .8; }
  const left = validateGeometryReceipt(first), right = validateGeometryReceipt(second);
  assert.notEqual(left.fit.scale, right.fit.scale);
  assert.equal(left.placement.scale, .46875); assert.deepEqual(left.placement.offset, { x: 66, y: 36 });
  assert.deepEqual(left.placement, right.placement);
  assert.equal(left.rounding.fittedPoints, 1.5 * .46875); assert.equal(right.rounding.fittedPoints, left.rounding.fittedPoints);
  assert.equal(left.textMeasurement.pointsPerSourceUnit, .46875);
  assert.equal(posterImageTransform(left, undefined, { review: true }).scale, .46875);
  assert.equal(posterImageTransform(right, undefined, { review: true }).scale, .46875);
  const largeFitDoesNotRescueShortRows = assessWritableRows([area('notice', 200, 1000, 150, 25), area('action', 100, 1040, 200, 25)], physicalPosterPlacement(first.coordinateSpace), { x: 0, y: 0, w: 1024, h: 1536 }, first.coordinateSpace);
  assert.ok(largeFitDoesNotRescueShortRows.faults.some(fault => fault.startsWith('insufficient_handwriting_space')));
});

test('the drawing and checker request separate writable areas in actual pixels and retain exact blank-plan words', () => {
  assert.equal(geometryRuleVersion, 'writable-rows-canvas-scale-v2');
  assert.deepEqual(minimumWritingPixels, { width: 154, height: 26 });
  assert.match(templatePrompt(), /NEVER put both blanks on one line/); assert.match(templatePrompt(), /154 pixels.*26 pixels/);
  const move = moves[0], kit = kitText(move), boxes = posterBoxes(move, kit), plan = boxes.find(box => box.id === 'move');
  assert.match(plan.text, /When I notice _+,\nI _+\./);
  assert.ok(plan.text.replace(/\s+/g, ' ').startsWith(emptyMove));
  const request = buildWordCheckRequest(family, move, sentences[0], 'data:image/png;base64,AAAA');
  const payload = JSON.parse(request.input[0].content[0].text);
  assert.match(payload.geometryInstruction, /CLEAR EMPTY AREA/); assert.match(payload.geometryInstruction, /Do NOT measure the thin underline ink/);
  assert.ok(request.text.format.schema.properties.geometry.required.includes('writableRows'));
  assert.equal(request.reasoning.effort, 'medium');
  assert.equal(buildWordCheckRequest(family, move, sentences[0], 'data:image/png;base64,AAAA', { panel: kit.panelLines[0] }).reasoning.effort, 'low');
  assert.equal(buildPictureCheckRequest(family, move, sentences[0], 'data:image/png;base64,AAAA').reasoning.effort, 'low');
  assert.equal(buildCastCheckRequest(family, move, sentences[0], [{ id: 'poster', data: 'data:image/png;base64,AAAA' }], []).reasoning.effort, 'low');
  assert.equal(posterCountReport(150).status, 'WARN');
});

test('uncertain writing measurements remain unverified after one check without buying another drawing', async () => {
  const boxes = posterBoxes(moves[0], kitText(moves[0])), answer = wordCheckAnswer(boxes); delete answer.geometry.writableRows;
  const calls = [];
  const transport = { call: async request => { calls.push(request); return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...syntheticCastEvidence(request), ...answer }) }] }] }; }, recordRejection() {}, recordVerdict() {} };
  const result = await checkWords(transport, family, moves[0], sentences[0], 'data:image/png;base64,AAAA', boxes);
  assert.equal(calls.length, 1); assert.equal(calls[0].stage, 'poster-word-check');
  assert.equal(result.ready, true); assert.equal(result.verified, false);
  assert.deepEqual(result.answers.geometry, answer.geometry);
  assert.ok(result.reviewFlags.some(flag => flag.key === 'checker_unverified'));
});

test('wrong coordinate units remain visible in the raw answer and cannot become measured pixel approval', async () => {
  const boxes = posterBoxes(moves[0], kitText(moves[0])), answer = wordCheckAnswer(boxes); answer.geometry = geometryAnswer();
  assert.equal(parseWordCheck(JSON.stringify(answer), boxes).ready, true, 'Historical parsing remains explicitly compatible.');
  const strict = parseWordCheck(JSON.stringify(answer), boxes, { expectedCoordinateUnit: 'source-pixels' });
  assert.equal(strict.ready, false); assert.match(strict.measurementFaults.join(' '), /source-pixels/);
  const calls = [];
  const transport = { call: async request => { calls.push(request); return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ ...syntheticCastEvidence(request), ...answer }) }] }] }; }, recordRejection() {}, recordVerdict() {} };
  const result = await checkWords(transport, family, moves[0], sentences[0], 'data:image/png;base64,AAAA', boxes);
  assert.equal(calls.length, 1); assert.equal(result.ready, true); assert.equal(result.verified, false);
  assert.deepEqual(result.answers.geometry, answer.geometry);
  assert.match(result.unresolvedMeasurements.join(' '), /source-pixels/);
  assert.ok(result.reviewFlags.some(flag => flag.key === 'footer_outside_art'));
});
