import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { createApp } from '../server/app-server.mjs';
import { createAppBudget } from '../server/app-budget.js';
import { parentResponse } from '../server/route.js';
import { preparePick } from '../server/picker.js';
import { parentJobFailure, requireCompleteKit } from '../server/job-failure.js';
import { readJSON, saveJSON } from '../server/files.js';
import { appJobClient, waitAppJob } from './app-job-client.mjs';

const fixture = readJSON(new URL('./fixtures/fictional-theo-exhausted-fit.json', import.meta.url));
const directoryFor = t => {
  const directory = mkdtempSync(join(tmpdir(), 'saved-lesson-fit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
};
function savedCase(t, tonight = fixture.checkpoint.tonight) {
  const directory = directoryFor(t), checkpoint = structuredClone(fixture.checkpoint);
  checkpoint.tonight = tonight;
  const file = join(directory, 'checkpoint.json'); saveJSON(file, checkpoint);
  const memory = createMemory(join(directory, 'family.json')); memory.store(checkpoint.recordAtStart);
  return { directory, checkpoint, memory, file, original: readFileSync(file) };
}

test('an unknown selected guide stops resume without buying or changing saved work', async t => {
  const saved = savedCase(t), selected = 'retired-fixture-guide';
  assert.equal(saved.checkpoint.stages.text.moveId, 'name-it-exactly');
  assert.equal(preparePick(saved.checkpoint.recordAtStart, saved.checkpoint.tonight, { chosenMoveId: selected }).status, 'noMatch');
  let calls = 0;
  const transport = { call: async () => { calls++; assert.fail('No provider request is allowed.'); } };
  const art = join(saved.directory, 'panel-1.png');
  writeFileSync(art, readFileSync(new URL('./fixtures/offline-art.png', import.meta.url)));
  const originalArt = readFileSync(art);
  for (let run = 0; run < 2; run++) {
    await assert.rejects(createKit(transport, saved.memory, saved.checkpoint.tonight, { kit: saved.checkpoint.kit, directory: saved.directory, resume: true, chosenMoveId: selected }), error => {
      assert.equal(error.code, 'saved_lesson_fit_review_required'); assert.equal(error.canResume, false);
      const failure = parentJobFailure(error);
      assert.equal(failure.kind, 'review'); assert.equal(failure.canResume, false); assert.match(failure.message, /check Tonight again/);
      return true;
    });
    assert.deepEqual(readFileSync(saved.file), saved.original);
    assert.deepEqual(readFileSync(art), originalArt);
  }
  assert.equal(calls, 0);
});

test('an unavailable explicit choice stays ordinary until a completion boundary makes it terminal', async t => {
  const saved = savedCase(t, 'A purple comet.');
  const result = preparePick(saved.checkpoint.recordAtStart, saved.checkpoint.tonight, { chosenMoveId: 'missing-guide' });
  assert.equal(result.status, 'noMatch'); assert.deepEqual(result.suggestions, []);
  assert.throws(() => requireCompleteKit(result), error => {
    assert.equal(error.code, 'saved_lesson_fit_review_required'); assert.equal(parentJobFailure(error).canResume, false); return true;
  });
  assert.deepEqual(readFileSync(saved.file), saved.original);
});

test('protective copy stays source-owned and sends a saved job back to Tonight without a retry', async t => {
  const note = 'He forgot his library book. Just listen tonight.';
  const saved = savedCase(t, note), expected = parentResponse(note);
  const result = await createKit({ call: async () => assert.fail('No provider request is allowed.') }, saved.memory, note, { kit: saved.checkpoint.kit, directory: saved.directory, resume: true, chosenMoveId: 'name-it-exactly' });
  assert.deepEqual(result, expected);
  assert.throws(() => requireCompleteKit(result), error => {
    assert.deepEqual(error.details.parentResponse, expected);
    const failure = parentJobFailure(error);
    assert.equal(failure.canResume, false); assert.match(failure.message, /Check Tonight again.*parent guidance/);
    return true;
  });
  assert.deepEqual(readFileSync(saved.file), saved.original);
});

test('a terminal saved page review survives reload and keeps work and charges when set aside', async t => {
  const directory = directoryFor(t), id = randomUUID(), credentials = { username: 'saved_no_fit', password: 'fictional-password' };
  let app, request, calls = 0, keyReads = 0;
  const start = async () => {
    app = createApp({ dataDirectory: directory, sample: null, sampleOnly: false,
      keyReader: () => { keyReads++; return 'offline-fixture-never-sent'; },
      transportFactory: () => ({ call: async () => { calls++; assert.fail('No provider request is allowed.'); } }),
    });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    request = appJobClient(`http://127.0.0.1:${app.server.address().port}`);
  };
  t.after(async () => { if (app?.server.listening) await app.close(); });
  await start();
  assert.equal((await request('signup', { ...credentials, family: { real: false, nickname: 'Theo', age: 8, pronouns: 'he/him', loves: ['books', 'space', 'games'], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] } })).status, 200);
  // An unknown explicit guide still ends normally without creating a paid job.
  const fresh = await request('jobs', { tonight: 'A purple comet.', moveId: 'missing-guide' });
  assert.equal(fresh.status, 200); assert.equal(fresh.data.status, 'noMatch'); assert.equal(keyReads, 0);
  await app.close();
  const stateFile = join(directory, 'accounts.json'), state = readJSON(stateFile), account = state.accounts[0];
  const checkpoint = structuredClone(fixture.checkpoint);
  checkpoint.tonight = 'A purple comet.';
  checkpoint.savedLayoutRevision = { status: 'review' }; // Synthetic terminal page-fit fixture, not a measured result.
  const jobDirectory = join(directory, account.id, id), file = join(jobDirectory, 'checkpoint.json');
  saveJSON(file, checkpoint);
  const asset = join(jobDirectory, 'panel-1.png'); writeFileSync(asset, readFileSync(new URL('./fixtures/offline-art.png', import.meta.url)));
  const before = readFileSync(file), artBefore = readFileSync(asset);
  state.jobs.push({ id, accountId: account.id, childId: 'primary', status: 'failed', canResume: true, stage: 'writing', tonight: checkpoint.tonight, moveId: checkpoint.stages.text.moveId, chapterNumber: checkpoint.kit, createdAt: '2026-10-15T20:00:00Z', attempt: 3 });
  saveJSON(stateFile, state);
  // These retained charges are a synthetic budget fixture, not paid usage.
  const budget = createAppBudget(join(directory, 'daily-budget.json'));
  budget.settle(budget.reserve(0.42), 0.42);
  await start(); await request('login', credentials);
  const charges = readFileSync(join(directory, 'daily-budget.json'));
  assert.equal((await request(`jobs/${id}/resume`, {})).status, 202);
  const failed = await waitAppJob(request, id, { interval: 5, maxPolls: 100 });
  assert.equal(failed.status, 'failed'); assert.equal(failed.canResume, false); assert.equal(failed.canSetAside, true);
  assert.match(failed.message, /saved story still does not fit.*set it aside/);
  const attempted = readJSON(stateFile).jobs[0].attempt; assert.equal(attempted, 4);
  for (let retry = 0; retry < 2; retry++) assert.equal((await request(`jobs/${id}/resume`, {})).status, 409);
  assert.equal(keyReads, 1); assert.equal(calls, 0);
  await app.close(); await start(); await request('login', credentials);
  assert.equal((await request(`jobs/${id}`)).data.canResume, false);
  assert.equal((await request(`jobs/${id}/resume`, {})).status, 409);
  assert.equal((await request(`jobs/${id}/set-aside`, {})).status, 200);
  const kept = (await request(`jobs/${id}`)).data;
  assert.equal(kept.status, 'set-aside'); assert.equal(kept.canResume, false);
  assert.deepEqual(readFileSync(file), before); assert.deepEqual(readFileSync(asset), artBefore);
  assert.deepEqual(readFileSync(join(directory, 'daily-budget.json')), charges);
  assert.equal(readJSON(stateFile).jobs[0].attempt, attempted);
  assert.equal(keyReads, 1); assert.equal(calls, 0);
});
