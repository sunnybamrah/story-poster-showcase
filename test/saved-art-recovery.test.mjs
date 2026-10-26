import { pictureStyleReferenceFor } from '../server/graphic-style.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readyDrawnPage, readyPicture, imageHash, imageData, castReferences, inspectSavedDrawingRecovery } from '../server/picture.js';
import { readJSON, saveJSON, moves } from '../server/files.js';
import { lockedCast } from '../server/cast.js';
import { pictureCast } from '../server/panel-contract.js';
import { buildPosterRequest, buildWordCheckRequest } from '../server/requests.js';
import { posterBoxes } from '../server/format.js';
import { parseWordCheck } from '../server/check-words.js';
import { geometryRuleVersion } from '../server/poster-template.js';
import { wordCheckAnswer, castObservation } from './checker-fixture.mjs';
import { openaiAnswer } from './offline-kit-fixture.mjs';
import { withKitEvidence } from '../server/kit-evidence.js';
import { kitText } from './kit-text-fixture.mjs';
import { family } from './fixture.mjs';

const move = moves[0], selection = { world: 'comic strip', colourSet: 'warm' };
const png = readFileSync(new URL('./fixtures/offline-art.png', import.meta.url));
function fixture(t, { legacy = true, legacyCheck } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'saved-art-recovery-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const record = structuredClone(family); record.real = false; record.cast = lockedCast(record);
  for (const person of record.cast) { person.referencePath = join(directory, `reference-${person.id}.png`); writeFileSync(person.referencePath, png); person.referenceHash = imageHash(person.referencePath); }
  record.hero.heroPicturePath = record.cast[0].referencePath;
  const text = { ...kitText(move), ...selection, ready: true }, boxes = posterBoxes(move, text);
  const good = () => ({ ...wordCheckAnswer(boxes), castObservations: pictureCast(record, move).map(castObservation) });
  const bad = () => { const answer = good(); answer.geometry.writableRows.forEach(row => { row.w = 24; }); return answer; };
  saveJSON(join(directory, 'checkpoint.json'), { recordAtStart: record, stages: { text } });
  if (legacy) {
    const ledger = [], logs = [];
    const references = castReferences(record);
    const redactImages = value => typeof value === 'string' ? value.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[private image input]') : Array.isArray(value) ? value.map(redactImages) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactImages(item)])) : value;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const bytes = Buffer.concat([png, Buffer.from(`SYNTHETIC rejected candidate ${attempt}`)]), path = join(directory, `poster-attempt-${attempt}.png`);
      writeFileSync(path, bytes);
      const drawId = `synthetic-draw-${attempt}`, checkId = `synthetic-check-${attempt}`;
      const body = buildPosterRequest(record, move, '', text, { selection, referenceImages: references, referenceData: imageData(record.hero.heroPicturePath) });
      logs.push({ event: 'request', id: drawId, logicalRequestId: drawId, stage: 'poster', body: redactImages(body) }, { event: 'response', id: drawId, stage: 'poster', body: { data: [{ b64_json: bytes.toString('base64') }] } });
      const checkBody = buildWordCheckRequest(record, move, '', imageData(path), { referenceImages: references, jokeIdea: text.jokeIdea });
      logs.push({ event: 'request', id: checkId, stage: 'poster-word-check', body: redactImages(checkBody) });
      const answer = legacyCheck ? legacyCheck(good()) : bad(), check = parseWordCheck(JSON.stringify(answer), boxes);
      saveJSON(join(directory, `picture-check-poster-${attempt}.json`), { fixture: true, answer, check });
      ledger.push({ stage: 'poster', attempt, requestId: drawId, verdict: 'insufficient_handwriting_space: synthetic old rejection' }, { stage: 'poster-word-check', attempt, requestId: checkId, verdict: 'insufficient_handwriting_space: synthetic old rejection' });
    }
    saveJSON(join(directory, 'kit-log.json'), ledger);
    writeFileSync(join(directory, 'requests.jsonl'), logs.map(row => JSON.stringify({ fixture: true, ...row })).join('\n') + '\n');
  }
  return { directory, record, text, good, bad };
}
function transport(f, { answer = f.good, failDraw, failCheck } = {}) {
  const calls = [];
  return { calls, recordRejection() {}, recordVerdict() {}, recordLocalResult() {}, async call(request) {
    calls.push(request);
    if (request.path.startsWith('/v1/images/')) {
      if (failDraw) return failDraw(request);
      return { data: [{ b64_json: Buffer.concat([png, Buffer.from(`SYNTHETIC new image ${calls.length}`)]).toString('base64') }] };
    }
    if (failCheck) return failCheck(request);
    return openaiAnswer(answer());
  } };
}
const run = (f, wire, options = {}) => readyDrawnPage(wire, f.record, move, '', f.text, { directory: f.directory, selection, ...options });

test('legacy rejected candidates bind exact response bytes, approved words and original references without writes', t => {
  const f = fixture(t), report = inspectSavedDrawingRecovery(f.record, move, f.text, { directory: f.directory, selection });
  assert.equal(report.drawRequestsSpent, 3); assert.equal(report.remainingDraws, 0);
  assert.equal(report.candidates.filter(row => row.eligibleForSameImageCheck).length, 3);
  assert.equal(existsSync(join(f.directory, 'poster-drawing-state.json')), false);
});
test('unchanged saved art resumes for parent review without buying a checker or another drawing', async t => {
  const f = fixture(t), wire = transport(f), original = readFileSync(join(f.directory, 'requests.jsonl'));
  const originalLog = readFileSync(join(f.directory, 'kit-log.json'));
  const rawChecks = [1, 2, 3].map(attempt => readFileSync(join(f.directory, `picture-check-poster-${attempt}.json`)));
  const before = imageHash(join(f.directory, 'poster-attempt-3.png'));
  const result = await run(f, wire);
  assert.equal(result.path, join(f.directory, 'poster-attempt-3.png')); assert.equal(result.hash, before);
  assert.equal(wire.calls.length, 0);
  assert.equal(result.checks.at(-1).reviewStatus, 'parent-review');
  assert.equal(result.checks.at(-1).verified, false);
  assert.equal(result.referenceHash, imageHash(f.record.hero.heroPicturePath));
  assert.deepEqual(result.castReferenceHashes, castReferences(f.record).map(({ characterId, hash }) => ({ characterId, hash })));
  assert.equal(result.pictureStyleId, 'detailed-comic'); assert.ok(result.pictureStyleVersion);
  assert.deepEqual(readFileSync(join(f.directory, 'requests.jsonl')), original);
  assert.deepEqual(readFileSync(join(f.directory, 'kit-log.json')), originalLog);
  for (let attempt = 1; attempt <= 3; attempt++) assert.deepEqual(readFileSync(join(f.directory, `picture-check-poster-${attempt}.json`)), rawChecks[attempt - 1]);
  assert.equal(readJSON(join(f.directory, 'poster-drawing-state.json')).drawRequests, 3);
  assert.equal((await run(f, wire)).hash, before); assert.equal(wire.calls.length, 0);
});
test('historical writing-space rejection stays evidence while parent review keeps all three drawings spent', async t => {
  const f = fixture(t), wire = transport(f, { answer: f.bad });
  const historical = readJSON(join(f.directory, 'picture-check-poster-3.json'));
  assert.equal(historical.check.ready, false);
  assert.ok(historical.check.faults.some(fault => fault.startsWith('insufficient_handwriting_space')));
  const result = await run(f, wire), state = readJSON(join(f.directory, 'poster-drawing-state.json'));
  assert.equal(result.ready, true); assert.equal(wire.calls.length, 0);
  assert.equal(state.drawRequests, 3); assert.equal(state.candidates.length, 3);
  assert.deepEqual(state.candidates.at(-1).checks[0], historical.check);
  assert.ok(result.checks.at(-1).reviewFlags.some(flag => flag.key.startsWith('insufficient_handwriting_space')));
  assert.equal((await run(f, wire)).hash, result.hash); assert.equal(wire.calls.length, 0);
});
test('uncertain saved measurements remain unverified without triggering another model call', async t => {
  const f = fixture(t, { legacyCheck: value => { delete value.geometry.writableRows; return value; } }), wire = transport(f);
  const historical = readJSON(join(f.directory, 'picture-check-poster-3.json'));
  assert.equal(historical.check.ready, false);
  const result = await run(f, wire), check = result.checks.at(-1);
  assert.equal(result.ready, true); assert.equal(check.reviewStatus, 'parent-review'); assert.equal(check.verified, false);
  assert.ok(check.reviewFlags.some(flag => flag.key === 'checker_unverified'));
  assert.equal(readJSON(join(f.directory, 'poster-drawing-state.json')).drawRequests, 3);
  assert.deepEqual(readJSON(join(f.directory, 'picture-check-poster-3.json')), historical);
  await run(f, wire); assert.equal(wire.calls.length, 0);
});
test('saved unfinished and failed approvals never renew their requests during local recovery', async t => {
  const f = fixture(t), wire = transport(f);
  await run(f, wire);
  const path = join(f.directory, 'poster-drawing-state.json'), state = readJSON(path), candidate = state.candidates.at(-1);
  candidate.rechecks = {
    'synthetic-check-interrupted': { status: 'checking', recovering: true, at: '2026-10-15T12:00:00.000Z' },
    'synthetic-check-sent': { status: 'failed', reason: 'Unknown connection failure after send.', recovering: true },
    'synthetic-check-rejected': { status: 'rejected', check: candidate.checks[0] },
  };
  candidate.preflightStops = [{ reason: 'Daily budget reached before a second checker call.', sent: false }];
  saveJSON(path, state);
  const result = await run(f, wire), resumed = readJSON(path);
  assert.equal(result.hash, candidate.hash); assert.equal(wire.calls.length, 0);
  assert.equal(resumed.drawRequests, 3);
  assert.deepEqual(resumed.candidates.at(-1).rechecks, candidate.rechecks);
  assert.deepEqual(resumed.candidates.at(-1).preflightStops, candidate.preflightStops);
});
for (const failure of ['unknown after send', 'proven preflight', 'budget after wire']) test(`an unavailable current word check preserves failure without buying art on Resume: ${failure}`, async t => {
  const f = fixture(t, { legacy: false }), message = failure === 'unknown after send' ? 'Unknown connection failure after send.' : 'Daily budget reached.';
  let checks = 0;
  const wire = withKitEvidence(transport(f, { failCheck: () => {
    if (failure === 'proven preflight' && checks++ > 0) return openaiAnswer(f.good());
    if (failure === 'budget after wire') appendFileSync(join(f.directory, 'requests.jsonl'), JSON.stringify({ event: 'request', stage: 'poster-word-check', logicalRequestId: 'synthetic-partial-review', id: 'wire' }) + '\n');
    throw Object.assign(Error(message), failure === 'proven preflight' ? { preflight: true } : {});
  } }), f.directory);
  await assert.rejects(run(f, wire), /unverified/);
  const path = join(f.directory, 'poster-drawing-state.json'), state = readJSON(path), candidate = state.candidates.at(-1);
  assert.equal(candidate.checks.at(-1).ready, false); assert.equal(candidate.checks.at(-1).verified, false);
  assert.equal(state.drawRequests, 1); assert.equal(wire.calls.length, 2);
  assert.deepEqual(wire.calls.map(call => call.stage), ['poster', 'poster-word-check']);
  assert.ok(readJSON(join(f.directory, 'kit-log.json')).some(row => row.verdict === message), 'The original outage remains in the evidence ledger.');
  if (failure === 'proven preflight') { assert.deepEqual(candidate.rechecks, {}); assert.equal(candidate.preflightStops[0].sent, false); }
  else { assert.equal(Object.values(candidate.rechecks)[0].status, 'failed'); assert.equal(Object.values(candidate.rechecks)[0].reason, message); }
  if (failure === 'proven preflight') {
    const recovered = await run(f, wire); assert.equal(recovered.hash, candidate.hash);
    assert.equal(wire.calls.length, 3); assert.equal(wire.calls.filter(row => row.stage === 'poster').length, 1);
    assert.equal(recovered.checks.at(-1).contentVerified, true);
  } else {
    await assert.rejects(run(f, wire), /unverified/); assert.equal(wire.calls.length, 2);
    assert.deepEqual(readJSON(path).candidates.at(-1).rechecks, candidate.rechecks);
  }
  assert.equal(readJSON(path).drawRequests, 1);
});
test('mismatched target content or changed reference bytes cannot recover another image or renew draws', async t => {
  const f = fixture(t), wire = transport(f);
  f.text.jokeIdea = 'A tiny toy hat rests beside the table.';
  await assert.rejects(run(f, wire), /drawing allowance is spent/); assert.equal(wire.calls.length, 0);
  appendFileSync(f.record.cast[0].referencePath, 'changed reference');
  await assert.rejects(run(f, wire), /reference bytes changed/); assert.equal(wire.calls.length, 0);
});
test('accepted recovery remains bound to the exact saved candidate hash', async t => {
  const f = fixture(t), wire = transport(f), result = await run(f, wire);
  appendFileSync(result.path, 'changed candidate');
  await assert.rejects(run(f, wire), /candidate bytes changed/); assert.equal(wire.calls.length, 0);
});
test('new measurement opinions become parent notes without an automatic redraw', async t => {
  const f = fixture(t, { legacy: false }), wire = transport(f, { answer: f.bad });
  const result = await run(f, wire);
  assert.equal(result.ready, true);
  assert.ok(result.checks.at(-1).reviewFlags.some(flag => flag.key.startsWith('insufficient_handwriting_space')));
  assert.deepEqual(wire.calls.map(call => call.stage), ['poster', 'poster-word-check']);
  await run(f, wire); assert.equal(wire.calls.length, 2);
  assert.equal(readJSON(join(f.directory, 'poster-drawing-state.json')).drawRequests, 1);
});
test('unknown image failures spend the durable allowance once per call and Resume cannot reset it', async t => {
  const f = fixture(t, { legacy: false }), wire = transport(f, { failDraw: () => { throw Error('Unknown image connection failure after send.'); } });
  for (let spent = 1; spent <= 2; spent++) {
    await assert.rejects(run(f, wire), /Unknown image connection/);
    assert.equal(readJSON(join(f.directory, 'poster-drawing-state.json')).drawRequests, spent);
    assert.equal(wire.calls.length, spent);
  }
  await assert.rejects(run(f, wire), /drawing allowance is spent/); assert.equal(wire.calls.length, 2);
});

test('a single-page completed response replays after interruption at the drawing cap', async t => {
  const f = fixture(t, { legacy: false });
  let draws = 0, saved, savedKey, replays = 0, unknown = false;
  const key = request => JSON.stringify([request.path, request.stage, request.kit, request.body]);
  const wire = transport(f, { failDraw: request => {
    draws++;
    if (draws === 2) { saved = { data: [{ b64_json: png.toString('base64') }] }; savedKey = key(request); }
    throw Error('Fixture disconnected before local image save.');
  } });
  const normalCall = wire.call.bind(wire);
  wire.hasRecovery = request => savedKey === key(request);
  wire.call = async request => {
    if (wire.hasRecovery(request)) {
      if (unknown) throw Object.assign(Error('Fixture remote outcome still unknown.'), { preflight: true, sent: false });
      replays++; return saved;
    }
    return normalCall(request);
  };
  for (let index = 0; index < 2; index++) await assert.rejects(run(f, wire), /disconnected/);
  const path = join(f.directory, 'poster-drawing-state.json');
  assert.equal(readJSON(path).drawRequests, 2);
  unknown = true;
  await assert.rejects(run(f, wire), /still unknown/);
  assert.equal(readJSON(path).drawRequests, 2, 'a no-send replay failure must not refund an earlier sent request');
  unknown = false;
  assert.equal((await run(f, wire)).ready, true);
  assert.equal(draws, 2); assert.equal(replays, 1); assert.equal(readJSON(path).drawRequests, 2);
});
for (const message of ['Daily budget reached.', 'Missing openai key.', 'OpenAI request contains nickname.']) test(`proven pre-send failure retains the unspent drawing allowance: ${message}`, async t => {
  const f = fixture(t, { legacy: false }), wire = transport(f, { failDraw: () => { throw Error(message); } });
  await assert.rejects(run(f, wire), error => error.message === message);
  assert.equal(readJSON(join(f.directory, 'poster-drawing-state.json')).drawRequests, 0);
});
test('unknown draw failures and late budget stops after a logged wire stay spent', async t => {
  for (const message of ['Unknown network failure.', 'Daily budget reached.']) {
    const f = fixture(t, { legacy: false }), wire = transport(f, { failDraw: () => {
      if (message.startsWith('Daily')) appendFileSync(join(f.directory, 'requests.jsonl'), JSON.stringify({ event: 'request', stage: 'poster', logicalRequestId: 'synthetic-wire-before-budget', id: 'wire' }) + '\n');
      throw Error(message);
    } });
    await assert.rejects(run(f, wire), error => error.message === message);
    assert.equal(readJSON(join(f.directory, 'poster-drawing-state.json')).drawRequests, 1);
  }
});
test('shared transport preflight proof, rather than error wording, controls unused allowances', async t => {
  for (const preflight of [true, false]) {
    const f = fixture(t, { legacy: false }), wire = transport(f, { failDraw: () => { throw Object.assign(Error(preflight ? 'Another validated no-send guard.' : 'Daily budget reached.'), { preflight }); } });
    await assert.rejects(run(f, wire));
    assert.equal(readJSON(join(f.directory, 'poster-drawing-state.json')).drawRequests, preflight ? 0 : 1);
  }
});
test('a retained no-send ledger row cannot burn the drawing allowance again on Resume', async t => {
  const f = fixture(t, { legacy: false });
  const blocked = withKitEvidence(transport(f, { failDraw: () => { throw Object.assign(Error('Another validated no-send guard.'), { preflight: true }); } }), f.directory);
  await assert.rejects(run(f, blocked));
  assert.equal(readJSON(join(f.directory, 'poster-drawing-state.json')).drawRequests, 0);
  assert.equal(readJSON(join(f.directory, 'poster-drawing-state.json')).preflightStops[0].ledgerEntry.index, 0);
  const resumed = withKitEvidence(transport(f), f.directory);
  assert.equal((await run(f, resumed)).ready, true);
  assert.equal(readJSON(join(f.directory, 'poster-drawing-state.json')).drawRequests, 1);
});
test('an explicit fixed layout revision gets its own bounded ledger and leaves original three spent', async t => {
  const f = fixture(t), wire = transport(f), originalLog = readFileSync(join(f.directory, 'kit-log.json'));
  const result = await run(f, wire, { layoutRevision: geometryRuleVersion });
  assert.equal(result.layoutRevision, geometryRuleVersion); assert.ok(result.path.includes(`poster-layout-${geometryRuleVersion}`));
  assert.equal(wire.calls.filter(call => call.stage === 'poster').length, 1);
  assert.equal(readJSON(join(f.directory, `poster-layout-${geometryRuleVersion}`, 'poster-drawing-state.json')).drawRequests, 1);
  await run(f, wire, { layoutRevision: geometryRuleVersion }); assert.equal(wire.calls.filter(call => call.stage === 'poster').length, 1);
  assert.deepEqual(readFileSync(join(f.directory, 'kit-log.json')), originalLog);
  assert.equal(inspectSavedDrawingRecovery(f.record, move, f.text, { directory: f.directory, selection }).drawRequestsSpent, 3);
  await assert.rejects(run(f, wire, { layoutRevision: '../escape' }), /Invalid explicit/);
});
test('a failed explicit layout revision cannot renew its two draws on ordinary repeated Resume', async t => {
  const f = fixture(t), wire = transport(f, { failDraw: () => { throw Error('Unknown image connection failure after send.'); } });
  for (let spent = 1; spent <= 2; spent++) {
    await assert.rejects(run(f, wire, { layoutRevision: geometryRuleVersion }), /Unknown image connection/);
    assert.equal(readJSON(join(f.directory, `poster-layout-${geometryRuleVersion}`, 'poster-drawing-state.json')).drawRequests, spent);
  }
  await assert.rejects(run(f, wire, { layoutRevision: geometryRuleVersion }), /drawing allowance is spent/);
  assert.equal(wire.calls.filter(call => call.stage === 'poster').length, 2);
});

test('a saved drawing cannot cross family styles or renew its allowance when the selected look changes', async t => {
  const f = fixture(t, { legacy: false }), wire = transport(f);
  const first = await run(f, wire); assert.equal(first.pictureStyleId, 'detailed-comic'); assert.ok(first.pictureStyleVersion);
  const path = join(f.directory, 'poster-drawing-state.json'), before = readFileSync(path), callCount = wire.calls.length;
  f.record.pictureStyleId = 'classic-comic';
  await assert.rejects(run(f, wire), /different family look/);
  assert.equal(wire.calls.length, callCount); assert.deepEqual(readFileSync(path), before);
});

test('a description-only identity reference sends no style example and uses the generation route', async t => {
  const f = fixture(t, { legacy: false }), guide = pictureStyleReferenceFor(f.record), calls = [];
  assert.ok(guide, 'The committed fictional style guide is available.');
  const wire = { call: async request => { calls.push(request); throw Error('Synthetic route assertion stopped before any provider.'); } };
  await assert.rejects(readyPicture(wire, f.record, move, '', { hero: true, directory: f.directory, selection }), /Synthetic route assertion/);
  assert.equal(calls.length, 1); assert.equal(calls[0].path, '/v1/images/generations'); assert.equal(calls[0].body.image, undefined);
  assert.doesNotMatch(calls[0].body.prompt, /RENDERING STYLE EXAMPLE/);
});

test('explicit Resume rechecks unknown poster words on the same image without resetting spent work', async t => {
  const f = fixture(t, { legacy: false }); let available = false;
  const wire = transport(f, { failCheck: () => openaiAnswer(available ? f.good() : 'not valid json') });
  await assert.rejects(run(f, wire), error => error.code === 'content_check_unverified' && error.canResume === true);
  const path = join(f.directory, 'poster-drawing-state.json'), before = readJSON(path), candidate = before.candidates.at(-1);
  assert.equal(before.drawRequests, 1); assert.equal(candidate.wordCheckInvocations, 1);
  assert.equal(wire.calls.filter(row => row.stage === 'poster-word-check').length, 2);
  available = true; wire.allowSavedCheckRetry = true;
  const result = await run(f, wire), after = readJSON(path);
  assert.equal(result.hash, candidate.hash); assert.equal(after.drawRequests, before.drawRequests);
  assert.equal(after.candidates.at(-1).wordCheckInvocations, 2);
  assert.equal(wire.calls.filter(row => row.stage === 'poster').length, 1);
  assert.equal(wire.calls.filter(row => row.stage === 'poster-word-check').length, 3);
  assert.equal(after.candidates.at(-1).recheckHistory.length, 1);
});

test('repeated unknown explicit poster Resumes retain every check and cannot spend twice in one Resume', async t => {
  const f = fixture(t, { legacy: false }), wire = transport(f, { failCheck: () => openaiAnswer('not valid json') });
  await assert.rejects(run(f, wire), /unverified/);
  const path = join(f.directory, 'poster-drawing-state.json'), originalHash = readJSON(path).candidates.at(-1).hash;
  wire.allowSavedCheckRetry = true;
  await assert.rejects(run(f, wire), /unverified/);
  const spent = wire.calls.length;
  await assert.rejects(run(f, wire), /unverified/); assert.equal(wire.calls.length, spent);
  const second = { ...wire, calls: wire.calls, allowSavedCheckRetry: true };
  await assert.rejects(run(f, second), /unverified/);
  const after = readJSON(path);
  assert.equal(after.drawRequests, 1); assert.equal(after.candidates.at(-1).hash, originalHash);
  assert.equal(after.candidates.at(-1).wordCheckInvocations, 3);
  assert.equal(wire.calls.filter(row => row.stage === 'poster').length, 1);
  assert.equal(wire.calls.filter(row => row.stage === 'poster-word-check').length, 6);
});
