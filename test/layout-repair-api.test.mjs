import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app-server.mjs';
import { readJSON, saveJSON, moves } from '../server/files.js';
import { geometryRuleVersion } from '../server/poster-template.js';
import { kitText } from './kit-text-fixture.mjs';
import { offlineSample } from './offline-kit-fixture.mjs';
import { appJobClient, waitAppJob } from './app-job-client.mjs';

test('only a legacy writing-space failure gets one explicit bounded layout revision, with old work retained', async t => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'layout-repair-api-'));
  const sample = await offlineSample(join(dataDirectory, 'synthetic-exports'));
  let app, request, original, repairedOptions;
  t.after(async () => { if (app?.server.listening) await app.close(); rmSync(dataDirectory, { recursive: true, force: true }); });
  const start = async runKit => {
    app = createApp({ dataDirectory, sample: null, sampleOnly: false, keyReader: () => 'offline-only', transportFactory: () => ({ call: async () => assert.fail('This API test makes no model calls.') }), runKit });
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    request = appJobClient(`http://127.0.0.1:${app.server.address().port}`);
  };
  await start(async (transport, memory, tonight, options) => {
    original = { version: 1, kit: 1, tonight, recordAtStart: memory.exportRecord(), stages: { text: { ...kitText(moves[0]), ready: true }, hero: { fixture: 'saved person' }, 'panel-1': { fixture: 'saved panel' }, poster: { fixture: 'old image' }, 'cast-continuity': { fixture: 'old verdict' }, 'poster-export': { fixture: 'old export' } } };
    saveJSON(join(options.directory, 'checkpoint.json'), original);
    transport.onStage('poster-word-check');
    throw Error('poster failed: insufficient_handwriting_space: old underline-only measurement');
  });
  const credentials = { username: 'layout_test', password: 'fictional-password' };
  assert.equal((await request('signup', { ...credentials, family: { real: false, nickname: 'Mika', age: 10, pronouns: 'they/them', loves: ['books', 'space', 'games'], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] } })).status, 200);
  const created = await request('jobs', { tonight: 'Homework felt frustrating.', moveId: 'name-it-exactly' });
  assert.equal(created.status, 202);
  const id = created.data.id;
  const failed = await waitAppJob(request, id, { interval: 5, maxPolls: 100 });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.canRepairLayout, false, 'a current-rule failure cannot renew its drawing allowance');
  assert.equal((await request(`jobs/${id}/repair-layout`, {})).status, 409);
  await app.close();
  const dbFile = join(dataDirectory, 'accounts.json'), db = readJSON(dbFile), savedJob = db.jobs.find(job => job.id === id);
  delete savedJob.geometryRuleVersion; saveJSON(dbFile, db); // Explicit historical fixture.
  await start(async (_transport, memory, _tonight, options) => {
    repairedOptions = options;
    const checkpoint = readJSON(join(options.directory, 'checkpoint.json'));
    assert.deepEqual(checkpoint.stages.text, original.stages.text);
    assert.deepEqual(checkpoint.stages.hero, original.stages.hero);
    assert.deepEqual(checkpoint.stages['panel-1'], original.stages['panel-1']);
    for (const stage of ['poster', 'cast-continuity', 'poster-export']) assert.equal(checkpoint.stages[stage], undefined);
    for (const file of ['poster.png', 'poster.pdf', 'kit_final.pdf']) copyFileSync(join(sample.directory, file), join(options.directory, file));
    return { ...kitText(moves[0]), move: moves[0], recordAtStart: memory.exportRecord(), complete: true, world: 'comic strip', colourSet: 'warm' };
  });
  assert.equal((await request(`jobs/${id}/repair-layout`, {})).status, 401);
  assert.equal((await request('login', credentials)).status, 200);
  assert.equal((await request(`jobs/${id}`)).data.canRepairLayout, true);
  assert.equal((await request(`jobs/${id}/repair-layout`, { layoutRevision: '../../forged' })).status, 202);
  const done = await waitAppJob(request, id, { interval: 5, maxPolls: 100 });
  assert.equal(done.status, 'complete'); assert.equal(done.canRepairLayout, false);
  assert.equal(repairedOptions.layoutRevision, geometryRuleVersion);
  assert.equal(repairedOptions.resume, true);
  const directory = join(dataDirectory, savedJob.accountId, id);
  assert.deepEqual(readJSON(join(directory, 'layout-revisions', `${geometryRuleVersion}-before.json`)), original);
  const after = readJSON(dbFile).jobs.find(job => job.id === id);
  assert.equal(after.layoutRevision, geometryRuleVersion);
  assert.equal((await request(`jobs/${id}/repair-layout`, {})).status, 200, 'completed job returns its saved result and starts no new work');
});
