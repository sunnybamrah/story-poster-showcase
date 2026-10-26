import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { readJSON, saveJSON, root } from '../server/files.js';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { publicCast } from '../server/cast.js';
import { replaySaved } from './replay-saved.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { offlineTransport, offlineExports, openaiAnswer } from './offline-kit-fixture.mjs';
import { castObservation } from './checker-fixture.mjs';
import { family, sentences } from './fixture.mjs';
const files = directory => /(?:^|\/)render-check(?:\/|$)/.test(directory) ? [] : readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
const replayInputs = directory => files(directory).filter(path => /\/(story-attempt-\d+\.(json|raw.txt)|story-check-\d+\.json|picture-check-.+\.json|poster-transcription-\d+\.json|poster-fit\.json)$/.test(path));
const assertReplayed = (directory, rows) => {
  const inputs = replayInputs(directory);
  assert.ok(inputs.length, 'The fixture must save replay inputs.');
  for (const input of inputs) assert.ok(rows.some(row => row.id.split('#')[0] === relative(root, input)), `Not replayed: ${input}`);
};
const assertVerdicts = rows => {
  for (const row of rows) {
    assert.ok(['PASS', 'FAIL', 'RECHECK', 'REVIEW'].includes(row.verdict), row.id);
    if (row.verdict !== 'PASS') assert.ok(row.reasons.length, row.id);
    if (row.verdict === 'FAIL') assert.match(row.reasons.join('; '), /no_dashes_as_punctuation|secondMoveTaught|feelingGoesAwayPromise|child_word_wall|writer_field_privacy|unknown_move_id|story_length_outside_format|fictionInNarration|tinyTryWrong|invalid_|confirmed_(identity|species)_mismatch|text_crosses_boundary|text_lines_overlap|text_clipped_at_safe_area|text_icon_collision|insufficient_handwriting_space|keyWordUnreadable|textCrossesBoundary/, row.id);
    assert.doesNotMatch(row.reasons.join('; '), /story_must_be_550|panel_bubble_too_long|panel_bubbles_unbalanced|rhyme_title_word_missing|geometry_deviation_|geometry_overlap:|printTextTooSmall:|use 90 words or fewer/, row.id);
  }
};

test('every checked-in historical answer, readback and geometry is replayed without retired count or drift stops', t => {
  const rows = replaySaved({ directories: [new URL('./fixtures/', import.meta.url).pathname] });
  const baseline = readJSON(new URL('./fixtures/replay-expectations.json', import.meta.url)).records;
  const expected = baseline.filter(row => row.id.startsWith('test/fixtures/'));
  t.diagnostic(`${baseline.length - expected.length} expectations describe optional ignored local runs, outside this checked-in fixture proof. No local history is reconstructed.`);
  assert.ok(expected.length);
  for (const before of expected) {
    const now = rows.find(row => row.id === before.id);
    assert.ok(now, `Missing saved failure: ${before.id}`);
    assert.equal(now.sha256, before.sha256, `Raw evidence changed: ${before.id}`);
    // The baseline pins saved bytes. Pass 24 intentionally changes dispositions.
    if (before.verdict === 'PASS' && now.verdict === 'FAIL') assert.match(now.reasons.join('; '), /no_dashes_as_punctuation|story_length_outside_format|fictionInNarration|tinyTryWrong/, before.id);
  }
  assertVerdicts(rows);
  mkdirSync(join(root, 'test/out'), { recursive: true });
  saveJSON(join(root, 'test/out/replay-saved.json'), { note: 'Full offline replay, no calls. Saved checker claims remain claims; Pass 24 saves opinions and unresolved checker evidence for review.', rows });
});

test('every saved checker has a replay row without inventing a model approval for local cast reuse', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'replay-kit-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const memory = createMemory(join(directory, 'family.json')); memory.store(family);
  const transport = offlineTransport(t, directory);
  const kit = await createKit(transport, memory, sentences[0], { kit: 1, directory: join(directory, 'kit-1'), exports: offlineExports() });
  assert.equal(kit.complete, true, JSON.stringify({ status: kit.status, pdf: kit.pdf, layoutFit: kit.layoutFit }));
  const rows = replaySaved({ directories: [directory] });
  assertReplayed(directory, rows);
  assertVerdicts(rows);
  assert.equal(rows.some(row => row.kind === 'cast-check'), false);
  assert.equal(existsSync(join(directory, 'kit-1', 'picture-check-cast-continuity-1.json')), false);
  assert.equal(transport.calls.some(call => call.stage === 'cast-continuity-check' || call.stage === 'hero-check' || call.stage.endsWith('-reference-check')), false);
  const stages = readJSON(join(directory, 'kit-1', 'checkpoint.json')).stages, continuity = stages['cast-continuity'];
  assert.equal(continuity.ready, true); assert.equal(continuity.verified, false);
  assert.equal(continuity.reviewStatus, 'parent-review'); assert.deepEqual(continuity.checks, []);
  assert.deepEqual(continuity.pictureHashes, ['poster', 'panel-1', 'panel-2', 'panel-3', 'panel-4'].map(id => ({ id, hash: stages[id].hash })));
  for (const id of ['poster', 'panel-1', 'panel-2', 'panel-3', 'panel-4']) assert.deepEqual(stages[id].castReferenceHashes, continuity.castReferenceHashes);
  assert.deepEqual(readJSON(join(directory, 'kit-1', 'cast-continuity-1.json')), { automaticRedraws: 0, reviewStatus: 'parent-review' });
});

test('cast replay uses rawText and reports missing original inputs for review', t => {
  const directory = mkdtempSync(join(tmpdir(), 'replay-cast-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const kitDirectory = join(directory, 'kit-1'); mkdirSync(kitDirectory);
  const file = join(kitDirectory, 'picture-check-cast-continuity-1.json');
  const saved = { answer: { pictures: [] }, rawText: 'malformed original answer', response: openaiAnswer({ pictures: [] }), check: { ready: true, faults: [] } };
  saveJSON(file, saved);
  let row = replaySaved({ directories: [directory] }).find(row => row.kind === 'cast-check');
  assert.equal(row.verdict, 'REVIEW');
  assert.match(row.reasons.join('; '), /cast is missing/);
  assert.match(row.reasons.join('; '), /picture ids are missing/);
  saveJSON(join(directory, 'family.json'), { ...family, cast: publicCast(family) });
  saveJSON(join(kitDirectory, 'checkpoint.json'), { stages: { 'cast-continuity': { pictureHashes: [{ id: 'poster', hash: 'fixture' }] } } });
  row = replaySaved({ directories: [directory] }).find(row => row.kind === 'cast-check');
  assert.equal(row.verdict, 'REVIEW');
  assert.match(row.reasons.join('; '), /malformed_cast_check/);
  for (const kind of ['identity', 'species']) {
    const observations = publicCast(family).map(castObservation);
    if (kind === 'identity') observations[0].identityMatches = false;
    else observations[0].observedSpecies = 'robot';
    observations[0].identityEvidence = 'The visible character is a different person or species.';
    saved.rawText = JSON.stringify({ pictures: [{ id: 'poster', castObservations: observations }] }); saveJSON(file, saved);
    row = replaySaved({ directories: [directory] }).find(row => row.kind === 'cast-check');
    assert.equal(row.verdict, 'FAIL');
    assert.ok(row.reasons.some(reason => reason.startsWith(`confirmed_${kind}_mismatch:`)));
    assertVerdicts([row]);
  }
  delete saved.rawText; saveJSON(file, saved);
  row = replaySaved({ directories: [directory] }).find(row => row.kind === 'cast-check');
  assert.equal(row.verdict, 'REVIEW');
  assert.match(row.reasons.join('; '), /rawText is missing/);
});

test('resuming a complete run exits before local checks and leaves saved reports untouched', t => {
  const directory = mkdtempSync(join(tmpdir(), 'resume-complete-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const reports = ['REPORT.md', 'run-report.json'].map(name => join(directory, name));
  for (const file of reports) writeFileSync(file, 'COMPLETE saved report\n');
  const protectedFiles = [...reports, join(root, 'test/out/results.json')];
  const snapshot = () => protectedFiles.map(file => existsSync(file) ? { contents: readFileSync(file, 'utf8'), mtimeMs: statSync(file).mtimeMs } : null);
  for (const oneKit of [true, false]) {
    saveJSON(join(directory, 'run-state.json'), { version: 1, oneKit, completedKits: oneKit ? [1] : [2, 1], nextKit: oneKit ? 2 : 3 });
    const before = snapshot(), state = readFileSync(join(directory, 'run-state.json'), 'utf8');
    const result = spawnSync(process.execPath, ['test/run-two-kits.mjs', '--resume', directory, '--max-calls', '-1'], { cwd: root, encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '' } });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), `ALREADY COMPLETE: ${directory}`);
    assert.deepEqual(snapshot(), before);
    assert.equal(readFileSync(join(directory, 'run-state.json'), 'utf8'), state);
    assert.deepEqual(readdirSync(directory).sort(), ['REPORT.md', 'run-report.json', 'run-state.json']);
  }
});

test('replay discovers a newly saved content failure without a filename allowlist', t => {
  const directory = mkdtempSync(join(tmpdir(), 'replay-new-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  saveJSON(join(directory, 'story-attempt-1.json'), { ...kitText(), moveId: 'invented' });
  const rows = replaySaved({ directories: [directory] });
  assert.equal(rows.length, 1); assert.equal(rows[0].verdict, 'FAIL'); assert.ok(rows[0].reasons.includes('unknown_move_id: moveId'));
});

test('replay retains rejected or unrecognized answers for every ordinary checker kind', t => {
  mkdirSync(join(root, 'test/out'), { recursive: true });
  const directory = mkdtempSync(join(root, 'test/out/replay-rejected-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const kind of ['hero', 'grown-up-one-reference', 'panel-1', 'poster', 'story']) for (const answer of [null, 'Incomplete answer', [], {}]) {
    const path = join(directory, `${kind}-check.json`);
    const value = { answer, rawText: 'Incomplete checker answer without a JSON object.', check: { ready: false } };
    saveJSON(path, value);
    let rows = replaySaved({ directories: [directory] }).filter(row => row.id.endsWith(`${kind}-check.json`));
    assert.equal(rows.length, 1, kind);
    assert.equal(rows[0].verdict, 'RECHECK');
    assert.match(rows[0].reasons.join('; '), /malformed saved checker answer/);
    const before = rows[0].sha256;
    value.rawText += ' More rejected evidence.'; saveJSON(path, value);
    rows = replaySaved({ directories: [directory] }).filter(row => row.id.endsWith(`${kind}-check.json`));
    assert.notEqual(rows[0].sha256, before);
    delete value.rawText; saveJSON(path, value);
    rows = replaySaved({ directories: [directory] }).filter(row => row.id.endsWith(`${kind}-check.json`));
    assert.equal(rows[0].verdict, 'REVIEW');
    assert.match(rows[0].reasons.join('; '), /rawText are missing/);
  }
});

test('replay applies field corrections to the latest earlier story after shortening', t => {
  const directory = mkdtempSync(join(tmpdir(), 'replay-corrections-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const latest = kitText();
  saveJSON(join(directory, 'story-attempt-1.json'), { ...latest, story: latest.story + '\n\nA leaf drifted past.' });
  saveJSON(join(directory, 'story-attempt-2.json'), latest);
  saveJSON(join(directory, 'story-attempt-3.json'), { story: latest.story, feelFirst: latest.feelFirst });
  saveJSON(join(directory, 'story-attempt-4.json'), { story: latest.story, noticedFeeling: latest.noticedFeeling });
  // A later final story must not replace the version locked for these corrections.
  saveJSON(join(directory, 'kit-text-final.json'), { ...latest, story: latest.story + '\n\nA door clicked.' });
  const rows = replaySaved({ directories: [directory] });
  assertReplayed(directory, rows); assertVerdicts(rows);
  for (const row of rows) assert.equal(row.verdict, 'PASS', row.id + ': ' + row.reasons.join('; '));
});

test('replay retains derived placement receipts without inventing original checker measurements', t => {
  const directory = mkdtempSync(join(tmpdir(), 'replay-fit-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  saveJSON(join(directory, 'new-placement.json'), { fit: { residuals: [] }, placement: { scale: 1 }, exported: {} });
  const rows = replaySaved({ directories: [directory] });
  assert.equal(rows.length, 1); assert.equal(rows[0].kind, 'geometry-fit-receipt');
  assert.equal(rows[0].verdict, 'REVIEW'); assert.match(rows[0].reasons[0], /cannot replace/);
});
