import { expectReview } from './review-assertions.mjs';
import { parseWordCheck } from '../server/check-words.js';
import { posterBoxes } from '../server/format.js';
import { wordCheckAnswer } from './checker-fixture.mjs';
import { parseStoryCheck } from '../server/check-story.js';
import { storyCheckAnswer } from './checker-fixture.mjs';
import { rhymeIdeas } from './rhyme-ideas.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { readJSON, moves } from '../server/files.js';
import { family, sentences } from './fixture.mjs';
import { offlineTransport, offlineExports, textAnswer } from './offline-kit-fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { normalizeKitText } from '../server/writing-guidance.js';
import { assertLayoutFit } from '../server/layout-fit.js';
import { validateGeometryReceipt } from '../server/poster-template.js';
import { geometryAnswer } from './checker-fixture.mjs';
import { validateStory, writeStory } from '../server/story.js';
import { selectedRhymeFor } from '../server/rhyme.js';
import { printedCapacity } from '../server/printed-capacity.js';
const temp = t => { const d = mkdtempSync(join(tmpdir(), 'pass22-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const setup = t => { const directory = temp(t), memory = createMemory(join(directory, 'family.json')); memory.store(family); return { directory, memory }; };
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');

test('writing guidance reports chapter capacity and other editorial counts remain reports', () => {
  for (const wordCount of [550, 600, 750]) {
    const value = kitText(moves[0], { wordCount });
    value.chapterTitle = Array(13).fill('word').join(' '); value.noticedFeeling = 'left out';
    value.feelFirst = ['One.', 'Two.', 'Three.', 'Four.']; value.tinyTryOptions[0].seconds = 120;
    const result = validateStory(value);
    assert.equal(result.guidance.find(row => row.field === 'story').outsideRange, wordCount > printedCapacity(value.moveId).story.ceilingWords);
    assert.ok(result.guidance.every(row => row.reportOnly));
  }
  for (const field of ['panelLines', 'tinyTryOptions']) { const value = kitText(); value[field].pop(); expectReview(() => validateStory(value)); }
});

test('harmless lines normalize once and normalization preserves chapter paragraph boundaries', () => {
  const value = kitText(); value.chapterTitle = 'One\nTwo'; value.feelFirst[0] = 'That\r\nfeels hard.';
  const clean = normalizeKitText(value);
  assert.equal(clean.chapterTitle, 'One Two'); assert.equal(clean.feelFirst[0], 'That feels hard.'); assert.equal(clean.story, value.story);
  assert.deepEqual(normalizeKitText(clean), clean); assert.doesNotThrow(() => validateStory(value));
});

test('stop before pictures saves accepted text and resume buys no text or judge calls', async t => {
  const { directory, memory } = setup(t), transport = offlineTransport(t, directory), exporters = offlineExports();
  const paused = await createKit(transport, memory, sentences[0], { directory, kit: 1, stopBeforePictures: true, exports: exporters });
  assert.equal(paused.stoppedBeforePictures, true); assert.equal(paused.complete, false);
  assert.deepEqual(transport.calls.map(row => row.stage), ['story', 'story-check']);
  const textHash = digest(join(directory, 'kit-text-final.json')), rawHash = digest(join(directory, 'story-attempt-1.json'));
  const resumed = await createKit(transport, memory, sentences[0], { directory, kit: 1, resume: true, exports: exporters });
  assert.equal(resumed.complete, true); assert.equal(resumed.pdf.fixture, true);
  assert.equal(transport.calls.filter(row => row.stage === 'story').length, 1);
  assert.equal(transport.calls.filter(row => row.stage === 'story-check').length, 1);
  assert.equal(digest(join(directory, 'kit-text-final.json')), textHash); assert.equal(digest(join(directory, 'story-attempt-1.json')), rawHash);
  assert.ok(existsSync(join(directory, 'layout-fit.json')));
  const calls = transport.calls.length;
  assert.equal((await createKit(transport, memory, sentences[0], { directory, kit: 1, resume: true, exports: exporters })).complete, true);
  assert.equal(transport.calls.length, calls, 'Completed resume must buy no art either');
});

test('resume retains accepted sibling art after an interrupted later panel', async t => {
  const { directory, memory } = setup(t); let fail = true;
  const transport = offlineTransport(t, directory, request => { if (fail && request.stage === 'panel-2') throw new Error('Offline interruption'); });
  await assert.rejects(createKit(transport, memory, sentences[0], { directory, kit: 1, exports: offlineExports() }), /request failed/);
  const checkpoint = readJSON(join(directory, 'checkpoint.json'));
  assert.ok(checkpoint.stages.text && checkpoint.stages.hero && checkpoint.stages.poster && checkpoint.stages['panel-1']);
  const first = digest(checkpoint.stages['panel-1'].path); fail = false;
  const resumedTransport = offlineTransport(t, directory);
  const result = await createKit(resumedTransport, memory, sentences[0], { directory, kit: 1, resume: true, exports: offlineExports() });
  assert.equal(result.complete, true); assert.equal(digest(checkpoint.stages['panel-1'].path), first);
  assert.ok(resumedTransport.calls.every(row => /^panel-[234]/.test(row.stage)));
  assert.equal(resumedTransport.calls.filter(row => row.stage === 'cast-continuity-check').length, 0);
  const continuity = readJSON(join(directory, 'checkpoint.json')).stages['cast-continuity'];
  assert.equal(continuity.reviewStatus, 'parent-review'); assert.equal(continuity.verified, false);
  assert.equal(continuity.pictureHashes.length, 5);
});

test('resume refuses missing checkpoints and altered checked images before buying replacements', async t => {
  const { directory, memory } = setup(t), transport = offlineTransport(t, directory);
  await assert.rejects(createKit(transport, memory, sentences[0], { directory, kit: 1, resume: true }), /checkpoint is missing/);
  assert.equal(transport.calls.length, 0);
  await createKit(transport, memory, sentences[0], { directory, kit: 1, exports: offlineExports() });
  const state = readJSON(join(directory, 'checkpoint.json')); writeFileSync(state.stages.poster.path, 'altered');
  const count = transport.calls.length;
  await assert.rejects(createKit(transport, memory, sentences[0], { directory, kit: 1, resume: true, exports: offlineExports() }), /checked bytes/);
  assert.equal(transport.calls.length, count);
});

test('measured overflow stops before art but keeps accepted text for resume', async t => {
  const { directory, memory } = setup(t), transport = offlineTransport(t, directory);
  const overflow = { measured: true, ready: false, faults: ['story.chapter-text: rendered text extends 12.50 points beyond its 540 by 700 point content area at 11.50 point type'] };
  await assert.rejects(createKit(transport, memory, sentences[0], { directory, kit: 1, exports: { ...offlineExports(), measureLayout: async () => overflow } }), error => error.code === 'printed_layout_review_required' && error.canResume === false && error.details.faults[0] === overflow.faults[0]);
  assert.deepEqual(transport.calls.map(row => row.stage), ['story', 'story-check']);
  assert.deepEqual(readJSON(join(directory, 'text-layout-fit.json')), overflow);
  assert.ok(readJSON(join(directory, 'checkpoint.json')).stages.text);
  assert.equal(readJSON(join(directory, 'checkpoint.json')).savedLayoutRevision.status, 'review');
  expectReview(() => assertLayoutFit({ measured: false }), /measurements missing/);
});

test('card drift cannot hide measured clipping, text collisions or missing writing space', () => {
  const clip = geometryAnswer(); clip.textLines[0].x = 0;
  assert.ok(validateGeometryReceipt(clip).faults.some(row => row.startsWith('text_clipped_at_safe_area')));
  const collision = geometryAnswer(); collision.textLines[1] = { ...collision.textLines[0], boxId: 'science.body' };
  assert.ok(validateGeometryReceipt(collision).faults.some(row => row.startsWith('text_lines_overlap')));
  const handwriting = geometryAnswer(); handwriting.writableRows[0].h = 5; handwriting.writableRows[0].baselineY = handwriting.writableRows[0].y + 5;
  assert.ok(validateGeometryReceipt(handwriting).faults.some(row => row.startsWith('insufficient_handwriting_space')));
});

test('approved rhyme selection never changes the chapter during a small field repair', async t => {
  const { directory } = setup(t), previous = kitText(); previous.story += '\nThe private chapter says a different phrase.';
  const transport = offlineTransport(t, directory, () => textAnswer({ story: previous.story, jokeIdea: 'A small hat sits on a pencil.' }));
  const result = await writeStory(transport, family, sentences[0], { correctionFields: ['jokeIdea'], priorStory: previous, lockedMoveId: previous.moveId });
  assert.equal(result.story, previous.story); assert.equal(result.tagline, selectedRhymeFor(moves[0]).tagline);
});


test('offline rhyme ideas keep approved wording and only return unapproved drafts for human review', () => {
  const packet = rhymeIdeas('name-it-exactly');
  assert.equal(packet.approved.tagline, selectedRhymeFor(moves[0]).tagline);
  assert.ok(packet.candidates.length > 0);
  assert.ok(packet.candidates.every(row => row.approved === false && row.status === "FOR SUNNY'S READ"));
  assert.match(packet.prompt, /Literal title-word overlap is not required/);
  assert.match(packet.note, /No new model answer/);
});

test('overlapping text lines within the same box still fail', () => {
  const receipt = geometryAnswer(); receipt.textLines.push({ ...receipt.textLines[0], text: 'A second line', y: receipt.textLines[0].y + 2 });
  assert.ok(validateGeometryReceipt(receipt).faults.some(reason => reason.startsWith('text_lines_overlap')));
});


test('missing handwriting measurements cannot be waived by correct word readback', () => {
  const receipt = geometryAnswer(); receipt.observed = receipt.observed.filter(row => row.id !== 'plan.handwriting'); delete receipt.writableRows;
  const result = validateGeometryReceipt(receipt, { wordVerdicts: [{ id: 'move', matches: true }], subBoxesRechecked: true });
  assert.equal(result.ready, false); assert.equal(result.needsRecheck, true);
  assert.ok(result.measurementFaults.some(reason => reason.includes('two writing rows')));
});

test('the saved ink calibration belongs to the actual twelve-point PDF sample', () => {
  const calibration = readJSON(new URL('./fixtures/readability-calibration.json', import.meta.url));
  assert.equal(digest(calibration.source), calibration.sha256);
  assert.ok(calibration.samples.every(row => row.fontSize === 12));
  assert.equal(Math.min(...calibration.samples.map(row => row.inkHeightPoints)), calibration.minimumObservedInkHeight);
});


test('absent judge words request a format recheck without a code sound verdict', () => {
  const story = kitText(), answer = storyCheckAnswer('Name what you feel, say what is real.');
  const result = parseStoryCheck(JSON.stringify(answer), { story, move: moves[0] });
  assert.equal(result.needsRecheck, true); assert.equal(result.ready, false);
  assert.equal(result.formatFault, 'taglineEndWords'); assert.equal(result.rhyme, undefined);
});


test('contradictory empty-blank evidence is ignored but actually filled words still stop the picture', () => {
  const boxes = posterBoxes(moves[0], kitText()), answer = wordCheckAnswer(boxes);
  answer.filledBlank = true; answer.evidence.filledBlank = 'The blanks are empty.';
  const empty = parseWordCheck(JSON.stringify(answer), boxes);
  assert.equal(empty.ready, true); assert.ok(empty.ignoredFaults.some(row => row.key === 'filledBlank'));
  answer.boxes.find(box => box.id === 'move').text = 'When I notice sad, I dance. Backup: Breathe out slowly';
  const filled = parseWordCheck(JSON.stringify(answer), boxes);
  assert.equal(filled.ready, true); assert.ok(filled.reviewFlags.some(row => row.key === 'filledBlank'));
  assert.ok(filled.reviewFlags.some(row => row.key.startsWith('words_differ')));
});
