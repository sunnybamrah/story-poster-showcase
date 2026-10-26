import { syntheticCastEvidence, pictureCheckAnswer, markFault } from './checker-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractJSON, readJSON, words, moves } from '../server/files.js';
import { validateStory, writeStory, readyStory } from '../server/story.js';
import { splitStory, bubbleInStory, assertStoryPagination, posterBoxes, posterWordReport } from '../server/format.js';
import { buildStoryRequest, STORY_RULES, buildPosterRequest } from '../server/requests.js';
import { parseStoryCheck } from '../server/check-story.js';
import { parsePictureCheck } from '../server/check-picture.js';
import { parseWordCheck } from '../server/check-words.js';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { withKitEvidence } from '../server/kit-evidence.js';
import { makePages, visibleText } from '../server/layout.js';
import { readyDrawnPage } from '../server/picture.js';
import { readLog, createTransport } from '../server/transport.js';
import { family, sentences } from './fixture.mjs';
import { run5, textAnswer, openaiAnswer, passingStoryCheck, passingWordCheck, offlineTransport, offlineExports } from './offline-kit-fixture.mjs';

const temp = t => { const path = mkdtempSync(join(tmpdir(), 'story-pass12-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; };
const clone = () => structuredClone(run5);
const plainFamily = () => structuredClone(family);
const reasonOf = run => { try { const value = run(); assert.ok(value.reviewFlags?.length); return value.reviewFlags.map(row => row.evidence).join('\n'); } catch (error) { return error.message; } };
const assertPrivate = path => assert.equal(statSync(path).mode & 0o777, 0o600, path);

test('run 5 passes and the saved split lies between paragraphs 20 and 23', () => {
  const { pagination } = validateStory(clone());
  const paragraphs = run5.story.replace(/^MADE UP\n/, '').split(/\n+/);
  const start20 = paragraphs.slice(0, 19).join('\n').length;
  assert.ok(pagination.pages[0].includes(run5.panelLines[1].line));
  assert.ok(!pagination.pages[0].includes(run5.panelLines[2].line));
  assert.ok(pagination.pages[1].includes(run5.panelLines[2].line));
  assert.ok(pagination.pages[0].length > start20);
  const paragraphCount = pagination.pages[0].split(/\n+/).length;
  assert.ok(paragraphCount >= 20 && paragraphCount < 23, `cut after paragraph ${paragraphCount}`);
  assert.equal(pagination.cut.paragraph, true);
  assert.deepEqual(pagination.pages.flatMap(words), words(run5.story.replace(/^MADE UP\n/, '')));
  for (const count of pagination.wordCounts) assert.ok(count / pagination.wordCounts.reduce((a, b) => a + b) >= .35 && count / pagination.wordCounts.reduce((a, b) => a + b) <= .65);
  run5.panelLines.forEach((panel, index) => assert.ok(bubbleInStory(pagination.pages[pagination.panelPages[index]], panel.line)));
});

test('reversed bubbles name the line and sentence numbers before testing balance', () => {
  const text = clone(); [text.panelLines[0], text.panelLines[3]] = [text.panelLines[3], text.panelLines[0]];
  const reason = reasonOf(() => validateStory(text));
  assert.match(reason, /^panel_bubbles_out_of_order:/);
  assert.ok(reason.includes(JSON.stringify(text.panelLines[1].line)));
  assert.match(reason, /sentence \d+/);
});

test('bubbles 2 and 3 in one sentence name both lines and the zero-sentence gap', () => {
  // Direct split uses a compact story to isolate the placement rule.
  const panels = ['We start.', 'find a word', 'that one fits', 'We finish.'].map(line => ({ line }));
  const reason = reasonOf(() => splitStory('MADE UP\nWe start. We find a word and that one fits. We finish.', panels));
  assert.match(reason, /^panel_bubbles_2_and_3_too_close:/);
  for (const panel of panels.slice(1, 3)) assert.ok(reason.includes(JSON.stringify(panel.line)));
  assert.match(reason, /0 full sentences/);
});

test('unbalanced pages follow bubble order and report the percentage without rejecting it', () => {
  const text = clone();
  text.panelLines = ['The door goes slam.', 'The backpack goes thud.', 'The whole afternoon goes bzzzt.', 'Pip turns the page and keeps drawing.'].map((line, index) => ({ line, scene: `Scene ${index + 1} shows the fox.` }));
  const { pagination } = validateStory(text);
  assert.ok(pagination.cut.pageOnePercent < 35);
  text.panelLines.forEach((panel, i) => assert.ok(bubbleInStory(pagination.pages[pagination.panelPages[i]], panel.line)));
});

test('a 13-word bubble reports its count and waits for measured fit', () => {
  const text = clone(); text.panelLines[0].line = 'Pip stops, because even Pip can hear that the word is too wide.';
  text.story = text.story.replace('The door goes slam.', text.panelLines[0].line);
  const result = validateStory(text);
  const row = result.guidance.find(row => row.field === 'panelLines[0].line');
  assert.equal(row.measured, 13); assert.equal(row.outsideRange, true); assert.equal(row.reportOnly, true);
});

test('paragraph boundaries win within the window; sentence boundaries work without paragraph breaks', () => {
  const sentences = Array.from({ length: 20 }, (_, index) => `Marker${index} ${'word '.repeat(9).trim()}.`);
  const panels = [1, 6, 14, 18].map(index => ({ line: `Marker${index}` }));
  const paragraphStory = sentences.slice(0, 9).join(' ') + '\n\n' + sentences.slice(9).join(' ');
  const paragraph = splitStory(paragraphStory, panels);
  assert.equal(paragraph.wordCounts[0], 90); assert.equal(paragraph.cut.paragraph, true);
  const sentence = splitStory(sentences.join(' '), panels);
  assert.deepEqual(sentence.wordCounts, [100, 100]); assert.equal(sentence.cut.paragraph, false);
  for (const count of [7, 13]) {
    const edge = [1, count - 1, count, 18].map(index => ({ line: `Marker${index}` }));
    assert.equal(splitStory(sentences.join(' '), edge).wordCounts[0], count * 10);
  }
});

test('layout requires and consumes saved pages without splitting again', () => {
  const text = clone(), { pagination } = validateStory(text);
  assert.throws(() => makePages(moves[0], text), /Saved chapter pages/);
  const pages = makePages(moves[0], { ...text, pagination });
  for (const [index, name] of ['story.html', 'story-2.html'].entries()) {
    assert.ok(visibleText(pages[name]).includes(pagination.pages[index].replace(/\s+/g, ' ')));
    assert.equal((pages[name].match(/src="panel-\d.png"/g) ?? []).length, 2);
  }
  const changed = structuredClone(pagination); changed.pages.reverse();
  assert.throws(() => assertStoryPagination(text.story, text.panelLines, changed), /changed after validation/);
  assert.doesNotThrow(() => makePages(moves[0], { ...text, story: text.story.replace('door goes slam', 'door goes thump'), pagination }));
});

test('adaptive medium request settings remain, and retry errors pass verbatim', () => {
  const reason = 'panel_bubbles_unbalanced: page 1 would hold 20 percent at "one" / "two".';
  const request = buildStoryRequest(family, sentences[0], { reason });
  assert.equal(request.max_output_tokens, 24000); assert.equal(request.store, false);
  assert.deepEqual(request.reasoning, { effort: 'medium' });
  assert.equal(JSON.parse(request.input[0].content).correction.error, reason);
  assert.match(STORY_RULES, /copies a short spoken passage/); assert.match(STORY_RULES, /page cut between them/);
  assert.doesNotMatch(STORY_RULES, /under 8|fewer than 8|match the first half|must have at most 109/);
});

test('extractJSON accepts fences and prose but takes only the first complete object', () => {
  for (const input of ['```json\n{"a":1}\n```', 'Here: {"a":1} Thanks.', '{"a":1} {"b":2}']) assert.deepEqual(extractJSON(input), { a: 1 });
  const value = { nested: { text: 'A } then { and a quote " and slash \\.' } };
  assert.deepEqual(extractJSON(JSON.stringify(value) + '\n{"second":true}'), value);
  for (const invalid of ['nothing', '{"a":', '{"a":}', '```json\n{"a":\n```']) assert.throws(() => extractJSON(invalid));
  assert.equal(parseStoryCheck('```json\n' + JSON.stringify(passingStoryCheck()) + '\n```').ready, true);
  assert.equal(parsePictureCheck('```json\n' + JSON.stringify(pictureCheckAnswer()) + '\n```').ready, true);
});

test('rejected and malformed stories retain private files; attempt 2 gets the exact reason', async t => {
  const directory = temp(t);
  const transport = offlineTransport(t, directory, request => ['story', 'story-correction'].includes(request.stage) ? textAnswer(request.retry === 0 ? { ...run5, panelLines: run5.panelLines.map((panel, i) => i ? panel : { ...panel, line: false }) } : '```json\n{"unfinished":') : undefined);
  await assert.rejects(createKit(transport, createStoredMemory(directory), sentences[0], { kit: 1, directory }), /Story rejected after 2/);
  const first = readJSON(join(directory, 'story-attempt-1.json'));
  assert.equal(first.panelLines[0].line, false);
  const reason = readFileSync(join(directory, 'story-attempt-1.reason.txt'), 'utf8').trim();
  // Both private names become two-word generic labels; count the visible bubble.
  assert.match(reason, /text strings/);
  assert.equal(JSON.parse(transport.calls[1].body.input[0].content).correction.error, reason);
  assert.equal(readFileSync(join(directory, 'story-attempt-2.raw.txt'), 'utf8'), '```json\n{"unfinished":');
  for (const name of ['story-attempt-1.json', 'story-attempt-1.reason.txt', 'story-attempt-2.raw.txt', 'story-attempt-2.reason.txt', 'kit-log.md']) assertPrivate(join(directory, name));
  assert.equal(transport.calls.length, 2);
});

function createStoredMemory(directory) { const memory = createMemory(join(directory, 'family.json')); memory.store(plainFamily()); return memory; }

test('checker rewrite and both full checker answers keep increasing file numbers', async t => {
  const directory = temp(t);
  const transport = offlineTransport(t, directory, request => request.stage === 'story-check' && request.retry === 0 ? textAnswer(markFault(passingStoryCheck(), 'secondMoveTaught', 'The door goes slam.', ['story'])) : undefined);
  const result = await readyStory(withKitEvidence(transport, directory), plainFamily(), sentences[0], { kit: 1 });
  assert.equal(result.ready, true);
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-check', 'story-rewrite', 'story-check']);
  assert.equal(readJSON(join(directory, 'story-check-1.json')).answer.secondMoveTaught, true);
  assert.equal(readJSON(join(directory, 'story-check-2.json')).answer.secondMoveTaught, false);
  assert.equal(readFileSync(join(directory, 'story-attempt-2.reason.txt'), 'utf8').trim(), 'PASS');
  const ledger = readJSON(join(directory, 'kit-log.json'));
  for (const row of ledger) {
    if (!row.requestId) { assert.equal(row.cost.usd, 0); continue; }
    const response = readLog(transport.logFile).find(item => item.event === 'response' && item.id === row.requestId);
    assert.equal(row.elapsedSeconds, response.elapsedSeconds); assert.deepEqual(row.cost, response.cost);
    assert.ok(row.verdict !== 'PENDING');
  }
});

test('unfinished answers are saved before the stop-reason check', async t => {
  const directory = temp(t);
  const transport = offlineTransport(t, directory, () => ({ ...textAnswer(run5), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }));
  await assert.rejects(writeStory(withKitEvidence(transport, directory), plainFamily(), sentences[0]), /story_max_tokens/);
  assert.deepEqual(readJSON(join(directory, 'story-attempt-1.json')), run5);
  assert.match(readFileSync(join(directory, 'story-attempt-1.reason.txt'), 'utf8'), /story_max_tokens/);
});

test('confirmed extra poster lettering allows one repair and preserves both readbacks', async t => {
  const directory = temp(t), record = plainFamily(); record.hero.heroPicturePath = new URL('./fixtures/offline-art.png', import.meta.url).pathname;
  let checks = 0;
  const transport = offlineTransport(t, directory, request => request.stage === 'poster-word-check' ? openaiAnswer({ ...syntheticCastEvidence(request), ...passingWordCheck(posterBoxes(moves[0], run5)), extraText: ++checks === 1 ? ['Stray lettering'] : [] }) : undefined);
  const result = await readyDrawnPage(withKitEvidence(transport, directory), record, moves[0], sentences[0], run5, { directory });
  assert.equal(result.ready, true); assert.equal(transport.calls.length, 4);
  assert.deepEqual(readJSON(join(directory, 'poster-transcription-1.json')).leftoverList, ['Stray lettering']);
  assert.deepEqual(readJSON(join(directory, 'poster-transcription-2.json')).leftoverList, []);
  assert.ok(result.checks[0].faults.some(key => key.startsWith('extra_words')));
});

test('poster count is report only but approved and transcribed words must still match', () => {
  const move = { ...moves[0], positiveAction: 'word '.repeat(150).trim() };
  const boxes = posterBoxes(move, run5), answer = passingWordCheck(boxes);
  assert.equal(posterWordReport(move, run5).status, 'WARN');
  assert.doesNotThrow(() => buildPosterRequest({ ...family, familyContext: '' }, move, '', run5));
  const check = parseWordCheck(JSON.stringify(answer), boxes);
  assert.equal(check.ready, true); assert.equal(check.wordCap.count, check.transcriptionWordCap.count);
  answer.boxes[0].text += ' extra';
  assert.equal(parseWordCheck(JSON.stringify(answer), boxes).ready, true);
});

test('offline whole kit reaches five pages, saved PDF fixture and interactive index with every receipt', async t => {
  const directory = temp(t), transport = offlineTransport(t, directory);
  const result = await createKit(transport, createStoredMemory(directory), sentences[0], { directory, kit: 1, exports: offlineExports() });
  assert.equal(result.complete, true); assert.equal(result.pdf.fixture, true); assert.equal(result.posterPDF.fixture, true);
  assert.equal(Object.keys(result.pages).length, 5);
  assert.deepEqual(result.pagination, readJSON(join(directory, 'story-pagination.json')));
  for (const [index, name] of ['story.html', 'story-2.html'].entries()) {
    const html = readFileSync(join(directory, name), 'utf8');
    assert.equal((html.match(/src="panel-\d.png"/g) ?? []).length, 2);
    run5.panelLines.forEach((panel, panelIndex) => {
      if (result.pagination.panelPages[panelIndex] === index) {
        assert.ok(html.includes(`panel-${panelIndex + 1}.png`));
        assert.ok(bubbleInStory(visibleText(html), panel.line));
      } else assert.ok(!html.includes(`panel-${panelIndex + 1}.png`));
    });
  }
  const finalHTML = readFileSync(join(directory, 'kit_final.html'), 'utf8');
  assert.equal((finalHTML.match(/data-page=/g) ?? []).length, 5);
  assert.match(finalHTML, /html\[data-theme=dark\]/); assert.match(finalHTML, /data-theme="light"/);
  for (const [name, count] of [['kit_final.pdf', 5], ['poster.pdf', 1]]) {
    const bytes = readFileSync(join(directory, name));
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal((bytes.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, count);
  }
  const index = readFileSync(join(directory, 'index.html'), 'utf8');
  assert.match(index, /interactive.js/); assert.match(index, /data-region="plan"/);
  assert.equal(result.interactive.ready, false, 'Rehearsal must not grant content approval');
  assert.equal(existsSync(join(directory, 'picture-check-hero-1.json')), false);
  assert.equal(result.art.continuityChecks.length, 0);
  const continuity = readJSON(join(directory, 'checkpoint.json')).stages['cast-continuity'];
  assert.equal(continuity.reviewStatus, 'parent-review'); assert.equal(continuity.verified, false);
  const check = result.art.poster.checks.at(-1);
  assert.equal(check.ready, true); assert.equal(check.wordCap.count, check.transcriptionWordCap.count);
  assert.equal(result.posterWordCheck.count, check.wordCap.count); assert.equal(result.posterWordCheck.reportOnly, true);
  for (const name of ['story-attempt-1.json', 'story-attempt-1.reason.txt', 'story-check-1.json', 'picture-check-poster-1.json', ...[1, 2, 3, 4].map(i => `picture-check-panel-${i}-1.json`), 'poster-transcription-1.json', 'printed-fit-1.json', 'printed-fit-2.json', 'kit-log.md']) {
    assert.ok(existsSync(join(directory, name)), name); assertPrivate(join(directory, name));
  }
  const transcription = readJSON(join(directory, 'poster-transcription-1.json'));
  assert.deepEqual(transcription.leftoverList, []); assert.equal(transcription.verdict, 'PASS');
  assert.equal(transport.calls.length, 14);
  assert.ok(!transport.calls.some(row => row.stage === 'hero-check' || row.stage.endsWith('-reference-check') || row.stage === 'cast-continuity-check'));
  const ledger = readJSON(join(directory, 'kit-log.json'));
  assert.ok(ledger.some(row => row.stage === 'cast-continuity' && /parent review/i.test(row.verdict)));
  assert.ok(ledger.every(row => row.verdict !== 'PENDING'));
  assert.ok(ledger.some(row => /parent review/i.test(row.verdict)));
  assert.equal(ledger.filter(row => row.stage === 'printed-fit').length, 2);
  assert.ok(ledger.every(row => row.cost.usd === 0));
  for (const name of readdirSync(directory).filter(name => /^(story-|picture-check-|poster-transcription-|printed-fit-|kit-log)/.test(name))) assertPrivate(join(directory, name));
});

test('a malformed current poster check rechecks once, saves failure and cannot restart on Resume', async t => {
  const directory = temp(t), record = plainFamily(); record.hero.heroPicturePath = new URL('./fixtures/offline-art.png', import.meta.url).pathname;
  const transport = offlineTransport(t, directory, request => request.stage === 'poster-word-check' ? openaiAnswer({ boxes: 'not an array' }) : undefined);
  const evidence = withKitEvidence(transport, directory);
  const run = () => readyDrawnPage(evidence, record, moves[0], sentences[0], run5, { directory });
  await assert.rejects(run(), /unverified/);
  assert.equal(transport.calls.filter(call => call.stage === 'poster').length, 1);
  assert.equal(transport.calls.filter(call => call.stage === 'poster-word-check').length, 2);
  for (const attempt of [1, 2]) assert.deepEqual(readJSON(join(directory, `picture-check-poster-${attempt}.json`)).answer, { boxes: 'not an array' });
  assert.equal(readJSON(join(directory, 'picture-check-poster-2.json')).check.verified, false);
  await assert.rejects(run(), /unverified/); assert.equal(transport.calls.length, 3);
});

test('hero lettering must be transcribed even if its boolean verdict claims no letters', () => {
  const answer = { ...pictureCheckAnswer(), transcription: ['Unexpected label'] };
  assert.equal(parsePictureCheck(JSON.stringify(answer)).ready, true);
  delete answer.transcription;
  assert.equal(parsePictureCheck(JSON.stringify(answer)).needsRecheck, true);
});

test('an answer with unknown billing reaches the private kit folder with its ceiling accounting', async t => {
  const directory = temp(t);
  const base = createTransport({ keys: { openai: 'offline-key' }, logFile: join(directory, 'requests.jsonl') });
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(textAnswer(run5)), { status: 200 }));
  const transport = withKitEvidence(base, directory);
  await writeStory(transport, plainFamily(), sentences[0]);
  assert.deepEqual(readJSON(join(directory, 'story-attempt-1.json')), run5);
  assert.ok(readJSON(join(directory, 'kit-log.json'))[0].accounting.usd > 0);
  assert.equal(readJSON(join(directory, 'kit-log.json'))[0].accounting.basis, 'reserved-ceiling');
  assert.equal(readJSON(join(directory, 'kit-log.json'))[0].cost.usd, null);
});

test('raw HTTP bodies remain strict JSON and the rejected body is retained', async t => {
  const directory = temp(t);
  const base = createTransport({ keys: { openai: 'offline-key' }, logFile: join(directory, 'requests.jsonl') });
  const raw = 'Here is a response: {"content":[]}';
  t.mock.method(globalThis, 'fetch', async () => new Response(raw, { status: 200 }));
  await assert.rejects(writeStory(withKitEvidence(base, directory), plainFamily(), sentences[0]), /malformed JSON/);
  assert.equal(readFileSync(join(directory, 'story-attempt-1.raw.txt'), 'utf8'), raw);
  assert.match(readFileSync(join(directory, 'story-attempt-1.reason.txt'), 'utf8'), /malformed JSON/);
});
