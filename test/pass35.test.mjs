import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { geometryAnswer } from './checker-fixture.mjs';
import { join } from 'node:path';
import { createApp } from '../server/app-server.mjs';
import { setupRecord } from '../server/app-data.js';
import { moves, root, readJSON, extractJSON } from '../server/files.js';
import { buildPictureRequest, buildPosterRequest, buildPanelRequest, buildWordCheckRequest, buildCastCheckRequest, buildPictureCheckRequest, assertNoFamilyText, privacyFor } from '../server/requests.js';
import { carryCodeDigits } from '../server/picture-code-digits.js';
import { exportAttempt } from '../server/export-attempt.js';
import { runCheck } from '../server/checker-contract.js';
import { callStructured } from '../server/structured-call.js';
import { offlineTransport, offlineExports } from './offline-kit-fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { appJobClient, waitAppJob } from './app-job-client.mjs';
import { runPaidAppKit } from './run-app-kit.mjs';

const out = join(root, 'context/pass35-tests'); mkdirSync(out, { recursive: true });
const temp = () => mkdtempSync(join(out, 'case-'));
const family = (pronouns = 'he/him') => ({ real: false, nickname: 'Pip', age: 8, pronouns, loves: ['comics', 'space', 'puzzles'], presetId: 'comet',
  familyContext: 'Pip is 8. There are 2 children, ages 8 and 11. Flat purple marbles belong in the cupboard.',
  parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] });
const tonight = 'The homework felt hard and frustrating.';
async function start(t, options = {}) {
  const directory = options.dataDirectory ?? temp();
  const app = createApp({ dataDirectory: directory, sample: null, sampleOnly: false, keyReader: () => 'offline-key', ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  return { ...app, directory, request: appJobClient(`http://127.0.0.1:${app.server.address().port}`) };
}
async function makeJob(request, input = family()) {
  const signup = await request('signup', { username: 'fixture_family', password: 'fictional-password', family: input }); assert.equal(signup.status, 200);
  const picked = await request('pick', { tonight }); assert.equal(picked.data.status, 'eligible');
  const created = await request('jobs', { tonight, moveId: 'name-it-exactly' }); assert.equal(created.status, 202);
  return created.data.id;
}
const wait = (request, id) => waitAppJob(request, id, { interval: 10, maxPolls: 1000 });
const privateJob = (directory, id) => readJSON(join(directory, 'accounts.json')).jobs.find(job => job.id === id);
const jobDirectory = (directory, id) => join(directory, privateJob(directory, id).accountId, id);

test('fixed request numbers do not collide with family ages; dynamic digits and identities still fail', () => {
  const record = setupRecord(family()), move = moves[0], text = kitText(move), privacy = privacyFor(record, tonight, move);
  const builders = [
    () => buildPictureRequest(record, move, tonight, { hero: true }),
    () => buildPosterRequest(record, move, tonight, text),
    () => buildPanelRequest(record, move, tonight, text.panelLines[0]),
    () => buildWordCheckRequest(record, move, tonight, 'data:image/png;base64,AA=='),
    () => buildWordCheckRequest(record, move, tonight, 'data:image/png;base64,AA==', { panel: text.panelLines[0] }),
    () => buildPictureCheckRequest(record, move, tonight, 'data:image/png;base64,AA=='),
    () => buildCastCheckRequest(record, move, tonight, [], []),
  ];
  for (const build of builders) assert.equal(assertNoFamilyText(build(), privacy), true);
  for (const value of ['I have 2 marbles.', 'I have 8 marbles.', 'Pip is here.']) {
    assert.throws(() => buildPanelRequest(record, move, tonight, { scene: value, line: 'This feels hard.' }), /OpenAI request contains/);
    assert.throws(() => buildPosterRequest(record, move, tonight, { ...text, jokeIdea: value }), /OpenAI request contains/);
    assert.throws(() => buildWordCheckRequest(record, move, tonight, 'data:image/png;base64,AA==', { jokeIdea: value }), /OpenAI request contains/);
  }
  assert.doesNotThrow(() => buildPanelRequest(record, move, tonight, { scene: 'Flat purple marbles wait.', line: 'This feels hard.' }), 'Ordinary colour and object phrases remain usable in pictures.');
  const poster = builders[1](); poster.prompt += '\nI have 2 marbles.';
  assert.throws(() => assertNoFamilyText(poster, privacy), /digit token/);
  const checker = builders[3](); checker.text.format.schema.properties.jokeInScene.description += ' Pip';
  assert.throws(() => assertNoFamilyText(checker, privacy), /nickname|hero name/);
  const forged = { model: 'gpt-image-2', prompt: 'I have 2 marbles.', codeOwned: true };
  assert.throws(() => assertNoFamilyText(forged, privacy), /digit token/);
  const clone = carryCodeDigits(builders[3](), builders[3]());
  const data = JSON.parse(clone.input[0].content[0].text); data.expectedJoke = 'There are 2 marbles.'; clone.input[0].content[0].text = JSON.stringify(data);
  assert.throws(() => assertNoFamilyText(clone, privacy), /digit token/);
});

test('schema fallback retains fixed numbers and unverified measurements without another check', async () => {
  const record = setupRecord(family()), move = moves[0], privacy = privacyFor(record, tonight, move);
  let calls = 0;
  const transport = { recordRejection() {}, async call(request) {
    assertNoFamilyText(request.body, request.privacy); calls++;
    if (calls === 1) throw Object.assign(new Error('Fixture schema rejection.'), { schemaRejected: true });
    return {};
  } };
  const request = { stage: 'poster-word-check', privacy, body: buildWordCheckRequest(record, move, tonight, 'data:image/png;base64,AA==') };
  let parsed = 0;
  const result = await runCheck(transport, request, () => ++parsed === 1 ? { ready: false, needsRecheck: true, faults: [], measurementFaults: ['Measure box 8 at 11 source pixels.'] } : { ready: true, faults: [] });
  assert.equal(calls, 2); assert.equal(parsed, 1);
  assert.equal(result.verified, false); assert.equal(result.needsRecheck, false);
  assert.deepEqual(result.unresolvedMeasurements, ['Measure box 8 at 11 source pixels.']);
  const unsafe = buildWordCheckRequest(record, move, tonight, 'data:image/png;base64,AA==');
  const data = JSON.parse(unsafe.input[0].content[0].text); data.actionLine = 'Pip carries 2 marbles.'; unsafe.input[0].content[0].text = JSON.stringify(data);
  await assert.rejects(callStructured(transport, { stage: 'poster-word-check', privacy, body: unsafe }), /nickname|digit token/);
});

test('the paid app command requires its explicit flag before starting anything', async () => {
  await assert.rejects(runPaidAppKit([]), /Paid calls require/);
  await assert.rejects(runPaidAppKit(['--paid', '--new-budget']), /Paid calls require/);
});

for (const pronouns of ['he/him', 'she/her', 'they/them']) test(`whole kit completes through HTTP job runner for ${pronouns}, using offline provider answers`, async t => {
  const directory = temp(); let modelTransport;
  const app = await start(t, { dataDirectory: directory, kitExports: offlineExports(), transportFactory: options => {
    modelTransport = offlineTransport(t, directory, () => undefined, { maxCalls: options.maxCalls, budget: options.budget });
    return modelTransport;
  } });
  const id = await makeJob(app.request, family(pronouns)), job = await wait(app.request, id);
  assert.equal(job.status, 'complete', JSON.stringify(privateJob(directory, id).lastFailure));
  assert.equal(job.stage, 'ready'); assert.equal(job.result.sample, false);
  const fixed = privateJob(directory, id).referenceSnapshot;
  assert.ok(fixed.cast.every(person => person.referencePath && person.referenceHash), 'Legacy bootstrap fills and pins every checked reference in this job.');
  const profile = readJSON(join(directory, privateJob(directory, id).accountId, 'family.json'));
  assert.deepEqual(profile.cast.map(person => person.outfit), setupRecord(family(pronouns)).cast.map(person => person.outfit), 'Per-kit outfits do not replace the saved family clothes.');
  assert.ok(modelTransport.calls.some(request => request.stage === 'story'));
  assert.ok(modelTransport.calls.some(request => request.stage === 'poster-word-check'));
  assert.ok(!modelTransport.calls.some(request => request.stage === 'cast-continuity-check'));
  for (const file of ['poster.png', 'poster.pdf', 'kit_final.pdf', 'panel-1.png', 'panel-4.png']) assert.equal((await app.request(`jobs/${id}/files/${file}`)).status, 200);
  for (const file of ['failure.json', 'job-events.jsonl', 'checkpoint.json']) assert.equal((await app.request(`jobs/${id}/files/${file}`)).status, 404);
  const session = await app.request('session'); assert.equal(session.data.record.pastKits.length, 1); assert.equal(session.data.jobs[0].status, 'complete');
  assert.doesNotMatch(JSON.stringify(session.data), /lastFailure|privateStage|offline-key|\/Users\//);
  assert.equal(app.budget.status().reserved, 0); assert.equal(app.budget.status().spent, 0);
  const kit = jobDirectory(directory, id), checkpoint = readJSON(join(kit, 'checkpoint.json'));
  assert.ok(checkpoint.stages['kit-pdf'].sha256);
  assert.match(readFileSync(join(kit, 'job-events.jsonl'), 'utf8'), /"event":"complete"/);
  assert.equal((readFileSync(join(kit, 'kit_final.html'), 'utf8').match(/data-page=/g) ?? []).length, 5);
});

test('failed inspection keeps private reason and all paid stages; resume replaces orphan PDF with no new calls', async t => {
  const directory = temp(), exporters = offlineExports(); let reject = true, modelTransport;
  const app = await start(t, { dataDirectory: directory, kitExports: { ...exporters,
    renderKitPDF: (html, path, options = {}) => exportAttempt(path, options, async candidate => {
      const result = await exporters.renderKitPDF(html, candidate, options);
      if (!options.posterOnly && reject) {
        reject = false;
        copyFileSync(candidate, path); // Historical orphan left by pre-pass35 renderer.
        return { rendered: false, reason: 'Fixture PDF inspection failed at top 32.55pt.' };
      }
      return result;
    }),
  }, transportFactory: options => { modelTransport = offlineTransport(t, directory, () => undefined, { maxCalls: options.maxCalls, budget: options.budget }); return modelTransport; } });
  const id = await makeJob(app.request), failed = await wait(app.request, id);
  assert.equal(failed.status, 'failed'); assert.doesNotMatch(JSON.stringify(failed), /32.55|failure.json|lastFailure|\/Users\//);
  const kit = jobDirectory(directory, id), failure = readJSON(join(kit, 'failure.json'));
  assert.match(failure.error.message, /32.55pt/); assert.match(failure.error.stack, /kit.js/); assert.equal(failure.stage, 'kit-pdf');
  assert.equal(statSync(join(kit, 'failure.json')).mode & 0o777, 0o600);
  assert.equal(privateJob(directory, id).lastFailure.error.message, failure.error.message);
  const before = readdirSync(kit).filter(name => /^story-attempt|picture-check/.test(name));
  const calls = modelTransport.calls.length;
  assert.equal((await app.request(`jobs/${id}/resume`, {})).status, 202);
  const resumed = await wait(app.request, id); assert.equal(resumed.status, 'complete', JSON.stringify(privateJob(directory, id).lastFailure));
  // The factory is reconstructed on resume. Every model stage is checkpointed.
  assert.equal(modelTransport.calls.length, 0); assert.ok(calls > 10);
  assert.deepEqual(readdirSync(kit).filter(name => /^story-attempt|picture-check/.test(name)), before);
  assert.ok(existsSync(join(kit, 'failure-001.json')));
  assert.equal((await app.request('session')).data.record.pastKits.length, 1);
  assert.equal(app.budget.status().reserved, 0);
});

test('startup, thrown errors and returned failures all keep redacted private evidence on every attempt', async t => {
  for (const mode of ['key', 'throw', 'return']) {
    const directory = temp(), secret = 'fixture-secret-never-print';
    const app = await start(t, { dataDirectory: directory, keyReader: () => { if (mode === 'key') throw Error('Fixture Keychain denied.'); return secret; },
      transportFactory: () => ({ call: async () => { throw Error('No model request expected.'); } }),
      runKit: async () => {
        if (mode === 'throw') throw new Error(`Fixture privacy failure ${secret}`, { cause: new Error('Fixture underlying reason.') });
        return { complete: false, pdf: { rendered: false, reason: 'Fixture saved PDF was invalid.' } };
      },
    });
    const id = await makeJob(app.request); assert.equal((await wait(app.request, id)).status, 'failed');
    assert.equal((await app.request(`jobs/${id}/resume`, {})).status, 202); assert.equal((await wait(app.request, id)).status, 'failed');
    const kit = jobDirectory(directory, id), failure = readJSON(join(kit, 'failure-002.json'));
    assert.match(failure.error.message, mode === 'key' ? /Keychain denied/ : mode === 'throw' ? /privacy failure \[redacted\]/ : /PDF was invalid/);
    if (mode === 'throw') assert.equal(failure.error.cause.message, 'Fixture underlying reason.');
    assert.equal(failure.attempt, 2);
    assert.doesNotMatch(readFileSync(join(directory, 'accounts.json'), 'utf8'), new RegExp(secret));
    assert.doesNotMatch(readFileSync(join(kit, 'job-events.jsonl'), 'utf8'), new RegExp(secret));
    assert.doesNotMatch(JSON.stringify((await app.request('session')).data), /Keychain denied|underlying reason|lastFailure|redacted|invalid|privacy failure/);
  }
});

test('resume retains older picture receipts and finishes export without repurchasing art or text', async t => {
  const directory = temp(), exporters = offlineExports(); let reject = true, modelTransport;
  const app = await start(t, { dataDirectory: directory, kitExports: { ...exporters, async renderKitPDF(html, path, options = {}) {
    if (!options.posterOnly && reject) { reject = false; return { rendered: false, reason: 'Fixture interrupted before full PDF export.' }; }
    return exporters.renderKitPDF(html, path, options);
  } }, transportFactory: options => { modelTransport = offlineTransport(t, directory, () => undefined, { maxCalls: options.maxCalls, budget: options.budget }); return modelTransport; } });
  const id = await makeJob(app.request); assert.equal((await wait(app.request, id)).status, 'failed');
  const kit = jobDirectory(directory, id), path = join(kit, 'checkpoint.json'), checkpoint = readJSON(path);
  const legacy = checkpoint.stages.poster.checks.at(-1).answers;
  for (const observation of legacy.castObservations) delete observation.appearance;
  // This synthetic older receipt predates explicit writable rows and the
  // durable candidate registry. Its original observations remain evidence.
  legacy.geometry = geometryAnswer(); delete legacy.geometry.writableRows;
  delete checkpoint.stages.poster.generationRuleVersion;
  rmSync(join(kit, 'poster-drawing-state.json'));
  const originalLegacy = structuredClone(legacy);
  const images = Object.entries(checkpoint.stages).filter(([name]) => name === 'poster' || /^panel-\d$/.test(name))
    .map(([name, picture]) => ({ name, hash: picture.hash, bytes: readFileSync(picture.path) }));
  const { saveJSON } = await import('../server/files.js'); saveJSON(path, checkpoint);
  assert.equal((await app.request(`jobs/${id}/resume`, {})).status, 202);
  assert.equal((await wait(app.request, id)).status, 'complete', JSON.stringify(privateJob(directory, id).lastFailure));
  assert.deepEqual(modelTransport.calls, []);
  const updated = readJSON(path); assert.deepEqual(updated.stages.poster.checks.at(-1).answers, originalLegacy);
  for (const image of images) {
    assert.equal(updated.stages[image.name].hash, image.hash);
    assert.deepEqual(readFileSync(updated.stages[image.name].path), image.bytes);
  }
});

test('all export kinds publish inspected candidates and retain rejected/previous bytes', async () => {
  for (const name of ['poster.png', 'poster.pdf', 'kit_final.pdf']) {
    const directory = temp(), path = join(directory, name); writeFileSync(path, 'old unaccepted bytes');
    const rejected = await exportAttempt(path, { replaceUnaccepted: true }, async candidate => { writeFileSync(candidate, 'bad new bytes'); return { rendered: false, reason: 'Fixture inspection failed.' }; });
    assert.equal(readFileSync(path, 'utf8'), 'old unaccepted bytes'); assert.equal(readFileSync(rejected.candidate, 'utf8'), 'bad new bytes');
    const accepted = await exportAttempt(path, { replaceUnaccepted: true }, async candidate => { writeFileSync(candidate, 'accepted bytes'); return { rendered: true }; });
    assert.equal(readFileSync(path, 'utf8'), 'accepted bytes'); assert.equal(readFileSync(accepted.candidate, 'utf8'), 'accepted bytes');
    await assert.rejects(exportAttempt(path, {}, async () => assert.fail('Must not render')), /Refusing to overwrite/);
  }
});
