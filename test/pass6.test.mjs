import { pictureStyleReferenceFor } from '../server/graphic-style.js';
import { expectReview } from './review-assertions.mjs';
import { syntheticCastEvidence, geometryAnswer, wordCheckAnswer, storyCheckAnswer, markFault, castObservation } from './checker-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { guideReaderLimitation, guideReaderClaim } from '../app/reader-notes.js';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { moves, words, readJSON } from '../server/files.js';
import { posterBoxes, boxText, cardTitles, posterWordCount, posterSlotWordCounts, assertPosterWordCap, emptyMove, visibleWords, approvedPosterWords, scienceFor, positiveActionFor, posterScienceClaimFor } from '../server/format.js';
import { buildPosterRequest, buildPanelRequest, buildWordCheckRequest, buildStoryCheckRequest, buildStoryRequest, privacyFor, assertNoFamilyText, storyCheckKeys } from '../server/requests.js';
import { parseWordCheck } from '../server/check-words.js';
import { readyDrawnPage, readyKitArt, imageHash } from '../server/picture.js';
import { lockedCast } from '../server/cast.js';
import { validateStory, readyStory } from '../server/story.js';
import { previewPages, makePages, combinedKitHTML, splitStory, visibleText, copyFonts } from '../server/layout.js';
import { validatePDFText } from '../server/check-pdf.js';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { createTransport, readLog } from '../server/transport.js';
import { family, sentences } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { posterTemplate, geometryRects, geometryBooleanKeys, templateGuidePNG } from '../server/poster-template.js';
const geometryFor = geometryAnswer;

const answerFor = wordCheckAnswer;
const shortMove = { ...moves[0], positiveAction: 'Say one feeling.', kidScienceLine: 'Naming may help.', whereItCameFromShort: 'Nook, Harvard, 2018.', searchPhrase: 'Nook feelings 2018' };
const safeRecord = { ...family, familyContext: '', hero: { ...family.hero } };
function temp(t) { const directory = mkdtempSync(join(tmpdir(), 'pass6-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; }
const png = templateGuidePNG(); // Synthetic outline image, never a paid drawing.

test('poster approved boxes match all v6 slots and leave footer and writing blanks empty', () => {
  const text = kitText();
  const boxes = posterBoxes(moves[0], text);
  assert.deepEqual(boxes.map(box => box.id), ['title', 'tagline', 'tiny', 'science', 'keyword', 'move', 'remember', 'source', 'footer']);
  assert.deepEqual(boxes.filter(box => box.card).map(box => box.title), cardTitles);
  assert.equal(boxes[2].text, positiveActionFor(moves[0]));
  assert.equal(boxes[3].text, posterScienceClaimFor(moves[0]));
  assert.equal(boxes[4].text, moves[0].keyWord);
  assert.ok(boxes[5].text.replace(/\s+/gu, ' ').startsWith(emptyMove));
  assert.match(boxes[5].text, /,\nI ______\./);
  assert.equal(boxes[6].text, `${text.tagline}\n${moves[0].bodyAction}`);
  assert.equal(boxes[7].text, `${moves[0].whereItCameFromShort} Search: ${moves[0].searchPhrase}`);
  assert.equal(boxes.at(-1).text, '');
  for (const move of moves) {
    assert.ok(words(move.whereItCameFromShort).length < 15);
    assert.equal(move.shortLineWrittenByCodex, true);
    const pages = previewPages(move);
    assert.ok(visibleText(pages['for-you.html']).includes(guideReaderClaim(move.id, scienceFor(move).claim)));
    assert.ok(visibleText(pages['for-you.html']).includes(guideReaderLimitation(move.id, scienceFor(move).limitation)));
    assert.doesNotMatch(pages['try.html'], /Where it came from, the longer version/);
  }
  for (const move of moves) {
    const backup = moves.find(item => item.id === move.approvedBackup);
    assert.equal(posterBoxes(move, text).find(box => box.id === 'move').text, `${emptyMove.replace(', I ', ',\nI ')}\nBackup: ${backup.name}`);
  }
});

test('poster body actions show each move, with the exact sigh only on the breathing move', () => {
  const meaningfulActions = {
    'name-it-exactly': "Touch your chest together. Say the feeling's name.",
    'long-breath-out': 'Two quick breaths in through the nose, one long breath out.',
    'coach-voice': 'Touch your chest. Say your name and one kind next step.',
    'snag-plan': "Hold up one finger for 'if' and another for 'then.'",
    'cool-off-break': "Step aside. Stretch gently. Step back and say, 'I'm back.'",
    'bring-in-my-person': "Turn toward your grown-up. Say, 'Can you help me?'",
    'one-brave-step': 'Hold up one finger. Take one small step forward.',
    'compare-with-past-me': 'Point left for what you could do then, right for now.',
    'make-it-right': "Hold out a new pencil. Say, 'Sorry I broke yours.'",
    'good-enough-is-done': 'Close your folder. Put it in your bag.',
    'dont-feed-the-fire': "Pretend to type, 'Are you okay?' Send it only to them.",
    'butterflies-mean-ready': "Touch your chest. Say, 'My body's getting ready.' Start your first line.",
    'worry-parking-spot': 'Fold your worry note. Put it in the box until your agreed talk time.',
    'check-my-battery': "Count on three fingers: 'Sleep? Water? A stretch?'",
  };
  for (const move of moves) {
    assert.equal(move.bodyAction, meaningfulActions[move.id], move.id);
    assert.ok(words(move.name).length <= 4, move.id);
  }
  assert.equal(new Set(moves.map(move => move.keyWord)).size, 14);
});

test('poster count includes every visible word and both rhyme copies; count warns at 110', () => {
  const text = kitText();
  const count = posterBoxes(moves[0], text).reduce((n, box) => n + visibleWords(boxText(box)).length, 0) + 3;
  assert.equal(posterWordCount(moves[0], text), count);
  assert.equal(count - posterWordCount(moves[0]), 2 * words(text.tagline).length);
  assert.equal(posterWordCount(moves[0], text, { nickname: 'Captain Pip' }), count + 1);
  assert.equal(Object.values(posterSlotWordCounts(moves[0], text)).reduce((a, b) => a + b, 0), count);
  assert.equal(assertPosterWordCap(109).status, 'PASS');
  for (const count of [110, 200, 999]) assert.deepEqual(assertPosterWordCap(count), { id: 'poster', count, cap: 109, status: 'WARN', reportOnly: true });
});

test('word check accepts exact transcription including line wrap, curly quotes and empty ruled lines', () => {
  const boxes = posterBoxes(moves[0], kitText());
  const answer = answerFor(boxes);
  answer.boxes[2].text = answer.boxes[2].text.replaceAll("'", '’').replaceAll(' ', '\n');
  assert.equal(parseWordCheck(JSON.stringify(answer), boxes).ready, true);
});
for (const fault of ['extra', 'missing', 'misspelled', 'mirrored', 'unreadable', 'filled blank', 'extra box', 'missing box', 'reordered', 'outside', 'clipped']) {
  test(`poster word check fails: ${fault}`, () => {
    const boxes = posterBoxes(moves[0], kitText()); const answer = answerFor(boxes);
    if (fault === 'extra') answer.boxes[2].text += ' Victory';
    if (fault === 'missing') answer.boxes[3].text = answer.boxes[3].text.replace(/^[^ ]+ /, '');
    if (fault === 'misspelled') answer.boxes[4].text = 'EXAKT';
    if (fault === 'mirrored') markFault(answer, 'keyWordMirrored', 'Visible mirrored key word');
    if (fault === 'unreadable') markFault(answer, 'keyWordUnreadable', '[unreadable]');
    if (fault === 'filled blank') answer.boxes[5].text = answer.boxes[5].text.replace('______', 'mad');
    if (fault === 'extra box') answer.boxes.push({ id: 'banner', text: 'Victory' });
    if (fault === 'missing box') answer.boxes.pop();
    if (fault === 'reordered') answer.boxes.reverse();
    if (fault === 'outside') answer.extraText.push('Surprise slogan');
    if (fault === 'clipped') answer.geometry.textLines[0].w += 40;
    const checked = parseWordCheck(JSON.stringify(answer), boxes);
    assert.equal(checked.ready, !['unreadable', 'clipped'].includes(fault));
    if (checked.ready) assert.ok(checked.reviewFlags.length);
  });
}
test('malformed, empty and incomplete transcription never passes', () => {
  for (const text of ['', '{}', '[]', 'null', '{"boxes":[]}']) assert.equal(parseWordCheck(text, posterBoxes(moves[0], kitText())).ready, false);
});

test('poster builder sends quoted exact words, v6 scene guidance, anonymous action and empty footer', () => {
  const text = kitText(); const body = buildPosterRequest(safeRecord, shortMove, '', text);
  for (const box of posterBoxes(shortMove, text).filter(box => box.id !== 'footer')) for (const line of boxText(box).split('\n')) assert.ok(body.prompt.includes(JSON.stringify(line)));
  for (const line of [shortMove.bodyAction, 'Exactly FIVE', 'No other words anywhere', 'No signposts', 'no slogans', 'no words on objects or screens', 'must not be mirrored', 'Baloo 2', 'Nunito', 'EMPTY banner']) assert.ok(body.prompt.includes(line));
  assert.ok(body.prompt.includes('keep the background simple right around the hand or body part doing the move'));
  assert.match(body.prompt, /Visual only, draw, do not write/); assert.ok(!body.prompt.includes(text.jokeIdea));
  assert.ok(body.prompt.includes('No words in the hero scene.'));
  assert.doesNotMatch(body.prompt, /Pip|Dee|grandad|familyContext|MADE UP|draft rhyme|WHAT YOUR BRAIN SAYS/);
  assert.doesNotThrow(() => buildPosterRequest(safeRecord, { ...moves[0], positiveAction: 'word '.repeat(200) }, '', text));
});

test('all new image and OCR requests keep family text, nickname, parent label and sentences out', () => {
  const text = kitText();
  for (const value of ['Pip', 'Dee', 'Biscuit', sentences[0]]) {
    assert.throws(() => buildPanelRequest(family, moves[0], sentences[0], { ...text.panelLines[0], scene: value }), /nickname|parent label|familyContext|tonight/);
    assert.throws(() => buildPosterRequest(family, shortMove, sentences[0], { ...text, jokeIdea: value }), /nickname|parent label|familyContext|tonight/);
  }
  const body = buildWordCheckRequest(family, moves[0], sentences[0], 'data:image/png;base64,AA==');
  assertNoFamilyText(body, privacyFor(family, sentences[0], moves[0]));
  const payload = JSON.parse(body.input[0].content[0].text);
  assert.deepEqual(Object.keys(payload).sort(), ['actionLine', 'cast', 'expectedJoke', 'expectedPeopleCount', 'expectedPictureStyleId', 'expectedVisibleCast', 'geometryInstruction', 'graphicStyleInstruction', 'graphicStyleVersion', 'identityReferences', 'instruction', 'lookChips', 'originalPosterCheck', 'outfitList', 'template']);
  assert.ok(!JSON.stringify(body).includes(moves[0].kidScienceLine)); // The reader cannot parrot the expected card answer.
  const polluted = { ...text.panelLines[0], familyContext: family.familyContext, nickname: family.hero.nickname };
  assert.doesNotMatch(buildPanelRequest(safeRecord, moves[0], '', polluted).prompt, /grandad|familyContext|Pip/);
});

test('panels use the same transcription check, exact bubbles, and no extra text', () => {
  const boxes = [{ id: 'bubble', text: 'This feels hard.' }];
  const answer = answerFor(boxes);
  assert.equal(parseWordCheck(JSON.stringify(answer), boxes).ready, true);
  answer.extraText = ['A screen insult'];
  expectReview(() => parseWordCheck(JSON.stringify(answer), boxes));
  const request = buildPanelRequest(family, moves[0], '', kitText().panelLines[0]);
  assert.match(request.prompt, /exactly ONE speech bubble/);
  assert.ok(request.prompt.includes('"This feels hard."'));
  assert.equal(request.size, '1536x1024');
});

test('uncertain drawing measurements retain the original art and review evidence without redraws', async t => {
  const directory = temp(t); const hero = join(directory, 'hero.png'); writeFileSync(hero, png);
  const record = { ...safeRecord, hero: { ...safeRecord.hero, heroPicturePath: hero } };
  const text = kitText(); const boxes = posterBoxes(shortMove, text); const sent = []; const rejects = [];
  const transport = { recordRejection: (_, reason) => rejects.push(reason), async call(request) {
    sent.push(request);
    if (request.path === '/v1/images/edits') return { data: [{ b64_json: png.toString('base64') }] };
    const answer = { ...syntheticCastEvidence(request), ...answerFor(boxes) }; answer.geometry.textLines[0].w += 40;
    return { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] };
  } };
  const art = await readyDrawnPage(transport, record, shortMove, '', text, { directory });
  assert.equal(art.ready, true); assert.equal(art.checks.length, 1);
  assert.ok(art.checks[0].reviewFlags.some(flag => /text_crosses_boundary/.test(flag.key)));
  const drawings = sent.filter(item => item.path === '/v1/images/edits');
  assert.equal(drawings.length, 1); assert.equal(rejects.length, 0);
  assert.deepEqual(drawings.map(item => item.retry), [0]);
  assert.ok(drawings.every(item => item.body.image[0] === `data:image/png;base64,${png.toString('base64')}`));
  assert.ok(drawings.every(item => item.body.image.at(-1) === `data:image/png;base64,${templateGuidePNG().toString('base64')}`));
  assert.equal(imageHash(art.path), art.hash);
});

test('one drawing keeps boundary notes; matching bytes in another panel retain a duplicate review flag', async t => {
  const directory = temp(t); const hero = join(directory, 'hero.png'); writeFileSync(hero, png);
  const record = { ...safeRecord, hero: { ...safeRecord.hero, heroPicturePath: hero } };
  const text = kitText(); let reads = 0;
  const transport = { recordRejection() {}, async call(request) {
    if (request.path === '/v1/images/edits') return { data: [{ b64_json: png.toString('base64') }] };
    const index = Number(request.stage.match(/^panel-(\d)/)?.[1]) - 1;
    const answer = answerFor([{ id: 'bubble', text: text.panelLines[index].line }]);
    answer.castObservations = JSON.parse(request.body.input[0].content[0].text).expectedVisibleCast.map(castObservation);
    if (++reads < 3) markFault(answer, 'textCrossesBoundary', 'Visible words cross the bubble border');
    return { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] };
  } };
  const result = await readyDrawnPage(transport, record, moves[0], '', text, { directory, panelIndex: 0 });
  assert.equal(result.ready, true); assert.equal(result.checks.length, 1);
  assert.ok(result.checks[0].reviewFlags.some(flag => flag.key === 'textCrossesBoundary'));
  const duplicate = await readyDrawnPage(transport, record, moves[0], '', text, { directory, panelIndex: 1, priorHashes: [result.hash] }); assert.equal(duplicate.ready, true); expectReview(() => duplicate.checks.at(-1), /duplicate_panel_drawing/);
  assert.equal(duplicate.hash, result.hash, 'the synthetic repeated bytes are explicitly retained as a duplicate concern');
});

test('four scenes are distinct, bubbles belong to story, telling shows an adult, and timings are checked', () => {
  for (const change of [
    value => { value.panelLines[1].scene = value.panelLines[0].scene.toUpperCase(); },
    value => { value.panelLines[0].line = 'one two three four five six seven eight'; },
    value => { value.panelLines[0].line = 'This was not said.'; },
    value => { value.tinyTryOptions[0].seconds = '29'; },
    value => { value.tinyTryOptions.forEach(option => { option.offScreen = false; }); },
    value => { value.whereElse.place = 'On a phone.'; },
    value => { value.feelFirst = null; },
    value => { value.tagline = ''; },
    value => { value.story += '\nA pause — a look.'; },
  ]) { const value = kitText(); change(value);
    if (typeof value.tinyTryOptions[0].seconds === 'string' || value.feelFirst === null || value.tagline === '') assert.throws(() => validateStory(value));
    else expectReview(() => validateStory(value));
  }
  const telling = kitText(moves.find(move => move.id === 'dont-feed-the-fire'));
  assert.doesNotThrow(() => validateStory(telling));
  telling.panelLines[2].scene = 'The fox stands alone beside a blank device.';
  expectReview(() => validateStory(telling), /telling_panel/);
});

test('Haiku receives all kit copy but no raw family context, then permits only one semantic rewrite', async () => {
  const fixture = kitText(); const request = buildStoryCheckRequest(fixture, moves[0]);
  assert.deepEqual(JSON.parse(request.input[0].content).story, fixture);
  assert.ok(!JSON.stringify(request).includes(family.familyContext));
  assert.equal(JSON.parse(buildStoryRequest(family, sentences[0]).input[0].content).parentLabel, 'Dee');
  const stages = [];
  const transport = { recordRejection() {}, async call(request) {
    stages.push(request.stage);
    const answer = request.stage === 'story-check' ? markFault(storyCheckAnswer(fixture.tagline), 'secondMoveTaught', 'This feels hard.', ['story']) : fixture;
    return { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] };
  } };
  await assert.rejects(readyStory(transport, family, sentences[0]), /second judge check/);
  assert.deepEqual(stages, ['story', 'story-check', 'story-rewrite', 'story-check']);
});

test('parent label persists, defaults to Dad, and the exact page 4 and 5 titles and slots are present', t => {
  const memory = createMemory(join(temp(t), 'memory.json')); memory.store(family);
  assert.equal(memory.exportRecord().parentLabel, 'Dee');
  const { parentLabel, ...legacy } = family; memory.store(legacy); assert.equal(memory.exportRecord().parentLabel, 'Dad');
  const pages = previewPages(moves[0], { nickname: 'Pip', parentLabel: 'Dee', kitCount: 6 });
  const page4 = visibleText(pages['try.html']); const page5 = visibleText(pages['for-you.html']);
  for (const title of ['TRY IT', 'The page that matters', 'FEEL FIRST, FOR DEE', 'MY ONE MOVE', 'Another way to try:', 'TINY TRY, PICK ONE', 'TALK', 'WHERE ELSE', 'This week I tried: ______', '4/5']) assert.ok(page4.includes(title), title);
  assert.match(page4, /When I notice _+\s*, I _+\s*\./);
  for (const title of ['DEE CARD', 'REMEMBER CARD, FRONT', 'REMEMBER CARD, BACK', 'GROWN-UP NOTES, FOR DEE', 'My move: ______', 'Remembered it', 'Practised it', 'Used it for real', '5/5']) assert.ok(page5.includes(title), title);
  assert.ok(page4.includes('Think of a place you might be tomorrow, away from a screen. What would you notice? Picture trying your move. Place pending.'));
  assert.ok(page5.includes('Think back. What did you first notice in your thoughts or body? What is your move? Try to remember and show it. Then turn over and check. Think of another time. Would this move fit? Would another way or some help fit better?'));
  assert.ok(page5.includes('Try it again on another calm night, even if you have not needed it yet. If they forget, give a clue and try again another time.'));
  assert.doesNotMatch(page5, /What is your one move\?|Show me for five seconds\./);
  assert.match(pages['for-you.html'], /class="parent-card|class="card coral parent-card/);
  assert.equal((pages['for-you.html'].match(/<hr class="cut-line">/g) ?? []).length, 2);
  assert.match(pages['for-you.html'], /width:3.5in;height:2.75in/);
  for (const page of ['story.html', 'story-2.html']) assert.match(pages[page], /Chapter 7:/);
  assert.match(pages['story.html'], /Pip \| MADE UP/);
  assert.doesNotMatch(pages['story-2.html'], /Pip \| MADE UP/);
  for (const html of Object.values(pages)) assert.ok(visibleText(html).includes("Pip's Confidence Guide"));
});

test('story split preserves every spoken word on two balanced pages', () => {
  for (const wordCount of [550, 600, 750]) {
    const text = kitText(moves[0], { wordCount });
    const { pages: halves } = splitStory(text.story, text.panelLines);
    assert.deepEqual(halves.flatMap(words), words(text.story.replace(/^MADE UP\n/, '')));
    assert.ok(halves.every(half => words(half).length < 450));
  }
});

test('bundled fonts have real TrueType data, recorded Google Fonts origin, licences and stable hashes', t => {
  const provenance = readJSON(new URL('../content/fonts/provenance.json', import.meta.url));
  for (const font of provenance) {
    const bytes = readFileSync(new URL(`../content/fonts/${font.file}`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString('hex'), '00010000');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), font.sha256);
    assert.match(font.source, /github.com\/google\/fonts/);
    assert.match(readFileSync(new URL(`../content/fonts/${font.licence}`, import.meta.url), 'utf8'), /SIL OPEN FONT LICENSE Version 1.1/);
  }
  const directory = temp(t); copyFonts(directory);
  for (const file of ['Baloo2-Variable.ttf', 'Nunito-Variable.ttf', 'Baloo2-OFL.txt', 'Nunito-OFL.txt']) assert.ok(existsSync(join(directory, 'fonts', file)));
  const html = combinedKitHTML(previewPages(moves[0]));
  assert.match(html, /font-family:'Baloo 2'/); assert.match(html, /font-family:Nunito/);
  assert.doesNotMatch(html, /src:url\('fonts\/(?:Baloo2|Nunito)-Variable/);
  for (const family of ['Baloo2', 'Nunito']) for (const weight of [400, 700, 800]) {
    const name = `${family}-${weight}.ttf`, bytes = readFileSync(join(directory, 'fonts', name));
    assert.ok(html.includes(`fonts/${name}`));
    const tables = Array.from({ length: bytes.readUInt16BE(4) }, (_, index) => bytes.toString('ascii', 12 + index * 16, 16 + index * 16));
    assert.ok(!tables.includes('fvar'), `${name} must be a static face for named Linux PDF embedding`);
  }

  assert.doesNotMatch(html, /<nav|<button|<input|<select|<textarea|fonts.googleapis/);
  assert.match(html, /html\[data-theme=dark\]/);
  assert.match(html, /@media print/);
});

test('PDF text inspection rejects navigation, missing pages and wrong order', () => {
  // Extracted-text fixtures test the PDF guard without claiming a browser render.
  const pages = ["Pip's Confidence Guide", 'Chapter 1: Start\n2/5', 'Chapter 1: Start\n3/5', 'TRY IT\n4/5', 'CARDS + PARENT STRIP\n5/5'];
  assert.equal(validatePDFText(pages.join('\f') + '\f').navigationText, false);
  assert.equal(validatePDFText(pages.join('\f').replace('CARDS + PARENT STRIP', 'CARDS + GROWN-UP GUIDE')).navigationText, false);
  assert.throws(() => validatePDFText(pages.join('\f') + '\nLight or dark'), /navigation/);
  assert.throws(() => validatePDFText(pages.slice(1).join('\f')), /five pages/);
  assert.throws(() => validatePDFText([pages[0], pages[3], pages[2], pages[1], pages[4]].join('\f')), /title or footer/);
});

test('over-cap fixed card sets reach the art stage and retain counts', async t => {
  const directory = temp(t); const memory = createMemory(join(directory, 'family.json')); memory.store(safeRecord);
  const originals = moves.map(move => move.positiveAction);
  const sent = [];
  const response = value => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
  const transport = { recordRejection() { assert.fail('Unexpected story rejection'); }, async call(request) {
    sent.push(request);
    if (request.stage === 'story') return response(kitText());
    if (request.stage === 'story-check') return response(storyCheckAnswer());
    throw new Error('fake art boundary reached');
  } };
  try {
    for (const move of moves) {
      // Begin with the displayed action, since changing its source wording
      // deliberately stops an exact-match reader correction from applying.
      move.positiveAction = positiveActionFor(move);
      const cards = posterBoxes(move).filter(box => box.card).reduce((n, box) => n + words(boxText(box)).length, 0);
      move.positiveAction += ' word'.repeat(200 - cards);
      assert.equal(posterBoxes(move).filter(box => box.card).reduce((n, box) => n + words(boxText(box)).length, 0), 200);
    }
    await assert.rejects(createKit(transport, memory, sentences[0], { directory, exports: { measureLayout: async () => ({ measured: true, ready: true, fixture: true, faults: [] }) } }), /fake art boundary reached/);
    assert.deepEqual(sent.map(request => request.stage), ['story', 'story-check', 'hero']);
    const counts = readJSON(join(directory, 'poster-word-counts.json'));
    assert.ok(counts.preflight.length > 0 && counts.preflight.every(row => row.count >= 200 && row.status === 'WARN' && row.reportOnly));
    assert.equal(counts.final.status, 'WARN');
  } finally { moves.forEach((move, i) => { move.positiveAction = originals[i]; }); }
});

test('over-cap art reaches drawing and an exact transcription passes', async t => {
  const directory = temp(t); const hero = join(directory, 'hero.png'); writeFileSync(hero, png);
  const record = { ...safeRecord, hero: { ...safeRecord.hero, heroPicturePath: hero } };
  const move = { ...moves[0], positiveAction: 'word '.repeat(200).trim() };
  const text = kitText(); const boxes = posterBoxes(move, text); let calls = 0;
  const transport = { async call() { calls++; throw new Error('Unexpected call'); } };
  await assert.rejects(readyDrawnPage(transport, record, move, '', text, { directory }), /Unexpected call/);
  assert.equal(calls, 1);
  const check = parseWordCheck(JSON.stringify(answerFor(boxes)), boxes);
  assert.equal(check.ready, true);
  assert.equal(check.transcriptionWordCap.status, 'WARN');
});

test('the default spend cap stays 24; explicit cap zero blocks before network or logging', async t => {
  const logFile = join(temp(t), 'requests.jsonl');
  const transport = createTransport({ keys: { openai: 'unit-test-not-a-key' }, logFile, maxCalls: 0 });
  await assert.rejects(transport.call({ provider: 'openai', path: '/v1/responses', familyRecord: { real: false }, body: { model: readJSON(new URL('../content/prices.json', import.meta.url)).selected.storyCheck, store: false, input: [{role:'user',content:'Offline test'}] }, stage: 'story-check' }), /call limit/);
  assert.deepEqual(readLog(logFile), []);
  for (const maxCalls of [-1, 77, NaN, '76']) assert.throws(() => createTransport({ keys: {}, maxCalls }), /Call cap/);
});

test('complete page text renders safely with four separate image slots and no extra page copy', async () => {
  const { makePages } = await import('../server/layout.js');
  const text = kitText();
  text.pagination = validateStory(text).pagination;
  const pages = makePages(shortMove, text, { nickname: 'Pip', parentLabel: 'Dee', kitCount: 2 });
  assert.equal((pages['story.html'].match(/src="panel-/g) ?? []).length, 2);
  assert.equal((pages['story-2.html'].match(/src="panel-/g) ?? []).length, 2);
  assert.ok(pages['story.html'].includes('panel-1.png') && pages['story.html'].includes('panel-2.png'));
  assert.ok(pages['story-2.html'].includes('panel-3.png') && pages['story-2.html'].includes('panel-4.png'));
  assert.equal((pages['poster.html'].match(/<img /g) ?? []).length, 1);
  const content = visibleText(pages['poster.html'].match(/<main[^>]*>([\s\S]*?)<\/main>/)[1]);
  assert.equal(content, "Pip's Confidence Guide");
  for (const line of text.feelFirst) assert.ok(visibleText(pages['try.html']).includes(line));
  assert.ok(visibleText(pages['try.html']).includes(`Think of a place you might be tomorrow, away from a screen. What would you notice? Picture trying your move. ${text.whereElse.place}`));
  assert.ok(!visibleText(pages['try.html']).includes(text.whereElse.line));
  assert.ok(visibleText(pages['for-you.html']).includes(`I noticed you looked ${text.noticedFeeling}. That makes sense.`));
  assert.ok(visibleText(pages['for-you.html']).includes(text.tagline));
  assert.equal((combinedKitHTML(pages).match(/data-page=/g) ?? []).length, 5);
  assert.throws(() => makePages(shortMove, { ...text, moveId: moves[1].id }), /differ/);
});

test('rotating worlds visit all eight and colours only use the four STYLE sets', async () => {
  const { chooseWorld, worldChoices } = await import('../server/worlds.js');
  const record = { pastKits: [] };
  for (let i = 0; i < 8; i++) record.pastKits.push(chooseWorld(record));
  assert.deepEqual(record.pastKits.map(kit => kit.world), worldChoices.worlds);
  assert.deepEqual([...new Set(record.pastKits.map(kit => kit.colourSet))], ['warm', 'cool', 'night', 'forest']);
});

test('saved legacy worlds and colours survive memory edits while new art rejects them', async t => {
  const { assertWorld, chooseWorld } = await import('../server/worlds.js');
  const memory = createMemory(join(temp(t), 'legacy.json'));
  memory.store({ ...family, pastKits: [{ date: '2026-10-14', chapterNumber: 1, moveId: moves[0].id, triedMove: 'yes', didItHelp: 'yes', adventureLine: 'Old fictional excerpt.', world: 'lab notebook', colourSet: 'sunset' }] });
  memory.editFact('Soccer tryouts are next week', 'Soccer tryouts were moved to November');
  assert.equal(memory.exportRecord().pastKits[0].colourSet, 'sunset');
  assert.notEqual(chooseWorld(memory.exportRecord()).world, 'science lab notebook');
  assert.throws(() => assertWorld({ world: 'lab notebook', colourSet: 'sunset' }), /fixed list/);
});

test('poster placement rejects another canvas and uses the saved fit', async t => {
  const { pngDimensions } = await import('../server/picture.js');
  const { posterContent } = await import('../server/layout.js');
  const file = join(temp(t), 'guide.png'); writeFileSync(file, png);
  assert.deepEqual(pngDimensions(file), { width: 1024, height: 1536 });
  assert.match(posterContent(moves[0], { posterDimensions: {width:1,height:1} }), /poster-art/);
  assert.ok(posterContent(moves[0]).includes(`data-template="${posterTemplate.version}"`));
  const html = previewPages(moves[0])['poster.html'];
  assert.doesNotMatch(html, /top:-7.9545454545%/);
  assert.match(html, /@page:first\{margin:0\}/);
});

test('changing approved words or image bytes invalidates an art receipt before pages are written', async t => {
  const { writePages } = await import('../server/layout.js');
  const { imageHash } = await import('../server/picture.js');
  const directory = temp(t), text = kitText();
  const makeArt = (name, boxes, index) => {
    const path = join(directory, `${name}.png`);
    writeFileSync(path, Buffer.concat([png, Buffer.from(`unit fixture ${index}`)]));
    return { path, hash: imageHash(path), referenceHash: 'unit-hero', ready: true, expectedBoxes: boxes, checks: [{ ready: true, answers: answerFor(boxes) }] };
  };
  const poster = makeArt('poster', posterBoxes(shortMove, text), 0);
  const panels = text.panelLines.map((panel, index) => makeArt(`panel-${index}`, [{ id: 'bubble', text: panel.line }], index + 1));
  const art = { ready: true, poster, panels };
  const output = join(directory, 'output');
  text.pagination = validateStory(text).pagination;
  const changed = parseWordCheck(JSON.stringify(poster.checks[0].answers), posterBoxes(shortMove, { ...text, tagline: 'A new rhyme for this time.' }));
  expectReview(() => changed, /words_differ/);
  writeFileSync(panels[0].path, png);
  assert.throws(() => writePages(output, shortMove, text, art), /unchanged art/);
});

test('a panel bubble out of story order is rejected before any drawing', () => {
  const text = kitText();
  [text.panelLines[0], text.panelLines[2]] = [text.panelLines[2], text.panelLines[0]];
  expectReview(() => validateStory(text), /panel_bubbles_out_of_order/);
  assert.throws(() => validateStory({ ...kitText(), noticedFeeling: true }), /feeling/);
});

test('whole art path buys exactly one poster and four separately checked panels with the same original hero', async t => {
  const directory = temp(t); const hero = join(directory, 'hero.png'); writeFileSync(hero, png);
  const record = { ...safeRecord, hero: { ...safeRecord.hero, heroPicturePath: hero } };
  record.cast = lockedCast(record).map(person => ({ ...person, referencePath: hero }));
  const text = kitText(); const requests = []; let draws = 0;
  const transport = { recordRejection() {}, async call(request) {
    requests.push(request);
    if (request.path === '/v1/images/edits') return { data: [{ b64_json: Buffer.concat([png, Buffer.from(`synthetic test ${++draws}`)]).toString('base64') }] };
    if (request.stage === 'cast-continuity-check') return { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ pictures: ['poster', 'panel-1', 'panel-2', 'panel-3', 'panel-4'].map(id => ({ id, castObservations: record.cast.map(castObservation) })) }) }] }] };
    const panel = request.stage.match(/^panel-(\d)/);
    const boxes = panel ? [{ id: 'bubble', text: text.panelLines[Number(panel[1]) - 1].line }] : posterBoxes(shortMove, text);
    return { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ...syntheticCastEvidence(request), ...answerFor(boxes) }) }] }] };
  } };
  const art = await readyKitArt(transport, record, shortMove, '', text, { directory });
  assert.equal(art.ready, true); assert.equal(art.panels.length, 4);
  assert.equal(new Set(art.panels.map(panel => panel.hash)).size, 4);
  assert.deepEqual(requests.map(item => item.stage), ['poster', 'poster-word-check', 'panel-1', 'panel-1-word-check', 'panel-2', 'panel-2-word-check', 'panel-3', 'panel-3-word-check', 'panel-4', 'panel-4-word-check']);
  for (const item of requests.filter(item => item.path === '/v1/images/edits')) assert.deepEqual(item.body.image, [`data:image/png;base64,${png.toString('base64')}`, `data:image/png;base64,${png.toString('base64')}`]);
  assert.ok(requests.filter(item => item.path === '/v1/images/edits').every(item => !item.body.image.includes(pictureStyleReferenceFor(family).data)));
  const { writePages } = await import('../server/layout.js');
  text.pagination = validateStory(text).pagination;
  const pages = writePages(join(directory, 'pages'), shortMove, text, art, { nickname: 'Pip', parentLabel: 'Dee' });
  assert.equal(Object.keys(pages).length, 5);
  assert.ok(existsSync(join(directory, 'pages', 'kit_final.html')));
  assert.equal(existsSync(join(directory, 'pages', 'kit_final.pdf')), false); // No fake PDF evidence.
});
