import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../server/app-server.mjs';
import { normalizePhoto, photoByteLimit, portraitFingerprint } from '../server/portraits.js';
import { lockedCast } from '../server/cast.js';
import { lookFlowVersion } from '../app/picture-styles.js';
import { createTransport } from '../server/transport.js';
import { setupRecord } from '../server/app-data.js';
import { buildPortraitRequest, privacyFor } from '../server/requests.js';
import { readJSON, saveJSON, root } from '../server/files.js';
import { createMemory } from '../server/memory.js';
import { readyCastReferences } from '../server/picture.js';

const family = () => ({ real: false, pictureStyleId: 'classic-comic', nickname: 'Pip', age: 10, pronouns: 'he/him', loves: ['comics', 'soccer', 'space'], presetId: 'comet', familyContext: 'Fictional household.', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] });
const picture = (red = 20) => sharp({ create: { width: 40, height: 60, channels: 3, background: { r: red, g: 140, b: 40 } } }).png().toBuffer();
const photo = async () => ({ mime: 'image/png', base64: (await picture()).toString('base64') });
const fixtureRoot = join(root, 'context/portrait-tests'); mkdirSync(fixtureRoot, { recursive: true });
const temp = t => { const dir = mkdtempSync(join(fixtureRoot, 'fixture-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
async function start(t, options = {}) {
  const dataDirectory = options.dataDirectory ?? temp(t);
  const app = createApp({ dataDirectory, sample: null, sampleOnly: false, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.server.listening ? app.close() : undefined);
  const request = async (path, data, cookie, method = data === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: response.status, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0], data: response.headers.get('content-type')?.includes('json') ? await response.json() : Buffer.from(await response.arrayBuffer()) };
  };
  return { ...app, dataDirectory, request };
}
const signup = (app, username = 'fictional') => app.request('signup', { username, password: 'only-fictional-fixture', family: family() });
// Answers every drawing check as the same person in the expected look, so a
// test's own counter sees drawing requests only.
const checked = call => async request => /-check$/.test(request.stage) ? identityReply(request) : call(request);
async function settle(app, cookie) {
  for (let i = 0; i < 100; i++) {
    const result = await app.request('portraits?childId=primary', undefined, cookie);
    if (result.data.people[0].job?.status !== 'running') return result.data.people[0];
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error('Fixture job did not settle');
}

test('photo decoder rejects mismatched, corrupt, excessive and non-image data; strips metadata and rotates', async () => {
  const png = await picture();
  await assert.rejects(normalizePhoto({ mime: 'image/jpeg', base64: png.toString('base64') }), /does not match/);
  await assert.rejects(normalizePhoto({ mime: 'image/png', base64: png.subarray(0, 24).toString('base64') }), /could not be opened/);
  await assert.rejects(normalizePhoto({ mime: 'image/png', base64: 'https://example.com/photo.png' }), /Choose/);
  await assert.rejects(normalizePhoto({ mime: 'image/png', base64: 'A'.repeat(Math.ceil(photoByteLimit / 3) * 4 + 4) }), /under 8 MB/);
  await assert.rejects(normalizePhoto({ mime: 'image/png', base64: 'AB==' }), /Choose/);
  const large = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: 'white' } }).png().toBuffer();
  const phonePhoto = await normalizePhoto({ mime: 'image/png', base64: large.toString('base64') });
  const phoneMeta = await sharp(phonePhoto).metadata(); assert.equal(phoneMeta.width, 1536); assert.equal(phoneMeta.height, 1152); assert.equal(phoneMeta.exif, undefined);
  const jpg = await sharp(png).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const normalized = await normalizePhoto({ mime: 'image/jpeg', base64: jpg.toString('base64') });
  const meta = await sharp(normalized).metadata();
  assert.equal(meta.width, 60); assert.equal(meta.height, 40); assert.equal(meta.exif, undefined); assert.equal(meta.orientation, undefined);
});

test('a realistic multi-megabyte seeded image decodes without regex stack growth and drops metadata', async () => {
  const pixels = Buffer.alloc(1024 * 768 * 3); let seed = 4281;
  for (let i = 0; i < pixels.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; pixels[i] = seed & 255; }
  const input = await sharp(pixels, { raw: { width: 1024, height: 768, channels: 3 } }).withMetadata({ orientation: 6 }).png().toBuffer();
  assert.ok(input.length > 1024 * 1024);
  const normalized = await normalizePhoto({ mime: 'image/png', base64: input.toString('base64') });
  const metadata = await sharp(normalized).metadata();
  assert.equal(metadata.width, 768); assert.equal(metadata.height, 1024); assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined);
  for (const base64 of ['AA=A', '=AAA', 'AAAA=', 'A===', 'AA==AAAA']) await assert.rejects(normalizePhoto({ mime: 'image/png', base64 }), /Choose/);
});

test('default gate blocks even real:false uploads before keys; synthetic switch still blocks real families', async t => {
  let keys = 0;
  const app = await start(t, { keyReader: () => { keys++; throw Error('No key reads'); } });
  const { cookie } = await signup(app);
  assert.equal((await app.request('portraits/child', { childId: 'primary', photo: await photo() }, cookie)).status, 403);
  assert.equal((await app.request('portraits/child', { photo: await photo() })).status, 401);
  assert.equal(keys, 0);
  const config = (await app.request('config')).data; assert.equal(config.photoUploadsApproved, false); assert.equal(config.photoMaxBytes, photoByteLimit);
  const synthetic = await start(t, { allowSyntheticPortraits: true, keyReader: () => { keys++; } });
  const user = await signup(synthetic);
  const db = readJSON(join(synthetic.dataDirectory, 'accounts.json'));
  const file = join(synthetic.dataDirectory, db.accounts[0].id, 'family.json');
  const record = readJSON(file); record.real = true; saveJSON(file, record);
  assert.equal((await synthetic.request('portraits/child', { childId: 'primary', photo: await photo() }, user.cookie)).status, 403);
  assert.equal(keys, 0);
});

test('a family with a chosen look gets one private drawing; select survives restart and later cast reuses exact image bytes', async t => {
  let calls = 0;
  const output = await picture(100), source = await photo();
  const options = { allowSyntheticPortraits: true, keyReader: () => 'fake-key', transportFactory: () => ({ call: checked(async request => { calls++; assert.equal(request.path, '/v1/images/edits'); assert.equal(request.body.n, 1); return { data: [{ b64_json: output.toString('base64') }] }; }) }) };
  const app = await start(t, options), { cookie } = await signup(app);
  const accepted = await app.request('portraits/child', { childId: 'primary', photo: source }, cookie);
  assert.equal(accepted.status, 202);
  const person = await settle(app, cookie); assert.equal(person.candidates.length, 1); assert.equal(calls, 1); assert.equal(person.job.kind, 'selected-style');
  const stranger = await signup(app, 'other_fictional');
  const selected = person.candidates[0];
  assert.equal((await app.request(selected.url.slice(5), undefined, stranger.cookie)).status, 404);
  assert.equal((await app.request(selected.url.slice(5))).status, 401);
  assert.equal((await app.request('portraits/child/select', { childId: 'primary', jobId: person.job.id, candidateId: selected.id }, stranger.cookie)).status, 404);
  assert.equal((await app.request('portraits/child/select', { childId: 'primary', jobId: person.job.id, candidateId: selected.id }, cookie)).status, 200);
  const db = readJSON(join(app.dataDirectory, 'accounts.json')), account = db.accounts[0];
  const memory = createMemory(join(app.dataDirectory, account.id, 'family.json')), record = memory.exportRecord();
  assert.equal(record.cast[0].referenceSource, 'photo'); assert.equal(record.hero.heroPicturePath, record.cast[0].referencePath);
  // Supply a saved grown-up too, so every cast member is already prepared.
  record.cast[1].referencePath = record.cast[0].referencePath; record.cast[1].referenceHash = record.cast[0].referenceHash;
  const reused = await readyCastReferences({ call: () => { throw Error('Must reuse selected portraits'); } }, record);
  assert.equal(reused[0].referenceHash, record.cast[0].referenceHash);
  assert.doesNotMatch(JSON.stringify(db), /base64|fake-key/);
  assert.ok(!readFileSync(join(app.dataDirectory, 'accounts.json'), 'utf8').includes(source.base64));
  const dataDirectory = app.dataDirectory; await app.close();
  const resumed = await start(t, { ...options, dataDirectory });
  const listed = await resumed.request('portraits', undefined, cookie); assert.equal(listed.data.people[0].selectedUrl, selected.url);
  assert.equal((await resumed.request(selected.url.slice(5), undefined, cookie)).status, 200);
  assert.equal((await resumed.request('family', {}, cookie, 'DELETE')).status, 200);
  assert.equal(existsSync(join(dataDirectory, account.id)), false); assert.equal(readJSON(join(dataDirectory, 'accounts.json')).portraits.length, 0);
});

test('partly drawn looks resume only the missing looks after restart; same-family paid work cannot overlap', async t => {
  let calls = 0, fail = true, release;
  const block = new Promise(resolve => { release = resolve; });
  const output = await picture(150), source = await photo();
  const options = { allowSyntheticPortraits: true, keyReader: () => 'fake-key', transportFactory: () => ({ call: checked(async () => { calls++; if (calls === 1) await block; if (calls === 2 && fail) throw Error('Fixture failure'); return { data: [{ b64_json: output.toString('base64') }] }; }) }) };
  const app = await start(t, options), { cookie } = await app.request('signup', { username: 'partial-looks', password: 'only-fictional-fixture', family: family(), lookFlow: lookFlowVersion });
  await app.request('portraits/child', { childId: 'primary', photo: source }, cookie);
  assert.equal((await app.request('portraits/grown-up-one', { childId: 'primary', photo: source }, cookie)).status, 409);
  assert.equal((await app.request('jobs', { tonight: 'Homework felt hard.', moveId: 'name-it-exactly' }, cookie)).status, 409);
  assert.equal((await app.request('family', {}, cookie, 'DELETE')).status, 409);
  release(); let person = await settle(app, cookie); assert.equal(person.candidates.length, 1);
  const first = person.candidates[0].id, directory = app.dataDirectory; await app.close(); fail = false;
  const resumed = await start(t, { ...options, dataDirectory: directory });
  const wrong = { mime: 'image/png', base64: (await picture(77)).toString('base64') };
  assert.equal((await resumed.request('portraits/child', { childId: 'primary', photo: wrong }, cookie)).status, 400);
  await resumed.request('portraits/child', { childId: 'primary', photo: source }, cookie);
  person = await settle(resumed, cookie); assert.equal(person.candidates.length, 3); assert.equal(person.candidates[0].id, first); assert.equal(calls, 4);
});

test('zero budget and sample mode stop photo work before key access', async t => {
  let keys = 0;
  for (const options of [{ dailyLimit: 0 }, { sampleOnly: true }]) {
    const app = await start(t, { ...options, allowSyntheticPortraits: true, keyReader: () => { keys++; } });
    const { cookie } = await signup(app);
    assert.equal((await app.request('portraits/child', { childId: 'primary', photo: await photo() }, cookie)).status, options.sampleOnly ? 503 : 429);
  }
  assert.equal(keys, 0);
});

test('transport logs contain no uploaded image bytes, including provider errors that echo input', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  const png = await picture(), encoded = png.toString('base64'), record = setupRecord(family());
  const file = join(temp(t), 'requests.jsonl');
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'bad image ' + encoded } }), { status: 400 });
  const transport = createTransport({ keys: { openai: 'fake-key' }, logFile: file, allowSyntheticPortraits: true });
  await assert.rejects(transport.call({ provider: 'openai', path: '/v1/images/edits', stage: 'portrait', familyRecord: record, body: buildPortraitRequest(record, record.cast[0], `data:image/png;base64,${encoded}`), privacy: privacyFor(record, '') }), /HTTP 400/);
  const log = readFileSync(file, 'utf8'); assert.ok(!log.includes(encoded)); assert.ok(!log.includes('fake-key')); assert.match(log, /private image input/);
});

test('same photo is idempotent; new photo makes immutable choices and explicit sibling reuse copies only matching grown-ups', async t => {
  let calls = 0;
  const output = await picture(80), source = await photo();
  const app = await start(t, { allowSyntheticPortraits: true, keyReader: () => 'fake-key', transportFactory: () => ({ call: checked(async () => { calls++; return { data: [{ b64_json: output.toString('base64') }] }; }) }) });
  const { cookie } = await signup(app);
  await app.request('portraits/grown-up-one', { childId: 'primary', photo: source }, cookie);
  for (let i = 0; i < 100 && app.active.size; i++) await new Promise(resolve => setTimeout(resolve, 5));
  let person = (await app.request('portraits', undefined, cookie)).data.people[1];
  const old = person.candidates[0];
  const preview = await app.request(person.candidates[0].url.replace('/api/', ''), undefined, cookie);
  assert.equal(preview.status, 200); assert.equal(preview.headers.get('content-type'), 'image/webp');
  assert.equal(preview.headers.get('cache-control'), 'private, no-cache');
  assert.ok((await sharp(preview.data).metadata()).width <= 640);
  assert.equal((await app.request(person.candidates[0].url.replace('/api/', ''))).status, 401);
  await app.request('portraits/grown-up-one/select', { childId: 'primary', jobId: person.job.id, candidateId: old.id }, cookie);
  await app.request('portraits/grown-up-one', { childId: 'primary', photo: source }, cookie);
  assert.equal(calls, 1);
  await app.request('portraits/grown-up-one', { childId: 'primary', photo: { mime: 'image/png', base64: (await picture(66)).toString('base64') } }, cookie);
  for (let i = 0; i < 100 && app.active.size; i++) await new Promise(resolve => setTimeout(resolve, 5));
  person = (await app.request('portraits', undefined, cookie)).data.people[1];
  assert.equal(calls, 2); assert.equal(person.selectedUrl, old.url); assert.notEqual(person.candidates[0].id, old.id);
  assert.equal((await app.request(old.url.slice(5), undefined, cookie)).status, 200);
  const added = await app.request('children', { family: { ...family(), nickname: 'Fern' }, reuseGrownUpsFromChildId: 'primary' }, cookie);
  assert.equal(added.status, 200);
  let people = (await app.request('portraits', undefined, cookie)).data.people;
  assert.equal(people[0].selectedUrl, null); assert.equal(people[1].selectedUrl, old.url);
  const notSame = await app.request('children', { family: { ...family(), nickname: 'Ray', parents: [{ label: 'Grandpa', pronouns: 'he/him', hair: 'short dark hair' }] }, reuseGrownUpsFromChildId: 'primary' }, cookie);
  assert.equal(notSame.status, 200); people = (await app.request('portraits', undefined, cookie)).data.people;
  assert.equal(people[1].selectedUrl, null);
  assert.equal((await app.request('children', { family: family(), reuseGrownUpsFromChildId: 'not-in-this-family' }, cookie)).status, 400);
});

test('interrupted index update restores committed candidate without new generation', async t => {
  const directory = temp(t), output = await picture(51);
  let calls = 0;
  const options = { dataDirectory: directory, allowSyntheticPortraits: true, keyReader: () => 'fake-key', transportFactory: () => ({ call: checked(async () => { calls++; return { data: [{ b64_json: output.toString('base64') }] }; }) }) };
  const app = await start(t, options), { cookie } = await signup(app);
  await app.request('portraits/child', { childId: 'primary', photo: await photo() }, cookie);
  const original = await settle(app, cookie); await app.close();
  const stateFile = join(directory, 'accounts.json'), db = readJSON(stateFile);
  db.portraits[0].candidates.pop(); db.portraits[0].status = 'running'; saveJSON(stateFile, db);
  const resumed = await start(t, options), restored = (await resumed.request('portraits', undefined, cookie)).data.people[0];
  assert.equal(restored.candidates.length, 1); assert.equal(restored.candidates[0].id, original.candidates[0].id); assert.equal(restored.job.status, 'complete'); assert.equal(calls, 1);
});

test('bad generated PNG keeps a redacted rejection answer and cannot become a choice', async t => {
  let encoded;
  const corrupt = (await picture(99)).subarray(0, 24).toString('base64');
  const app = await start(t, { allowSyntheticPortraits: true, keyReader: () => 'fake-key', transportFactory: () => ({ call: async request => { encoded = (Array.isArray(request.body.image) ? request.body.image[0] : request.body.image).split(',')[1]; return { data: [{ b64_json: corrupt }], echo: encoded }; } }) });
  const { cookie } = await signup(app);
  await app.request('portraits/child', { childId: 'primary', photo: await photo() }, cookie);
  const person = await settle(app, cookie); assert.equal(person.candidates.length, 0);
  const db = readJSON(join(app.dataDirectory, 'accounts.json')), job = db.portraits[0];
  const answerFile = join(app.dataDirectory, job.accountId, 'portraits', job.id, 'attempt-0-1-answer.json');
  assert.ok(existsSync(answerFile)); assert.ok(!readFileSync(answerFile, 'utf8').includes(encoded));
  assert.equal((await app.request('portraits/child/select', { childId: 'primary', jobId: job.id, candidateId: 'not-a-choice' }, cookie)).status, 404);
});

test('grown-up labels are inclusive without changing fixed practice wording', () => {
  const record = setupRecord({ ...family(), parents: [...family().parents, { label: 'Papa', pronouns: 'he/him', hair: 'short grey hair' }] });
  assert.equal(record.parentLabel, 'Dad and Papa');
  assert.doesNotThrow(() => buildPortraitRequest(record, record.cast[1], 'data:image/png;base64,AAAA'));
});

test('re-encoded unchanged source pixels never enter candidate files or any JSON evidence', async t => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  let reencoded, sent;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.openai.com/')) return originalFetch(url, options);
    const upload = options.body.getAll('image[]')[0];
    sent = Buffer.from(await upload.arrayBuffer());
    reencoded = await sharp(sent).png({ compressionLevel: 9 }).toBuffer();
    assert.notDeepEqual(reencoded, sent);
    return new Response(JSON.stringify({ data: [{ b64_json: reencoded.toString('base64') }], echoedSource: sent.toString('base64'), alternateEcho: reencoded.toString('base64'), usage: { input_tokens: 0, output_tokens: 0, input_tokens_details: { text_tokens: 0, image_tokens: 0, cached_tokens: 0 } } }), { status: 200 });
  };
  const app = await start(t, { allowSyntheticPortraits: true, keyReader: () => 'fake-key', transportFactory: createTransport }), { cookie } = await signup(app);
  await app.request('portraits/child', { childId: 'primary', photo: await photo() }, cookie);
  const person = await settle(app, cookie); assert.equal(person.candidates.length, 0);
  const db = readJSON(join(app.dataDirectory, 'accounts.json')), job = db.portraits[0];
  const directory = join(app.dataDirectory, job.accountId, 'portraits', job.id);
  assert.ok(!readdirSync(directory).some(name => name.endsWith('.png')));
  for (const name of readdirSync(directory)) {
    const contents = readFileSync(join(directory, name), 'utf8');
    assert.ok(!contents.includes(reencoded.toString('base64')), name); assert.ok(!contents.includes(sent.toString('base64')), name);
  }
  assert.match(readFileSync(join(directory, 'attempt-0-1-rejection.json'), 'utf8'), /unchanged-source-pixels/);
});

test('exhausted attempt restarts only explicitly, carries accepted drawings and rejects another account restart id', async t => {
  let calls = 0, fail = false;
  const output = await picture(113), broken = output.subarray(0, 24).toString('base64'), source = await photo();
  const app = await start(t, { allowSyntheticPortraits: true, keyReader: () => 'fake-key', transportFactory: () => ({ call: checked(async () => { calls++; return { data: [{ b64_json: fail ? broken : output.toString('base64') }] }; }) }) });
  const { cookie } = await signup(app);
  await app.request('portraits/child', { childId: 'primary', photo: source }, cookie);
  let person = await settle(app, cookie); const saved = person.candidates[0];
  await app.request('portraits/child/select', { childId: 'primary', jobId: person.job.id, candidateId: saved.id }, cookie);
  // Two broken tries at "another drawing" spend that look's two attempts.
  fail = true;
  await app.request('portraits/child', { childId: 'primary', photo: source, another: true, anotherJobId: person.job.id }, cookie); person = await settle(app, cookie);
  assert.equal(person.job.status, 'needs-photo');
  await app.request('portraits/child', { childId: 'primary', photo: source }, cookie);
  person = await settle(app, cookie); assert.equal(person.job.canRestart, true); assert.equal(calls, 3);
  assert.equal((await app.request('portraits/child', { childId: 'primary', photo: source }, cookie)).status, 409);
  const other = await signup(app, 'other_restart');
  assert.equal((await app.request('portraits/child', { childId: 'primary', photo: source, restartJobId: person.job.id }, other.cookie)).status, 409);
  fail = false;
  const restarted = await app.request('portraits/child', { childId: 'primary', photo: source, restartJobId: person.job.id }, cookie);
  assert.equal(restarted.status, 202);
  const done = await settle(app, cookie); assert.equal(done.candidates.length, 2); assert.equal(done.candidates[0].id, saved.id); assert.equal(done.selectedUrl, saved.url); assert.equal(calls, 4);
  assert.notEqual(done.job.id, person.job.id);
  assert.equal((await app.request('portraits/child', { childId: 'primary', photo: source, restartJobId: person.job.id }, cookie)).status, 409);
});

test('no-credit responses keep creative attempts intact but each batch has a durable request cap', async t => {
  let calls = 0;
  const app = await start(t, { allowSyntheticPortraits: true, keyReader: () => 'fake-key', transportFactory: () => ({ call: async () => { calls++; const error = Error('no credit'); error.response = { error: { code: 'credit_balance_exhausted' } }; throw error; } }) });
  const { cookie } = await signup(app), source = await photo();
  let person;
  for (let i = 0; i < 6; i++) { await app.request('portraits/child', { childId: 'primary', photo: source }, cookie); person = await settle(app, cookie); }
  assert.equal(calls, 6); assert.equal(person.job.canRestart, true);
  const db = readJSON(join(app.dataDirectory, 'accounts.json')); assert.deepEqual(db.portraits[0].attempts, []); assert.equal(db.portraits[0].requestCount, 6);
  assert.equal((await app.request('portraits/child', { childId: 'primary', photo: source }, cookie)).status, 409); assert.equal(calls, 6);
});

test('A then B then A restores the original drawing, also after names and private notes change', async t => {
  let calls = 0;
  const output = await picture(117);
  const app = await start(t, { allowSyntheticPortraits: true, keyReader: () => 'fake-key', transportFactory: () => ({ call: checked(async () => { calls++; return { data: [{ b64_json: output.toString('base64') }] }; }) }) });
  const { cookie } = await signup(app), a = await photo(), b = { mime: 'image/png', base64: (await picture(67)).toString('base64') };
  await app.request('portraits/child', { childId: 'primary', photo: a }, cookie); const first = await settle(app, cookie);
  await app.request('portraits/child/select', { childId: 'primary', jobId: first.job.id, candidateId: first.candidates[0].id }, cookie);
  await app.request('portraits/child', { childId: 'primary', photo: b }, cookie); await settle(app, cookie);
  await app.request('family', { childId: 'primary', family: { ...family(), nickname: 'Pip renamed', familyContext: 'A changed private note.' } }, cookie, 'PATCH');
  const restored = await app.request('portraits/child', { childId: 'primary', photo: a }, cookie);
  assert.equal(restored.data.people[0].job.id, first.job.id); assert.deepEqual(restored.data.people[0].candidates.map(({selected, ...item}) => item), first.candidates.map(({selected, ...item}) => item)); assert.equal(calls, 2);
  assert.equal(restored.data.people[0].selectedUrl, first.candidates[0].url);
  await app.request('family', { childId: 'primary', family: { ...family(), presetId: 'fern' } }, cookie, 'PATCH');
  await app.request('portraits/child', { childId: 'primary', photo: a }, cookie); const changed = await settle(app, cookie);
  assert.notEqual(changed.job.id, first.job.id); assert.equal(calls, 3);
});

test('only trusted zero-wire preflight stops preserve portrait request allowance', async t => {
  for (const marker of [true, false, undefined]) {
    const app = await start(t, { allowSyntheticPortraits: true, keyReader: () => 'fake-key', transportFactory: () => ({ call: async () => { const error = Error('Daily budget reached.'); if (marker !== undefined) error.preflight = marker; throw error; } }) });
    const { cookie } = await signup(app), source = await photo();
    for (let i = 0; i < 3; i++) { await app.request('portraits/child', { childId: 'primary', photo: source }, cookie); await settle(app, cookie); }
    const job = readJSON(join(app.dataDirectory, 'accounts.json')).portraits[0];
    assert.equal(job.requestCount, marker === true ? 0 : 3); assert.deepEqual(job.attempts, []);
  }
});

test('image interruptions preserve spent attempts and reuse the same description base on recovery', async t => {
  for (const [inputMode, stage] of [['photo', 'portrait-render'], ['description', 'portrait-finish']]) for (const marker of [true, false]) {
    let blocked = true; const calls = [];
    const app = await start(t, { allowSyntheticPortraits: true, keyReader: () => 'fake-key', transportFactory: () => ({ call: async request => {
      calls.push(request.stage);
      if (request.stage === stage && blocked) { const error = Error(marker ? 'Daily budget reached.' : 'Synthetic network failure after sending'); if (marker) error.preflight = true; throw error; }
      assert.ok(!/-check$/.test(request.stage));
      return { data: [{ b64_json: (await picture(request.stage === 'portrait-ink' ? 61 : 62)).toString('base64') }] };
    } }) });
    const { cookie } = await app.request('signup', { username: `stop-${inputMode}-${marker}`, password: 'only-fictional-fixture', family: inkFamily() }), source = await photo();
    const input = inputMode === 'photo' ? { childId: 'primary', photo: source } : descriptionInput;
    for (let i = 0; i < 4; i++) { await app.request('portraits/child', input, cookie); await settle(app, cookie); }
    let job = readJSON(join(app.dataDirectory, 'accounts.json')).portraits[0]; const baseCount = inputMode === 'description' ? 1 : 0;
    assert.equal(job.requestCount, baseCount + (marker ? 0 : 4)); assert.equal(job.candidates.length, 0);
    if (marker) { assert.equal(job.preflightStops.length, 4); assert.ok(job.preflightStops.every(stop => stop.sent === false)); }
    else assert.equal(job.preflightStops, undefined);
    blocked = false; await app.request('portraits/child', input, cookie); const done = await settle(app, cookie);
    job = readJSON(join(app.dataDirectory, 'accounts.json')).portraits[0];
    assert.equal(done.job.status, 'complete'); assert.equal(done.candidates.length, 1); assert.equal(job.requestCount, baseCount + (marker ? 1 : 5));
    if (inputMode === 'description') assert.equal(calls.filter(stage => stage === 'portrait-ink').length, 1);
  }
});

test('same photo drawings are isolated by chosen style, and returning to a style reuses only its own drawing', async t => {
  let calls = 0;
  const output = await picture(117), app = await start(t, { allowSyntheticPortraits: true, keyReader: () => 'fake-key', transportFactory: () => ({ call: checked(async () => { calls++; return { data: [{ b64_json: output.toString('base64') }] }; }) }) });
  const { cookie } = await signup(app), source = await photo();
  await app.request('portraits/child', { childId: 'primary', photo: source }, cookie); const classic = await settle(app, cookie);
  assert.equal((await app.request('family/style', { pictureStyleId: 'animated-film' }, cookie)).status, 200);
  assert.equal((await app.request('portraits/child/select', { childId: 'primary', jobId: classic.job.id, candidateId: classic.candidates[0].id }, cookie)).status, 404);
  await app.request('portraits/child', { childId: 'primary', photo: source }, cookie); const film = await settle(app, cookie); assert.notEqual(film.job.id, classic.job.id); assert.equal(calls, 2);
  assert.equal((await app.request('family/style', { pictureStyleId: 'classic-comic' }, cookie)).status, 200);
  const reused = await app.request('portraits/child', { childId: 'primary', photo: source }, cookie); assert.equal(reused.data.people[0].job.id, classic.job.id); assert.equal(calls, 2);
  await app.request('portraits/child/select', { childId: 'primary', jobId: classic.job.id, candidateId: classic.candidates[0].id }, cookie);
  const db = readJSON(join(app.dataDirectory, 'accounts.json')), account = db.accounts[0], record = createMemory(join(app.dataDirectory, account.id, 'family.json')).exportRecord();
  assert.equal(record.cast[0].referenceStyleId, 'classic-comic'); assert.ok(record.cast[0].referenceStyleVersion);
  const job = db.portraits.find(job => job.id === classic.job.id); assert.equal(job.pictureStyleId, 'classic-comic'); assert.equal(job.candidates[0].pictureStyleId, 'classic-comic');
});

const inkFamily = () => ({ ...family(), pictureStyleId: 'bold-ink-comic' });
const descriptionInput = { childId: 'primary', inputMode: 'description', description: 'Warm brown skin, oval face, short curly dark hair and brown eyes.' };
// Offline stand-in for the selected picture checker's answer about one ink sketch.
const identityReply = (request, { matches = true, certainty = 'confirmed', evidence = matches ? 'Same oval face, curly hair and eyes as the source.' : 'The sketch shows a bald bearded man; the source shows long curly hair and no beard.' } = {}) => {
  const { characterId } = JSON.parse(request.body.input[0].content[0].text);
  const answer = { castObservations: [{ characterId, observedSpecies: 'human', identityMatches: matches, certainty, identityEvidence: evidence, appearance: [], clothing: [] }] };
  if (request.stage === 'portrait-render-check') answer.graphicStyle = { matchesSelectedStyle: true, flatInk: true, photographicTexture: false, toyShine: false, oversizedEyes: false, evidence: 'Drawn in the expected look.' };
  return { status: 'completed', usage: { input_tokens: 10, output_tokens: 10 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] };
};
const imageCalls = calls => calls.filter(request => !/-check$/.test(request.stage));

test('description input makes one private neutral sketch then one checked drawing without needing photo consent', async t => {
  const calls = [], base = await picture(111), finish = await picture(122);
  const app = await start(t, { keyReader: () => 'fixture-key', transportFactory: () => ({ call: async request => { calls.push(request); if (/-check$/.test(request.stage)) return identityReply(request); return { data: [{ b64_json: (request.stage === 'portrait-ink' ? base : finish).toString('base64') }] }; } }) });
  const { cookie } = await app.request('signup', { username: 'ink-description', password: 'only-fictional-fixture', family: inkFamily() });
  const response = await app.request('portraits/child', descriptionInput, cookie); assert.equal(response.status, 202, JSON.stringify(response.data));
  const person = await settle(app, cookie); assert.equal(person.job.status, 'complete'); assert.equal(person.inputMode, 'description'); assert.equal(person.job.description, descriptionInput.description); assert.equal(person.candidates.length, 1);
  assert.deepEqual(calls.map(request => request.stage), ['portrait-ink', 'portrait-finish']);
  assert.match(calls[0].body.prompt, /BLACK AND WHITE INK CHARACTER BASE/); assert.match(calls[0].body.prompt, /NEUTRAL IDENTITY BASE/); assert.match(calls[0].body.prompt, /There is NO person photograph/); assert.equal(calls[0].body.image, undefined);
  assert.equal(calls[1].body.image[0], `data:image/png;base64,${base.toString('base64')}`); assert.ok(!calls[1].body.prompt.includes(descriptionInput.description)); assert.match(calls[1].body.prompt, /BOLD INK COMIC/);
  const db = readJSON(join(app.dataDirectory, 'accounts.json')), job = db.portraits[0]; assert.equal(job.requestCount, 2); assert.equal(job.pipelineVersion, 'ink-base-v1'); assert.equal(job.baseAttempts, 1); assert.ok(job.inkBase.hash); assert.equal(job.kind, 'selected-style');
  await app.request('portraits/child/select', { childId: 'primary', jobId: person.job.id, candidateId: person.candidates[0].id }, cookie);
  const record = createMemory(join(app.dataDirectory, db.accounts[0].id, 'family.json')).exportRecord(); assert.equal(record.cast[0].referenceSource, 'description'); assert.equal(record.cast[0].referenceStyleId, 'bold-ink-comic');
  const cast = await readyCastReferences({ call: () => { throw Error('Must reuse chosen description drawing'); } }, { ...record, cast: [record.cast[0]] }); assert.equal(cast[0].referencePath, record.cast[0].referencePath);
  await app.request('portraits/child', descriptionInput, cookie); assert.equal(calls.length, 2);
});

test('a photo drawing goes straight from the photo, resumes after an interruption and never saves the photo', async t => {
  const calls = [], drawn = await picture(125); let interrupted = false;
  const options = { allowSyntheticPortraits: true, keyReader: () => 'fixture-key', transportFactory: () => ({ call: async request => { calls.push(request); if (/-check$/.test(request.stage)) return identityReply(request); if (!interrupted) { interrupted = true; throw Error('Synthetic network failure with unknown billing'); } return { data: [{ b64_json: drawn.toString('base64') }] }; } }) };
  const app = await start(t, options), { cookie } = await app.request('signup', { username: 'direct-photo', password: 'only-fictional-fixture', family: inkFamily() }), source = await photo();
  await app.request('portraits/child', { childId: 'primary', inputMode: 'photo', photo: source }, cookie); const paused = await settle(app, cookie); assert.equal(paused.job.status, 'needs-photo');
  const job = readJSON(join(app.dataDirectory, 'accounts.json')).portraits[0]; assert.equal(job.requestCount, 1); assert.equal(job.pipelineVersion, 'direct-render-v1'); assert.equal(job.inkBase, undefined);
  app.close(); const resumed = await start(t, { ...options, dataDirectory: app.dataDirectory });
  await resumed.request('portraits/child', { childId: 'primary', photo: source }, cookie); const done = await settle(resumed, cookie); assert.equal(done.job.status, 'complete'); assert.equal(done.candidates.length, 1);
  assert.deepEqual(calls.map(request => request.stage), ['portrait-render', 'portrait-render']);
  for (const request of imageCalls(calls)) { assert.equal(request.body.image.length, 1); assert.equal(request.body.image[0], calls[0].body.image[0]); assert.match(request.body.prompt, /BOLD INK COMIC/); }
  const saved = readJSON(join(app.dataDirectory, 'accounts.json')).portraits[0];
  assert.equal(fileHash(saved.candidates[0].path), saved.candidates[0].hash); assert.equal(saved.candidates[0].renderCheck.status, 'parent-review');
  const walkJSON = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walkJSON(join(directory, entry.name)) : entry.name.endsWith('.json') ? [readFileSync(join(directory, entry.name), 'utf8')] : []);
  for (const json of walkJSON(join(app.dataDirectory, job.accountId))) { assert.ok(!json.includes(source.base64)); assert.ok(!json.includes(calls[0].body.image[0].split(',')[1])); }
  assert.equal(readJSON(join(app.dataDirectory, 'accounts.json')).portraits[0].requestCount, 2);
});

test('photo and description cannot be mixed or used to skip the real-family and photo gates', async t => {
  let keys = 0; const app = await start(t, { keyReader: () => { keys++; throw Error('Must not read key'); } });
  const { cookie } = await app.request('signup', { username: 'mixed-input', password: 'only-fictional-fixture', family: inkFamily() }), source = await photo();
  for (const body of [{ ...descriptionInput, photo: source }, { childId: 'primary', inputMode: 'photo', photo: source, description: '' }, { childId: 'primary', photo: source, description: descriptionInput.description }, { ...descriptionInput, description: 'x'.repeat(601) }, { ...descriptionInput, description: 'data:image/png;base64,AAAA' }]) assert.equal((await app.request('portraits/child', body, cookie)).status, 400);
  assert.equal((await app.request('portraits/child', { childId: 'primary', inputMode: 'photo', photo: source }, cookie)).status, 403);
  const db = readJSON(join(app.dataDirectory, 'accounts.json')), file = join(app.dataDirectory, db.accounts[0].id, 'family.json'), record = readJSON(file); record.real = true; saveJSON(file, record);
  assert.ok([400, 403].includes((await app.request('portraits/child', descriptionInput, cookie)).status)); assert.equal(keys, 0);
});

test('ink base and unknown finish failures share the original six-request cap without automatic renewal', async t => {
  let calls = 0, checks = 0; const base = await picture(114);
  const app = await start(t, { keyReader: () => 'fixture-key', transportFactory: () => ({ call: async request => { if (request.stage === 'portrait-identity-check') { checks++; return identityReply(request); } calls++; if (request.stage === 'portrait-ink') return { data: [{ b64_json: base.toString('base64') }] }; throw Error('Synthetic unknown finish failure'); } }) });
  const { cookie } = await app.request('signup', { username: 'ink-cap', password: 'only-fictional-fixture', family: inkFamily() });
  for (let index = 0; index < 5; index++) { await app.request('portraits/child', descriptionInput, cookie); await settle(app, cookie); }
  const job = readJSON(join(app.dataDirectory, 'accounts.json')).portraits[0]; assert.equal(calls, 6); assert.equal(checks, 0); assert.equal(job.requestCount, 6); assert.equal(job.baseAttempts, 1); assert.ok(job.inkBase); assert.deepEqual(job.attempts, []);
  assert.equal((await app.request('portraits/child', descriptionInput, cookie)).status, 409); assert.equal(calls, 6);
});

test('mode hashes keep description and photo drawings separate; an older family in any look gets one direct drawing', async t => {
  const calls = [], base = await picture(116), finish = await picture(126);
  const app = await start(t, { allowSyntheticPortraits: true, keyReader: () => 'fixture-key', transportFactory: () => ({ call: async request => { calls.push(request); if (/-check$/.test(request.stage)) return identityReply(request); return { data: [{ b64_json: (request.stage === 'portrait-ink' ? base : finish).toString('base64') }] }; } }) });
  const { cookie } = await app.request('signup', { username: 'mode-cache', password: 'only-fictional-fixture', family: inkFamily() });
  await app.request('portraits/child', descriptionInput, cookie); const description = await settle(app, cookie);
  await app.request('portraits/child', { childId: 'primary', photo: await photo() }, cookie); const photoJob = await settle(app, cookie); assert.notEqual(photoJob.job.id, description.job.id); assert.equal(imageCalls(calls).length, 3); assert.equal(calls.length, 3);
  const reused = await app.request('portraits/child', descriptionInput, cookie); assert.equal(reused.data.people[0].job.id, description.job.id); assert.equal(calls.length, 3);
  // Playful comic, an older look with no ink sketch, also gets one drawing straight from the photo.
  const older = await signup(app, 'old-direct'); await app.request('portraits/child', { childId: 'primary', photo: await photo() }, older.cookie); const drawn = await settle(app, older.cookie);
  assert.deepEqual(calls.slice(-1).map(request => request.stage), ['portrait-render']); assert.match(calls.at(-1).body.prompt, /PLAYFUL COMIC/); assert.equal(drawn.candidates.length, 1);
  const job = readJSON(join(app.dataDirectory, 'accounts.json')).portraits.at(-1); assert.equal(job.kind, 'selected-style'); assert.equal(job.pictureStyleId, 'classic-comic'); assert.equal(job.requestCount, 1);
});

test('transport distinguishes a builder-verified description from an uploaded photo and rejects forged mode metadata', async t => {
  const { buildPortraitStageRequest } = await import('../server/requests.js');
  const record = setupRecord(inkFamily()), person = record.cast[0], directory = temp(t), originalFetch = globalThis.fetch;
  let wires = 0; const generated = await picture(115);
  globalThis.fetch = async () => { wires++; return new Response(JSON.stringify({ data: [{ b64_json: generated.toString('base64') }], usage: { input_tokens: 10, output_tokens: 10, input_tokens_details: { text_tokens: 10, image_tokens: 0, cached_tokens: 0 } } })); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const transport = createTransport({ keys: { openai: 'fake-key' }, logFile: join(directory, 'description-log.jsonl'), maxCalls: 76, familyRecordFor: () => record });
  const body = buildPortraitStageRequest(record, person, { phase: 'ink', inputMode: 'description', description: descriptionInput.description });
  await transport.call({ provider: 'openai', path: body.image ? '/v1/images/edits' : '/v1/images/generations', stage: 'portrait-ink', body, familyRecord: record, privacy: privacyFor(record, '') }); assert.equal(wires, 1);
  const raw = `data:image/png;base64,${(await picture(12)).toString('base64')}`;
  assert.throws(() => buildPortraitStageRequest(record, person, { phase: 'ink', inputMode: 'description', description: descriptionInput.description, referenceData: raw }), /cannot include/);
  await assert.rejects(transport.call({ provider: 'openai', path: '/v1/images/edits', stage: 'portrait-ink', body: { ...body, image: raw }, familyRecord: record, privacy: privacyFor(record, '') }), /provenance/); assert.equal(wires, 1);
  body.image = [raw];
  await assert.rejects(transport.call({ provider: 'openai', path: '/v1/images/edits', stage: 'portrait-ink', body, familyRecord: record, privacy: privacyFor(record, '') }), /provenance/); assert.equal(wires, 1);
  const photoBody = buildPortraitStageRequest(record, person, { phase: 'ink', inputMode: 'photo', referenceData: raw });
  await assert.rejects(transport.call({ provider: 'openai', path: '/v1/images/edits', stage: 'portrait-ink', body: photoBody, familyRecord: record, privacy: privacyFor(record, '') }), /Photo use needs/); assert.equal(wires, 1);
  assert.ok(!readFileSync(join(directory, 'description-log.jsonl'), 'utf8').includes(generated.toString('base64')));
});

test('a real child under thirteen cannot use description generation even with current parent consent', async t => {
  const { recordDataConsent } = await import('../server/config.js'); const { dataPolicyVersion } = await import('../app/data-policy.js');
  let keys = 0; const app = await start(t, { keyReader: () => { keys++; throw Error('Must not read key'); } });
  const { cookie } = await app.request('signup', { username: 'protected-description', password: 'only-fictional-fixture', family: inkFamily() });
  const db = readJSON(join(app.dataDirectory, 'accounts.json')), file = join(app.dataDirectory, db.accounts[0].id, 'family.json'), record = readJSON(file);
  record.real = true; record.dataPolicyConsent = recordDataConsent({ accepted: true, version: dataPolicyVersion }); saveJSON(file, record);
  const response = await app.request('portraits/child', descriptionInput, cookie); assert.equal(response.status, 403); assert.match(response.data.message, /Zero Data Retention|under 13/i); assert.equal(keys, 0);
});

test('a changed saved ink base stops before any finish send and never resets the batch count', async t => {
  let calls = 0; const base = await picture(118);
  const app = await start(t, { keyReader: () => 'fixture-key', transportFactory: () => ({ call: async request => { calls++; if (request.stage === 'portrait-identity-check') return identityReply(request); if (request.stage === 'portrait-ink') return { data: [{ b64_json: base.toString('base64') }] }; throw Error('Synthetic interrupted finish'); } }) });
  const { cookie } = await app.request('signup', { username: 'ink-integrity', password: 'only-fictional-fixture', family: inkFamily() });
  await app.request('portraits/child', descriptionInput, cookie); await settle(app, cookie);
  const job = readJSON(join(app.dataDirectory, 'accounts.json')).portraits[0]; assert.equal(job.requestCount, 2);
  const { writeFileSync } = await import('node:fs'); writeFileSync(job.inkBase.path, await picture(119));
  await app.request('portraits/child', descriptionInput, cookie); const stopped = await settle(app, cookie);
  assert.equal(stopped.job.status, 'needs-input'); assert.equal(calls, 2); assert.equal(readJSON(join(app.dataDirectory, 'accounts.json')).portraits[0].requestCount, 2);
});

// October 16 regression: a style example's father became a mother's portrait.
// The ink sketch is now checked before any paid colour finish.
const fileHash = path => createHash('sha256').update(readFileSync(path)).digest('hex');

test('a description base and its finished drawing are offered for parent choice without an appearance judge', async t => {
  const calls = [], base = await picture(131), finish = await picture(133);
  const app = await start(t, { keyReader: () => 'fixture-key', transportFactory: () => ({ call: async request => {
    calls.push(request); assert.ok(!/-check$/.test(request.stage));
    return { data: [{ b64_json: (request.stage === 'portrait-ink' ? base : finish).toString('base64') }] };
  } }) });
  const { cookie } = await app.request('signup', { username: 'parent-choice', password: 'only-fictional-fixture', family: inkFamily() });
  await app.request('portraits/child', descriptionInput, cookie); const done = await settle(app, cookie);
  assert.equal(done.job.status, 'complete'); assert.equal(done.candidates.length, 1);
  assert.deepEqual(calls.map(request => request.stage), ['portrait-ink', 'portrait-finish']);
  const job = readJSON(join(app.dataDirectory, 'accounts.json')).portraits[0];
  assert.equal(job.requestCount, 2); assert.equal(job.inkChecks, 0); assert.equal(job.inkBase.identityCheck.status, 'parent-review');
  assert.equal(job.candidates[0].renderCheck.status, 'parent-review'); assert.equal(fileHash(job.inkBase.path), job.inkBase.hash); assert.equal(fileHash(job.candidates[0].path), job.candidates[0].hash);
  assert.deepEqual(calls[1].body.image, [`data:image/png;base64,${base.toString('base64')}`]);
  await app.request('portraits/child/select', { childId: 'primary', jobId: done.job.id, candidateId: done.candidates[0].id }, cookie);
  const saved = readJSON(join(app.dataDirectory, job.accountId, 'family.json')); assert.equal(saved.cast[0].referenceHash, job.candidates[0].hash);
  await app.request('portraits/child', descriptionInput, cookie); assert.equal(calls.length, 2);
});

test('a finish outage preserves the sketch across restart and resumes without redrawing it', async t => {
  const calls = [], base = await picture(134), finish = await picture(135); let failFinish = true;
  const options = { keyReader: () => 'fixture-key', transportFactory: () => ({ call: async request => {
    calls.push(request); assert.ok(!/-check$/.test(request.stage));
    if (request.stage === 'portrait-finish' && failFinish) { failFinish = false; throw Error('Synthetic finish outage'); }
    return { data: [{ b64_json: (request.stage === 'portrait-ink' ? base : finish).toString('base64') }] };
  } }) };
  const app = await start(t, options), { cookie } = await app.request('signup', { username: 'finish-pending', password: 'only-fictional-fixture', family: inkFamily() });
  await app.request('portraits/child', descriptionInput, cookie); const paused = await settle(app, cookie);
  assert.equal(paused.job.status, 'needs-input');
  const before = readJSON(join(app.dataDirectory, 'accounts.json')).portraits[0]; assert.equal(before.requestCount, 2); assert.ok(before.inkBase); assert.equal(before.pendingInk, undefined);
  await app.close(); const resumed = await start(t, { ...options, dataDirectory: app.dataDirectory });
  await resumed.request('portraits/child', descriptionInput, cookie); const done = await settle(resumed, cookie);
  const after = readJSON(join(app.dataDirectory, 'accounts.json')).portraits[0];
  assert.equal(done.job.status, 'complete'); assert.deepEqual(calls.map(request => request.stage), ['portrait-ink', 'portrait-finish', 'portrait-finish']);
  assert.equal(after.requestCount, 3); assert.equal(after.inkChecks, 0); assert.equal(after.inkBase.hash, before.inkBase.hash); assert.equal(fileHash(after.inkBase.path), before.inkBase.hash);
  for (const request of calls.filter(item => item.stage === 'portrait-finish')) assert.deepEqual(request.body.image, [`data:image/png;base64,${base.toString('base64')}`]);
});

test('older unchosen finished batches are not handed back; chosen older batches are reused; old evidence stays byte-identical', async t => {
  const calls = [], drawn = await picture(137);
  const options = { allowSyntheticPortraits: true, keyReader: () => 'fixture-key', transportFactory: () => ({ call: async request => { calls.push(request); if (/-check$/.test(request.stage)) return identityReply(request); return { data: [{ b64_json: drawn.toString('base64') }] }; } }) };
  const app = await start(t, options), { cookie } = await app.request('signup', { username: 'policy-upgrade', password: 'only-fictional-fixture', family: inkFamily() });
  const childPhoto = await photo(), adultPhoto = { mime: 'image/png', base64: (await picture(90)).toString('base64') };
  await app.request('portraits/child', { childId: 'primary', inputMode: 'photo', photo: childPhoto }, cookie); const child = await settle(app, cookie);
  await app.request('portraits/grown-up-one', { childId: 'primary', inputMode: 'photo', photo: adultPhoto }, cookie);
  for (let i = 0; i < 100 && readJSON(join(app.dataDirectory, 'accounts.json')).portraits.at(-1).status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 5));
  await app.request('portraits/child/select', { childId: 'primary', jobId: child.job.id, candidateId: child.candidates[0].id }, cookie);
  app.close();
  // Give both jobs the shape saved before October 16: no kind, the older key and policy.
  const dbFile = join(app.dataDirectory, 'accounts.json'), db = readJSON(dbFile);
  const record = createMemory(join(app.dataDirectory, db.accounts[0].id, 'family.json')).exportRecord();
  for (const job of db.portraits) {
    for (const key of ['kind', 'targets', 'referencePolicy', 'renderChecks']) delete job[key];
    job.pipelineVersion = 'ink-base-v1'; job.personFingerprint = portraitFingerprint(record, lockedCast(record).find(person => person.id === job.personId), { inputMode: 'photo', pipelineVersion: 'ink-base-v1' });
    for (const candidate of job.candidates) { delete candidate.jobKind; delete candidate.renderCheck; }
  }
  saveJSON(dbFile, db);
  const oldAdult = structuredClone(db.portraits.find(job => job.personId === 'grown-up-one')), oldChild = structuredClone(db.portraits.find(job => job.personId === 'child'));
  const evidence = directory => readdirSync(directory).sort().map(name => [name, fileHash(join(directory, name))]);
  const adultDirectory = join(app.dataDirectory, oldAdult.accountId, 'portraits', oldAdult.id), adultFiles = evidence(adultDirectory);
  const resumed = await start(t, { ...options, dataDirectory: app.dataDirectory }), callsBefore = calls.length;
  // The chosen older batch comes back for the same photo with no call.
  const reusedChild = await resumed.request('portraits/child', { childId: 'primary', inputMode: 'photo', photo: childPhoto }, cookie);
  assert.equal(reusedChild.data.people.find(person => person.id === 'child').job.id, child.job.id); assert.equal(calls.length, callsBefore);
  assert.deepEqual(readJSON(dbFile).portraits.find(job => job.id === oldChild.id), oldChild);
  // The unchosen older batch is never handed back; the same photo gets one new checked drawing.
  await resumed.request('portraits/grown-up-one', { childId: 'primary', inputMode: 'photo', photo: adultPhoto }, cookie);
  for (let i = 0; i < 100 && readJSON(dbFile).portraits.at(-1).status === 'running'; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const after = readJSON(dbFile), fresh = after.portraits.at(-1);
  assert.notEqual(fresh.id, oldAdult.id); assert.equal(fresh.personId, 'grown-up-one'); assert.equal(fresh.kind, 'selected-style'); assert.equal(fresh.referencePolicy, 'identity-refs-only-v1'); assert.equal(fresh.inkBase, undefined);
  assert.deepEqual(fresh.candidates.map(candidate => [candidate.pictureStyleId, candidate.renderCheck.status]), [['bold-ink-comic', 'parent-review']]);
  assert.deepEqual(after.portraits.find(job => job.id === oldAdult.id), oldAdult); assert.deepEqual(evidence(adultDirectory), adultFiles);
  assert.deepEqual(calls.slice(callsBefore).map(request => request.stage), ['portrait-render']);
  const listed = (await resumed.request('portraits?childId=primary', undefined, cookie)).data.people;
  assert.equal(listed.find(person => person.id === 'grown-up-one').job.id, fresh.id); assert.ok(listed.find(person => person.id === 'child').selectedUrl);
});

test('the sketch check uses builder provenance, the selected checker and the same photo permission as the drawing', async t => {
  const { buildPortraitIdentityCheckRequest } = await import('../server/requests.js');
  const record = setupRecord(inkFamily()), person = record.cast[1], directory = temp(t), originalFetch = globalThis.fetch;
  const ink = `data:image/png;base64,${(await picture(140)).toString('base64')}`, source = `data:image/png;base64,${(await picture(141)).toString('base64')}`;
  let wires = 0; globalThis.fetch = async () => { wires++; return new Response(JSON.stringify(identityReply({ body: { input: [{ content: [{ text: JSON.stringify({ characterId: person.id }) }] }] } }))); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const body = buildPortraitIdentityCheckRequest(record, person, { inputMode: 'photo', inkData: ink, sourceData: source });
  assert.equal(body.model, readJSON(new URL('../content/prices.json', import.meta.url)).selected.pictureCheck); assert.equal(body.store, false); assert.equal(body.tools, undefined);
  assert.throws(() => buildPortraitIdentityCheckRequest(record, person, { inputMode: 'photo', inkData: ink }), /exactly its own photo/);
  assert.throws(() => buildPortraitIdentityCheckRequest(record, person, { inputMode: 'description', description: descriptionInput.description, inkData: ink, sourceData: source }), /exactly its own photo/);
  const call = (transport, request) => transport.call({ provider: 'openai', path: '/v1/responses', stage: 'portrait-identity-check', body: request, familyRecord: record, privacy: privacyFor(record, '') });
  const gated = createTransport({ keys: { openai: 'fake-key' }, logFile: join(directory, 'gated.jsonl'), maxCalls: 76, familyRecordFor: () => record });
  await assert.rejects(call(gated, body), /Photo use needs/); assert.equal(wires, 0);
  await assert.rejects(call(gated, structuredClone(body)), /provenance/); assert.equal(wires, 0);
  const allowed = createTransport({ keys: { openai: 'fake-key' }, logFile: join(directory, 'allowed.jsonl'), maxCalls: 76, familyRecordFor: () => record, allowSyntheticPortraits: true });
  await call(allowed, body); assert.equal(wires, 1);
  const log = readFileSync(join(directory, 'allowed.jsonl'), 'utf8'); assert.ok(log.includes('[private image input]')); assert.ok(!log.includes(source.split(',')[1])); assert.ok(!log.includes(ink.split(',')[1]));
});

test('appearance drafts save privately without model work, conflict safely and cannot cross families', async t => {
  let modelCalls = 0; const app = await start(t, { allowSyntheticPortraits: true, transportFactory: () => { modelCalls++; throw Error('No generation for drafts'); } });
  const first = await signup(app, 'draft_one'), other = await signup(app, 'draft_two');
  const identities = (await app.request('portraits', undefined, first.cookie)).data.people;
  const childIdentity = identities.find(person => person.id === 'child').personIdentity;
  const parentIdentity = identities.find(person => person.id === 'grown-up-one').personIdentity;
  const before = (await app.request('session', undefined, first.cookie)).data.record;
  const saved = await app.request('portraits/child/draft', { childId: 'primary', personIdentity: childIdentity, description: 'Curly dark hair and round glasses.', revision: 0 }, first.cookie, 'PATCH');
  assert.equal(saved.status, 200); assert.equal(saved.data.people[0].draft.description, 'Curly dark hair and round glasses.'); assert.equal(saved.data.people[0].draft.revision, 1);
  assert.equal((await app.request('portraits', undefined, other.cookie)).data.people[0].draft, undefined);
  assert.equal((await app.request('portraits/child/draft', { childId: 'primary', personIdentity: childIdentity, description: 'Stale change.', revision: 0 }, first.cookie, 'PATCH')).status, 409);
  assert.equal((await app.request('portraits/child/draft', { childId: 'not-owned', description: 'Not owned.', revision: 0 }, first.cookie, 'PATCH')).status, 400);
  assert.equal((await app.request('portraits/child/draft', { childId: 'primary', personIdentity: childIdentity, description: 'https://example.test', revision: 1 }, first.cookie, 'PATCH')).status, 400);
  assert.deepEqual((await app.request('session', undefined, first.cookie)).data.record, before); assert.equal(modelCalls, 0);
  const cleared = await app.request('portraits/child/draft', { childId: 'primary', personIdentity: childIdentity, description: '', revision: 1 }, first.cookie, 'PATCH'); assert.equal(cleared.status, 200); assert.equal(cleared.data.people[0].draft.description, '');
  await app.request('family', { childId: 'primary', family: { ...family(), nickname: 'New fictional name' } }, first.cookie, 'PATCH');
  assert.equal((await app.request('portraits', undefined, first.cookie)).data.people[0].draft, undefined);
  assert.equal((await app.request('portraits/child/draft', { childId: 'primary', personIdentity: childIdentity, description: 'Old name first save.', revision: 0 }, first.cookie, 'PATCH')).status, 409);
  assert.equal((await app.request('portraits', undefined, first.cookie)).data.people[0].draft, undefined);
  await app.request('portraits/grown-up-one/draft', { childId: 'primary', personIdentity: parentIdentity, description: 'Short curly hair.', revision: 0 }, first.cookie, 'PATCH');
  await app.request('portraits/child/draft', { childId: 'primary', personIdentity: childIdentity, description: 'Long straight hair.', revision: 0 }, other.cookie, 'PATCH');
  assert.equal((await app.request('family', {}, first.cookie, 'DELETE')).status, 200);
  assert.equal(readJSON(join(app.dataDirectory, 'accounts.json')).portraitDrafts.length, 1);
  assert.equal((await app.request('portraits', undefined, other.cookie)).data.people[0].draft.description, 'Long straight hair.');
});


test('family save checks appearance versions before changing names and permits a deliberate rename', async t => {
  const app = await start(t, { allowSyntheticPortraits: true }); const user = await signup(app, 'versioned_family');
  const original = (await app.request('portraits', undefined, user.cookie)).data.people[0];
  const stale = { id: 'child', personIdentity: original.personIdentity, revision: 0 };
  const words = await app.request('portraits/child/draft', { childId: 'primary', personIdentity: original.personIdentity, revision: 0, description: 'Round glasses and a blue cap.' }, user.cookie, 'PATCH'); assert.equal(words.status, 200);
  const rename = { family: { ...family(), nickname: 'Robin', appearanceMode: 'photo-or-description' }, childId: 'primary', appearanceDraftVersions: [stale] };
  assert.equal((await app.request('family', rename, user.cookie, 'PATCH')).status, 409);
  assert.equal((await app.request('session', undefined, user.cookie)).data.record.hero.nickname, 'Pip');
  rename.appearanceDraftVersions[0].revision = 1;
  assert.equal((await app.request('family', rename, user.cookie, 'PATCH')).status, 200);
  const updated = (await app.request('portraits', undefined, user.cookie)).data.people[0];
  assert.notEqual(updated.personIdentity, original.personIdentity); assert.equal(updated.draft, undefined);
  assert.equal((await app.request('portraits/child/draft', { childId: 'primary', personIdentity: updated.personIdentity, revision: 0, description: 'Round glasses and a blue cap.' }, user.cookie, 'PATCH')).status, 200);
});


test('custom clothes apply to child and grown-ups with the same item limits', () => {
  const input = { ...family(), presetId: 'custom', customOutfit: 'red jacket; blue jeans; white shoes', parents: [{ ...family().parents[0], customOutfit: 'green kurta; cream trousers; brown shoes' }] };
  const record = setupRecord(input);
  assert.deepEqual(record.hero.lockedOutfit, ['red jacket', 'blue jeans', 'white shoes']);
  assert.deepEqual(record.cast[1].outfit, ['green kurta', 'cream trousers', 'brown shoes']);
  assert.throws(() => setupRecord({ ...input, parents: [{ ...input.parents[0], customOutfit: '' }] }), /outfit/);
  assert.throws(() => setupRecord({ ...input, parents: [{ ...input.parents[0], customOutfit: Array(9).fill('shirt').join(';') }] }), /one to eight/);
});
