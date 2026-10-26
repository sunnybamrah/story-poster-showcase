import { expectReview } from './review-assertions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { moves, readJSON } from '../server/files.js';
import { checkSources } from '../content/check-sources.mjs';
import { createMemory } from '../server/memory.js';
import { eligibleMoves, scout } from '../server/picker.js';
import { chooseWorld, worldChoices } from '../server/worlds.js';
import { writeStory, readyStory, validateStory } from '../server/story.js';
import { createKit } from '../server/kit.js';
import { createTransport, readLog } from '../server/transport.js';
import { buildStoryRequest, buildPictureRequest, buildFrameRequest, buildFrameCheckRequest, STORY_RULES } from '../server/requests.js';
import { checkedFrame, readyFrame } from '../server/frames.js';
import { previewPages, posterContent, verifyOwnedWords, assertPosterWordCap, combinedKitHTML, assertBlankFrames, pdfCommand } from '../server/layout.js';
import { auditKits } from '../server/audit.js';
import { family, sentences, savedKit } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';

function localRun(t, record = family) {
  const directory = mkdtempSync(join(tmpdir(), 'slice0-pass3-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const memory = createMemory(join(directory, 'family.json')); memory.store(record);
  const logFile = join(directory, 'requests.jsonl'); writeFileSync(logFile, '');
  const transport = createTransport({ keys: {}, logFile });
  return { directory, memory, transport, logFile };
}

test('source records keep ids, fit labels, copied kid lines and valid backups', () => {
  assert.equal(checkSources().moves, 14);
  for (const move of moves) {
    assert.ok(move.whereItCameFrom && move.searchPhrase && move.keyWord);
    assert.ok(move.source.text.includes(move.whereItCameFrom));
    assert.ok(move.source.text.includes(move.searchPhrase));
    assert.ok(moves.some(other => other.id === move.approvedBackup && other.id !== move.id));
    for (const source of move.sources) {
      assert.ok(move.parentReceipt.includes(source.pubmed ?? source.doi));
      assert.ok(source.limitation.trim(), `${move.id}: each paper needs its own limit`);
    }
  }
  const broken = structuredClone(moves);
  delete broken[0].sources[0].doi; delete broken[0].sources[0].pubmed;
  assert.throws(() => checkSources(broken), /id/);
  const noLabel = structuredClone(moves); delete noLabel[0].sources[0].fitLabel;
  assert.throws(() => checkSources(noLabel), /fit label/);
});

test('four saved kits keep all fields and used ids while summarize3 holds only three', t => {
  const { memory, directory } = localRun(t);
  for (let i = 0; i < 4; i++) memory.addKit(savedKit({ chapterNumber: i + 1, moveId: moves[i].id, adventureLine: `Adventure ${i + 1}` }));
  const saved = createMemory(join(directory, 'family.json')).exportRecord();
  assert.equal(saved.pastKits.length, 4);
  assert.deepEqual(saved.usedMoveIds, moves.slice(0, 4).map(move => move.id));
  assert.deepEqual(Object.keys(saved.pastKits[0]).sort(), ['date', 'chapterNumber', 'moveId', 'triedMove', 'didItHelp', 'adventureLine', 'world', 'colourSet', 'wallChoice'].sort());
  assert.doesNotMatch(memory.summarize3(), /Adventure 1/);
  assert.match(memory.summarize3(), /Adventure 4/);
  assert.equal(memory.summarize3().split('\n').length, 3);
  memory.deleteFact('Pip gets loud when plans change.');
  assert.deepEqual(memory.exportRecord().usedMoveIds, saved.usedMoveIds);
  for (const patch of [{ triedMove: 'maybe' }, { didItHelp: 'helped' }, { world: 'injected world' }, { chapterNumber: 0 }]) {
    assert.throws(() => memory.addKit(savedKit({ chapterNumber: 5, ...patch })));
  }
});

test('used moves stay in the writing source bank while history and explicit eligibility stay intact', () => {
  const record = { ...family, pastKits: moves.slice(0, 4).map((move, i) => savedKit({ chapterNumber: i + 1, moveId: move.id })) };
  const request = JSON.parse(buildStoryRequest(record, sentences[0]).input[0].content);
  assert.ok(request.moves.some(move => move.id === moves[0].id));
  assert.equal(request.moves.length, 14);
  const story = kitText();
  expectReview(() => validateStory(story, { usedIds: record.pastKits.map(kit => kit.moveId) }), /used_move/);
  assert.equal(validateStory(story, { usedIds: [story.moveId], allowRepeat: true }).id, story.moveId);
  assert.ok(JSON.parse(buildStoryRequest(record, sentences[0], { allowRepeat: true }).input[0].content).moves.some(move => move.id === story.moveId));
  assert.ok(!eligibleMoves(record, sentences[0], { allowRepeat: 'true' }).some(item => item.move.id === story.moveId));
  assert.throws(() => validateStory(story, { eligibleIds: ['long-breath-out'] }), /ineligible/);
});

test('changed saved feedback changes repeat order by helped then tried, with latest feedback used', t => {
  const { memory } = localRun(t);
  memory.addKit(savedKit({ moveId: 'name-it-exactly', didItHelp: 'a little', triedMove: 'yes' }));
  memory.addKit(savedKit({ chapterNumber: 2, moveId: 'long-breath-out', didItHelp: 'yes', triedMove: 'no' }));
  const order = () => eligibleMoves(memory.exportRecord(), sentences[0], { allowRepeat: true }).map(item => item.move.id);
  assert.deepEqual(order().slice(0, 2), ['long-breath-out', 'name-it-exactly']);
  memory.setFeedback(1, { triedMove: 'yes', didItHelp: 'yes' });
  assert.deepEqual(order().slice(0, 2), ['name-it-exactly', 'long-breath-out']);
  memory.setFeedback(1, { triedMove: 'yes', didItHelp: 'not for us' });
  assert.equal(order()[0], 'long-breath-out');
  assert.ok(!order().includes('name-it-exactly'));
  const payload = JSON.parse(buildStoryRequest(memory.exportRecord(), sentences[0], { allowRepeat: true }).input[0].content);
  assert.ok(order().every(id => payload.moves.some(move => move.id === id)));
  assert.ok(!payload.moves.some(move => move.id === 'name-it-exactly'));
  assert.equal(payload.moves.length, 13);
  assert.equal(payload.moves[0].id, 'bring-in-my-person', 'An unused fitting guide ranks first without deleting other source choices.');
});

test('no unused match requires a repeat choice and never pads unknown notes', t => {
  const { memory, logFile } = localRun(t, { ...family, pastKits: moves.map((move, i) => savedKit({ moveId: move.id, chapterNumber: i + 1 })) });
  const repeat = scout(sentences[0], memory.exportRecord());
  assert.equal(repeat.status, 'noMatch'); assert.equal(repeat.canRepeat, true); assert.deepEqual(repeat.suggestions, []);
  const chosen = scout(sentences[0], memory.exportRecord(), { allowRepeat: true });
  assert.ok(chosen.suggestions.length);
  assert.ok(JSON.parse(buildStoryRequest(memory.exportRecord(), sentences[0], { allowRepeat: true }).input[0].content).moves.length);
  const unknown = scout('A purple comet.', memory.exportRecord(), { allowRepeat: true });
  assert.equal(unknown.status, 'noMatch'); assert.equal(unknown.canRepeat, false); assert.deepEqual(unknown.suggestions, []);
  assert.deepEqual(readLog(logFile), []);
});

test('scout returns three fitting ids and reasons without calls and honors saved history', t => {
  const { memory, logFile } = localRun(t);
  const result = scout(sentences[0]);
  assert.equal(result.status, 'scout'); assert.equal(result.suggestions.length, 3);
  assert.deepEqual(result.suggestions.map(item => item.moveId), eligibleMoves(family, sentences[0]).slice(0, 3).map(item => item.move.id));
  assert.ok(result.suggestions.every(item => item.reason.trim()));
  memory.addKit(savedKit());
  assert.ok(!scout(sentences[0], memory.exportRecord()).suggestions.some(item => item.moveId === 'name-it-exactly'));
  assert.equal(scout('A purple comet.').status, 'noMatch');
  assert.deepEqual(readLog(logFile), []);
});

const parentCases = [
  ['My child worries about body weight and food.', 'listen', 'body-and-food'],
  ['Their dog died today.', 'grief', 'loss'],
  ['Just listen tonight.', 'listen', 'listening-request'],
  ['They are left out on purpose.', 'grown-up job', 'adult-responsibility'],
  ['I yelled at my child.', 'repair', 'parent-repair'],
];
for (const [sentence, route, reason] of parentCases) test(`parent route returns saved words and makes no calls: ${reason}`, async t => {
  const { memory, directory, transport, logFile } = localRun(t);
  const expected = readJSON(new URL('../content/parent-responses.json', import.meta.url))[reason];
  const result = await createKit(transport, memory, sentence, { directory });
  assert.equal(result.status, 'parentResponse'); assert.equal(result.route, route);
  assert.deepEqual(result.lines, expected.lines);
  assert.deepEqual((await readyStory(transport, memory.exportRecord(), sentence)).lines, expected.lines);
  assert.deepEqual(scout(sentence).suggestions, []);
  assert.deepEqual(readLog(logFile), []);
  assert.equal(existsSync(join(directory, 'poster.html')), false);
});

test('poster worlds and colours rotate without imposing a story setting', () => {
  assert.ok(new Set(worldChoices.worlds).size >= 8); assert.ok(new Set(worldChoices.colourSets).size === 4);
  const record = structuredClone(family);
  for (let i = 0; i < 6; i++) {
    const pair = chooseWorld(record);
    for (const prior of record.pastKits.slice(-2)) { assert.notEqual(pair.world, prior.world); assert.notEqual(pair.colourSet, prior.colourSet); }
    record.pastKits.push(savedKit({ chapterNumber: i + 1, ...pair }));
  }
  const payload = JSON.parse(buildStoryRequest(record, sentences[0]).input[0].content);
  const pair = chooseWorld(record);
  assert.equal(payload.world, undefined); assert.equal(payload.colourSet, undefined);
  const picture = buildPictureRequest(record, moves[1], sentences[0], { selection: pair });
  assert.ok(picture.prompt.includes(`World: ${pair.world}.`)); assert.ok(picture.prompt.includes(`Colour set: ${pair.colourSet}.`));
  assert.ok(picture.prompt.includes(moves[1].actionLine));
  assert.throws(() => buildPictureRequest(record, moves[0], sentences[0], { selection: { world: record.familyContext, colourSet: 'warm' } }), /fixed list/);
});

test('story instructions retain honest ending and add strategy, joke, worry and blank guards', () => {
  for (const text of ['Every positive action names a strategy, asking for help, or noticing progress', 'Never praise effort alone', '"yet" is not magic', 'One harmless joke about the move', 'an honest imperfect ending', 'Worried thoughts belong in the story and never on the poster', "Never supply the child's blank answer"]) assert.ok(STORY_RULES.includes(text));
  assert.throws(() => validateStory({ ...kitText(), story: kitText().story + '\nWhen I notice fear, I hide.' }), /filled_When_I_notice/);
});

test('110 words are report only and five-page PDF keeps order, margins, empty frames and true image shapes', () => {
  assert.equal(assertPosterWordCap(109).status, 'PASS');
  assert.equal(assertPosterWordCap(110).status, 'WARN');
  assert.throws(() => assertPosterWordCap('x'), /not a number/);
  const pages = previewPages(moves[0]);
  const html = combinedKitHTML(pages, { preview: true });
  assert.deepEqual([...html.matchAll(/data-page="([^"]+)"/g)].map(match => match[1]), ['poster', 'story', 'story-2', 'try', 'for-you']);
  assert.match(html, /@page\{size:letter;margin:36pt\}/);
  assert.match(html, /object-fit:contain/); assert.match(html, /break-after:page/);
  assert.equal(assertBlankFrames({ 'kit_final.html': html }), true);
  assert.throws(() => assertBlankFrames({ 'kit_final.html': html.replace('______', 'angry') }));
  const { args } = pdfCommand('/tmp/kit_final.html', '/tmp/kit_final.pdf');
  assert.equal(args.at(-1), 'file:///tmp/kit_final.html?print=1');
  for (const flag of ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files', '--no-pdf-header-footer', '--print-to-pdf=/tmp/kit_final.pdf']) assert.ok(args.includes(flag));
});

test('frame requests contain only art directions; missing or interrupted frames cannot trigger a second generation', async t => {
  const { directory, transport, logFile } = localRun(t);
  const body = buildFrameRequest(family, sentences[0]);
  assert.equal(body.n, 1); assert.match(body.prompt, /decorative border/); assert.match(body.prompt, /no letters/);
  assert.doesNotMatch(body.prompt, /Pip|grandad|tryouts/);
  const payload = JSON.parse(buildFrameCheckRequest(family, sentences[0], 'data:image/png;base64,AA==').input[0].content[0].text);
  assert.deepEqual(payload.lookChips, []); assert.deepEqual(payload.outfitList, []); assert.equal(payload.expectedPeopleCount, 0);
  assert.throws(() => checkedFrame(directory), /pending/);
  writeFileSync(join(directory, 'graphic-novel-v3-frame.json'), JSON.stringify({ generations: 1, state: 'generation-started' }));
  await assert.rejects(readyFrame(transport, family, sentences[0], { directory }), /pending/);
  assert.deepEqual(readLog(logFile), []);
});

test('Kit 2 uses the corrected tryout month, November, and never says next week', () => {
  const audit = story => {
    const pages = previewPages(moves[0], { kitCount: 1 }); pages['story.html'] += `<p>${story}</p>`;
    const kit = { complete: true, move: moves[0], recordAtStart: family, story, pages, checks: [] };
    return auditKits({ kits: [kit, kit], record: family, log: [] }).rows[0];
  };
  assert.equal(audit('MADE UP\nTryouts are in November.').status, 'PASS');
  assert.equal(audit('MADE UP\nTryouts are next week.').status, 'FAIL');
  assert.equal(audit('MADE UP\nTryouts are in October.').status, 'FAIL');
});
