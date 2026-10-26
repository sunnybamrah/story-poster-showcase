import { readyFrame, checkedFrame } from '../server/frames.js';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { family, sentences } from './fixture.mjs';
import { offlineTransport, offlineExports, textAnswer } from './offline-kit-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitForLayoutResult, measureLayout, assertLayoutFit } from '../server/layout-fit.js';
import { assessCheck, hardStoryFaults } from '../server/stop-policy.js';
import { runCheck, brokenCheck } from '../server/checker-contract.js';
import { withKitEvidence } from '../server/kit-evidence.js';
import { checkModels } from '../content/check-models.mjs';
import { renderSavedKit } from './render-saved-kit.mjs';
import { parseWordCheck } from '../server/check-words.js';
import { posterBoxes } from '../server/format.js';
import { moves } from '../server/files.js';
import { kitText } from './kit-text-fixture.mjs';
import { wordCheckAnswer } from './checker-fixture.mjs';
import legacyNotes from './fixtures/printed-notes-v1.json' with { type: 'json' };
const temp = t => { const path = mkdtempSync(join(tmpdir(), 'pass24-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; };
const fit = { measured: true, ready: true, faults: [] };

test('slow page passes the soft mark and completes when its actual result arrives', async () => {
  let time = 0, polls = 0, notices = 0;
  const page = { evaluate: async () => ({ result: ++polls === 8 ? JSON.stringify(fit) : null, progress: String(polls) }) };
  assert.deepEqual(await waitForLayoutResult(page, { now: () => time, wait: async ms => { time += ms; }, pollMs: 100, softMs: 200, quietMs: 250, onSlow: () => { notices++; throw Error('reporter failure'); } }), fit);
  assert.equal(notices, 1); assert.equal(polls, 8);
});

test('missing result retries a fresh browser and keeps diagnostics away from the cause', async t => {
  const path = join(temp(t), 'kit.html'); writeFileSync(path, '<body></body>');
  let launches = 0, closes = 0, time = 0;
  const result = await measureLayout(path, { launch: async () => {
    const attempt = ++launches;
    return { newPage: async () => ({ goto: async () => {}, evaluate: async () => ({ result: attempt === 2 ? JSON.stringify(fit) : null, progress: 'complete' }) }), close: async () => { closes++; } };
  }, waitOptions: { now: () => time, wait: async ms => { time += ms; }, quietMs: 100 } });
  assert.equal(result.measured, true); assert.equal(launches, 2); assert.equal(closes, 2);
  assert.equal(result.diagnostics[0].measured, false);
  const unavailable = await measureLayout(path, { launch: async () => { throw Error('CVDisplayLink noise'); } });
  assert.doesNotMatch(unavailable.reason, /CVDisplayLink/); assert.match(unavailable.diagnostics[0].error, /CVDisplayLink/);
  assert.equal(assertLayoutFit(unavailable).reviewFlags[0].label, "FOR SUNNY'S READ");
  assert.throws(() => assertLayoutFit({ measured: true, ready: false, faults: ['measured clipping'] }), /printed_layout_overflow/);
});

test('valid opinions cost one check; broken checker costs two and saves unverified evidence', async t => {
  for (const broken of [false, true]) {
    let calls = 0;
    const directory = join(temp(t), 'kit-1');
    const transport = withKitEvidence({ call: async () => { calls++; return { output: [] }; }, recordRejection() {} }, directory);
    const result = await runCheck(transport, { stage: 'hero-check', body: {} }, () => broken ? brokenCheck('missing keys') : ({ ready: false, faults: ['outfitMismatch'], needsRecheck: false }));
    assert.equal(calls, broken ? 2 : 1); assert.equal(result.ready, !broken); assert.equal(result.verified, !broken);
    assert.equal(result.reviewFlags[0].label, "FOR SUNNY'S READ");
    assert.match(readFileSync(join(directory, 'review-flags.json'), 'utf8'), /FOR SUNNY'S READ/);
    assert.match(readFileSync(join(directory, 'kit-log.md'), 'utf8'), /FOR SUNNY'S READ/);
    if (broken) assert.match(readFileSync(join(directory, 'picture-check-hero-2.json'), 'utf8'), /content_check_unverified/);
  }
});

test('hard story faults and measured breaks still stop while unknown opinions become flags', () => {
  for (const fault of [...hardStoryFaults, 'text_crosses_boundary: science', 'insufficient_handwriting_space: plan']) {
    const result = assessCheck({ faults: [fault], needsRecheck: false }); assert.equal(result.ready, false, fault); assert.deepEqual(result.faults, [fault]);
  }
  const result = assessCheck({ faults: ['some_future_opinion'], needsRecheck: false });
  assert.equal(result.ready, true); assert.equal(result.reviewFlags[0].key, 'some_future_opinion');
});

test('geometry opinions survive the word checker and retain the review label', () => {
  const boxes = posterBoxes(moves[0], kitText()), answer = wordCheckAnswer(boxes);
  answer.geometry.observed.push(structuredClone(answer.geometry.observed[0]));
  const result = parseWordCheck(JSON.stringify(answer), boxes);
  assert.equal(result.ready, true); assert.ok(result.reviewFlags.some(row => row.key === 'duplicate_or_extra_measurement' && row.label === "FOR SUNNY'S READ"));
});

test('model catalog stays byte-identical while runtime verification goes to its receipt', async t => {
  const path = join(temp(t), 'prices.json'), receiptPath = join(temp(t), 'models.json');
  const bytes = readFileSync(new URL('../content/prices.json', import.meta.url)); writeFileSync(path, bytes);
  const selected = JSON.parse(bytes).selected;
  await checkModels({ call: async () => ({ data: Object.values(selected).map(id => ({ id })) }) }, { path, receiptPath });
  assert.deepEqual(readFileSync(path), bytes); assert.ok(JSON.parse(readFileSync(receiptPath)).liveModelsCheckedAt);
});

test('saved render checks both themes before export and creates a fresh folder every time', async t => {
  const outputRoot = temp(t); let exports = 0;
  const source = temp(t), memory = createMemory(join(source, 'family.json')); memory.store(family);
  await createKit(offlineTransport(t, source), memory, sentences[0], { directory: source, kit: 1, exports: offlineExports() });
  const savedText = JSON.parse(readFileSync(join(source, 'kit-text-final.json')));
  const oldSection = legacyNotes.notes[savedText.moveId]; assert.ok(oldSection);
  for (const file of ['kit_final.html', 'for-you.html']) {
    const html = readFileSync(join(source, file), 'utf8');
    assert.match(html, /data-short-notes="exact-v2"/);
    writeFileSync(join(source, file), html.replace(/<section data-short-notes="exact-v2">[\s\S]*?<\/section>/, oldSection));
  }
  const exporters = { measureLayout: async (_, { theme }) => ({ measured: theme === 'dark', ready: false, faults: theme === 'dark' ? ['clipping'] : [], reason: 'no result' }), renderKitPDF: async () => { exports++; }, renderPoster: async () => { exports++; } };
  const a = await renderSavedKit({ source, outputRoot, exports: exporters }), b = await renderSavedKit({ source, outputRoot, exports: exporters });
  assert.notEqual(a.directory, b.directory); assert.equal(exports, 0);
  assert.deepEqual(a.measurements.map(row => row.theme), ['light', 'dark']); assert.match(a.reason, /Fit unverified.*PDF and screenshots were not attempted/);
  for (const result of [a, b]) assert.ok(readFileSync(join(result.directory, 'for-you.html'), 'utf8').includes(oldSection), 'Saved notes keep their old exact wording by default.');
  const refreshed = await renderSavedKit({ source, outputRoot, refreshResearchNotes: true, exports: exporters });
  assert.match(readFileSync(join(refreshed.directory, 'for-you.html'), 'utf8'), /data-short-notes="exact-v2"/);
  assert.ok(readFileSync(join(source, 'for-you.html'), 'utf8').includes(oldSection), 'An explicit refresh creates a separate revision.');
});

test('a kit pauses before export after two malformed poster checks and keeps its paid stages', async t => {
  const directory = temp(t), memory = createMemory(join(directory, 'family.json')); memory.store(family);
  const transport = offlineTransport(t, directory, request => request.stage === 'poster-word-check' ? textAnswer({ boxes: 'bad' }) : undefined);
  await assert.rejects(createKit(transport, memory, sentences[0], { directory, kit: 1, exports: offlineExports() }), /unverified/);
  assert.equal(existsSync(join(directory, 'kit_final.pdf')), false);
  assert.equal(JSON.parse(readFileSync(join(directory, 'checkpoint.json'))).stages.text.ready, true);
  assert.equal(transport.calls.filter(row => row.stage === 'poster-word-check').length, 2);
  assert.equal(transport.calls.filter(row => row.stage === 'poster').length, 1);
  const calls = transport.calls.length;
  await assert.rejects(createKit(transport, memory, sentences[0], { directory, kit: 1, resume: true, exports: offlineExports() }), /unverified/);
  assert.equal(transport.calls.length, calls, 'unknown content cannot rebuy text, people, art or checks on Resume');
});

test('an unused legacy frame with an unknown letter check keeps its files without passing', async t => {
  const directory = temp(t), transport = offlineTransport(t, directory, request => request.stage === 'frame-check' ? textAnswer({}) : undefined);
  const path = join(directory, 'frame');
  await assert.rejects(readyFrame(withKitEvidence(transport, directory), family, sentences[0], { directory: path }), /unverified/);
  assert.throws(() => checkedFrame(path), /changed/);
  const spent = transport.calls.length;
  await assert.rejects(readyFrame(withKitEvidence(transport, directory), family, sentences[0], { directory: path }), /changed/);
  assert.equal(transport.calls.length, spent);
});
