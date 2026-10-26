import { expectReview } from './review-assertions.mjs';
import { offlinePrices } from './offline-prices.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { moves, readJSON } from '../server/files.js';
import { posterBoxes, bubbleInStory, splitStory } from '../server/format.js';
import { validateStory } from '../server/story.js';
import { compareBoxWords } from '../server/word-comparison.js';
import { parseWordCheck } from '../server/check-words.js';
import { geometryRects, posterTemplate, posterTemplateFor, bodyTextBoxes, validateGeometryReceipt, posterImageTransform, makePosterMap, currentPosterTemplateVersion } from '../server/poster-template.js';
import { fitRectangles, transformRect } from '../server/geometry-fit.js';
import { posterContent } from '../server/layout.js';
import { createTransport, readLog } from '../server/transport.js';
import { withKitEvidence } from '../server/kit-evidence.js';
import { readyDrawnPage } from '../server/picture.js';
import { syntheticCastEvidence, geometryAnswer, sourceGeometryAnswer, markFault, wordCheckAnswer } from './checker-fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { family, sentences } from './fixture.mjs';
import { offlineTransport, openaiAnswer, run5 } from './offline-kit-fixture.mjs';
import { buildWordCheckRequest, STORY_RULES } from '../server/requests.js';

const run7 = readJSON(new URL('./fixtures/run7-story-2.json', import.meta.url));
const run7Approved = readJSON(new URL('./fixtures/run7-approved-words.json', import.meta.url)).boxes;
const poster2 = readJSON(new URL('./fixtures/run7-poster-2-check.json', import.meta.url)).answer;
const temp = t => { const directory = mkdtempSync(join(tmpdir(), 'pass14-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; };
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} versus ${b}`);

function transformedReceipt() {
  const receipt = geometryAnswer(posterTemplate.version);
  const transform = { scale: 1.4, offset: { x: 30, y: 40 } };
  receipt.coordinateSpace = { unit: 'source-pixels', width: 1024, height: 1536 };
  receipt.observed = receipt.observed.map(rect => transformRect(rect, transform));
  receipt.textLines = receipt.textLines.map(rect => transformRect(rect, transform));
  receipt.writableRows = receipt.writableRows.map(rect => ({ ...transformRect(rect, transform), baselineY: rect.baselineY * transform.scale + transform.offset.y }));
  // This synthetic drawing still needs physical writing room after the fixed
  // canvas print scale; fitting anchor boxes cannot enlarge its short rows.
  Object.assign(receipt.writableRows[0], { x: 200, y: 802, w: 180, h: 26, baselineY: 828 });
  Object.assign(receipt.writableRows[1], { x: 100, y: 828, w: 280, h: 26, baselineY: 854 });
  return receipt;
}

test('uniform least-squares recovers a translated and scaled drawing across all rectangles', () => {
  const receipt = transformedReceipt();
  const result = validateGeometryReceipt(receipt);
  assert.equal(result.ready, true, result.faults.join('; '));
  close(result.fit.scale, 1 / 1.4); close(result.fit.offset.x, -30 / 1.4); close(result.fit.offset.y, -40 / 1.4);
  for (const row of result.fit.residuals) for (const error of Object.values(row.points)) close(error, 0);
  assert.equal(result.fit.residuals.length, Object.keys(geometryRects()).length);
  const margin = result.placement.margins;
  close(margin.left, margin.right); close(margin.top, margin.bottom);
  assert.ok(Object.values(margin).every(value => value >= 36 - 1e-8));
});

test('run 7 raw measurements keep the honest fit and request a recheck, not a redraw', () => {
  const result = validateGeometryReceipt(poster2.geometry);
  const expectedFit = fitRectangles(poster2.geometry.observed.filter(row => row.id !== 'joke'), geometryRects(posterTemplateFor(poster2.geometry.templateVersion)));
  close(result.fit.scale, expectedFit.scale);
  assert.ok(!result.fit.residuals.some(row => row.id === 'joke'));
  assert.deepEqual(result.faults, [], 'Untrusted measurements cannot become drawing faults');
  assert.equal(result.ready, false); assert.equal(result.needsRecheck, true);
  assert.match(result.measurementFaults.join(' '), /outside the declared/);
});

test('card drift and box contact are review flags while missing boxes remain faults', () => {
  const near = geometryAnswer(posterTemplate.version); near.observed.find(r => r.id === 'keyword').x -= 5;
  assert.equal(validateGeometryReceipt(near).ready, true);
  const far = geometryAnswer(posterTemplate.version); far.observed.find(r => r.id === 'keyword').x -= 100;
  assert.ok(validateGeometryReceipt(far).observations.some(row => row.evidence.startsWith('geometry_deviation_keyword')));
  const missing = geometryAnswer(posterTemplate.version); missing.observed = missing.observed.filter(r => r.id !== 'keyword');
  expectReview(() => validateGeometryReceipt(missing), /missing_geometry_box: keyword/);
  const overlap = geometryAnswer(posterTemplate.version); overlap.observed.find(r => r.id === 'science').x -= 20;
  assert.ok(validateGeometryReceipt(overlap).observations.some(row => row.evidence.startsWith('geometry_overlap:')));
});

test('ink heights are calibrated for review without treating seven points as a font size', () => {
  for (const [height, expected] of [[7, true], [6.9, true], [14, true]]) {
    const receipt = geometryAnswer(posterTemplate.version); receipt.textLines.forEach(line => { line.h = height; });
    markFault(receipt, 'printTextTooSmall', 'A visual guess below fourteen points');
    const result = validateGeometryReceipt(receipt);
    assert.equal(result.ready, expected); close(result.textMeasurement.smallestBodyTextHeight, height);
    assert.equal(result.faults.some(fault => fault.startsWith('printTextTooSmall:')), false);
    assert.equal(result.textMeasurement.minimum, null);
    assert.ok(result.textMeasurement.calibration.samples.length > 0);
  }
  const missing = geometryAnswer(posterTemplate.version); delete missing.textLines;
  assert.equal(validateGeometryReceipt(missing).needsRecheck, true);
  const crossed = geometryAnswer(posterTemplate.version); crossed.textLines[0].w += 40;
  assert.ok(validateGeometryReceipt(crossed).faults.some(fault => fault.startsWith('text_crosses_boundary: tinyTry.body')));
});

test('export and all eight taps use the same saved placement without stretching', () => {
  const result = validateGeometryReceipt(transformedReceipt());
  const transform = posterImageTransform(result);
  close(transform.scale, result.placement.scale);
  const map = makePosterMap('test-v1', 'a'.repeat(64), result);
  for (const [id, rect] of Object.entries(map.regions)) {
    for (const key of ['x', 'y', 'w', 'h']) close(rect[key], result.exported[id][key]);
  }
  const html = posterContent(moves[0], { posterGeometry: result });
  assert.ok(html.includes(`width:${100 * 1024 * transform.scale / 612}%`));
  assert.match(html, /height:auto/);
  assert.ok(html.includes(`top:${100 * result.exported.footer.y / 792}%`));
});

test('new checker request asks for source pixels and individual body text lines', () => {
  const request = buildWordCheckRequest(family, moves[0], sentences[0], 'data:image/png;base64,AA==');
  const geometry = request.text.format.schema.properties.geometry;
  assert.ok(geometry.required.includes('textLines')); assert.ok(geometry.required.includes('coordinateSpace'));
  assert.deepEqual(geometry.properties.textLines.items.properties.boxId.enum, bodyTextBoxes);
  const text = request.input[0].content[0].text;
  assert.match(text, /SOURCE PIXELS/); assert.match(text, /ink height is not font size/i);
  assert.doesNotMatch(text, /printTextTooSmall means body below 14pt/);
});

test('run 7 historical wording check is omitted with the redundant edit-history fields', { skip: 'Needs the omitted original-wording (*Original) fields in content/moves.json from the private historical fixture.' }, () => {
  const current = moves.find(move => move.id === run7.moveId);
  const original = { ...current };
  for (const field of ['name', 'keyWord', 'bodyAction', 'positiveAction', 'kidScienceLine', 'whereItCameFromShort']) original[field] = current[`${field}Original`];
  const boxes = posterBoxes(original, run7);
  const backup = moves.find(move => move.id === current.approvedBackup);
  boxes.find(box => box.id === 'move').text = `When I notice ______, I ______.\nBackup: ${backup.nameOriginal}`;
  for (const id of ['move', 'remember']) {
    const diff = compareBoxWords(boxes.find(box => box.id === id), poster2.boxes.find(box => box.id === id).text);
    assert.equal(diff.matches, true, id); assert.deepEqual(diff.extra, []); assert.deepEqual(diff.missing, []); assert.deepEqual(diff.misspelled, []);
  }
  const check = parseWordCheck(JSON.stringify(poster2), run7Approved);
  assert.ok(!check.faults.some(fault => fault.startsWith('words_differ')));
  assert.equal(check.wordCap.count, check.transcriptionWordCap.count);
});

test('word comparison normalizes punctuation, case, handwriting rules, joins and duplicate leading headings', () => {
  const box = { id: 'source', title: 'WHERE IT CAME FROM', text: "Feeling-name research: teens’ words." };
  for (const text of ["where it came from\nFeeling name research: teens' words", "WHERE IT CAME FROM\nWHERE IT CAME FROM\nFeeling-\nname research: teens’ words.\n______"]) assert.equal(compareBoxWords(box, text).matches, true, text);
  assert.equal(compareBoxWords({ id: 'move', text: 'When I notice ______, I ______.' }, 'When I notice __________ I __________').matches, true);
  assert.equal(compareBoxWords({ id: 'test', text: 'strategy' }, 'stra-\ntegy').matches, true);
  assert.equal(compareBoxWords({ id: 'test', text: 'a part' }, 'apart').matches, false, 'Unmarked word joins must not vanish');
});

test('word verdicts and retry faults name exact approved/read words and real edits', () => {
  const box = { id: 'bubble', text: 'Say the exact feeling word.' };
  const diff = compareBoxWords(box, 'Say the exakt word now.');
  assert.deepEqual(diff.misspelled, [{ approved: 'exact', read: 'exakt' }]);
  assert.ok(diff.missing.includes('feeling')); assert.ok(diff.extra.includes('now'));
  const answer = wordCheckAnswer([box]); answer.boxes[0].text = 'Say the exakt word now.';
  const checked = parseWordCheck(JSON.stringify(answer), [box]);
  assert.deepEqual(checked.wordVerdicts[0], diff);
  for (const word of ['approved=', 'read=', 'extra=', 'missing=', 'misspelled=', 'exakt', 'feeling', 'now']) assert.ok(checked.reviewFlags.map(row => row.evidence).join(' ').includes(word));
});

test('two-sentence bubble matching stays in one paragraph and keeps the whole bubble before a split', () => {
  const first = readJSON(new URL('./fixtures/run7-story-1.json', import.meta.url));
  assert.equal(bubbleInStory(first.story, 'Closer. But still not all of it.'), true);
  // The historical chapter is unchanged; the current rhyme rule is stricter.
  assert.doesNotThrow(() => validateStory({ ...first, tagline: kitText(moves.find(move => move.id === first.moveId)).tagline }));
  assert.equal(bubbleInStory('Closer.\n\nBut still not all of it.', 'Closer. But still not all of it.'), false);
  assert.equal(bubbleInStory('First. Second. Third.', 'First Second Third'), false);
  assert.match(STORY_RULES, /copies a short spoken passage/);
  const paragraphs = Array.from({ length: 20 }, (_, i) => `Marker${i}. ${'word '.repeat(9).trim()}.`);
  const panels = [1, 8, 12, 18].map(i => ({ line: `Marker${i} word` }));
  const pagination = splitStory(paragraphs.join('\n\n'), panels);
  panels.forEach((panel, i) => assert.equal(bubbleInStory(pagination.pages[pagination.panelPages[i]], panel.line), true));
  assert.ok(pagination.bubbleSentenceRanges.every(range => range.end === range.start + 1));
});

function fakeWire(t, directory, sequence, maxCalls = 24) {
  const waits = [], seen = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    seen.push({ url, options }); const item = sequence[Math.min(seen.length - 1, sequence.length - 1)];
    if (item instanceof Error) throw item;
    return new Response(JSON.stringify(item.body ?? { usage: { input_tokens: 0, output_tokens: 0 }, content: [], stop_reason: 'end_turn' }), { status: item.status ?? 200 });
  });
  const logFile = join(directory, 'requests.jsonl');
  const transport = createTransport({ keys: { openai: 'offline-test-key' }, logFile, maxCalls, costCatalog: offlinePrices, wait: async ms => { waits.push(ms); } });
  const call = () => transport.call({ provider: 'openai', path: '/v1/responses', stage: 'story', familyRecord: { real: false }, body: { model: offlinePrices.selected.story, store: false, max_output_tokens: 1000, input: [{role:'user',content:'Offline test'}] } });
  return { transport, waits, seen, logFile, call };
}
const network = code => Object.assign(new Error(code === 'fetch failed' ? code : 'network interrupted'), { cause: { code } });
for (const reason of ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'fetch failed']) test(`network ${reason} retries at 2s and 6s using one cap slot without responses`, async t => {
  const mock = fakeWire(t, temp(t), [network(reason), network(reason), {}], 1);
  await mock.call(); assert.deepEqual(mock.waits, [2000, 6000]); assert.equal(mock.seen.length, 3);
  const retries = readLog(mock.logFile).filter(row => row.event === 'transport-retry');
  assert.equal(retries.length, 2); assert.ok(retries.every(row => row.reusesCallCapSlot));
  await assert.rejects(mock.call(), /call limit/); assert.equal(mock.seen.length, 3);
});
for (const status of [429, 500, 502, 503, 599]) test(`HTTP ${status} retries twice with logged responses and received-response cap accounting`, async t => {
  const mock = fakeWire(t, temp(t), [{ status, body: { error: 'temporary' } }, { status, body: { error: 'temporary' } }, {}], 3);
  await mock.call(); assert.deepEqual(mock.waits, [2000, 6000]);
  const rows = readLog(mock.logFile); assert.equal(rows.filter(row => row.event === 'response').length, 3);
  assert.ok(rows.filter(row => row.event === 'transport-retry').every(row => !row.reusesCallCapSlot));
  assert.equal(rows.filter(row => row.event === 'response').at(-1).callCost.usd, null, 'Unknown earlier charges must remain visible');
  await assert.rejects(mock.call(), /call limit/);
});

test('retry exhaustion stops after three attempts and permanent failures never retry', async t => {
  const mock = fakeWire(t, temp(t), [network('ECONNRESET')]);
  await assert.rejects(mock.call(), /ECONNRESET/); assert.equal(mock.seen.length, 3); assert.deepEqual(mock.waits, [2000, 6000]);
  await assert.rejects(mock.call(), /ECONNRESET/); assert.equal(mock.seen.length, 6);
  assert.ok(readLog(mock.logFile).filter(row => row.event === 'response').every(row => row.accounting.basis === 'reserved-ceiling'));
});

test('HTTP 400 and malformed successful bodies never use transport retries', async t => {
  const mock = fakeWire(t, temp(t), [{ status: 400, body: { error: 'bad input' } }]);
  await assert.rejects(mock.call(), /HTTP 400/); assert.deepEqual(mock.waits, []); assert.equal(mock.seen.length, 1);
});

test('bad geometry measurements are saved after one check without another opinion or redraw', async t => {
  const directory = temp(t), record = structuredClone(family);
  record.hero.heroPicturePath = new URL('./fixtures/offline-art.png', import.meta.url).pathname;
  const malformed = sourceGeometryAnswer();
  malformed.observed.find(row => row.id === 'tinyTry.body').x = -20;
  const transport = offlineTransport(t, directory, request => {
    if (request.stage === 'poster-word-check' && request.retry === 0) return openaiAnswer({ ...syntheticCastEvidence(request), ...wordCheckAnswer(posterBoxes(moves[0], run5)), geometry: malformed });
  });
  const result = await readyDrawnPage(withKitEvidence(transport, directory), record, moves[0], sentences[0], run5, { directory });
  assert.equal(result.ready, true);
  assert.deepEqual(transport.calls.map(call => call.stage), ['poster', 'poster-word-check']);
  const saved = readJSON(join(directory, 'picture-check-poster-1.json'));
  // A composed poster has no target layout to fit; the measurements themselves are saved.
  assert.equal(saved.check.geometry.fit ?? null, null); assert.equal(saved.check.answers.geometry.templateVersion, currentPosterTemplateVersion);
  assert.ok(saved.check.unresolvedMeasurements.length > 0); assert.equal(saved.check.verified, false);
  assert.ok(saved.check.reviewFlags.some(flag => flag.key === 'checker_unverified'));
  assert.equal(existsSync(join(directory, 'picture-check-poster-2.json')), false);
  const transcription = readJSON(join(directory, 'poster-transcription-1.json'));
  assert.equal(transcription.wordVerdicts.length, 9); assert.equal(transcription.geometryFit, null);
  assert.equal(transcription.geometryPlacement, undefined, 'The raw failed measurements do not gain an invented placement.');
  const fallback = result.checks.at(-1).geometry; assert.equal(fallback.verified, false);
  assert.ok(Number.isFinite(fallback.placement.scale) && fallback.placement.scale > 0);
});

test('extra boxes and outside lettering are named in the saved word verdict', () => {
  const boxes = [{ id: 'bubble', text: 'This feels hard.' }];
  const answer = wordCheckAnswer(boxes);
  answer.boxes.push({ id: 'sign', text: 'Surprise slogan' }); answer.extraText = ['Stray label'];
  const check = parseWordCheck(JSON.stringify(answer), boxes);
  assert.deepEqual(check.wordVerdicts.find(diff => diff.id === 'sign').extra, ['surprise', 'slogan']);
  assert.match(check.reviewFlags.map(row => row.evidence).join('; '), /Stray label/);
});
