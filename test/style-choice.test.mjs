import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../server/app-server.mjs';
import { createMemory } from '../server/memory.js';
import { setupRecord } from '../server/app-data.js';
import { readJSON, saveJSON, moves } from '../server/files.js';
import { savedKit } from './fixture.mjs';
import { defaultPictureStyleId, pictureStyleOptions } from '../app/picture-styles.js';
import { dataPolicyVersion } from '../app/data-policy.js';
const [firstStyle, secondStyle, thirdStyle] = pictureStyleOptions.map(style => style.id);

const input = (pictureStyleId, nickname = 'Mika') => ({ real: false, ...(pictureStyleId === undefined ? {} : { pictureStyleId }), nickname, age: 10, pronouns: 'they/them', loves: ['piano', 'space', 'football'], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function harness(t, options = {}) {
  const directory = options.dataDirectory ?? mkdtempSync(join(tmpdir(), 'style-choice-'));
  if (!options.dataDirectory) t.after(() => rmSync(directory, { recursive: true, force: true }));
  let keys = 0, runs = 0;
  const app = createApp({ dataDirectory: directory, sample: null, keyReader: () => { keys++; return 'fictional-test-key'; }, transportFactory: () => ({ call() { throw Error('No provider calls are allowed.'); } }), runKit: async () => { runs++; throw Error('Synthetic stop before any provider work.'); }, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = async (path, body, cookie, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(base + '/api/' + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const signup = (username, pictureStyleId) => request('signup', { username, password: 'fictional-password', family: input(pictureStyleId) });
  return { ...app, directory, request, signup, counts: () => ({ keys, runs }) };
}

test('one validated account style persists through reload and cannot change another family', async t => {
  const h = await harness(t), first = await h.signup('style_first'), second = await h.signup('style_second', secondStyle);
  assert.equal(first.status, 200); assert.equal(first.data.pictureStyleId, defaultPictureStyleId); assert.equal(first.data.record.pictureStyleId, defaultPictureStyleId);
  assert.equal((await h.request('family/style', { pictureStyleId: secondStyle })).status, 401);
  for (const pictureStyleId of ['invented', '<script>', '', null]) assert.equal((await h.request('family/style', { pictureStyleId }, first.cookie)).status, 400);
  const changed = await h.request('family/style', { pictureStyleId: thirdStyle, accountId: 'other', username: 'style_second' }, first.cookie);
  assert.equal(changed.status, 200); assert.equal(changed.data.pictureStyleId, thirdStyle);
  assert.equal((await h.request('session', undefined, second.cookie)).data.pictureStyleId, secondStyle);
  assert.equal((await h.request('login', { username: 'style_first', password: 'fictional-password' })).data.record.pictureStyleId, thirdStyle);
  assert.equal((await h.signup('style_invalid', 'invented')).status, 400);
  assert.equal(readJSON(join(h.directory, 'accounts.json')).accounts.length, 2);
  assert.deepEqual(h.counts(), { keys: 0, runs: 0 });
});

test('siblings inherit the account look and a before-photo change stamps every child without changing permission', async t => {
  const h = await harness(t), signed = await h.signup('style_siblings', secondStyle), cookie = signed.cookie;
  const rejected = await h.request('children', { family: input(firstStyle, 'Rory') }, cookie); assert.equal(rejected.status, 409);
  const child = await h.request('children', { family: input(undefined, 'Rory') }, cookie);
  assert.equal(child.status, 200); assert.ok(child.data.children.every(row => row.pictureStyleId === secondStyle));
  const changed = await h.request('family/style', { pictureStyleId: firstStyle, childId: child.data.childId }, cookie);
  assert.equal(changed.status, 200); assert.ok(changed.data.children.every(row => row.pictureStyleId === firstStyle));
  const edited = await h.request('family', { childId: child.data.childId, family: input(thirdStyle, 'Rory') }, cookie, 'PATCH');
  assert.equal(edited.status, 200); assert.ok(edited.data.children.every(row => row.pictureStyleId === thirdStyle));
  const account = readJSON(join(h.directory, 'accounts.json')).accounts[0];
  for (const id of account.childIds) {
    const path = id === 'primary' ? join(h.directory, account.id, 'family.json') : join(h.directory, account.id, 'children', id, 'family.json');
    const record = readJSON(path); assert.equal(record.pictureStyleId, thirdStyle); assert.equal(record.real, false); assert.equal(record.dataPolicyConsent, undefined); assert.equal(record.pastKits.length, 0);
  }
  const memory = createMemory(join(h.directory, account.id, 'family.json')), before = memory.exportRecord(); delete before.pictureStyleId; memory.store(before);
  assert.equal(memory.exportRecord().pictureStyleId, thirdStyle);
  assert.deepEqual(h.counts(), { keys: 0, runs: 0 });
});

test('chosen photo drawings lock the look while profile edits and sibling reuse preserve style provenance', async t => {
  const h = await harness(t), signed = await h.signup('style_photos', secondStyle), cookie = signed.cookie;
  const account = readJSON(join(h.directory, 'accounts.json')).accounts[0], memory = createMemory(join(h.directory, account.id, 'family.json'));
  const path = join(h.directory, account.id, 'fictional-selected.png'); copyFileSync(new URL('./fixtures/offline-art.png', import.meta.url), path); const bytesHash = hash(readFileSync(path));
  const record = memory.exportRecord(); for (const person of record.cast) Object.assign(person, { referencePath: path, referenceHash: bytesHash, referenceSource: 'photo', portraitCandidateId: 'fictional-choice', referenceStyleId: secondStyle, referenceStyleVersion: 'fixture-film-v1' });
  record.hero.heroPicturePath = path; memory.store(record);
  assert.equal((await h.request('session', undefined, cookie)).data.canChangePictureStyle, false);
  const blocked = await h.request('family/style', { pictureStyleId: firstStyle }, cookie); assert.equal(blocked.status, 409); assert.match(blocked.data.message, /saved drawings|unfinished/);
  assert.equal((await h.request('family', { family: input(firstStyle) }, cookie, 'PATCH')).status, 409);
  const edited = await h.request('family', { family: input(secondStyle) }, cookie, 'PATCH'); assert.equal(edited.status, 200);
  assert.equal(edited.data.record.cast[1].referenceStyleId, secondStyle); assert.equal(edited.data.record.cast[1].referenceStyleVersion, 'fixture-film-v1');
  const child = await h.request('children', { family: input(secondStyle, 'Rory'), reuseGrownUpsFromChildId: 'primary' }, cookie); assert.equal(child.status, 200); assert.equal(child.data.record.cast[1].referenceStyleId, secondStyle);
  assert.equal(hash(readFileSync(path)), bytesHash); assert.deepEqual(h.counts(), { keys: 0, runs: 0 });
});

test('new kit jobs take the account style and unfinished jobs cannot renew the style choice', async t => {
  const h = await harness(t), signed = await h.signup('style_jobs', secondStyle), cookie = signed.cookie;
  const picked = await h.request('pick', { tonight: 'The homework felt hard.' }, cookie), moveId = picked.data.suggestions[0].id;
  const job = await h.request('jobs', { tonight: 'The homework felt hard.', moveId, pictureStyleId: firstStyle }, cookie);
  assert.equal(job.status, 202); assert.equal(job.data.pictureStyleId, secondStyle);
  for (let count = 0; count < 30; count++) { if ((await h.request('jobs/' + job.data.id, undefined, cookie)).data.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 5)); }
  const before = readFileSync(join(h.directory, 'daily-budget.json'));
  assert.equal((await h.request('family/style', { pictureStyleId: firstStyle }, cookie)).status, 409);
  assert.equal((await h.request('session', undefined, cookie)).data.pictureStyleId, secondStyle);
  assert.deepEqual(readFileSync(join(h.directory, 'daily-budget.json')), before);
  assert.equal(h.counts().runs, 1);
});

test('missing legacy style maps to detailed without relabelling drawings, rewriting saved history or spending', async t => {
  const h = await harness(t), signed = await h.signup('style_legacy', 'detailed-comic');
  const stateFile = join(h.directory, 'accounts.json'), db = readJSON(stateFile), account = db.accounts[0], file = join(h.directory, account.id, 'family.json');
  const record = readJSON(file); delete record.pictureStyleId; delete account.pictureStyleId;
  record.pastKits = [savedKit({ chapterNumber: 1, adventureLine: 'A fictional saved moment stays exactly here.' })];
  const path = join(h.directory, account.id, 'legacy-selected.png'); copyFileSync(new URL('./fixtures/offline-art.png', import.meta.url), path);
  const imageHash = hash(readFileSync(path)); Object.assign(record.cast[0], { referenceSource: 'photo', referencePath: path, referenceHash: imageHash, portraitCandidateId: 'legacy-fictional-choice' }); record.hero.heroPicturePath = path;
  saveJSON(file, record); saveJSON(stateFile, db); const beforeRevision = record.revision, beforeHistory = structuredClone(record.pastKits), budget = readFileSync(join(h.directory, 'daily-budget.json'));
  await h.close(); const restart = await harness(t, { dataDirectory: h.directory });
  const login = await restart.request('login', { username: 'style_legacy', password: 'fictional-password' });
  assert.equal(login.data.pictureStyleId, 'detailed-comic'); assert.equal(login.data.record.pictureStyleId, 'detailed-comic'); assert.equal(login.data.canChangePictureStyle, false);
  assert.deepEqual(login.data.record.pastKits, beforeHistory); assert.equal(login.data.record.revision, beforeRevision); assert.equal(hash(readFileSync(path)), imageHash);
  assert.equal(login.data.record.cast[0].referenceStyleId, undefined);
  assert.equal((await restart.request('family/style', { pictureStyleId: 'classic-comic' }, login.cookie)).status, 409);
  assert.deepEqual(readFileSync(join(h.directory, 'daily-budget.json')), budget); assert.deepEqual(restart.counts(), { keys: 0, runs: 0 });
});

test('selected description drawings survive edits and sibling reuse and satisfy the real-family drawing prerequisite', async t => {
  const h = await harness(t), family = { ...input(defaultPictureStyleId), real: true, age: 13, dataPolicyConsent: { accepted: true, version: dataPolicyVersion } };
  const signed = await h.request('signup', { username: 'described_family', password: 'fictional-password', family }); assert.equal(signed.status, 200);
  const cookie = signed.cookie, account = readJSON(join(h.directory, 'accounts.json')).accounts[0], memory = createMemory(join(h.directory, account.id, 'family.json'));
  const path = join(h.directory, account.id, 'fictional-described-reference.png'); copyFileSync(new URL('./fixtures/offline-art.png', import.meta.url), path);
  const record = memory.exportRecord(), imageHash = hash(readFileSync(path));
  for (const person of record.cast) Object.assign(person, { referenceSource: 'description', referencePath: path, referenceHash: imageHash, portraitCandidateId: 'fixture-description-choice', referenceStyleId: defaultPictureStyleId, referenceStyleVersion: 'fixture-only' });
  record.hero.heroPicturePath = path; memory.store(record);
  const edited = await h.request('family', { family }, cookie, 'PATCH'); assert.equal(edited.status, 200); assert.equal(edited.data.record.cast[0].referenceSource, 'description');
  const sibling = await h.request('children', { family: { ...family, nickname: 'Rory' }, reuseGrownUpsFromChildId: 'primary' }, cookie); assert.equal(sibling.status, 200); assert.equal(sibling.data.record.cast[1].referenceSource, 'description');
  await h.request('children/current', { childId: 'primary' }, cookie, 'PATCH');
  const pick = await h.request('pick', { tonight: 'The homework felt hard.' }, cookie);
  const job = await h.request('jobs', { tonight: 'The homework felt hard.', moveId: pick.data.suggestions[0].id }, cookie);
  assert.equal(job.status, 202, JSON.stringify(job.data)); assert.equal(hash(readFileSync(path)), imageHash);
});
