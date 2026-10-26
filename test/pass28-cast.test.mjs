import { pictureStyleReferenceFor } from '../server/graphic-style.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { family } from './fixture.mjs';
import { moves } from '../server/files.js';
import { lockedCast, publicCast, assessCastObservations } from '../server/cast.js';
import { castObservation, pictureCheckAnswer, wordCheckAnswer } from './checker-fixture.mjs';
import { buildPosterRequest, buildPanelRequest, buildCastCheckRequest, buildWordCheckRequest } from '../server/requests.js';
import { readyCastReferences, readyKitArt, imageHash, castReferences } from '../server/picture.js';
import { parseCastCheck } from '../server/check-cast.js';
import { parsePictureCheck } from '../server/check-picture.js';
import { isHardFault } from '../server/stop-policy.js';
import { createMemory } from '../server/memory.js';
import { withKitEvidence } from '../server/kit-evidence.js';
import { posterBoxes } from '../server/format.js';
import { kitText } from './kit-text-fixture.mjs';
import { openaiAnswer } from './offline-kit-fixture.mjs';
import { createTransport } from '../server/transport.js';
import { offlinePrices } from './offline-prices.mjs';
import { auditCastContinuity } from '../server/audit.js';

const move = moves[0], text = kitText(move);
const fixtureImage = new URL('./fixtures/offline-art.png', import.meta.url).pathname;
const directoryFor = t => { const directory = mkdtempSync(join(tmpdir(), 'pass28-cast-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; };
const readyRecord = () => { const record = structuredClone(family); record.cast = lockedCast(record).map(person => ({ ...person, referencePath: fixtureImage, referenceHash: imageHash(fixtureImage) })); record.hero.heroPicturePath = fixtureImage; return record; };
function transportFor(record, { failCross = 0 } = {}) {
  const calls = [], png = readFileSync(fixtureImage); let cross = 0, image = 0;
  return { calls, recordRejection() {}, recordVerdict() {}, async call(request) {
    calls.push(request);
    if (request.path.startsWith('/v1/images/')) return { data: [{ b64_json: Buffer.concat([png, Buffer.from(`CAST FIXTURE ${++image}`)]).toString('base64') }] };
    if (request.stage.endsWith('-reference-check')) {
      const data = JSON.parse(request.body.input[0].content[0].text);
      return openaiAnswer({ ...pictureCheckAnswer(), castObservations: data.cast.map(castObservation) });
    }
    if (request.stage.endsWith('-word-check')) {
      const index = Number(request.stage.match(/^panel-(\d)/)?.[1]);
      const boxes = index ? [{ id: 'bubble', text: text.panelLines[index - 1].line }] : posterBoxes(move, text);
      const data = JSON.parse(request.body.input[0].content[0].text);
      return openaiAnswer({ ...wordCheckAnswer(boxes), castObservations: data.expectedVisibleCast.map(castObservation) });
    }
    assert.equal(request.stage, 'cast-continuity-check');
    const pictures = ['poster', 'panel-1', 'panel-2', 'panel-3', 'panel-4'].map(id => ({ id, castObservations: publicCast(record).map(castObservation) }));
    if (cross++ < failCross) Object.assign(pictures[3].castObservations[1], { observedSpecies: 'fox', identityMatches: false, identityEvidence: 'The human grown-up has a fox muzzle, orange fur and a tail in panel three.' });
    return openaiAnswer({ pictures });
  } };
}

test('all recurring humans have separate locked named references, reused once per family', async t => {
  const directory = directoryFor(t), record = structuredClone(family), transport = transportFor(record);
  const cast = await readyCastReferences(transport, record, move, '', { directory });
  assert.deepEqual(cast.map(person => [person.id, person.species]), [['child', 'human'], ['grown-up-one', 'human']]);
  assert.equal(transport.calls.filter(request => request.path.startsWith('/v1/images/')).length, 2);
  const memory = createMemory(join(directory, 'family.json')); memory.store(record); memory.setCast(cast);
  const saved = memory.exportRecord();
  await readyCastReferences(transport, saved, move, '', { directory });
  assert.equal(transport.calls.filter(request => request.path.startsWith('/v1/images/')).length, 2);
  assert.equal(saved.hero.heroPicturePath, cast[0].referencePath);
  const referenceImages = castReferences(saved);
  const requests = [buildPosterRequest(saved, move, '', text, { referenceImages }), ...text.panelLines.map(panel => buildPanelRequest(saved, move, '', panel, { referenceImages }))];
  for (const [index, request] of requests.entries()) { assert.equal(request.image.length, 2); assert.ok(!request.image.includes(pictureStyleReferenceFor(saved).data)); assert.match(request.prompt, /Reference image 1 is child/); assert.match(request.prompt, /Reference image 2 is grown-up-one/); assert.match(request.prompt, /Every character is human/); assert.doesNotMatch(request.prompt, /Pip|Dee/); }
});

test('multiple grown-ups keep their own roles and only their own references reach the edit upload', async t => {
  const directory = directoryFor(t), record = readyRecord();
  record.cast.push({ ...record.cast[1], id: 'grown-up-two', label: 'the second grown-up', description: ['human adult', 'long dark hair'], outfit: ['red shirt', 'black trousers'] });
  const references = castReferences(record);
  assert.equal(buildPanelRequest(record, move, '', text.panelLines[2], { referenceImages: references }).image.length, 3);
  let uploads;
  t.mock.method(globalThis, 'fetch', async (url, options) => { uploads = options.body.getAll('image[]'); return new Response(JSON.stringify({ data: [{ b64_json: readFileSync(fixtureImage).toString('base64') }], usage: { input_tokens: 0, output_tokens: 0, input_tokens_details: { text_tokens: 0, image_tokens: 0, cached_tokens: 0 } } }), { status: 200 }); });
  const transport = createTransport({ keys: { openai: 'offline-key' }, logFile: join(directory, 'transport.jsonl'), maxCalls: 1, costCatalog: offlinePrices });
  await transport.call({ provider: 'openai', path: '/v1/images/edits', stage: 'panel-3', body: buildPanelRequest(record, move, '', text.panelLines[2], { referenceImages: references }), privacy: { familyContext: record.familyContext, identityContext: record.hero.loves.join('. '), nickname: record.hero.nickname, heroName: record.hero.name, parentLabel: record.parentLabel, tonight: '', moveId: move.id } });
  assert.equal(uploads.length, 3);
  for (const upload of uploads) assert.deepEqual(Buffer.from(await upload.arrayBuffer()), readFileSync(fixtureImage));
  for (const upload of uploads) assert.notDeepEqual(Buffer.from(await upload.arrayBuffer()), readFileSync(pictureStyleReferenceFor(record).file));
});

test('cast identification precedes clothes and a grown-up garment cannot become a child fault', () => {
  const record = readyRecord(), cast = publicCast(record), child = castObservation(cast[0]);
  child.clothing = [{ expected: 'blue sweater', observed: 'green hoodie', visible: true, matches: false, evidence: 'The child hoodie differs from the grown-up sweater.' }];
  const wrongOwner = assessCastObservations([child], cast);
  assert.deepEqual(wrongOwner.faults, []); assert.equal(wrongOwner.reviewFlags[0].key, 'cast_clothing_wrong_owner');
  child.clothing = [{ expected: cast[0].outfit.find(item => /sketchbook/.test(item)), observed: 'The sketchbook rests on the table.', visible: true, matches: false, evidence: 'The sketchbook is on the table instead of under one arm.' }];
  assert.deepEqual(assessCastObservations([child], cast).faults, []);
  const request = buildWordCheckRequest(record, move, '', 'data:image/png;base64,AA==', { panel: text.panelLines[2], referenceImages: castReferences(record) });
  const payload = JSON.parse(request.input[0].content[0].text);
  assert.match(payload.instruction, /Identify each visible character FIRST/);
  assert.equal(payload.cast[1].outfit[0], 'blue sweater'); assert.equal(payload.expectedVisibleCast.length, 2);
});

test('confirmed species and identity differences stay parent notes; uncertainty stays a review flag', () => {
  const cast = publicCast(readyRecord()), row = castObservation(cast[1]);
  Object.assign(row, { observedSpecies: 'fox', identityMatches: false, identityEvidence: 'The grown-up visibly has a fox muzzle and tail.' });
  const confirmed = assessCastObservations([row], cast);
  assert.ok(isHardFault(confirmed.faults[0]));
  const parsed = parsePictureCheck(JSON.stringify({ ...pictureCheckAnswer(), castObservations: [row] }), { cast, generation: true });
  assert.equal(parsed.ready, true);
  assert.ok(parsed.reviewFlags.some(flag => flag.key.startsWith('confirmed_species_mismatch')));
  row.certainty = 'uncertain'; const uncertain = assessCastObservations([row], cast);
  assert.deepEqual(uncertain.faults, []); assert.equal(uncertain.reviewFlags[0].key, 'cast_identity_uncertain');
});

test('the whole-kit check sees five pictures together and rejects omitted picture verdicts', () => {
  const record = readyRecord(), pictures = ['poster', 'panel-1', 'panel-2', 'panel-3', 'panel-4'].map(id => ({ id, data: 'data:image/png;base64,AA==' }));
  const request = buildCastCheckRequest(record, move, '', pictures, castReferences(record));
  assert.equal(request.input[0].content.filter(item => item.type === 'input_image').length, 7);
  assert.match(request.instructions, /ACROSS ALL FIVE/);
  const parsed = parseCastCheck(JSON.stringify({ pictures: [] }), publicCast(record), pictures.map(picture => picture.id));
  assert.equal(parsed.needsRecheck, true);
});

test('kit art cannot bypass the recurring-character references or whole-kit checker', async t => {
  const directory = directoryFor(t), record = structuredClone(family), transport = transportFor(record);
  record.hero.heroPicturePath = fixtureImage;
  await assert.rejects(readyKitArt(transport, record, move, '', text, { directory }), /Every recurring character needs a checked reference/);
  assert.deepEqual(transport.calls, []);
});

test('the final audit requires every saved cast reference and a verified whole-kit verdict', () => {
  const record = readyRecord();
  const expected = record.cast.map(person => ({ characterId: person.id, hash: person.referenceHash }));
  const picture = () => ({ ready: true, castReferenceHashes: structuredClone(expected) });
  const kit = { art: { poster: picture(), panels: Array.from({ length: 4 }, picture), continuityChecks: [{ ready: true, verified: true, answers: { pictures: ['poster', 'panel-1', 'panel-2', 'panel-3', 'panel-4'].map(id => ({ id })) } }] } };
  assert.equal(auditCastContinuity([kit], record), true);
  for (const change of [copy => { copy.art.panels[2].castReferenceHashes.pop(); }, copy => { copy.art.continuityChecks = []; }, copy => { copy.art.continuityChecks[0].ready = false; }, copy => { copy.art.continuityChecks[0].verified = false; }, copy => { copy.art.continuityChecks[0].answers.pictures.pop(); }]) {
    const changed = structuredClone(kit); change(changed); assert.equal(auditCastContinuity([changed], record), false);
  }
  record.cast[1].referenceHash = 'changed'; assert.equal(auditCastContinuity([kit], record), false);
});

test('kit art uses the saved family references without a whole-kit opinion or automatic redraw', async t => {
  const directory = directoryFor(t), record = readyRecord(), base = transportFor(record, { failCross: 1 }), saved = {};
  const art = await readyKitArt(withKitEvidence(base, directory), record, move, '', text, { directory, saveStage(name,value){ saved[name]=value; } });
  assert.equal(art.ready, true); assert.deepEqual(art.continuityChecks, []);
  for (const id of ['poster', 'panel-1', 'panel-2', 'panel-3', 'panel-4']) assert.equal(base.calls.filter(request => request.stage === id).length, 1);
  assert.equal(base.calls.filter(request => request.stage === 'cast-continuity-check').length, 0);
  assert.equal(readdirSync(directory).filter(name => /^panel-3-attempt-.*png$/.test(name)).length, 1);
  assert.equal(readdirSync(directory).filter(name => /^cast-continuity-check-.*json$/.test(name)).length, 0);
  const continuity=saved['cast-continuity']; assert.equal(continuity.reviewStatus,'parent-review'); assert.equal(continuity.verified,false);
  assert.deepEqual(continuity.pictureHashes.map(row=>row.hash), [art.poster.hash,...art.panels.map(panel=>panel.hash)]);
});

test('resume keeps all accepted family drawings and their references without repeating appearance checks', async t => {
  const directory = directoryFor(t), record = readyRecord(), transport = transportFor(record, { failCross: Infinity }), saved = {};
  const art=await readyKitArt(transport, record, move, '', text, { directory, saveStage(name,value){ saved[name]=value; } });
  const count=transport.calls.length, hashes=[art.poster.hash,...art.panels.map(panel=>panel.hash)];
  const resumed=await readyKitArt(transport, record, move, '', text, { directory, saved });
  assert.equal(transport.calls.length,count); assert.deepEqual([resumed.poster.hash,...resumed.panels.map(panel=>panel.hash)],hashes);
  assert.ok(resumed.panels.every(panel=>JSON.stringify(panel.castReferenceHashes)===JSON.stringify(castReferences(record).map(({characterId,hash})=>({characterId,hash})))));
  assert.equal(transport.calls.filter(request => request.stage === 'panel-3').length, 1);
  assert.equal(transport.calls.filter(request => request.stage === 'cast-continuity-check').length, 0);
});
