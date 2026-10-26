import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJSON, moves } from '../server/files.js';
import { parseStoryCheck, checkStory } from '../server/check-story.js';
import { parsePictureCheck } from '../server/check-picture.js';
import { parseWordCheck } from '../server/check-words.js';
import { validateGeometryReceipt } from '../server/poster-template.js';
import { validateStory, writeStory, readyStory, correctionPlan, kitTextKeys } from '../server/story.js';
import { buildStoryRequest, buildStoryCheckRequest } from '../server/requests.js';
import { withKitEvidence } from '../server/kit-evidence.js';
import { createTransport, readLog } from '../server/transport.js';
import { callStructured } from '../server/structured-call.js';
import { readyFrame, checkedFrame } from '../server/frames.js';
import { posterBoxes } from '../server/format.js';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { selectedRhymeFor } from '../server/rhyme.js';
import { inspectAnswer } from '../server/answer-shape.js';
import { pictureParserSchema, geometryParserSchema, judgeParserSchema } from '../server/answer-schemas.js';
import { storyCheckKeys } from '../server/checker-contract.js';
import { storyCheckAnswer, pictureCheckAnswer, wordCheckAnswer, geometryAnswer } from './checker-fixture.mjs';
import { offlineTransport, offlineExports, textAnswer, openaiAnswer, run5 } from './offline-kit-fixture.mjs';
import { family, sentences } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';

const temp = t => { const directory = mkdtempSync(join(tmpdir(), 'pass21-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; };
const original = readJSON(new URL('./fixtures/run13-story.json', import.meta.url));
const originalWithSpeakers = { ...original, panelLines: original.panelLines.map(panel => ({ ...panel, speakerId: 'child' })) };
const move = moves.find(move => move.id === original.moveId);
const run13 = [1, 2].map(number => readJSON(new URL(`./fixtures/run13-story-check-${number}.json`, import.meta.url)));
const fixture = () => { const value = kitText(); value.story = value.story.replace(/\bDad\b/g, family.parentLabel); return value; };
const usage = { input_tokens: 1000, output_tokens: 300, output_tokens_details: { reasoning_tokens: 100 } };

for (const [index, saved] of run13.entries()) test(`run 13 judge answer ${index + 1} parses extras and saves its tagline concern for Sunny`, () => {
  const check = parseStoryCheck(JSON.stringify(saved.answer), { story: original, move });
  assert.equal(check.needsRecheck, false, check.faults.join('; '));
  assert.deepEqual(check.faults, []); assert.equal(check.ready, true);
  assert.equal(check.evidence.wordAChildMustTranslate, 'say what is real');
  assert.deepEqual(check.reviewFlags[0].fields, ['tagline']);
  assert.deepEqual(correctionPlan(check), { fields: [], rewrite: false });
  assert.ok(check.extraKeys.includes('visibleWordCount'));
  assert.ok(!check.extraKeys.includes('affectedFields')); assert.ok(check.extraKeys.includes('rhymeComparison'));
  assert.deepEqual(check.answers, saved.answer, 'Keep every word of the model answer');
});

test('a synthetic current replay keeps the historical fiction introduction and its prose note', async t => {
  const directory = temp(t), transport = offlineTransport(t, directory, request => request.stage === 'story' ? textAnswer({ ...originalWithSpeakers, tagline: selectedRhymeFor(move).tagline }) : undefined);
  const result = await readyStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.story, originalWithSpeakers.story); assert.ok(result.reviewFlags.some(flag => flag.key === 'fictionInNarration'));
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-check']);
  assert.match(readFileSync(join(directory, 'story-attempt-1.json'), 'utf8'), /made up fox/);
});

test('story, picture, word, geometry and frame parsing ignore extras at every object level', async t => {
  const story = storyCheckAnswer(); story.extra = 'helpful'; story.evidence.extra = 'explanation'; story.affectedFields.extra = ['story'];
  const checked = parseStoryCheck(JSON.stringify(story));
  assert.equal(checked.ready, true); assert.deepEqual(checked.extraKeys.sort(), ['affectedFields.extra', 'evidence.extra', 'extra']);
  const picture = pictureCheckAnswer(); picture.qualityScore = 99; picture.evidence.note = 'helpful';
  assert.equal(parsePictureCheck(JSON.stringify(picture)).ready, true);
  const geometry = geometryAnswer(); geometry.note = 'helpful'; geometry.observed[0].confidence = .99; geometry.textLines[0].font = 'rounded'; geometry.evidence.note = 'helpful';
  const measured = validateGeometryReceipt(geometry);
  assert.equal(measured.ready, true); assert.ok(measured.extraKeys.includes('geometry.observed[0].confidence'));
  const boxes = posterBoxes(moves[0], run5), word = wordCheckAnswer(boxes); word.summary = 'nice'; word.boxes[0].confidence = .99; word.geometry = geometry;
  const readback = parseWordCheck(JSON.stringify(word), boxes);
  assert.equal(readback.ready, true); assert.ok(readback.extraKeys.includes('boxes[0].confidence')); assert.ok(readback.extraKeys.includes('geometry.textLines[0].font'));
  const directory = temp(t), transport = offlineTransport(t, directory, request => request.stage === 'frame-check' ? openaiAnswer(picture) : undefined);
  const frame = await readyFrame(withKitEvidence(transport, directory), family, sentences[0], { directory: join(directory, 'frame') });
  assert.equal(frame.ready, true); assert.ok(frame.check.extraKeys.includes('qualityScore'));
  assert.equal(checkedFrame(join(directory, 'frame')).ready, true);
});

test('all required checker keys fail by name when missing or wrongly typed, despite extra keys', () => {
  const examples = [
    [storyCheckAnswer(), judgeParserSchema, value => parseStoryCheck(JSON.stringify(value))],
    [pictureCheckAnswer(), pictureParserSchema, value => parsePictureCheck(JSON.stringify(value))],
    [geometryAnswer(), geometryParserSchema, validateGeometryReceipt],
  ];
  for (const [answer, schema, parse] of examples) for (const key of schema.required) {
    for (const mode of ['missing', 'wrong type']) {
      const bad = structuredClone(answer); bad.helpfulSummary = 'Extras are allowed';
      if (mode === 'missing') delete bad[key]; else bad[key] = schema.properties[key].type === 'string' ? 42 : 'wrong';
      const check = parse(bad);
      assert.equal(check.ready, false, key); assert.equal(check.needsRecheck, true, key);
      assert.ok([...check.faults, ...(check.measurementFaults ?? [])].join(' ').includes(key), key);
    }
  }
  const word = wordCheckAnswer([{ id: 'bubble', text: 'Name it.' }]); word.boxes[0].text = 42;
  assert.match(parseWordCheck(JSON.stringify(word), [{ id: 'bubble', text: 'Name it.' }]).faults.join(' '), /boxes\[0\]\.text/);
  const evidence = storyCheckAnswer(); evidence.evidence.wordAChildMustTranslate = false;
  assert.match(parseStoryCheck(JSON.stringify(evidence)).faults.join(' '), /evidence.wordAChildMustTranslate/);
});

test('extra transcription data and actual bad words remain faults, even when object extras are ignored', () => {
  const boxes = [{ id: 'bubble', text: 'Name it.' }], answer = wordCheckAnswer(boxes);
  answer.annotation = 'helpful'; answer.boxes.push({ id: 'sign', text: 'Unapproved words', annotation: 'helpful' });
  const check = parseWordCheck(JSON.stringify(answer), boxes);
  assert.equal(check.ready, true); assert.ok(check.extraKeys.includes('annotation'));
  assert.match(check.reviewFlags.map(row => row.evidence).join(' '), /extra=.*unapproved/);
});

test('writer extras are saved but never used, including nested fields and invented ready flags', async t => {
  const directory = temp(t), value = fixture(); value.ready = true; value.summary = 'helpful'; value.panelLines[0].comment = 'helpful'; value.tinyTryOptions[0].score = 10;
  const direct = validateStory(value);
  assert.ok(direct.extraKeys.includes('ready')); assert.ok(direct.extraKeys.includes('panelLines[0].comment'));
  const transport = offlineTransport(t, directory, () => textAnswer(value));
  const result = await writeStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.ready, undefined); assert.equal(result.panelLines[0].comment, undefined); assert.equal(result.tinyTryOptions[0].score, undefined);
  assert.deepEqual(readJSON(join(directory, 'story-attempt-1.json')), value);
  const path = join(directory, 'story-attempt-1.verdict.json'); assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readJSON(path).extraKeys, direct.extraKeys);
  assert.match(readFileSync(join(directory, 'kit-log.md'), 'utf8'), /ignored extra keys/);
});

test('a correction ignores unrequested extras while still requiring the requested field and locked story', async t => {
  const directory = temp(t), original = fixture(); original.noticedFeeling = false;
  const transport = offlineTransport(t, directory, request => request.stage === 'story' ? textAnswer(original) : textAnswer({ story: original.story, noticedFeeling: 'sad', jokeIdea: 'An unrequested edit.', note: 'helpful' }));
  const result = await writeStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.noticedFeeling, 'sad'); assert.equal(result.jokeIdea, original.jokeIdea);
  assert.deepEqual(readJSON(join(directory, 'story-attempt-2.verdict.json')).extraKeys, ['jokeIdea', 'note']);
});

test('missing writer fields still produce all named failures rather than being filled from extras', () => {
  const value = fixture(); delete value.jokeIdea; value.joke = 'Wrong key'; value.panelLines[0].line = false;
  assert.throws(() => validateStory(value), error => error.failures.some(fault => fault.field === 'jokeIdea') && error.failures.some(fault => fault.field === 'panelLines[0].line'));
});

test('writer, nested patch and judge schemas require every declared key and forbid undeclared output', () => {
  const bodies = [buildStoryRequest(family, sentences[0]), buildStoryRequest(family, sentences[0], { reason: 'Repair only these fields.', correctionFields: ['panelLines[0].scene', 'tinyTryOptions[1].seconds'] }), buildStoryCheckRequest(fixture(), moves[0])];
  const walk = schema => {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(new Set(schema.required), new Set(Object.keys(schema.properties)));
      Object.values(schema.properties).forEach(walk);
    }
    if (schema.items) walk(schema.items);
  };
  for (const body of bodies) { assert.equal(body.text.format.type, 'json_schema'); assert.equal(body.text.format.strict, true); walk(body.text.format.schema); }
  assert.deepEqual(bodies[0].text.format.schema.required, kitTextKeys);
  assert.deepEqual(bodies[1].text.format.schema.required, ['story', 'panelLines[0].scene', 'tinyTryOptions[1].seconds']);
  assert.equal(bodies[1].text.format.schema.properties['tinyTryOptions[1].seconds'].type, 'number');
  for (const key of storyCheckKeys) assert.ok(bodies[2].text.format.schema.properties.evidence.required.includes(key));
  const fresh = fixture();
  for (const panel of fresh.panelLines) panel.speakerId = 'child';
  assert.ok(inspectAnswer(fresh, bodies[0].text.format.schema).issues.length === 0);
  const legacy = fixture(); for (const panel of legacy.panelLines) delete panel.speakerId;
  assert.ok(inspectAnswer(legacy, bodies[0].text.format.schema).issues.some(issue => issue.includes('speakerId')));
});

test('judge uses medium and 8192 tokens, high only for a broken-answer recheck of the same text', async t => {
  const directory = temp(t), value = fixture();
  const transport = offlineTransport(t, directory, request => textAnswer(request.retry === 0 ? { ...storyCheckAnswer(value.tagline), secondMoveTaught: 'no' } : storyCheckAnswer(value.tagline)));
  const check = await checkStory(withKitEvidence(transport, directory), value, moves[0], { record: family });
  assert.equal(check.ready, true); assert.deepEqual(transport.calls.map(call => call.body.reasoning.effort), ['medium', 'high']);
  assert.ok(transport.calls.every(call => call.body.max_output_tokens === 8192));
  assert.equal(check.verified, true); assert.equal(check.checkerAttempt, 2);
  assert.ok(run13.every(saved => saved.response.usage.output_tokens < 8192), 'The limit includes reasoning and fits both saved run 13 answers');
});

function fakeWire(t, directory, responses, maxCalls = 24) {
  const calls = [], logFile = join(directory, 'requests.jsonl');
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    calls.push(JSON.parse(options.body)); const reply = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  });
  const transport = withKitEvidence(createTransport({ keys: { openai: 'offline-key' }, logFile, maxCalls }), directory);
  return { calls, transport, logFile };
}
const schemaError = { status: 400, body: { error: { type: 'invalid_request_error', code: 'invalid_json_schema', param: 'text.format.schema', message: 'Unsupported schema for text.format.' } } };

for (const role of ['story', 'story-check']) test(`${role} schema rejection falls back once, keeps evidence, logs reasoning tokens and still parses types`, async t => {
  const directory = temp(t), value = fixture(), answer = role === 'story' ? value : { ...storyCheckAnswer(value.tagline), helpful: 'extra' };
  const wire = fakeWire(t, directory, [schemaError, { body: { ...textAnswer(answer), usage } }]);
  if (role === 'story') assert.equal((await writeStory(wire.transport, family, sentences[0])).story, value.story);
  else assert.equal((await checkStory(wire.transport, value, moves[0], { record: family })).ready, true);
  assert.deepEqual(wire.calls.map(body => body.text.format.type), ['json_schema', 'json_object']);
  assert.ok(wire.calls.every(body => body.store === false && body.reasoning.effort === 'medium'));
  const receipts = readLog(wire.logFile).filter(row => row.event === 'response');
  assert.equal(receipts[0].schemaRejected, true); assert.equal(receipts[0].cost.usd, 0);
  assert.equal(receipts[1].schemaFallback, true); assert.equal(receipts[1].reasoningTokens, 100);
  const ledger = readJSON(join(directory, 'kit-log.json')).filter(row => row.stage === role);
  assert.deepEqual(ledger.map(row => row.reasoningTokens), [0, 100]);
  assert.equal(readJSON(join(directory, 'structured-output-fallback-1.json')).fallback, 'json_object');
});

test('the same rejected schema is remembered, but a different schema still uses strict output', async t => {
  const directory = temp(t), wire = fakeWire(t, directory, [schemaError, { body: { ...textAnswer(fixture()), usage } }]);
  const request = { provider: 'openai', path: '/v1/responses', stage: 'story', familyRecord: { real: false }, body: buildStoryRequest(family, sentences[0]) };
  await callStructured(wire.transport, request); await callStructured(wire.transport, request);
  await callStructured(wire.transport, { ...request, stage: 'story-correction', body: buildStoryRequest(family, sentences[0], { correctionFields: ['jokeIdea'] }) });
  assert.deepEqual(wire.calls.map(body => body.text.format.type), ['json_schema', 'json_object', 'json_object', 'json_schema']);
});

test('unrelated API errors never disable the schema and fallback never exceeds the call cap', async t => {
  const directory = temp(t), wire = fakeWire(t, directory, [{ status: 400, body: { error: { type: 'invalid_request_error', message: 'Bad input data.' } } }]);
  const request = { provider: 'openai', path: '/v1/responses', stage: 'story', familyRecord: { real: false }, body: buildStoryRequest(family, sentences[0]) };
  await assert.rejects(callStructured(wire.transport, request), /HTTP 400/); assert.equal(wire.calls.length, 1);
  const capped = fakeWire(t, join(directory, 'capped'), [schemaError], 1);
  await assert.rejects(callStructured(capped.transport, request), /call limit/); assert.equal(capped.calls.length, 1);
});

test('the rejected run 13 narration stops a new kit before any picture call', async t => {
  const directory = temp(t), memory = createMemory(join(directory, 'family.json')); memory.store(family);
  const transport = offlineTransport(t, directory, request => ['story', 'story-rewrite'].includes(request.stage) ? textAnswer({ ...originalWithSpeakers, tagline: selectedRhymeFor(move).tagline }) : undefined);
  const result = await createKit(transport, memory, sentences[0], { directory, stopBeforePictures: true, exports: offlineExports() });
  assert.equal(result.stoppedBeforePictures, true); assert.equal(result.story, originalWithSpeakers.story);
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-check']);
});
