import { hardStoryFaults } from '../server/stop-policy.js';
import { selectedRhymeFor } from '../server/rhyme.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJSON, moves } from '../server/files.js';
import { storyFields, storyCheckKeys, pictureCheckKeys, wordCheckBooleans, geometryBooleanKeys, smallFields } from '../server/checker-contract.js';
import { parseStoryCheck } from '../server/check-story.js';
import { parsePictureCheck } from '../server/check-picture.js';
import { parseWordCheck } from '../server/check-words.js';
import { validateGeometryReceipt } from '../server/poster-template.js';
import { readyStory, writeStory, validateStory, applyFieldCorrection, correctionPlan, spokenWordCount } from '../server/story.js';
import { withKitEvidence } from '../server/kit-evidence.js';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { eligibleMoves } from '../server/picker.js';
import { readyKitArt, readyPicture, readyDrawnPage } from '../server/picture.js';
import { lockedCast } from '../server/cast.js';
import { buildStoryRequest, buildStoryCheckRequest, buildPictureCheckRequest, buildWordCheckRequest } from '../server/requests.js';
import { posterBoxes } from '../server/format.js';
import { family, sentences, savedKit } from './fixture.mjs';
import { kitText, withSyntheticSpeakers } from './kit-text-fixture.mjs';
import { syntheticCastEvidence, storyCheckAnswer, pictureCheckAnswer, wordCheckAnswer, geometryAnswer, markFault } from './checker-fixture.mjs';
import { offlineTransport, textAnswer, openaiAnswer, run5, offlineExports } from './offline-kit-fixture.mjs';

const historicalRun6 = readJSON(new URL('./fixtures/run6-story.json', import.meta.url));
// Explicit synthetic current provider answer: historical chapter with a current four-to-seven-word rhyme.
const run6 = withSyntheticSpeakers({ ...historicalRun6, tagline: 'Name it clear, keep it near.' });
const run6Check = readJSON(new URL('./fixtures/run6-story-check.json', import.meta.url));
const shortRewrite = readJSON(new URL('./fixtures/run6-rewrite.json', import.meta.url));
const temp = t => { const directory = mkdtempSync(join(tmpdir(), 'pass13-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; };
const mockTransport = answer => {
  const calls = [], rejected = [];
  return { calls, rejected, recordRejection(response, reason) { rejected.push(reason); }, async call(request) { calls.push(request); return answer(request, calls); } };
};
const expectedFields = (answer, fields) => ({ story: answer.story, ...Object.fromEntries(fields.map(field => [field, answer[field]])) });

test('the legacy run 6 answer rechecks missing evidence without deriving sound or rewriting the chapter', async t => {
  assert.match(run6Check.rawText, /do rhyme/);
  assert.equal(run6Check.answer.taglineDoesNotRhyme, 'yes');
  const check = parseStoryCheck(run6Check.rawText, { story: historicalRun6 });
  assert.equal(check.ready, false); assert.equal(check.needsRecheck, true);
  assert.equal(check.qualityCoverage, 'legacy-unverified'); assert.equal(check.rhyme, undefined);
  const directory = temp(t);
  const transport = offlineTransport(t, directory, request => request.stage === 'story' ? textAnswer(run6) : request.stage === 'story-check' && request.retry === 0 ? structuredClone(run6Check.response) : undefined);
  const result = await readyStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.story, run6.story); assert.equal(result.tagline, selectedRhymeFor(moves[0]).tagline);
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-check', 'story-check']);
  assert.equal(readJSON(join(directory, 'story-check-1.json')).answer.taglineDoesNotRhyme, 'yes');
  assert.equal(result.checks.at(-1).verified, true);
});

test('judge sound opinions are preserved and approved-rhyme concerns are review only', () => {
  for (const [a, b, rhymes, expected] of [['bad', 'had', false, true], ['blue', 'you', true, true], ['blue', 'you', false, true]]) {
    const answer = storyCheckAnswer(); answer.taglineEndWords = [a, b]; answer.taglineRhymes = rhymes;
    answer.evidence.taglineRhymes = `${a} / ${b}`;
    const checked = parseStoryCheck(JSON.stringify(answer));
    assert.equal(checked.ready, expected); assert.equal(checked.rhyme.rhymes, rhymes);
    assert.equal(checked.reviewFlags.length, rhymes ? 0 : 1);
  }
  const forged = storyCheckAnswer(selectedRhymeFor(moves[0]).tagline); forged.taglineEndWords = ['cat', 'hat'];
  assert.equal(parseStoryCheck(JSON.stringify(forged), { story: run6 }).needsRecheck, true);
});

test('every story, picture, word and geometry flag ignores empty evidence and keeps supported faults', () => {
  const groups = [
    [storyCheckKeys, storyCheckAnswer, value => parseStoryCheck(JSON.stringify(value))],
    [pictureCheckKeys, pictureCheckAnswer, value => parsePictureCheck(JSON.stringify(value))],
    [wordCheckBooleans, () => wordCheckAnswer(posterBoxes(moves[0], run5)), value => parseWordCheck(JSON.stringify(value), posterBoxes(moves[0], run5))],
    [geometryBooleanKeys, geometryAnswer, validateGeometryReceipt],
  ];
  for (const [keys, create, parse] of groups) for (const key of keys) {
    const answer = create(); answer[key] = true;
    const ignored = parse(answer);
    assert.equal(ignored.ready, true, key); assert.ok(ignored.ignoredFaults.some(item => item.key === key), key);
    markFault(answer, key, 'Exact quoted test evidence');
    assert.equal(parse(answer).ready, (keys === storyCheckKeys && !hardStoryFaults.has(key)) || keys === pictureCheckKeys || (keys === wordCheckBooleans && key !== 'keyWordUnreadable') || keys === geometryBooleanKeys && true, key);
  }
});

test('checker contracts use fault booleans and evidence for every picture and geometry flag', () => {
  const requests = [buildPictureCheckRequest(family, moves[0], sentences[0], 'data:image/png;base64,AA=='), buildWordCheckRequest(family, moves[0], sentences[0], 'data:image/png;base64,AA==')];
  for (const request of requests) {
    const schema = request.text.format.schema;
    for (const [key, property] of Object.entries(schema.properties)) if (property.type === 'boolean') {
      assert.ok(schema.properties.evidence.properties[key]);
      assert.doesNotMatch(key, /DoesNot|noText|Matches|CountRight|InsideBoxes/);
    }
  }
  const request = buildStoryCheckRequest(run6, moves[0]);
  assert.doesNotMatch(request.instructions, /taglineDoesNotRhyme|"yes"|"no"/);
  for (const name of ['taglineEndWords', 'taglineRhymes', 'affectedFields', 'evidence']) assert.ok(request.instructions.includes(name));
  const story = buildStoryRequest(family, sentences[0]);
  assert.equal(story.max_output_tokens, 24000); assert.equal(story.store, false); assert.deepEqual(story.reasoning, { effort: 'medium' });
  assert.match(story.instructions, /printedCapacity.story.targetWords/);
});

for (const field of smallFields) test(`repair ${field} preserves the chapter and every other field`, async () => {
  const original = kitText();
  if (field === 'tagline') {
    const patch = applyFieldCorrection(original, { story: original.story, tagline: 'A candidate for separate review.' }, ['tagline']);
    assert.equal(patch.story, original.story);
    for (const key of storyFields.filter(key => key !== 'tagline')) assert.deepEqual(patch[key], original[key]);
    return;
  }
  const repaired = structuredClone(original);
  if (field === 'tagline') repaired.tagline = 'Name it clear, hold it near.';
  if (field === 'jokeIdea') repaired.jokeIdea = 'A puzzle piece wears a tiny hat.';
  if (field === 'replayCue') repaired.replayCue = 'My paws tense up.';
  if (field === 'feelFirst') repaired.feelFirst[0] = 'That moment felt hard.';
  if (field === 'tinyTryOptions') repaired.tinyTryOptions[0].text = 'Say one feeling word beside the chair.';
  if (field === 'whereElse') repaired.whereElse.line = 'Try the same move beside the classroom door.';
  if (field === 'noticedFeeling') repaired.noticedFeeling = 'annoyed';
  const evidence = typeof original[field] === 'string' ? original[field] : field === 'feelFirst' ? original[field][0] : field === 'tinyTryOptions' ? original[field][0].text : original[field].line;
  const key = field === 'jokeIdea' ? 'jokeAtPerson' : field === 'tinyTryOptions' ? 'tinyTryWrong' : 'adviceOutsideRecord';
  const transport = mockTransport(request => {
    if (request.stage === 'story') return textAnswer(original);
    if (request.stage === 'story-correction') {
      const correction = JSON.parse(request.body.input[0].content).correction;
      assert.deepEqual(correction.fields, [field]); assert.match(correction.instruction, /byte for byte/);
      return textAnswer(expectedFields(repaired, [field]));
    }
    if (request.stage === 'story-check') return textAnswer(request.retry === 0 ? markFault(storyCheckAnswer(original.tagline), key, evidence, [field]) : storyCheckAnswer(repaired.tagline));
    assert.fail(request.stage);
  });
  const result = await writeStory(transport, family, sentences[0], { priorStory: original, lockedMoveId: original.moveId, correctionFields: [field], correction: 'Typed field repair fixture.' });
  assert.equal(result.story, original.story);
  for (const key of storyFields) assert.deepEqual(result[key], key === 'tagline' ? selectedRhymeFor(moves[0]).tagline : key === field ? repaired[key] : original[key], key);
  assert.deepEqual(transport.calls.map(call => call.stage), ['story-correction']);
  assert.deepEqual(result.pagination, validateStory(original).pagination);
});

test('small patches reject changed story text, extra fields and missing fields, then retry the same patch', async () => {
  const original = kitText(), previous = { ...original, pagination: validateStory(original).pagination };
  assert.throws(() => applyFieldCorrection(previous, { story: original.story + ' Changed.', tagline: original.tagline }, ['tagline']), /changed_story/);
  assert.equal(applyFieldCorrection(previous, { story: original.story, tagline: original.tagline, jokeIdea: 'extra' }, ['tagline']).jokeIdea, original.jokeIdea);
  assert.throws(() => applyFieldCorrection(previous, { story: original.story }, ['tagline']), /locked_fields/);
  const transport = mockTransport(request => textAnswer({ story: request.retry === 0 ? shortRewrite.story : original.story, tagline: original.tagline }));
  const result = await writeStory(transport, family, sentences[0], { correction: 'Fix rhyme only', correctionFields: ['tagline'], priorStory: previous, lockedMoveId: original.moveId });
  assert.equal(result.story, original.story); assert.equal(transport.calls.length, 2);
  assert.ok(transport.calls.every(call => call.stage === 'story-correction'));
  assert.match(JSON.parse(transport.calls[1].body.input[0].content).correction.error, /changed_story/);
});

test('a code rejection confined to a small field also keeps the story on attempt 2', async () => {
  const original = kitText(), first = { ...original, noticedFeeling: true };
  const transport = mockTransport(request => textAnswer(request.retry === 0 ? first : { story: original.story, noticedFeeling: 'annoyed' }));
  const result = await writeStory(transport, family, sentences[0]);
  assert.equal(result.story, original.story);
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-correction']);
});

test('a true chapter fault retries only a missing practice passage and reports advisory word counts', async t => {
  const directory = temp(t), current = { ...run6, tagline: selectedRhymeFor(moves[0]).tagline };
  const broken = { ...current, story: null };
  const transport = offlineTransport(t, directory, request => {
    if (request.stage === 'story') return textAnswer(current);
    if (request.stage === 'story-check') return textAnswer(request.retry === 0 ? markFault(storyCheckAnswer(current.tagline), 'secondMoveTaught', current.story.split('\n')[1], ['story']) : storyCheckAnswer(current.tagline));
    if (request.stage === 'story-rewrite') return textAnswer(request.retry === 0 ? broken : current);
  });
  const result = await readyStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.ready, true);
  const rewrites = transport.calls.filter(call => call.stage === 'story-rewrite');
  assert.equal(rewrites.length, 2);
  assert.match(JSON.parse(rewrites[0].body.input[0].content).correction.lengthRule, /measured|capacity/i);
  assert.match(readFileSync(join(directory, 'story-attempt-2.reason.txt'), 'utf8'), /invalid_story_type/);
  assert.equal(readFileSync(join(directory, 'story-attempt-3.reason.txt'), 'utf8').trim(), 'PASS');
  for (const field of smallFields) assert.deepEqual(result[field], current[field]);
});

test('a full rewrite rejects changes to unrelated small fields', async () => {
  const transport = mockTransport(() => textAnswer({ ...run6, tagline: 'A changed rhyme this time.' }));
  await assert.rejects(writeStory(transport, family, sentences[0], { correction: 'Fix chapter', priorStory: run6, lockedMoveId: run6.moveId, rewriteFields: ['story', 'panelLines'] }), /rewrite_changed_locked_field: tagline/);
  assert.equal(transport.calls.length, 2);
});

test('only generated story faults including a joke at a person can rewrite the chapter', () => {
  for (const key of ['secondMoveTaught', 'feelingGoesAwayPromise', 'adviceOutsideRecord', 'jokeAtPerson', 'effortOnlyPraise', 'filledWhenINotice', 'chapterShapeWrong']) assert.equal(correctionPlan({ faults: [key], affectedFields: { [key]: ['story'] } }).rewrite, true);
  assert.throws(() => correctionPlan({ faults: ['tinyTryWrong'], affectedFields: { tinyTryWrong: ['story'] } }), /no allowed correction scope/);
});

test('broken Haiku answers recheck the same story and never buy a rewrite', async () => {
  const transport = mockTransport(request => request.stage === 'story' ? textAnswer(run6) : textAnswer(request.retry === 0 ? '{}' : storyCheckAnswer(run6.tagline)));
  const result = await readyStory(transport, family, sentences[0]);
  assert.equal(result.story, run6.story);
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-check', 'story-check']);
  assert.equal(transport.calls[1].body.reasoning.effort, 'medium'); assert.equal(transport.calls[2].body.reasoning.effort, 'high'); assert.equal(result.checks.at(-1).verified, true);
});

test('two incomplete current story checks stop honestly without inventing a verdict', async () => {
  const transport = mockTransport(request => request.stage === 'story' ? textAnswer(run6) : textAnswer('{}'));
  await assert.rejects(readyStory(transport, family, sentences[0]), error => error.code === 'content_check_unverified' && error.canResume === true);
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-check', 'story-check']);
});

test('an explicit Resume checks the saved story draft without buying another story', async t => {
  const directory = temp(t), memory = createMemory(join(directory, 'family.json'));
  memory.store(family);
  const first = offlineTransport(t, directory, request => request.stage === 'story-check' ? textAnswer('{}') : undefined);
  const options = { kit: 1, directory, chosenMoveId: run5.moveId, stopBeforePictures: true, exports: offlineExports() };
  await assert.rejects(createKit(first, memory, sentences[0], options), error => error.code === 'content_check_unverified' && error.canResume === true);
  const saved = readJSON(join(directory, 'checkpoint.json'));
  assert.equal(saved.stages.text, undefined);
  assert.equal(saved.stages['story-draft'].story, run5.story);
  const resumed = offlineTransport(t, directory);
  const result = await createKit(resumed, memory, sentences[0], { ...options, resume: true });
  assert.equal(result.story, saved.stages['story-draft'].story);
  assert.equal(resumed.calls.filter(call => call.stage === 'story').length, 0);
  assert.equal(resumed.calls.filter(call => call.stage === 'story-check').length, 1);
});

test('a malformed image check rechecks the same bytes instead of redrawing', async t => {
  const directory = temp(t), record = structuredClone(family);
  record.hero.heroPicturePath = new URL('./fixtures/offline-art.png', import.meta.url).pathname;
  const transport = offlineTransport(t, directory, request => request.stage === 'panel-1-word-check' && request.retry === 0 ? openaiAnswer('{}') : undefined);
  const result = await readyDrawnPage(withKitEvidence(transport, directory), record, moves[0], sentences[0], run5, { directory, panelIndex: 0 });
  assert.equal(result.ready, true);
  assert.deepEqual(transport.calls.map(call => call.stage), ['panel-1', 'panel-1-word-check', 'panel-1-word-check']);
  assert.equal(transport.calls[1].body.reasoning.effort, 'low');
});

test('a confirmed panel fault redraws only that panel and names the fault', async t => {
  const directory = temp(t), record = structuredClone(family);
  record.hero.heroPicturePath = new URL('./fixtures/offline-art.png', import.meta.url).pathname;
  record.cast = lockedCast(record).map(person => ({ ...person, referencePath: record.hero.heroPicturePath }));
  const transport = offlineTransport(t, directory, request => {
    if (request.stage === 'panel-3-word-check' && request.retry === 0) return openaiAnswer({ ...syntheticCastEvidence(request), ...markFault(wordCheckAnswer([{ id: 'bubble', text: run5.panelLines[2].line }]), 'textCrossesBoundary', '"That one fits." crosses the bubble border') });
  });
  const result = await readyKitArt(withKitEvidence(transport, directory), record, moves[0], sentences[0], run5, { directory });
  assert.equal(result.ready, true);
  const draws = transport.calls.filter(call => call.path === '/v1/images/edits');
  assert.deepEqual(draws.map(call => call.stage), ['poster', 'panel-1', 'panel-2', 'panel-3', 'panel-4']);
  assert.ok(result.panels[2].checks.at(-1).reviewFlags.some(flag => flag.key === 'textCrossesBoundary'));
  for (const call of draws) assert.deepEqual(call.body.image.slice(0, 2), draws[0].body.image.slice(0, 2));
});

test('hero outfit opinions are saved without buying another drawing', async t => {
  const directory = temp(t);
  const transport = offlineTransport(t, directory, request => request.stage === 'hero-check' ? openaiAnswer({ ...syntheticCastEvidence(request), ...markFault(pictureCheckAnswer(), 'outfitMismatch', 'The visible hoodie is blue instead of green.') }) : undefined);
  const result = await readyPicture(withKitEvidence(transport, directory), family, moves[0], sentences[0], { directory: join(directory, 'hero'), hero: true });
  assert.equal(result.ready, true); assert.equal(transport.calls.filter(call => call.stage === 'hero').length, 1);
  assert.ok(result.checks[0].reviewFlags.some(row => row.key === 'parent_picture_choice')); assert.equal(result.checks[0].verified, false);
});

test('a portrait needs no opinion call while historical empty-evidence flags remain readable', async t => {
  const directory = temp(t), transport = offlineTransport(t, directory);
  const result = await readyPicture(withKitEvidence(transport, directory), family, moves[0], sentences[0], { directory: join(directory, 'hero'), hero: true });
  assert.equal(result.ready, true); assert.equal(result.checks[0].verified, false); assert.equal(transport.calls.length, 1);
  const parsed = parsePictureCheck(JSON.stringify({ ...pictureCheckAnswer(), outfitMismatch: true }));
  assert.ok(parsed.ignoredFaults.some(row => row.key === 'outfitMismatch'));
});

test('two complete offline kits use the run 6 answer, reuse the hero and preserve all evidence', async t => {
  const directory = temp(t), memory = createMemory(join(directory, 'family.json'));
  memory.store(family);
  const stories = { 1: run6 };
  const transport = offlineTransport(t, directory, request => {
    const text = stories[request.kit];
    if (request.stage === 'story') return textAnswer(text);
    if (request.stage === 'story-check') return request.kit === 1 && request.retry === 0 ? structuredClone(run6Check.response) : textAnswer(storyCheckAnswer(JSON.parse(request.body.input[0].content).story.tagline));

  }, { maxCalls: 76 });
  const first = await createKit(transport, memory, sentences[0], { kit: 1, directory: join(directory, 'kit-1'), exports: offlineExports() });
  assert.equal(first.complete, true); assert.equal(first.story, run6.story);
  memory.addKit(savedKit({ moveId: first.moveId, world: first.world, colourSet: first.colourSet }));
  const next = eligibleMoves(memory.exportRecord(), sentences[1])[0].move;
  stories[2] = kitText(next); stories[2].story = stories[2].story.replace(/\bDad\b/g, 'Dee');
  const second = await createKit(transport, memory, sentences[1], { kit: 2, directory: join(directory, 'kit-2'), exports: offlineExports() });
  assert.equal(second.complete, true); assert.notEqual(second.moveId, first.moveId);
  assert.equal(first.heroHash, second.heroHash);
  assert.equal(transport.calls.filter(call => call.stage === 'story').length, 2);
  assert.equal(transport.calls.filter(call => call.stage === 'story-check').length, 3);
  assert.equal(transport.calls.filter(call => call.stage === 'hero').length, 1);
  for (const kit of [first, second]) {
    assert.equal(Object.keys(kit.pages).length, 5);
    for (const file of ['story-attempt-1.json', 'story-check-1.json', 'picture-check-poster-1.json', 'poster-transcription-1.json', 'kit-log.md', 'kit_final.pdf', 'index.html']) assert.ok(existsSync(join(kit.directory, file)), file);
    assert.equal(kit.pdf.fixture, true, 'This is pipeline rehearsal, not a fresh browser export');
  }
});

test('a sound concern preserves the saved reminder and keeps the raw verdict', async t => {
  const directory = temp(t), original = kitText(moves[0]);
  const transport = offlineTransport(t, directory, request => {
    if (request.stage === 'story') return textAnswer(original);
    if (request.stage === 'story-check') {
      const current = JSON.parse(request.body.input[0].content).story, answer = storyCheckAnswer(current.tagline);
      answer.taglineRhymes = false;
      return textAnswer(answer);
    }
  });
  const result = await readyStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.ready, true); assert.equal(result.story, original.story); assert.equal(result.tagline, original.tagline);
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-check']);
  assert.equal(readJSON(join(directory, 'story-check-1.json')).answer.taglineRhymes, false);
});
