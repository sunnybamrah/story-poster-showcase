import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshSavedRhyme } from '../server/rhyme-refresh.js';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { moves, saveJSON, readJSON } from '../server/files.js';
import { validateStory } from '../server/story.js';
import { kitText } from './kit-text-fixture.mjs';
import { family, sentences } from './fixture.mjs';
import { offlineTransport, offlineExports } from './offline-kit-fixture.mjs';

const move = moves.find(move => move.id === 'name-it-exactly');
const oldRhyme = 'Carry the thought, tell what you have got.';
function checkpointFixture({ changedBubble = false } = {}) {
  const text = { ...kitText(move), ready: true, checks: [{ ready: true, historicalFixture: true }], tagline: oldRhyme };
  text.story += '\n' + oldRhyme;
  text.replayCue = oldRhyme; text.noticedFeeling = oldRhyme;
  if (changedBubble) { text.story = text.story.replace(text.panelLines[1].line, oldRhyme); text.panelLines[1].line = oldRhyme; }
  text.pagination = validateStory(text).pagination;
  return { stages: { text, hero: { fixture: 'person reference' }, 'reference-grown-up-one': { fixture: 'grown-up reference' }, poster: { fixture: 'old poster' }, 'cast-continuity': { fixture: 'old continuity' }, 'poster-export': { fixture: 'old PNG' }, 'poster-pdf': { fixture: 'old PDF' }, 'kit-pdf': { fixture: 'old kit PDF' }, ...Object.fromEntries([1, 2, 3, 4].map(index => [`panel-${index}`, { fixture: `accepted panel ${index}` }])) }, fitAttempts: { story: 2, 'story-2': 1, try: 2 } };
}
function workflow(checkpoint, check) {
  const preserved = [], saves = [], notes = [];
  return { preserved, saves, notes, run: () => refreshSavedRhyme({ checkpoint, move, record: family, check, preserve: value => preserved.push(structuredClone(value)), save: () => saves.push(structuredClone(checkpoint)), note: value => notes.push(structuredClone(value)) }) };
}
test('Resume preserves every saved word, image and spent allowance without a new check', async () => {
  const checkpoint = checkpointFixture({ changedBubble: true }), original = structuredClone(checkpoint);
  const flow = workflow(checkpoint, async () => assert.fail('A default change must not spend another review.'));
  const result = await flow.run();
  assert.equal(result, checkpoint.stages.text);
  assert.deepEqual(checkpoint, original);
  assert.deepEqual(flow.preserved, []); assert.deepEqual(flow.saves, []); assert.deepEqual(flow.notes, []);
  await flow.run(); assert.deepEqual(checkpoint, original);
});
test('completed historical exports stay unchanged, including long reminders', async () => {
  const checkpoint = checkpointFixture();
  for (const stage of ['poster-export', 'poster-pdf', 'kit-pdf']) checkpoint.stages[stage].rendered = true;
  const original = structuredClone(checkpoint);
  assert.equal((await workflow(checkpoint, async () => assert.fail('No new check.')).run()).tagline, oldRhyme);
  assert.deepEqual(checkpoint, original);
});
test('kit Resume keeps legacy accepted text and does not invalidate its pictures', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'rhyme-resume-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const memory = createMemory(join(directory, 'family.json')); memory.store(family);
  const checkpoint = { ...checkpointFixture(), version: 1, kit: 1, chapterNumber: 1, tonight: sentences[0], recordAtStart: memory.exportRecord(), fitLockVersion: 3 };
  saveJSON(join(directory, 'checkpoint.json'), checkpoint);
  const transport = offlineTransport(t, directory);
  const result = await createKit(transport, memory, sentences[0], { directory, kit: 1, resume: true, stopBeforePictures: true, exports: offlineExports() });
  assert.equal(result.tagline, oldRhyme);
  const editorial = readJSON(join(directory, 'kit-editorial.json'));
  assert.equal(editorial.rhyme.tagline, oldRhyme);
  assert.equal(editorial.rhyme.approved, false);
  assert.deepEqual(transport.calls, []);
  const saved = readJSON(join(directory, 'checkpoint.json'));
  assert.deepEqual(saved.fitAttempts, checkpoint.fitAttempts);
  for (const stage of ['poster', 'panel-1', 'panel-2', 'panel-3', 'panel-4']) assert.deepEqual(saved.stages[stage], checkpoint.stages[stage]);
});
