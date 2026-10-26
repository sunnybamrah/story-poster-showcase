import { validationFinding } from './review-assertions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moves, words, readJSON } from '../server/files.js';
import { validateStory, writeStory, applyFieldCorrection, kitTextKeys } from '../server/story.js';
import { buildStoryRequest, buildStoryCheckRequest, STORY_RULES, privacyFor } from '../server/requests.js';
import { scrubWriterImageText } from '../server/writer-image-text.js';
import { textModels } from '../server/text-models.js';
import { createTransport, readLog } from '../server/transport.js';
import { withKitEvidence } from '../server/kit-evidence.js';
import { fieldValue, quoteValue } from '../server/validation-reason.js';
import { kitText } from './kit-text-fixture.mjs';
import { family, sentences } from './fixture.mjs';
import { offlineTransport, textAnswer } from './offline-kit-fixture.mjs';

const temp = t => { const path = mkdtempSync(join(tmpdir(), 'pass19-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; };
const long = count => Array(count).fill('word').join(' ');
const fixture = () => kitText();
const caught = validationFinding;
const brave = () => kitText(moves.find(move => move.id === 'one-brave-step'));
const cases = [
  ['root type', () => null, 'kit', 0, 11],
  ['missing key', value => { delete value.jokeIdea; return value; }, 'kit', 10, 11],
  ['unknown move', value => ({ ...value, moveId: 'invented' }), 'moveId', 0, 1],
  ['locked move', value => value, 'moveId', 0, 1, { lockedMoveId: 'other-move' }],
  ['last move repeated', value => value, 'moveId', 1, 0, { lastMoveId: moves[0].id }],
  ['used move repeated', value => value, 'moveId', 1, 0, { usedIds: [moves[0].id] }],
  ['ineligible move', value => value, 'moveId', 0, 1, { eligibleIds: [] }],
  ['privacy field', value => ({ ...value, jokeIdea: 'Pip wears a hat.' }), 'jokeIdea', 1, 0, { nickname: 'Pip' }],
  ['story type', value => ({ ...value, story: true }), 'story', 0, 1],
  ['clinical word', value => ({ ...value, jokeIdea: 'A diagnosis sits here.' }), 'jokeIdea', 1, 0],
  ['dash punctuation', value => { value.feelFirst[1] = 'One — two.'; return value; }, 'feelFirst[1]', 1, 0],
  ['filled blank', value => { value.tinyTryOptions[1].text = 'When I notice sad, I dance.'; return value; }, 'tinyTryOptions[1].text', 1, 0],
  ['safety missing', () => { const value = brave(); value.story = value.story.replace('only after a grown-up says it is safe', 'only after a grown person thinks it is fine'); return value; }, 'story', 0, 1],
  ['title maximum', value => ({ ...value, chapterTitle: long(11) }), 'chapterTitle', 11, 10],
  ['title minimum', value => ({ ...value, chapterTitle: '' }), 'chapterTitle', 0, 1],
  ['title lines', value => ({ ...value, chapterTitle: 'One\nTwo' }), 'chapterTitle', 2, 1],
  ['tagline maximum', value => ({ ...value, tagline: long(11) }), 'tagline', 11, 10],
  ['tagline lines', value => ({ ...value, tagline: 'One\nTwo' }), 'tagline', 2, 1],
  ['tagline title word', value => ({ ...value, tagline: 'Clouds so bright, stars at night.' }), 'tagline', 0, 1],
  ['joke maximum', value => ({ ...value, jokeIdea: long(41) }), 'jokeIdea', 41, 40],
  ['replay maximum', value => ({ ...value, replayCue: long(41) }), 'replayCue', 41, 40],
  ['feeling word count', value => ({ ...value, noticedFeeling: 'very sad' }), 'noticedFeeling', 2, 1],
  ['feeling type', value => ({ ...value, noticedFeeling: true }), 'noticedFeeling', 0, 1],
  ['feeling punctuation', value => ({ ...value, noticedFeeling: 'sad!' }), 'noticedFeeling', 1, 0],
  ['feelFirst count', value => ({ ...value, feelFirst: ['One.'] }), 'feelFirst', 1, 2],
  ['feelFirst type', value => ({ ...value, feelFirst: null }), 'feelFirst', 0, 1],
  ['feelFirst line length', value => ({ ...value, feelFirst: ['One.', long(41)] }), 'feelFirst[1]', 41, 40],
  ['feelFirst item type', value => ({ ...value, feelFirst: ['One.', false] }), 'feelFirst[1]', 0, 1],
  ['panel count', value => ({ ...value, panelLines: value.panelLines.slice(0, 3) }), 'panelLines', 3, 4],
  ['panel type', value => ({ ...value, panelLines: false }), 'panelLines', 0, 4],
  ['panel shape', value => { value.panelLines[1] = { scene: 'One', text: 'Wrong key.' }; return value; }, 'panelLines[1]', 1, 2],
  ['panel object type', value => { value.panelLines[1] = null; return value; }, 'panelLines[1]', 0, 2],
  ['scene maximum', value => { value.panelLines[0].scene = long(91); return value; }, 'panelLines[0].scene', 91, 90],
  ['scene lines', value => { value.panelLines[2].scene = 'One\nTwo'; return value; }, 'panelLines[2].scene', 2, 1],
  ['scene type', value => { value.panelLines[3].scene = 12; return value; }, 'panelLines[3].scene', 0, 1],
  ['distinct scenes', value => { value.panelLines[1].scene = value.panelLines[0].scene; return value; }, 'panelLines[1].scene', 3, 4],
  ['bubble maximum', value => { value.panelLines[0].line = long(8); return value; }, 'panelLines[0].line', 8, 7],
  ['bubble empty', value => { value.panelLines[0].line = ''; return value; }, 'panelLines[0].line', 0, 1],
  ['bubble missing from story', value => { value.panelLines[0].line = 'This is absent.'; return value; }, 'panelLines[0].line', 0, 1],
  ['bubble order', value => { value.panelLines[1].line = value.panelLines[0].line; return value; }, 'panelLines[1].line', 1, 2],
  ['bubble gap', value => { value.panelLines[2].line = value.panelLines[1].line; return value; }, 'panelLines[1].line / panelLines[2].line', 0, 1],
  ['bubble balance', value => { value.panelLines[2].line = 'The puzzle waits.'; return value; }, 'panelLines[1].line / panelLines[2].line', 1.2, 35],
  ['telling scene missing', () => { const value = brave(); value.panelLines[2].scene = 'The fox looks at the last puzzle piece.'; return value; }, 'panelLines', 0, 1],
  ['option count', value => ({ ...value, tinyTryOptions: value.tinyTryOptions.slice(0, 2) }), 'tinyTryOptions', 2, 3],
  ['option type', value => ({ ...value, tinyTryOptions: 'three' }), 'tinyTryOptions', 0, 3],
  ['option shape', value => { delete value.tinyTryOptions[1].seconds; return value; }, 'tinyTryOptions[1]', 2, 3],
  ['option text maximum', value => { value.tinyTryOptions[1].text = long(51); return value; }, 'tinyTryOptions[1].text', 51, 50],
  ['seconds minimum', value => { value.tinyTryOptions[1].seconds = 29; return value; }, 'tinyTryOptions[1].seconds', 29, 30],
  ['seconds maximum', value => { value.tinyTryOptions[2].seconds = 91; return value; }, 'tinyTryOptions[2].seconds', 91, 90],
  ['seconds integer', value => { value.tinyTryOptions[0].seconds = 30.5; return value; }, 'tinyTryOptions[0].seconds', 30.5, 30],
  ['seconds type', value => { value.tinyTryOptions[0].seconds = '30'; return value; }, 'tinyTryOptions[0].seconds', 0, 1],
  ['offScreen type', value => { value.tinyTryOptions[1].offScreen = 'true'; return value; }, 'tinyTryOptions[1].offScreen', 0, 1],
  ['offScreen minimum', value => { value.tinyTryOptions.forEach(option => { option.offScreen = false; }); return value; }, 'tinyTryOptions', 0, 1],
  ['whereElse shape', value => ({ ...value, whereElse: { place: 'Beside a chair.' } }), 'whereElse', 1, 2],
  ['whereElse line maximum', value => ({ ...value, whereElse: { ...value.whereElse, line: long(41) } }), 'whereElse.line', 41, 40],
  ['whereElse place maximum', value => ({ ...value, whereElse: { ...value.whereElse, place: long(41) } }), 'whereElse.place', 41, 40],
  ['whereElse place empty', value => ({ ...value, whereElse: { ...value.whereElse, place: '' } }), 'whereElse.place', 0, 1],
  ['whereElse screen', value => ({ ...value, whereElse: { ...value.whereElse, place: 'On a phone screen.' } }), 'whereElse.place', 2, 0],
];

const advisoryCases = new Set(['title maximum', 'title lines', 'tagline maximum', 'tagline lines', 'tagline title word', 'joke maximum', 'replay maximum', 'feeling word count', 'feeling punctuation', 'feelFirst count', 'feelFirst line length', 'scene maximum', 'scene lines', 'bubble maximum', 'bubble balance', 'option text maximum', 'seconds minimum', 'seconds maximum', 'seconds integer', 'whereElse line maximum', 'whereElse place maximum']);
for (const [name, violate, field, measured, limit, options] of cases) test(`${advisoryCases.has(name) ? 'advisory or normalized value accepted' : 'validation reason names field, count, limit and exact value'}: ${name}`, () => {
  const candidate = violate(fixture());
  if (advisoryCases.has(name)) {
    if (name === 'bubble maximum') candidate.story = candidate.story.replace('This feels hard.', candidate.panelLines[0].line + '.');
    assert.doesNotThrow(() => validateStory(candidate, options));
    return;
  }
  const error = caught(() => validateStory(candidate, options));
  assert.ok(error.failure, error.message); assert.equal(error.failure.field, field); assert.equal(error.failure.measured, measured);
  assert.ok(Object.values(error.failure.limit).includes(limit), error.message);
  assert.ok(error.message.includes(field), error.message); assert.ok(error.message.includes(String(measured))); assert.ok(error.message.includes(String(limit)));
  assert.ok(error.message.includes(quoteValue(error.failure.value)), error.message);
  assert.ok(error.failure.instruction.length > 10);
});

test('saved pagination faults also name the failed check and numeric requirement', () => {
  const candidate = fixture(), pagination = validateStory(candidate).pagination;
  for (const [change, field] of [[page => { page.source = 'changed'; }, 'pagination.source'], [page => { page.pages[0] += ' changed'; }, 'pagination.receipt']]) {
    const saved = structuredClone(pagination); change(saved);
    const error = caught(() => validateStory(candidate, { pagination: saved }));
    assert.equal(error.failure.field, field); assert.equal(error.failure.measured, 0); assert.equal(error.failure.limit.exactly, 1);
  }
});

test('both run 11 drafts pass without a scene cap and keep every raw word', () => {
  for (const [n, count] of [[1, 67], [2, 69]]) {
    const raw = readJSON(new URL(`./fixtures/run11-story-${n}.json`, import.meta.url));
    const privacy = privacyFor(family, sentences[0]);
    const cleaned = scrubWriterImageText(raw, privacy).text;
    assert.equal(words(raw.panelLines[0].scene).length, count);
    assert.doesNotThrow(() => validateStory(cleaned, { privacy, nickname: family.hero.nickname, parentLabel: family.parentLabel }));
    assert.equal(cleaned.story, raw.story);
  }
  assert.match(STORY_RULES, /Four panelLines objects contain scene, line and speakerId/);
  const candidate = fixture(); candidate.panelLines[0].scene = long(90);
  assert.doesNotThrow(() => validateStory(candidate));
});

test('a scene with 91 words is accepted without a paid correction and its raw answer is saved', async t => {
  const directory = temp(t), original = fixture(); original.story = original.story.replace(/\bDad\b/g, family.parentLabel);
  original.panelLines[0].scene = long(91);
  const transport = offlineTransport(t, directory, () => textAnswer(original));
  const result = await writeStory(withKitEvidence(transport, directory), family, sentences[0]);
  for (const key of kitTextKeys) assert.deepEqual(result[key], original[key]);
  assert.deepEqual(transport.calls.map(request => request.stage), ['story']);
  assert.deepEqual(readJSON(join(directory, 'story-attempt-1.json')), original);
  assert.deepEqual(readJSON(join(directory, 'kit-text-final.json')), result);
  assert.equal(statSync(join(directory, 'story-attempt-1.reason.txt')).mode & 0o777, 0o600);
});

test('nested correction paths preserve siblings and refuse whole containers, extra keys and story edits', () => {
  const previous = fixture();
  const replacements = { 'panelLines[0].scene': 'A new scene.', 'panelLines[2].line': 'Can we talk?', 'tinyTryOptions[1].seconds': 60, 'tinyTryOptions[0].offScreen': false, 'feelFirst[1]': 'That felt hard.', 'whereElse.place': 'In the yard.' };
  for (const [field, value] of Object.entries(replacements)) {
    const result = applyFieldCorrection(previous, { story: previous.story, [field]: value }, [field]);
    assert.deepEqual(fieldValue(result, field), value);
    assert.deepEqual(applyFieldCorrection(result, { story: previous.story, [field]: fieldValue(previous, field) }, [field]), previous);
    assert.equal(applyFieldCorrection(previous, { story: previous.story, [field]: value, jokeIdea: 'Changed' }, [field]).jokeIdea, previous.jokeIdea);
    assert.throws(() => applyFieldCorrection(previous, { story: previous.story + ' Change.', [field]: value }, [field]), /changed_story/);
  }
  assert.throws(() => applyFieldCorrection(previous, { story: previous.story, panelLines: previous.panelLines }, ['panelLines[0].scene']), /locked_fields/);
  assert.throws(() => applyFieldCorrection(previous, { story: previous.story, 'panelLines[20].scene': 'bad' }, ['panelLines[20].scene']), /no existing parent/);
});

test('a panel-count finding preserves the chapter and costs no correction', async t => {
  const directory = temp(t), original = fixture(); original.story = original.story.replace(/\bDad\b/g, family.parentLabel);
  original.panelLines = original.panelLines.slice(0, 3);
  const transport = offlineTransport(t, directory, () => textAnswer(original));
  const result = await writeStory(withKitEvidence(transport, directory), family, sentences[0]);
  for (const field of kitTextKeys) assert.deepEqual(result[field], original[field]);
  assert.deepEqual(transport.calls.map(request => request.stage), ['story']);
  assert.ok(result.reviewFlags.some(row => row.key === 'need_four_short_panel_lines'));
});

test('image-bound literal correction keys are scrubbed before validation', () => {
  const patch = { story: 'Pip stays private here.', 'panelLines[1].scene': 'Pip sits beside Dee.', 'panelLines[2]': { scene: 'Pip stands.', line: 'Pip waits.' } };
  const scrubbed = scrubWriterImageText(patch, privacyFor(family, sentences[0]));
  assert.equal(scrubbed.text['panelLines[1].scene'], 'The hero sits beside a grown-up.');
  assert.equal(scrubbed.text['panelLines[2]'].scene, 'The hero stands.');
  assert.equal(scrubbed.text.story, patch.story);
});

test('short chapters remain accepted with their count and raw answer retained', async t => {
  const directory = temp(t), original = kitText(moves[0], { wordCount: 499 });
  const transport = offlineTransport(t, directory, () => textAnswer(original));
  const result = await writeStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.story, original.story);
  assert.equal(result.guidance.find(row => row.field === 'story').measured, 499);
  assert.equal(transport.calls.length, 1);
  assert.ok(existsSync(join(directory, 'story-attempt-1.json')));
  assert.equal(existsSync(join(directory, 'story-attempt-2.json')), false);
});

test('selected models are swapped with high effort, model-safe output options and each model price in the log', async t => {
  const directory = temp(t), catalog = readJSON(new URL('../content/prices.json', import.meta.url));
  const writer = buildStoryRequest(family, sentences[0]), judge = buildStoryCheckRequest(fixture(), moves[0]);
  assert.deepEqual(textModels(), { story: 'gpt-6.1-sol', storyCheck: 'gpt-6-astra' });
  for (const [body, role] of [[writer, 'story'], [judge, 'storyCheck']]) {
    assert.equal(body.model, catalog.selected[role]); assert.deepEqual(body.reasoning, { effort: 'medium' });
    assert.equal(body.max_output_tokens, role === 'story' ? 24000 : 8192); assert.equal(body.store, false); assert.equal(body.text.format.type, 'json_schema'); assert.equal(body.text.format.strict, true);
  }
  const sameModel = structuredClone(catalog); sameModel.selected.storyCheck = sameModel.selected.story;
  assert.throws(() => textModels(sameModel), /two different models/);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ ...textAnswer({ test: true }), usage: { input_tokens: 1000, output_tokens: 500 } })));
  const logFile = join(directory, 'requests.jsonl'), transport = createTransport({ keys: { openai: 'offline-key' }, logFile });
  for (const [body, stage] of [[writer, 'story'], [judge, 'story-check']]) await transport.call({ provider: 'openai', path: '/v1/responses', stage, familyRecord: { real: false }, body });
  const receipts = readLog(logFile).filter(row => row.event === 'response');
  for (const row of receipts) assert.equal(row.cost.usd, (1000 * catalog.models[row.model].input + 500 * catalog.models[row.model].output) / 1e6);
  assert.notEqual(receipts[0].cost.usd, receipts[1].cost.usd);
});
