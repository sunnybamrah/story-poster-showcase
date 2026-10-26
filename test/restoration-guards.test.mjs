import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessGenerationCheck } from '../server/stop-policy.js';
import { parseStoryCheck } from '../server/check-story.js';
import { brokenCheck, runCheck } from '../server/checker-contract.js';
import { scrubIdentityText } from '../server/writer-image-text.js';
import { familyContextHits } from '../server/family-privacy.js';
import { route } from '../server/route.js';
import { createTransport, readLog } from '../server/transport.js';
import { buildStoryRequest, buildComicWordCheckRequest } from '../server/requests.js';
import { checkComicWords, parseComicWordCheck, parseWordCheck, checkWords } from '../server/check-words.js';
import { family } from './fixture.mjs';
import { posterBoxes } from '../server/format.js';
import { moves } from '../server/files.js';
import { kitText } from './kit-text-fixture.mjs';
import { wordCheckAnswer, storyCheckAnswer, markFault } from './checker-fixture.mjs';
import { openaiAnswer } from './offline-kit-fixture.mjs';
import { offlinePrices } from './offline-prices.mjs';

const temporary = t => { const directory = mkdtempSync(join(tmpdir(), 'restoration-guard-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; };
const context = { nickname: 'Nia', heroName: 'Nia', parentLabel: 'Papa', tonight: '', familyContext: 'A blue notebook waits beside the piano. Nia lives at 123 Willow Street. Contact nia@example.test. Her little brother shares a room.' };

test('ordinary objects survive while names, contacts, addresses and family relationships stay private', () => {
  assert.equal(scrubIdentityText('The Blue Notebook', context), 'The Blue Notebook');
  assert.equal(scrubIdentityText('Pass the blue notebook beside the piano.', context), 'Pass the blue notebook beside the piano.');
  for (const value of ['Nia', '123 Willow Street', 'nia@example.test', 'little brother', 'shares a room']) assert.notEqual(scrubIdentityText(value, context), value, value);
  assert.equal(familyContextHits('blue notebook beside the piano', context).length, 0);
  assert.equal(familyContextHits('practice', { ...context, familyContext: 'Practice grouping objects by material.' }).length, 0);
  assert.notEqual(scrubIdentityText('Cookie', { ...context, familyContext: 'Our pet is Cookie.' }), 'Cookie');
});

test('meaning and child-owned blanks stop; counts and visual taste remain notes', () => {
  for (const key of ['scienceRecordMissingOrChanged', 'adviceOutsideRecord', 'tinyTryWrong', 'filledWhenINotice', 'filled_When_I_notice', 'concernDrift', 'writer_field_privacy', 'words_differ_in_bubble: missing', 'confirmed_bubble_speaker_mismatch: wrong']) assert.equal(assessGenerationCheck({ faults: [key] }).ready, false, key);
  for (const key of ['narrativeEssay', 'chapterShapeWrong', 'confirmed_cast_appearance_mismatch', 'insufficient_handwriting_space: plan', 'wordAChildMustTranslate']) assert.equal(assessGenerationCheck({ faults: [key] }).ready, true, key);
});

test('unknown content gets exactly one same-artifact recheck, then a saved failure', async () => {
  for (const recovers of [true, false]) {
    const requests = [], verdicts = [];
    const transport = { async call(request) { requests.push(request); return {}; }, recordRejection() {}, recordVerdict(response, verdict, check) { verdicts.push({ verdict, check }); } };
    const result = await runCheck(transport, { stage: 'poster-word-check', body: { fixedArtifact: 'same' } }, () => recovers && requests.length === 2 ? { ready: true, faults: [] } : brokenCheck('malformed'));
    assert.equal(requests.length, 2); assert.deepEqual(requests[0].body, requests[1].body);
    assert.equal(result.ready, recovers); assert.equal(result.verified, recovers); assert.equal(result.needsRecheck, false);
    if (!recovers) { assert.equal(result.canRedraw, false); assert.ok(result.faults.includes('content_check_unverified')); }
    assert.equal(verdicts.length, 2);
  }
});

test('body topics and persistent low mood preserve meaning, negation and explicit choices', () => {
  for (const text of ['I want a kit about her hair.', 'She wants a poster about periods.', 'The doctor said something about her blood test.', 'She has felt low for several days.']) assert.notEqual(route(text), 'move', text);
  for (const text of ['She wants to sort objects by shape and size.', 'We played a board game about food.', 'He learned body language today.', 'Her bad hair day made her feel everyone was watching.', 'She had sex education class and is comfortable.', 'She did not feel low for several days.', 'We read a fictional story whose character said she felt low for several days.']) assert.equal(route(text), 'move', text);
  assert.equal(route('I yelled at my child.', { parentEdition: true }), 'move');
  assert.notEqual(route('I hit my child.', { parentEdition: true }), 'move');
  const loss = 'Her pet died and she wants to remember it.';
  assert.equal(route(loss), 'grief');
  assert.equal(route(loss, { remembranceRequested: true }), 'grief');
  assert.equal(route(loss, { remembranceRequested: true, remembranceChildLed: true }), 'move');
});

const panels = kitText().panelLines.map(panel => ({ ...panel, speakerId: 'child' }));
const comicAnswer = () => ({ panels: panels.map((panel, index) => ({ panelId: `panel-${index + 1}`, check: wordCheckAnswer([{ id: 'bubble', text: panel.line }]) })), extraText: [] });
test('one actual-sheet readback compares all four exact bubbles and evidenced speakers', async () => {
  let count = 0;
  const transport = { call: async request => { count++; assert.equal(request.stage, 'comic-word-check'); return openaiAnswer(comicAnswer()); }, recordVerdict() {}, recordRejection() {} };
  assert.equal((await checkComicWords(transport, family, moves[0], '', 'data:image/png;base64,AA==', panels)).ready, true); assert.equal(count, 1);
  const body = buildComicWordCheckRequest(family, moves[0], '', 'data:image/png;base64,AA==', { panels });
  assert.equal(body.input[0].content.filter(item => item.type === 'input_image' && item.image_url === 'data:image/png;base64,AA==').length, 1);
  const wrong = comicAnswer(); wrong.panels[2].check.boxes[0].text = 'You are stupid.';
  assert.equal(parseComicWordCheck(JSON.stringify(wrong), family, moves[0], panels).ready, false);
  const speaker = comicAnswer(); speaker.panels[0].check.bubbleSpeaker = { characterId: 'grown-up-one', certainty: 'confirmed', evidence: 'The tail touches the grown-up mouth.' };
  assert.equal(parseComicWordCheck(JSON.stringify(speaker), family, moves[0], panels).ready, false);
});

test('API request slots survive Resume, including a network retry reusing its one slot', async t => {
  const logFile = join(temporary(t), 'requests.jsonl'); let sends = 0;
  t.mock.method(globalThis, 'fetch', async () => { sends++; if (sends === 1) throw new Error('fetch failed'); return new Response(JSON.stringify({ ...openaiAnswer('{}'), usage: { input_tokens: 0, output_tokens: 0 } }), { status: 200 }); });
  const options = { keys: { openai: 'offline-key' }, logFile, maxCalls: 1, costCatalog: offlinePrices, wait: async () => {} };
  const request = { provider: 'openai', path: '/v1/responses', stage: 'story', body: buildStoryRequest(family, 'A difficult day.'), familyRecord: { ...family, real: false } };
  await createTransport(options).call(request); assert.equal(sends, 2);
  const rows = readLog(logFile).filter(row => row.event === 'request'); assert.equal(rows.length, 2); assert.equal(rows[0].callSlotId, rows[1].callSlotId);
  await assert.rejects(createTransport(options).call(request), /call limit/); assert.equal(sends, 2);
  const oldLog = join(temporary(t), 'old.jsonl');
  for (const row of [{ event: 'request', method: 'POST', id: 'a', logicalRequestId: 'x', wireAttempt: 0 }, { event: 'transport-retry', logicalRequestId: 'x', nextWireAttempt: 1, reusesCallCapSlot: true }, { event: 'request', method: 'POST', id: 'b', logicalRequestId: 'x', wireAttempt: 1 }]) appendFileSync(oldLog, JSON.stringify(row)+'\n');
  await assert.rejects(createTransport({ ...options, logFile: oldLog }).call(request), /call limit/); assert.equal(sends, 2);
});


test('the same content parser stops source changes only with actual quoted story evidence', () => {
  const story = kitText(), quote = 'This game will make every worry go away.';
  story.story += '\n' + quote;
  const answer = markFault(storyCheckAnswer(story.tagline), 'scienceRecordMissingOrChanged', quote, ['story']);
  const checked = parseStoryCheck(JSON.stringify(answer), { story, move: moves[0], record: family, generation: true });
  assert.equal(checked.ready, false); assert.ok(checked.faults.includes('scienceRecordMissingOrChanged'));
  answer.evidence.scienceRecordMissingOrChanged = 'A claim absent from this chapter.';
  assert.equal(parseStoryCheck(JSON.stringify(answer), { story, move: moves[0], record: family, generation: true }).faults.includes('scienceRecordMissingOrChanged'), false);
});

test('factual comic captions keep their exact words without inventing a speaker verdict', () => {
  const answer = comicAnswer();
  for (const row of answer.panels) delete row.check.bubbleSpeaker;
  const checked = parseComicWordCheck(JSON.stringify(answer), { ...family, kitContext: { storyMode: 'factual' } }, moves[0], panels);
  assert.equal(checked.ready, true);
  answer.panels[0].check.boxes[0].text = 'Unapproved caption';
  assert.equal(parseComicWordCheck(JSON.stringify(answer), { ...family, kitContext: { storyMode: 'factual' } }, moves[0], panels).ready, false);
});


test('shared guide notes protect a copied specific place without stripping ordinary picture objects', () => {
  const privateNote = 'A fictional child put objects on the purple attic shelf and wants to learn grouping.';
  const scoped = { ...context, familyContext: privateNote, privateNoteFragments: privateNote };
  assert.ok(familyContextHits('Remember the purple attic shelf.', scoped).some(hit => hit.kind === 'familyContext phrase'));
  assert.equal(familyContextHits('grouping objects by material', { ...context, familyContext: 'Practice grouping objects by material.', privateNoteFragments: 'Practice grouping objects by material.' }).length, 0);
  assert.equal(familyContextHits('purple attic shelf', { ...context, familyContext: privateNote }).length, 0, 'ordinary image objects do not inherit the shared-guide fragment policy');
});


test('current actual words stay checked when geometry and appearance data are omitted or malformed', () => {
  const boxes = [{ id: 'bubble', text: 'We can try together.' }];
  for (const change of [answer => { delete answer.graphicStyle; }, answer => { answer.graphicStyle = 'unreadable'; }, answer => { answer.castObservations = [{ observedSpecies: null, identityEvidence: 12 }]; }, answer => { answer.outfitMismatch = true; answer.evidence.outfitMismatch = 14; }]) {
    const answer = wordCheckAnswer(boxes); change(answer);
    const current = parseWordCheck(JSON.stringify(answer), boxes, { generation: true });
    assert.equal(current.ready, true); assert.equal(current.needsRecheck, false); assert.equal(current.contentVerified, true); assert.equal(current.verified, false);
    answer.boxes[0].text = 'Different words';
    assert.equal(parseWordCheck(JSON.stringify(answer), boxes, { generation: true }).ready, false, 'Unknown appearance cannot hide wrong words.');
  }
  const malformed = wordCheckAnswer(boxes); delete malformed.boxes;
  const current = parseWordCheck(JSON.stringify(malformed), boxes, { generation: true });
  assert.equal(current.ready, false); assert.equal(current.contentNeedsRecheck, true);
});


test('a missing current poster measurement remains an unverified note after one actual-word readback', async () => {
  const boxes = posterBoxes(moves[0], kitText()), answer = wordCheckAnswer(boxes); delete answer.geometry;
  let calls = 0;
  const transport = { call: async () => { calls++; return openaiAnswer(answer); }, recordRejection() {}, recordVerdict() {} };
  const checked = await checkWords(transport, family, moves[0], '', 'data:image/png;base64,AA==', boxes);
  assert.equal(calls, 1); assert.equal(checked.ready, true); assert.equal(checked.contentVerified, true); assert.equal(checked.verified, false);
  assert.equal(Object.hasOwn(checked.answers, 'geometry'), false, 'No omitted measurement is invented.');
});

test('a partial malformed verdict cannot retain an invalid blank claim against the required parent feeling', async () => {
  const story = kitText(), partial = markFault(storyCheckAnswer(story.tagline), 'filledWhenINotice', story.noticedFeeling, ['noticedFeeling']);
  let calls = 0;
  const transport = { call: async () => { calls++; return {}; }, recordRejection() {}, recordVerdict() {} };
  const checked = await runCheck(transport, { stage: 'story-check', body: { instructions: 'Read the same story.', input: [{ content: JSON.stringify({ story }) }] } }, () => calls === 1 ? brokenCheck('missing current content fields', partial) : parseStoryCheck(JSON.stringify(storyCheckAnswer(story.tagline)), { story, move: moves[0], record: family, generation: true }));
  assert.equal(calls, 2); assert.equal(checked.ready, true); assert.deepEqual(checked.faults, []);
});

test('drawn maths symbols and punctuation are not extra written words in new posters or comics', () => {
  const boxes = posterBoxes(moves[0], kitText(moves[0]));
  const symbols = ['?', '+', '−', '×', '÷', '→', '♥'];
  const poster = wordCheckAnswer(boxes); poster.extraText = symbols;
  assert.equal(parseWordCheck(JSON.stringify(poster), boxes, { generation: true }).ready, true);
  assert.ok(parseWordCheck(JSON.stringify(poster), boxes).reviewFlags.some(flag => flag.key.startsWith('extra_words_outside_boxes')), 'Read-only historical meaning is preserved.');
  const comic = comicAnswer(); comic.extraText = symbols;
  for (const panel of comic.panels) panel.check.extraText = symbols;
  assert.equal(parseComicWordCheck(JSON.stringify(comic), family, moves[0], panels).ready, true);
  assert.deepEqual(poster.extraText, symbols, 'Raw readback remains unchanged.');
  for (const extra of ['Wrong answer', '2 + 2 = 5', 'No!', '٣', '数']) {
    poster.extraText = [extra]; comic.extraText = [extra];
    assert.equal(parseWordCheck(JSON.stringify(poster), boxes, { generation: true }).ready, false, extra);
    assert.equal(parseComicWordCheck(JSON.stringify(comic), family, moves[0], panels).ready, false, extra);
  }
});
