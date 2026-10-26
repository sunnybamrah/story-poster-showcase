import { validationFinding } from './review-assertions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readJSON, moves } from '../server/files.js';
import { assertNoFamilyText, privacyFor, buildStoryRequest, buildStoryCheckRequest, buildPosterRequest, buildPanelRequest } from '../server/requests.js';
import { familyContextHits, picturePrivacyHits } from '../server/family-privacy.js';
import { scrubWriterImageText, scrubIdentityText } from '../server/writer-image-text.js';
import { validateStory, writeStory, kitTextKeys } from '../server/story.js';
import { withKitEvidence } from '../server/kit-evidence.js';
import { readLog } from '../server/transport.js';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { posterBoxes, bubbleInStory } from '../server/format.js';
import { selectedRhymeFor } from '../server/rhyme.js';
import { kitText, withSyntheticSpeakers } from './kit-text-fixture.mjs';
import { offlineTransport, offlineExports, textAnswer, openaiAnswer } from './offline-kit-fixture.mjs';
import { syntheticCastEvidence, wordCheckAnswer } from './checker-fixture.mjs';
import { family, sentences } from './fixture.mjs';

const temp = t => { const directory = mkdtempSync(join(tmpdir(), 'pass20-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; };
const privacy = { ...privacyFor(family, sentences[0]), familyContext: family.familyContext + ' We visit Lincoln school with coach Dave. Our pet is Biscuit. The team7 password changed.' };
const fixture = options => { const value = kitText(moves[0], options); value.story = value.story.replace(/\bDad\b/g, family.parentLabel); return value; };
const caught = validationFinding;
const long = length => Array(length).fill('word').join(' ');

test('ordinary single lowercase words pass even outside the large English vocabulary', () => {
  const context = { ...privacy, familyContext: privacy.familyContext + ' The florble waits in the kitchen by a sister.' };
  const dictionary = readJSON(new URL('../content/common-words.json', import.meta.url));
  assert.ok(dictionary.commonEnglish.length >= 5000); assert.ok(!dictionary.commonEnglish.includes('florble'));
  for (const word of ['room', 'soccer', 'with', 'brother', 'sister', 'kitchen', 'school', 'team', 'florble']) assert.equal(assertNoFamilyText(word, context), true, word);
  assert.equal(scrubIdentityText('room soccer with brother', context), 'room soccer with brother');
});

test('names, known identities, digits and explicit sensitive words outrank the dictionary', () => {
  for (const word of ['Pip', 'Biscuit', 'Lincoln', 'Dee', 'team7', 'password']) assert.throws(() => assertNoFamilyText(word, privacy), /OpenAI request contains/, word);
  assert.throws(() => assertNoFamilyText('rose', { ...privacy, nickname: 'Rose' }), /nickname/);
  assert.throws(() => assertNoFamilyText('Aurora', { ...privacy, heroName: 'Aurora the Fox' }), /hero name/);
  assert.throws(() => assertNoFamilyText('Biscuit', privacyFor(family, '')), /name/, 'Pet names in the saved loves are also identities');
});

test('capitalized sentence starters and ordinary I are exempt, while names inside a sentence are protected', () => {
  const context = { ...privacy, familyContext: 'Room feels warm. Soccer is fun. Pip and I visit Lincoln.' };
  for (const word of ['room', 'soccer', 'I']) assert.equal(assertNoFamilyText(word, context), true);
  assert.throws(() => assertNoFamilyText('Lincoln', context), /name/);
  assert.equal(assertNoFamilyText('and I', context), true);
  assert.throws(() => assertNoFamilyText('Milo', { ...context, familyContext: 'Milo moved in.' }), /name/);
});

test('ordered adjacent family-context phrases stay protected across case, spaces and hyphens', () => {
  for (const text of ['little brother', 'LITTLE   BROTHER', 'little-brother', 'soccer tryouts', 'coach Dave', 'shares a room']) assert.throws(() => assertNoFamilyText(text, privacy), /phrase/);
  assert.equal(assertNoFamilyText('brother little', privacy), true);
  assert.equal(assertNoFamilyText({ a: 'little', b: 'brother' }, privacy), true, 'Do not invent a phrase between independent values');
  assert.equal(assertNoFamilyText(JSON.stringify({ a: 'little', b: 'brother' }), privacy), true);
  assert.throws(() => assertNoFamilyText({ nested: { Lincoln: 'a place' } }, privacy), /name/);
});

test('one guard result lists every hit across every nested value', () => {
  const body = { first: 'Biscuit', second: 'Lincoln', third: 'little brother', fourth: 'coach Dave' };
  const error = caught(() => assertNoFamilyText(body, privacy));
  assert.ok(error.violations.length >= 4);
  for (const key of Object.keys(body)) assert.ok(error.violations.some(hit => hit.field === `request.${key}`), key);
  assert.deepEqual(error.violations, picturePrivacyHits(body, privacy));
});

test('the shared scrub replaces every private field, preserves ordinary words and leaves the chapter alone', () => {
  const value = fixture(); value.chapterTitle = 'Pip meets coach Dave';
  value.jokeIdea = 'The toy points at soccer tryouts.';
  value.panelLines[0].scene = 'The fox waves to little brother.';
  value.panelLines[1].scene = 'The fox looks toward Lincoln.';
  value.panelLines[2].scene = 'The fox draws Biscuit.';
  const result = scrubWriterImageText(value, privacy);
  assert.equal(result.text.jokeIdea, 'The toy points at a game.');
  assert.equal(result.text.panelLines[0].scene, 'The fox waves to another child.');
  assert.equal(result.text.panelLines[2].scene, 'The fox draws an animal.');
  assert.equal(result.text.story, value.story); assert.equal(result.text.tagline, value.tagline);
  assert.deepEqual(result.remainingViolations, []);
  for (const field of ['chapterTitle', 'jokeIdea', 'panelLines[0].scene', 'panelLines[1].scene', 'panelLines[2].scene']) assert.ok(result.violations.some(hit => hit.field === field), field);
  const twice = scrubWriterImageText(result.text, privacy);
  assert.deepEqual(twice.text, result.text); assert.deepEqual(twice.changes, []);
});

test('literal correction paths get the same phrase scrub and complete report', () => {
  const patch = { story: 'Pip and little brother stay in the private chapter.', 'panelLines[0].scene': 'A toy points at coach Dave.', 'panelLines[1].line': 'little brother' };
  const result = scrubWriterImageText(patch, privacy);
  assert.equal(result.text['panelLines[0].scene'], 'A toy points at a grown-up.');
  assert.equal(result.text['panelLines[1].line'], 'Another child');
  assert.equal(result.text.story, patch.story); assert.deepEqual(result.remainingViolations, []);
  assert.equal(new Set(result.violations.map(hit => hit.field)).size, 2);
});

test('scrubbed bubble matching uses the same anonymous view without changing private chapter words', () => {
  const value = fixture(); value.story = value.story.replace('This feels hard.', 'My little brother feels sad.');
  value.panelLines[0].line = 'little brother feels sad';
  const scrubbed = scrubWriterImageText(value, privacy).text;
  assert.equal(scrubbed.panelLines[0].line, 'Another child feels sad');
  assert.equal(bubbleInStory(value.story, scrubbed.panelLines[0].line, { matchText: text => scrubIdentityText(text, privacy) }), true);
  assert.doesNotThrow(() => validateStory(scrubbed, { privacy, nickname: family.hero.nickname, parentLabel: family.parentLabel }));
});

test('validation reports all privacy and shape faults together, with their precise counts and limits', () => {
  const value = fixture(); value.jokeIdea = 'A toy points at little brother.';
  value.panelLines[0].scene = 'The fox waits near Lincoln.';
  value.panelLines[2].scene = null; value.chapterTitle = '';
  value.tinyTryOptions[1].seconds = '12'; value.whereElse.place = 'phone';
  const error = caught(() => validateStory(value, { privacy, nickname: family.hero.nickname, parentLabel: family.parentLabel }));
  const fields = new Set(error.failures.map(fault => fault.field));
  for (const field of ['jokeIdea', 'panelLines[0].scene', 'panelLines[2].scene', 'chapterTitle', 'tinyTryOptions[1].seconds', 'whereElse.place']) assert.ok(fields.has(field), field);
  for (const fault of error.failures) { assert.ok(fault.limit); assert.equal(typeof fault.measured, 'number'); assert.ok(error.message.includes(fault.reason)); }
});

test('malformed containers never hide independent faults or crash the collector', () => {
  const value = fixture(); value.panelLines[0] = null; value.panelLines[3].line = 'An absent bubble.';
  value.feelFirst = false; value.tinyTryOptions[0] = null; value.whereElse = null; value.noticedFeeling = false;
  const error = caught(() => validateStory(value));
  for (const field of ['panelLines[0]', 'panelLines[3].line', 'feelFirst', 'tinyTryOptions[0]', 'whereElse', 'noticedFeeling']) assert.ok(error.failures.some(fault => fault.field === field), field);
  const empty = caught(() => validateStory({}));
  assert.ok(empty.failures.length > 6); assert.ok(empty.failures.some(fault => fault.field === 'kit'));
});

test('all absent bubbles and all duplicate scenes appear in the same fault list', () => {
  const value = fixture(); value.panelLines[1].scene = value.panelLines[0].scene; value.panelLines[2].scene = value.panelLines[0].scene;
  value.panelLines[0].line = 'Absent phrase alpha.'; value.panelLines[3].line = 'Absent phrase omega.';
  const error = caught(() => validateStory(value));
  for (const field of ['panelLines[1].scene', 'panelLines[2].scene', 'panelLines[0].line', 'panelLines[3].line']) assert.ok(error.failures.some(fault => fault.field === field), field);
});

test('a missing or malformed panel cannot hide faults in the other available panels', () => {
  const malformed = fixture(); malformed.panelLines[0] = null; malformed.panelLines[2].scene = malformed.panelLines[1].scene;
  const first = caught(() => validateStory(malformed));
  assert.ok(first.failures.some(fault => fault.field === 'panelLines[0]'));
  assert.ok(first.failures.some(fault => fault.field === 'panelLines[2].scene'));
  const missing = fixture(); missing.panelLines.pop(); missing.panelLines[0].line = 'Absent bubble words.';
  const second = caught(() => validateStory(missing));
  assert.ok(second.failures.some(fault => fault.field === 'panelLines'));
  assert.ok(second.failures.some(fault => fault.field === 'panelLines[0].line'));
  const gap = fixture(); gap.panelLines[0].line = gap.panelLines[2].line; gap.panelLines[1].line = null; gap.panelLines[2].line = 'This feels hard.';
  const third = caught(() => validateStory(gap));
  assert.ok(third.failures.some(fault => fault.field === 'panelLines[1].line'));
  assert.ok(third.failures.some(fault => fault.field === 'panelLines[2].line' && fault.code === 'panel_bubbles_out_of_order'));
});

test('one correction fixes every small-field fault and saves the whole list privately', async t => {
  const directory = temp(t), good = fixture(), bad = structuredClone(good);
  bad.jokeIdea = ''; bad.panelLines[0].scene = null; bad.tinyTryOptions[1].seconds = '12'; bad.whereElse.place = 'phone';
  const fields = ['jokeIdea', 'panelLines[0].scene', 'tinyTryOptions[1].seconds'];
  const transport = offlineTransport(t, directory, request => {
    if (request.stage === 'story') return textAnswer(bad);
    const correction = JSON.parse(request.body.input[0].content).correction;
    assert.deepEqual(new Set(correction.fields), new Set(fields)); assert.equal(correction.failures.length, 3);
    for (const field of fields) assert.ok(correction.failures.some(fault => fault.field === field));
    assert.match(correction.instruction, /every listed failure/);
    return textAnswer({ story: good.story, jokeIdea: good.jokeIdea, 'panelLines[0].scene': good.panelLines[0].scene, 'tinyTryOptions[1].seconds': good.tinyTryOptions[1].seconds });
  });
  const result = await writeStory(withKitEvidence(transport, directory), family, sentences[0]);
  for (const field of kitTextKeys) assert.deepEqual(result[field], field === 'whereElse' ? bad[field] : good[field]);
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-correction']);
  const path = join(directory, 'story-attempt-1.validation.json'); assert.equal(statSync(path).mode & 0o777, 0o600);
  const saved = readJSON(path).failures; assert.equal(saved.length, 3);
  for (const fault of saved) assert.ok(readFileSync(join(directory, 'story-attempt-1.reason.txt'), 'utf8').includes(fault.reason));
  assert.deepEqual(readLog(transport.logFile).find(row => row.event === 'validation-reject').failures, saved);
});

test('a mixed chapter and scene repair changes only those fields and leaves other panels locked', async t => {
  const directory = temp(t), good = fixture(), bad = fixture(); bad.story = null; bad.panelLines[2].scene = null;
  const transport = offlineTransport(t, directory, request => {
    if (request.stage === 'story') return textAnswer(bad);
    const correction = JSON.parse(request.body.input[0].content).correction;
    assert.deepEqual(new Set(correction.fields), new Set(['story', 'panelLines[2].scene']));
    return textAnswer({ ...bad, story: good.story, panelLines: bad.panelLines.map((panel, index) => index === 2 ? { ...panel, scene: good.panelLines[2].scene } : panel) });
  });
  const result = await writeStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.story, good.story); assert.deepEqual(result.panelLines, good.panelLines);
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-rewrite']);
});

test('mixed repair still refuses a changed unlisted sibling panel', async t => {
  const directory = temp(t), good = fixture(), bad = fixture(); bad.story = null; bad.panelLines[2].scene = null;
  const transport = offlineTransport(t, directory, request => request.stage === 'story' ? textAnswer(bad) : textAnswer({ ...good, panelLines: good.panelLines.map((panel, index) => index === 0 ? { ...panel, scene: 'Unrequested scene change.' } : panel) }));
  await assert.rejects(writeStory(withKitEvidence(transport, directory), family, sentences[0]), /rewrite_changed_locked_field: panelLines/);
  assert.equal(transport.calls.length, 2);
});

test('run 12 first draft retains room in both fields and passes all picture request guards', () => {
  const raw = readJSON(new URL('./fixtures/run12-story-1.json', import.meta.url)), context = privacyFor(family, sentences[0]);
  const result = scrubWriterImageText(raw, context);
  assert.deepEqual(result.text, raw); assert.deepEqual(result.violations, []);
  assert.match(result.text.jokeIdea, /room/); assert.match(result.text.panelLines[0].scene, /room/);
  assert.doesNotThrow(() => validateStory(result.text, { privacy: context, nickname: family.hero.nickname, parentLabel: family.parentLabel }));
  const move = moves.find(move => move.id === raw.moveId);
  assert.doesNotThrow(() => buildPosterRequest(family, move, sentences[0], raw));
  for (const panel of raw.panelLines) assert.doesNotThrow(() => buildPanelRequest(family, move, sentences[0], panel));
});

test('run 12 derived offline kit reaches five pages with no room correction and records medium/high effort', async t => {
  const directory = temp(t), raw = withSyntheticSpeakers(readJSON(new URL('./fixtures/run12-story-1.json', import.meta.url)));
  // Synthetic current-voice input: omit the recited age range. The raw saved
  // answer remains unchanged; pass 36 separately tests its lecture rejection.
  raw.story = raw.story.replace('children aged 8 to 13', 'children');
  raw.tagline = 'Name feelings today. Say them your way.';
  const move = moves.find(move => move.id === raw.moveId), memory = createMemory(join(directory, 'family.json')); memory.store(family);
  const transport = offlineTransport(t, directory, request => {
    if (request.stage === 'story') return textAnswer(raw);
    if (request.stage.endsWith('-word-check')) {
      const number = request.stage.match(/^panel-(\d)/)?.[1];
      return openaiAnswer({ ...syntheticCastEvidence(request), ...wordCheckAnswer(number ? [{ id: 'bubble', text: raw.panelLines[Number(number) - 1].line }] : posterBoxes(move, { ...raw, tagline: 'Name it to tame it' })) });
    }
  });
  const result = await createKit(transport, memory, sentences[0], { directory, exports: offlineExports() });
  assert.equal(result.complete, true); assert.equal(Object.keys(result.pages).length, 5); assert.equal(result.pdf.fixture, true);
  assert.ok(!transport.calls.some(call => call.stage === 'story-correction'));
  const ledger = readJSON(join(directory, 'kit-log.json'));
  assert.equal(ledger.find(row => row.stage === 'story').reasoningEffort, 'medium');
  assert.equal(ledger.find(row => row.stage === 'story-check').reasoningEffort, 'medium');
  assert.match(readFileSync(join(directory, 'kit-log.md'), 'utf8'), /\| story \| 1 \| medium \|/);
  assert.deepEqual(readJSON(join(directory, 'story-attempt-1.json')), raw);
});

test('writer and judge start at medium, and truncation uses one logged low-effort retry', async t => {
  const directory = temp(t), good = fixture();
  assert.equal(buildStoryRequest(family, sentences[0]).reasoning.effort, 'medium');
  assert.equal(buildStoryCheckRequest(good, moves[0]).reasoning.effort, 'medium');
  const transport = offlineTransport(t, directory, request => request.retry === 0 ? { ...textAnswer(''), status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } : textAnswer(good));
  await writeStory(withKitEvidence(transport, directory), family, sentences[0]);
  const requests = readLog(transport.logFile).filter(row => row.event === 'request');
  assert.deepEqual(requests.map(row => row.reasoningEffort), ['medium', 'low']);
  assert.deepEqual(readJSON(join(directory, 'kit-log.json')).filter(row => row.stage === 'story').map(row => row.reasoningEffort), ['medium', 'low']);
});
