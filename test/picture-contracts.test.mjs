import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { family } from './fixture.mjs';
import { moves } from '../server/files.js';
import { publicCast, lockedCast, assessCastObservations } from '../server/cast.js';
import { panelWithSpeaker, pictureCast } from '../server/panel-contract.js';
import { buildPanelRequest, buildWordCheckRequest, buildCastCheckRequest, buildPortraitRequest, assertNoFamilyText, privacyFor } from '../server/requests.js';
import { writerSchema, writerRequestSchema } from '../server/answer-schemas.js';
import { inspectAnswer } from '../server/answer-shape.js';
import { parseWordCheck, checkWords } from '../server/check-words.js';
import { parseCastCheck } from '../server/check-cast.js';
import { readyDrawnPage, readyKitArt, readyCastReferences, imageHash, castReferences } from '../server/picture.js';
import { posterBoxes } from '../server/format.js';
import { castObservation, wordCheckAnswer, pictureCheckAnswer } from './checker-fixture.mjs';
import { openaiAnswer } from './offline-kit-fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';

const move = moves[0], fixture = new URL('./fixtures/offline-art.png', import.meta.url).pathname;
function recordWithPeople() {
  const record = structuredClone(family);
  record.cast = lockedCast(record);
  record.cast.push({ ...structuredClone(record.cast[1]), id: 'grown-up-two', description: ['human adult', 'curly hair'], outfit: ['red sweater'] });
  record.storyPeople = [{ castId: 'grown-up-one', storyName: 'Papa' }, { castId: 'grown-up-two', storyName: 'Dad' }];
  return record;
}
const panel = { scene: 'The child sits beside grown-up-one and grown-up-two.', line: 'We can listen before deciding anything.', speakerId: 'grown-up-two' };
const payload = body => JSON.parse(body.input[0].content[0].text);
const directoryFor = t => { const directory = mkdtempSync(join(tmpdir(), 'picture-contract-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; };

test('fresh writer schema requires speaker ids while historical parser and rewrite requests remain compatible', () => {
  const text = kitText(move);
  for (const panel of text.panelLines) delete panel.speakerId;
  assert.equal(inspectAnswer(text, writerSchema()).issues.length, 0);
  assert.ok(inspectAnswer(text, writerRequestSchema()).issues.some(issue => issue.includes('speakerId')));
  for (const item of text.panelLines) item.speakerId = 'child';
  assert.equal(inspectAnswer(text, writerRequestSchema()).issues.length, 0);
  assert.equal(writerRequestSchema(undefined, { speakers: false }).properties.panelLines.items.properties.speakerId, undefined);
});

test('legacy attribution uses explicit spoken tags and never guesses from a nearby name or ambiguous repetition', () => {
  const record = recordWithPeople(), { speakerId, ...old } = panel;
  for (const story of ['Dad said, “We can listen before deciding anything.”', '“We can listen before deciding anything,” Dad said.', '“We can listen before deciding anything,” said Dad.']) assert.equal(panelWithSpeaker(record, old, story).speakerId, 'grown-up-two');
  assert.equal(panelWithSpeaker(record, old, 'Dad sits down. “We can listen before deciding anything.”').speakerId, undefined);
  assert.equal(panelWithSpeaker(record, old, 'Dad said, “We can listen before deciding anything.” Papa said, “We can listen before deciding anything.”').speakerId, undefined);
  assert.throws(() => panelWithSpeaker(record, { ...panel, speakerId: 'child' }, 'Dad said, “We can listen before deciding anything.”'), /contradicts the explicit story attribution/);
});

test('drawing, word check and continuity share exact visible cast and count with two parents', () => {
  const record = recordWithPeople();
  const request = buildPanelRequest(record, move, '', panel);
  assert.match(request.prompt, /bubble is spoken by grown-up-two/);
  assert.match(request.prompt, /tail must clearly end at this person's mouth/);
  assert.doesNotMatch(request.prompt, /Papa|Dad|Pip/);
  const data = payload(buildWordCheckRequest(record, move, '', 'data:image/png;base64,AA==', { panel }));
  assert.equal(data.expectedPeopleCount, 3);
  assert.equal(data.expectedSpeakerId, 'grown-up-two');
  assert.equal(data.expectedVisibleCast.length, 3);
  const otherParentOnly = { ...panel, scene: 'The child sits beside grown-up-two.' };
  assert.deepEqual(pictureCast(record, move, otherParentOnly).map(person => person.id), ['child', 'grown-up-two']);
  const pictures = [{ id: 'poster', data: 'data:image/png;base64,AA==', expectedVisibleCast: pictureCast(record, move) }];
  assert.equal(payload(buildCastCheckRequest(record, move, '', pictures, [])).images[0].expectedPeopleCount, move.expectedPeopleCount);
  record.parentLabel = 'Papa and Dad';
  assert.doesNotThrow(() => buildPanelRequest(record, move, '', panel));
  assert.throws(() => buildPanelRequest(record, move, '', { ...panel, scene: 'Papa sits beside the child.' }), /contains/);
});

test('an evidenced wrong bubble speaker receives one targeted repair', async t => {
  const record = recordWithPeople(), directory = directoryFor(t);
  record.hero.heroPicturePath = fixture;
  for (const person of record.cast) person.referencePath = fixture;
  const text = { ...kitText(move), panelLines: [panel] }, calls = [];
  let checks = 0;
  const transport = { recordRejection() {}, recordVerdict() {}, async call(request) {
    calls.push(request);
    if (request.path.startsWith('/v1/images/')) return { data: [{ b64_json: Buffer.concat([readFileSync(fixture), Buffer.from(String(calls.length))]).toString('base64') }] };
    return openaiAnswer({ ...wordCheckAnswer([{ id: 'bubble', text: panel.line }]), castObservations: publicCast(record).map(castObservation),
      bubbleSpeaker: { characterId: ++checks === 1 ? 'child' : 'grown-up-two', certainty: 'confirmed', evidence: checks === 1 ? 'The tail ends at the child mouth on the left.' : 'The tail ends at the second grown-up mouth on the right.' } });
  } };
  const art = await readyDrawnPage(transport, record, move, '', text, { directory, panelIndex: 0 });
  assert.equal(art.checks.length, 2);
  assert.ok(art.checks[0].faults.some(flag => flag.startsWith('confirmed_bubble_speaker_mismatch')));
  const drawings = calls.filter(request => request.path.startsWith('/v1/images/'));
  assert.equal(drawings.length, 2);
  assert.equal(imageHash(art.path), art.hash);
  assert.equal(calls.every(request => request.stage.startsWith('panel-1')), true);
});

test('old receipts without tail observations recheck the same image and retain confirmed contradictions', async () => {
  const record = recordWithPeople(), boxes = [{ id: 'bubble', text: panel.line }];
  const legacy = wordCheckAnswer(boxes); delete legacy.bubbleSpeaker;
  assert.equal(parseWordCheck(JSON.stringify(legacy), boxes, { expectedSpeakerId: panel.speakerId }).needsRecheck, true);
  const calls = [];
  const transport = { recordRejection() {}, recordVerdict() {}, async call(request) {
    calls.push(request);
    return openaiAnswer({ ...legacy, castObservations: payload(request.body).expectedVisibleCast.map(castObservation), bubbleSpeaker: { characterId: 'child', certainty: 'confirmed', evidence: 'The drawn tail touches the child mouth.' } });
  } };
  const check = await checkWords(transport, record, move, '', 'data:image/png;base64,AA==', boxes, { panel });
  assert.equal(check.ready, false);
  assert.ok(check.faults.some(flag => flag.startsWith('confirmed_bubble_speaker_mismatch')));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/v1/responses');
});

test('older saved panels keep their original bytes without buying a schema approval', async t => {
  const record = recordWithPeople(), text = kitText(move), directory = directoryFor(t), calls = [];
  record.hero.heroPicturePath = fixture;
  for (const person of record.cast) { person.referencePath = fixture; person.referenceHash = imageHash(fixture); }
  for (const panel of text.panelLines) panel.speakerId = 'child';
  const hashes = castReferences(record).map(({ characterId, hash }) => ({ characterId, hash }));
  const oldAnswer = boxes => { const answer = { ...wordCheckAnswer(boxes), castObservations: pictureCast(record, move).map(castObservation) }; delete answer.bubbleSpeaker; return answer; };
  const savedImage = boxes => ({ ready: true, path: fixture, hash: imageHash(fixture), referenceHash: imageHash(fixture), castReferenceHashes: hashes,
    checks: [{ ready: true, checkerAttempt: 2, answers: oldAnswer(boxes) }] });
  const saved = { poster: savedImage(posterBoxes(move, text)), ...Object.fromEntries(text.panelLines.map((panel, index) => [`panel-${index + 1}`, savedImage([{ id: 'bubble', text: panel.line }])])) };
  const transport = { recordRejection() {}, recordVerdict() {}, async call(request) {
    calls.push(request);
    assert.equal(request.path, '/v1/responses');
    if (request.stage === 'cast-continuity-check') return openaiAnswer({ pictures: payload(request.body).images.filter(image => image.kind === 'kit-picture').map(image => ({ id: image.id, castObservations: image.expectedVisibleCast.map(castObservation) })) });
    const index = Number(request.stage.match(/^panel-(\d)/)?.[1]) - 1;
    const data = payload(request.body);
    assert.ok(index >= 0);
    return openaiAnswer({ ...wordCheckAnswer([{ id: 'bubble', text: text.panelLines[index].line }]), castObservations: data.expectedVisibleCast.map(castObservation),
      bubbleSpeaker: { characterId: 'child', certainty: 'confirmed', evidence: 'The tail touches the visible child mouth.' } });
  } };
  const art = await readyKitArt(transport, record, move, '', text, { directory, saved });
  assert.equal(art.ready, true);
  assert.deepEqual(calls, []);
  for (const panel of art.panels) assert.equal(panel.path, fixture);
});

test('absent second parent in a planned two-person poster is allowed, actual missing required and changed identities fail', () => {
  const record = recordWithPeople(), cast = publicCast(record), expected = pictureCast(record, { ...move, expectedPeopleCount: 2 });
  const absent = { ...castObservation(cast[2]), identityMatches: false, identityEvidence: 'No separate curly-haired grown-up-two body is visible.' };
  const answers = { pictures: [{ id: 'poster', castObservations: [...expected.map(castObservation), absent] }] };
  assert.equal(parseCastCheck(JSON.stringify(answers), cast, ['poster'], { poster: expected }).ready, true);
  const missing = { ...castObservation(cast[1]), observedSpecies: 'absent', identityMatches: false, identityEvidence: 'The required first grown-up is absent from the scene.' };
  assert.ok(assessCastObservations([missing], cast, 'poster', expected).faults.some(fault => fault.startsWith('confirmed_missing_character')));
  const wrong = { ...castObservation(cast[1]), identityMatches: false, identityEvidence: 'The visible first grown-up has a new face and curly red hair instead of the reference.' };
  assert.ok(assessCastObservations([wrong], cast, 'poster', expected).faults.some(fault => fault.startsWith('confirmed_identity_mismatch')));
});

test('verified saved hero supplies child reference without buying another drawing', async t => {
  const record = structuredClone(family), directory = directoryFor(t), calls = [];
  record.cast = lockedCast(record); record.hero.heroPicturePath = fixture;
  const heroReference = { ready: true, path: fixture, hash: imageHash(fixture) };
  const transport = { recordRejection() {}, recordVerdict() {}, async call(request) {
    calls.push(request);
    return request.path.startsWith('/v1/images/') ? { data: [{ b64_json: readFileSync(fixture).toString('base64') }] } : openaiAnswer({ ...pictureCheckAnswer(), castObservations: [castObservation(record.cast[1])] });
  } };
  const cast = await readyCastReferences(transport, record, move, '', { directory, heroReference });
  assert.equal(cast[0].referencePath, fixture); assert.equal(cast[0].referenceHash, heroReference.hash);
  assert.equal(calls.filter(request => request.path.startsWith('/v1/images/')).length, 1);
  assert.equal(calls.some(request => request.stage === 'child-reference'), false);
  await assert.rejects(readyCastReferences(transport, record, move, '', { directory, heroReference: { ...heroReference, hash: 'changed' } }), /bytes changed/);
});

test('selected photo identity outranks stale presets but actual reference and clothing contradictions still fail', () => {
  const record = recordWithPeople();
  Object.assign(record.cast[0], { referenceSource: 'photo', portraitCandidateId: 'private-123', uploadedPhotoPath: '/private/family.png', description: ['human boy with short dark hair'] });
  const person = publicCast(record)[0];
  assert.deepEqual(person.description, ['human child']);
  assert.equal(person.portraitCandidateId, undefined);
  assert.equal(person.uploadedPhotoPath, undefined);
  const body = buildPortraitRequest(record, record.cast[0], 'data:image/png;base64,AA==');
  assert.match(body.prompt, /Likeness takes priority/); assert.doesNotMatch(body.prompt, /short dark hair/);
  const stale = castObservation(person);
  stale.appearance = [{ expected: 'human boy with short dark hair', observed: 'long fair hair', visible: true, matches: false, evidence: 'Preset short dark hair differs.' }];
  assert.deepEqual(assessCastObservations([stale], [person]).faults, []);
  Object.assign(stale, { identityMatches: false, identityEvidence: 'The child face and hair visibly differ from the chosen photo reference.' });
  assert.ok(assessCastObservations([stale], [person]).faults.some(fault => fault.startsWith('confirmed_identity_mismatch')));
  stale.identityMatches = true;
  stale.clothing = [{ expected: person.outfit[0], observed: 'purple shirt', visible: true, matches: false, evidence: 'A purple shirt replaces the locked green hoodie.' }];
  assert.ok(assessCastObservations([stale], [person]).faults.some(fault => fault.startsWith('confirmed_cast_clothing_mismatch')));
});

test('individual parent names protect May and Papa while ordinary connectors and fixed record passages stay unchanged', () => {
  const record = recordWithPeople();
  record.storyPeople[0].storyName = 'May';
  record.storyPeople[1].storyName = 'Papa';
  record.parentLabel = 'May and Papa';
  const privacy = privacyFor(record, '', move);
  assert.throws(() => assertNoFamilyText({ prompt: 'May sits beside the child.' }, privacy), /parent label/);
  assert.throws(() => assertNoFamilyText({ prompt: 'Papa sits beside the child.' }, privacy), /parent label/);
  assert.doesNotThrow(() => assertNoFamilyText({ prompt: 'The child may pause and look.' }, privacy));
  const exact = move.practiceScript;
  assert.doesNotThrow(() => assertNoFamilyText({ prompt: exact }, privacy));
  assert.equal(exact, move.practiceScript);
  assert.doesNotThrow(() => buildWordCheckRequest(record, move, '', 'data:image/png;base64,AA=='));
});
