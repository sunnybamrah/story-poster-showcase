import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { readyKitArt, imageHash, comicPanelCrops } from '../server/picture.js';
import { lockedCast } from '../server/cast.js';
import { moves } from '../server/files.js';
import { family, sentences } from './fixture.mjs';
import { offlineTransport, run5, openaiAnswer } from './offline-kit-fixture.mjs';
import { parentJobFailure } from '../server/job-failure.js';
import { wordCheckAnswer } from './checker-fixture.mjs';
import { withKitEvidence } from '../server/kit-evidence.js';
import { panelActionDirection } from '../server/panel-contract.js';
import { buildPanelRequest, buildStoryRequest } from '../server/requests.js';

// Synthetic existing raster fixture. These tests check placement, not likeness.
const fixture = new URL('./fixtures/offline-art.png', import.meta.url).pathname;
const prepare = (t, override = () => undefined) => {
  const directory = mkdtempSync(join(tmpdir(), 'subscription-panels-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const record = structuredClone(family); record.real = false; record.hero.heroPicturePath = fixture;
  record.cast = lockedCast(record).map(person => ({ ...person, referencePath: fixture, referenceHash: imageHash(fixture) }));
  const saved = {};
  const transport = offlineTransport(t, directory, request => override(request) ?? (request.stage === 'comic-panels' ? { data: [{ b64_json: readFileSync(fixture).toString('base64') }], usage: { input_tokens: 0, output_tokens: 0 } } : undefined));
  transport.route = 'codex-subscription';
  return { directory, record, saved, raw: transport, transport: withKitEvidence(transport, directory), options: { directory, saved, saveStage: (name, value) => { saved[name] = value; } } };
};

test('one subscription image produces four separate source-linked panels at their true shape', async t => {
  const f = prepare(t), result = await readyKitArt(f.transport, f.record, moves.find(move => move.id === run5.moveId), sentences[0], run5, f.options);
  assert.equal(result.panels.length, 4); assert.equal(f.raw.calls.filter(call => call.stage === 'comic-panels').length, 1);
  assert.equal(f.raw.calls.filter(call => /^panel-/.test(call.stage)).length, 0);
  assert.equal(f.raw.calls.filter(call => call.stage === 'comic-word-check').length, 1);
  const sheetPrompt = f.raw.calls.find(call => call.stage === 'comic-panels').body.prompt;
  assert.equal(sheetPrompt.split(panelActionDirection).length - 1, 4);
  assert.match(sheetPrompt, /Never float a book or object against a body/);
  const original = await sharp(fixture).metadata();
  for (const [index, panel] of result.panels.entries()) {
    const image = await sharp(panel.path).metadata();
    assert.equal(image.width, Math.floor(original.width / 2)); assert.equal(image.height, Math.floor(original.height / 2));
    assert.equal(panel.hash, imageHash(panel.path)); assert.equal(panel.sourceSheet.hash, imageHash(join(f.directory, 'comic-sheet.png')));
    assert.equal(panel.expectedBoxes[0].text, run5.panelLines[index].line); assert.equal(panel.checks[0].contentVerified, true);
  }
  const calls = f.raw.calls.length;
  const again = await readyKitArt(f.transport, f.record, moves.find(move => move.id === run5.moveId), sentences[0], run5, f.options);
  assert.equal(f.raw.calls.length, calls); assert.deepEqual(again.panels.map(panel => panel.hash), result.panels.map(panel => panel.hash));
});

test('physical action directions preserve flat turns without copying the private moment into art', () => {
  const panel = { scene: 'Child compares a paper piece lying flat on the table, tall in the tabletop plane with its bump on the right, against a wide prediction drawing.', line: 'I can check.', speakerId: 'child' };
  const move = moves.find(move => move.id === run5.moveId);
  const request = buildPanelRequest(family, move, sentences[0], panel);
  assert.ok(request.prompt.includes(panel.scene));
  assert.ok(request.prompt.includes(panelActionDirection));
  assert.match(request.prompt, /flat surface from lifting, standing upright or flipping/);
  assert.ok(!request.prompt.includes(sentences[0]));
  assert.equal(panel.scene, 'Child compares a paper piece lying flat on the table, tall in the tabletop plane with its bump on the right, against a wide prediction drawing.');
  const writing = buildStoryRequest(family, sentences[0]);
  assert.match(JSON.parse(writing.input[0].content).panelActionInstruction, /supporting surface, direction and resulting state/);
});

test('a stop while placing the sheet resumes from the saved image without buying it again', async t => {
  const f = prepare(t); let interrupt = true;
  const save = f.options.saveStage;
  f.options.saveStage = (name, value) => { save(name, value); if (name === 'panel-1' && interrupt) { interrupt = false; throw Error('Offline stop while saving the first panel'); } };
  await assert.rejects(readyKitArt(f.transport, f.record, moves.find(move => move.id === run5.moveId), sentences[0], run5, f.options), /Offline stop/);
  const before = f.raw.calls.length;
  const result = await readyKitArt(f.transport, f.record, moves.find(move => move.id === run5.moveId), sentences[0], run5, f.options);
  assert.equal(result.panels.length, 4); assert.equal(f.raw.calls.length, before);
  assert.equal(f.raw.calls.filter(call => call.stage === 'comic-panels').length, 1);
});

test('off-centre dividers keep every crop inside its own actual scene', async t => {
  const f = prepare(t), path = join(f.directory, 'offset-sheet.png');
  const regions = [
    { left: 0, top: 0, width: 95, height: 46 }, { left: 102, top: 0, width: 98, height: 46 },
    { left: 0, top: 53, width: 95, height: 47 }, { left: 102, top: 53, width: 98, height: 47 },
  ];
  const colours = ['#bd3126', '#249044', '#2668ba', '#ad7a18'];
  const inputs = await Promise.all(regions.map(async (rect, index) => ({ left: rect.left, top: rect.top, input: await sharp({ create: { width: rect.width, height: rect.height, channels: 3, background: colours[index] } }).png().toBuffer() })));
  writeFileSync(path, await sharp({ create: { width: 200, height: 100, channels: 3, background: '#ffffff' } }).composite(inputs).png().toBuffer());
  const crops = await comicPanelCrops(path);
  assert.deepEqual(crops, regions);
  const inkPath = join(f.directory, 'offset-ink-sheet.png');
  await sharp(path).greyscale().png().toFile(inkPath);
  assert.deepEqual(await comicPanelCrops(inkPath), regions, 'the same divider works in a black-ink comic');
  for (const [index, crop] of crops.entries()) {
    const { data, info } = await sharp(path).extract(crop).raw().toBuffer({ resolveWithObject: true });
    assert.equal(new Set(Array.from({ length: info.width * info.height }, (_, pixel) => data.subarray(pixel * info.channels, (pixel + 1) * info.channels).toString('hex'))).size, 1, `scene ${index + 1} contains no white gutter or neighbouring scene`);
  }
});


const comicReadback = request => {
  const payload = JSON.parse(request.body.input[0].content[0].text);
  return { panels: payload.panels.map((row, index) => ({ panelId: row.panelId, check: { ...wordCheckAnswer([{ id: 'bubble', text: run5.panelLines[index].line }]), bubbleSpeaker: { characterId: row.expectedSpeakerId ?? 'child', certainty: 'confirmed', evidence: 'Synthetic fixture tail reaches this supplied person.' } } })), extraText: [] };
};
test('one confirmed comic word fault gets one repair and keeps the rejected sheet', async t => {
  let readbacks = 0;
  const f = prepare(t, request => {
    if (request.stage !== 'comic-word-check') return undefined;
    const answer = comicReadback(request);
    if (++readbacks === 1) answer.panels[1].check.boxes[0].text = 'You are stupid.';
    return openaiAnswer(answer);
  });
  const result = await readyKitArt(f.transport, f.record, moves.find(move => move.id === run5.moveId), sentences[0], run5, f.options);
  assert.equal(result.ready, true); assert.equal(readbacks, 2);
  assert.equal(f.raw.calls.filter(row => row.stage === 'comic-panels').length, 2);
  assert.equal(existsSync(join(f.directory, 'comic-sheet-attempt-1.png')), true);
  assert.equal(existsSync(join(f.directory, 'comic-sheet-attempt-2.png')), true);
  assert.equal(JSON.parse(readFileSync(join(f.directory, 'comic-sheet-state.json'))).history.length, 2);
});

test('a completed second comic request survives interruption and replays at its drawing cap', async t => {
  let readbacks = 0;
  const f = prepare(t, request => {
    if (request.stage !== 'comic-word-check') return undefined;
    const answer = comicReadback(request);
    if (++readbacks === 1) answer.panels[1].check.boxes[0].text = 'Different fixture words.';
    return openaiAnswer(answer);
  });
  const normalCall = f.raw.call.bind(f.raw), key = request => JSON.stringify([request.path, request.stage, request.kit, request.body]);
  const cache = new Map(); let drawings = 0, replays = 0;
  f.raw.hasRecovery = request => cache.has(key(request));
  f.raw.call = async request => {
    if (cache.has(key(request))) { replays++; return cache.get(key(request)); }
    const response = await normalCall(request);
    if (request.stage === 'comic-panels' && ++drawings === 2) { cache.set(key(request), response); throw Error('Fixture disconnect after second drawing was saved remotely.'); }
    return response;
  };
  f.transport = withKitEvidence(f.raw, f.directory);
  const run = () => readyKitArt(f.transport, f.record, moves.find(move => move.id === run5.moveId), sentences[0], run5, f.options);
  await assert.rejects(run(), /disconnect after second/);
  const state = () => JSON.parse(readFileSync(join(f.directory, 'comic-sheet-state.json')));
  assert.equal(state().attempts, 2); assert.equal(state().hash, undefined);
  const result = await run();
  assert.equal(result.ready, true); assert.equal(result.panels.length, 4);
  assert.equal(drawings, 2); assert.equal(replays, 1); assert.equal(state().attempts, 2);
  assert.equal(f.raw.calls.filter(request => request.stage === 'comic-panels').length, 2);
});
test('unknown comic words recheck the same sheet once, stop and cannot renew on Resume', async t => {
  const f = prepare(t, request => request.stage === 'comic-word-check' ? openaiAnswer('not valid json') : undefined);
  const run = () => readyKitArt(f.transport, f.record, moves.find(move => move.id === run5.moveId), sentences[0], run5, f.options);
  await assert.rejects(run(), error => { assert.match(error.message, /unverified/); assert.equal(error.code, 'content_check_unverified'); assert.equal(error.canResume, true); return true; });
  assert.equal(f.raw.calls.filter(row => row.stage === 'comic-panels').length, 1);
  assert.equal(f.raw.calls.filter(row => row.stage === 'comic-word-check').length, 2);
  const spent = f.raw.calls.length;
  await assert.rejects(run(), /unverified/); assert.equal(f.raw.calls.length, spent);
});
test('a second confirmed comic word fault stops after one repair and retains both drawings', async t => {
  const f = prepare(t, request => {
    if (request.stage !== 'comic-word-check') return undefined;
    const answer = comicReadback(request); answer.extraText.push('Unapproved words'); return openaiAnswer(answer);
  });
  const run = () => readyKitArt(f.transport, f.record, moves.find(move => move.id === run5.moveId), sentences[0], run5, f.options);
  await assert.rejects(run(), /after one repair/);
  assert.equal(f.raw.calls.filter(row => row.stage === 'comic-panels').length, 2);
  const spent = f.raw.calls.length; await assert.rejects(run(), /after one repair/); assert.equal(f.raw.calls.length, spent);
});


test('a proven no-send comic check retries the same sheet on Resume without buying another picture', async t => {
  const f = prepare(t), call = f.transport.call.bind(f.transport); let paused = false;
  f.transport.call = async request => {
    if (request.stage === 'comic-word-check' && !paused) { paused = true; throw Object.assign(Error('Daily budget reached.'), { preflight: true }); }
    return call(request);
  };
  const run = () => readyKitArt(f.transport, f.record, moves.find(move => move.id === run5.moveId), sentences[0], run5, f.options);
  await assert.rejects(run(), error => { assert.match(error.message, /unverified/); assert.equal(parentJobFailure(error, 'comic-panels').canResume, true); return true; });
  const path = join(f.directory, 'comic-sheet-state.json'), state = JSON.parse(readFileSync(path));
  assert.equal(state.check.checkerNotSent, true); assert.equal(state.attempts, 1);
  assert.equal(f.raw.calls.filter(row => row.stage === 'comic-word-check').length, 0);
  const result = await run(); assert.equal(result.ready, true);
  assert.equal(f.raw.calls.filter(row => row.stage === 'comic-panels').length, 1);
  assert.equal(f.raw.calls.filter(row => row.stage === 'comic-word-check').length, 1);
  const resumed = JSON.parse(readFileSync(path)); assert.equal(resumed.hash, state.hash); assert.equal(resumed.attempts, 1);
});

test('a later preflight stop cannot refund an earlier sent comic word check', async t => {
  const f = prepare(t, request => request.stage === 'comic-word-check' ? openaiAnswer('not valid json') : undefined);
  const call = f.transport.call.bind(f.transport); let checks = 0;
  f.transport.call = async request => {
    if (request.stage === 'comic-word-check' && ++checks === 2) throw Object.assign(Error('Daily budget reached.'), { preflight: true });
    return call(request);
  };
  const run = () => readyKitArt(f.transport, f.record, moves.find(move => move.id === run5.moveId), sentences[0], run5, f.options);
  await assert.rejects(run(), /unverified/);
  const state = JSON.parse(readFileSync(join(f.directory, 'comic-sheet-state.json')));
  assert.equal(state.check.checkerNotSent, false); assert.equal(state.attempts, 1);
  assert.equal(f.raw.calls.filter(row => row.stage === 'comic-word-check').length, 1);
  const spent = f.raw.calls.length; await assert.rejects(run(), /unverified/); assert.equal(f.raw.calls.length, spent);
});

test('explicit Resume checks the same unknown comic sheet once and keeps all request history', async t => {
  let available = false;
  const f = prepare(t, request => request.stage === 'comic-word-check' ? openaiAnswer(available ? comicReadback(request) : 'not valid json') : undefined);
  const run = () => readyKitArt(f.transport, f.record, moves.find(move => move.id === run5.moveId), sentences[0], run5, f.options);
  await assert.rejects(run(), /unverified/);
  const path = join(f.directory, 'comic-sheet-state.json'), before = JSON.parse(readFileSync(path));
  assert.equal(before.wordCheckInvocations, 1);
  available = true; f.transport.allowSavedCheckRetry = true;
  const result = await run(), after = JSON.parse(readFileSync(path));
  assert.equal(result.ready, true); assert.equal(after.hash, before.hash); assert.equal(after.attempts, 1);
  assert.equal(after.wordCheckInvocations, 2); assert.equal(after.explicitResumeChecks, 1); assert.equal(after.history.length, 2);
  assert.equal(f.raw.calls.filter(row => row.stage === 'comic-panels').length, 1);
  assert.equal(f.raw.calls.filter(row => row.stage === 'comic-word-check').length, 3);
});

test('repeated unknown comic checks need a new explicit Resume and never reset drawings or history', async t => {
  const f = prepare(t, request => request.stage === 'comic-word-check' ? openaiAnswer('not valid json') : undefined);
  const run = transport => readyKitArt(transport, f.record, moves.find(move => move.id === run5.moveId), sentences[0], run5, f.options);
  await assert.rejects(run(f.transport), /unverified/);
  f.transport.allowSavedCheckRetry = true; await assert.rejects(run(f.transport), /unverified/);
  const spent = f.raw.calls.length;
  await assert.rejects(run(f.transport), /unverified/); assert.equal(f.raw.calls.length, spent);
  await assert.rejects(run({ ...f.transport, allowSavedCheckRetry: true }), /unverified/);
  const after = JSON.parse(readFileSync(join(f.directory, 'comic-sheet-state.json')));
  assert.equal(after.attempts, 1); assert.equal(after.wordCheckInvocations, 3); assert.equal(after.explicitResumeChecks, 2);
  assert.equal(after.history.length, 3);
  assert.equal(f.raw.calls.filter(row => row.stage === 'comic-panels').length, 1);
  assert.equal(f.raw.calls.filter(row => row.stage === 'comic-word-check').length, 6);
});
