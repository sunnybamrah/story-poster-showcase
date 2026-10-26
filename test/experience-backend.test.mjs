import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
import { createPracticeAnswers } from '../server/practice-answers.js';
import { jobProgress } from '../server/job-progress.js';
import { parentJobFailure } from '../server/job-failure.js';
import { createAccessControl } from '../server/access-control.js';
import { createPrintCopies, renderPrintCopy, printCopySources, printCopyVersion } from '../server/print-copy.js';
import { createApp } from '../server/app-server.mjs';
import { passwordFields } from '../server/accounts.js';
import { kitText } from './kit-text-fixture.mjs';
import { moves, saveJSON } from '../server/files.js';
import { family } from './fixture.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const temp = t => { const directory = mkdtempSync(join(tmpdir(), 'experience-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; };
const completed = (overrides = {}) => ({ id: randomUUID(), accountId: 'family-one', status: 'complete', chapterNumber: 1, childId: 'primary', createdAt: new Date().toISOString(), result: { posterSections: [{ id: 'move', text: 'When I notice ______,\nI ______.\nA backup plan.' }] }, ...overrides });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

for (const [stage, sentence] of [['story', 'We are writing the story.'], ['story-check', 'We are checking the story.'], ['poster-word-check', 'We are checking the pictures and their words.'], ['kit-pdf', 'We are making the pages ready to read and print.']]) test(`progress names actual ${stage} step instead of furthest phase`, () => {
  assert.deepEqual(jobProgress({ id: 'j', accountId: 'a', status: 'running', stage: 'drawing', privateStage: stage }), { state: 'working', message: sentence, active: true });
});
test('own request waits without exposing other families or pretending kits are FIFO', () => {
  const job = { id: 'j', accountId: 'a', status: 'running', privateStage: 'library-review' };
  const other = { owner: { accountId: 'b', workId: 'j' }, status: 'running', secret: 'OTHER FAMILY' };
  assert.equal(jobProgress(job, { requests: [other], worker: { mode: 'remote', online: true } }).state, 'working');
  const request = { owner: { accountId: 'a', workId: 'guide' }, status: 'waiting' };
  const context = { requests: [other, request], libraryJobs: [{ id: 'guide', parentJobId: 'j', accountId: 'a' }], worker: { mode: 'remote', online: true } };
  const view = jobProgress(job, context); assert.equal(view.state, 'queued'); assert.doesNotMatch(JSON.stringify(view), /OTHER FAMILY|position|percent|minutes|guide/);
  assert.equal(view.active, false);
  context.worker.online = false; assert.equal(jobProgress(job, context).state, 'worker-unavailable'); assert.equal(jobProgress(job, context).active, false);
  assert.equal(jobProgress({ ...job, status: 'complete' }, context).state, 'complete');
  const failure = parentJobFailure({ cause: { code: 'WORKER_UNAVAILABLE' } }); assert.equal(failure.kind, 'worker-unavailable');
  assert.equal(jobProgress({ ...job, status: 'failed', failureKind: failure.kind }, context).state, 'worker-unavailable');
});

test('private plan revision prevents lost edits, survives restart and clears without changing printed snapshot', () => {
  const job = completed(), snapshot = JSON.stringify(job), db = {};
  let plans = createPracticeAnswers({ db, persist() {} });
  assert.deepEqual(plans.view(job).prompts, { notice: 'When I notice', action: 'I' });
  plans.change(job, { revision: 0, answers: { notice: 'My hands feel tight.', action: 'Ask for a turn.' } });
  assert.throws(() => plans.change(job, { revision: 0, answers: { notice: '', action: '' } }), error => error.status === 409);
  plans = createPracticeAnswers({ db: JSON.parse(JSON.stringify(db)), persist() {} });
  assert.equal(plans.view(job).answers.action, 'Ask for a turn.');
  assert.equal(plans.change(job, { revision: 1 }, true).revision, 2);
  assert.deepEqual(plans.view(job).answers, { notice: '', action: '' }); assert.equal(JSON.stringify(job), snapshot);
  assert.deepEqual(plans.view({ ...job, accountId: 'other' }).answers, { notice: '', action: '' });
  plans.remove(job.accountId, job.id); assert.equal(plans.view(job).revision, 0);
});
test('plan accepts blank and 500-character answers, rejects invalid fields and unfinished or mismatched kits', () => {
  const plans = createPracticeAnswers({ db: {}, persist() {} }), job = completed();
  plans.change(job, { revision: 0, answers: { notice: 'x'.repeat(500), action: '' } });
  for (const answers of [{ notice: 'x'.repeat(501), action: '' }, { notice: '', action: '', score: 1 }, { notice: 3, action: '' }, { notice: '\x00', action: '' }]) assert.throws(() => plans.change(job, { revision: 1, answers }), error => error.status === 400);
  assert.throws(() => plans.view({ ...job, status: 'running' }), error => error.status === 409);
  assert.throws(() => plans.view({ ...job, result: {} }), error => error.status === 409);
});

function mailHarness({ db, sender, now = Date.now, flush = async () => {} }) {
  return createAccessControl({ db, persist() {}, flush, accounts: { isOwner: () => false }, sendMail: sender, publicOrigin: 'https://stories.example.test', autoDeliver: false, now, readyJobExists: job => job.filesSaved === true });
}
test('ready mail is opt-in, complete, saved, verified and generic, with retry/restart idempotency', async () => {
  const account = { id: 'a', email: 'parent@example.test', emailVerified: true, creationEnabled: false };
  const job = completed({ accountId: 'a', notifyWhenReady: true, filesSaved: true, tonight: 'PRIVATE MOMENT', result: { chapterTitle: 'PRIVATE TITLE' } });
  const db = { accounts: [account], jobs: [job] }, sends = []; let fail = true, now = 100;
  const sender = Object.assign(async message => { sends.push(message); if (fail) throw Error('fixture rejection'); return { accepted: true, providerId: 'fixture-provider' }; }, { available: true });
  let access = mailHarness({ db, sender, now: () => now });
  access.queueReady({ ...job, notifyWhenReady: false }); access.queueReady({ ...job, status: 'running' }); access.queueReady({ ...job, filesSaved: false });
  account.emailVerified = false; access.queueReady(job); account.emailVerified = true;
  assert.equal(db.accessDeliveries.length, 0);
  access.queueReady(job); access.queueReady(job); assert.equal(db.accessDeliveries.length, 1);
  await Promise.all([access.drainEmail(), access.drainEmail()]); assert.equal(sends.length, 1); assert.equal(access.readyEmailView(job).status, 'failed');
  await access.drainEmail(); assert.equal(sends.length, 1); access.close();
  now = 100000; fail = false;
  access = mailHarness({ db: JSON.parse(JSON.stringify(db)), sender, now: () => now });
  await access.drainEmail(); await access.drainEmail(); access.close();
  assert.equal(sends.length, 2); assert.equal(sends[0].idempotencyKey, sends[1].idempotencyKey);
  assert.doesNotMatch(JSON.stringify(sends), /PRIVATE|child|tonight/); assert.match(sends[0].text, /#shelf/);
});
test('ready notice checks ownership and finished files again after durable save, before sending', async () => {
  for (const change of [db => { db.accounts = []; }, db => { db.jobs = []; }, db => { db.jobs[0].filesSaved = false; }, db => { db.accounts[0].emailVerified = false; }]) {
    const job = completed({ accountId: 'a', notifyWhenReady: true, filesSaved: true }), db = { accounts: [{ id: 'a', email: 'parent@example.test', emailVerified: true }], jobs: [job] };
    const access = mailHarness({ db, sender: Object.assign(async () => assert.fail('No mail after deletion or invalidation.'), { available: true }), flush: async () => change(db) });
    access.queueReady(job); await access.drainEmail(); access.close(); assert.equal(db.accessDeliveries[0].reason, 'This message no longer applies.');
  }
});

async function sourceFixture(directory) {
  mkdirSync(directory, { recursive: true }); mkdirSync(join(directory, 'fonts'));
  writeFileSync(join(directory, 'fonts', 'Nunito-400.ttf'), 'fixture font');
  const html = '<html><head><style>@font-face{src:url(\'fonts/Nunito-400.ttf\')}</style></head><body><main class="sheet"><p>Exact saved words.</p><img src="poster-art.png"></main></body></html>';
  for (const name of ['poster.html', 'kit_final.html']) writeFileSync(join(directory, name), html);
  await sharp({ create: { width: 3, height: 2, channels: 3, background: '#fff9ed' } }).png().toFile(join(directory, 'poster-art.png'));
  writeFileSync(join(directory, 'kit_final.pdf'), 'ORIGINAL COLOUR PDF'); writeFileSync(join(directory, 'requests.jsonl'), 'PRIVATE MODEL INPUT');
}
test('B/W derivative keeps exact saved text/original hashes, grayscale art, distinct checked PDFs and no request logs', async t => {
  const root = temp(t), source = join(root, 'source'); await sourceFixture(source);
  const original = printCopySources(source), originalPdf = readFileSync(join(source, 'kit_final.pdf')), calls = [];
  const result = await renderPrintCopy({ source, outputRoot: join(root, 'copy'), render: async (html, pdf, options) => {
    calls.push(options); assert.match(readFileSync(html, 'utf8'), /Exact saved words/); assert.equal(typeof options.inspectPage, 'function');
    writeFileSync(pdf, 'synthetic checked PDF'); return { rendered: true, fixture: true };
  } });
  assert.deepEqual(printCopySources(source), original); assert.deepEqual(readFileSync(join(source, 'kit_final.pdf')), originalPdf);
  assert.equal(existsSync(join(result.directory, 'requests.jsonl')), false); assert.equal(calls.length, 2); assert.equal(calls[1].posterOnly, true);
  assert.deepEqual(Object.keys(result.receipt.outputs).sort(), ['kit-bw.pdf', 'poster-bw.pdf']);
  const pixels = await sharp(join(result.directory, 'poster-art.png')).removeAlpha().toColourspace('srgb').raw().toBuffer();
  for (let i = 0; i < pixels.length; i += 3) { assert.equal(pixels[i], pixels[i + 1]); assert.equal(pixels[i], pixels[i + 2]); }
  assert.ok(result.receipt.artwork[0].whitePixels > 0);
});
test('B/W keeps face midtones and smooth shade order while strengthening dark lines and clearing pale paper', async t => {
  const root = temp(t), source = join(root, 'source'); await sourceFixture(source);
  const ramp = Buffer.from(Array.from({ length: 256 }, (_, shade) => [shade, shade, shade]).flat());
  await sharp(ramp, { raw: { width: 256, height: 1, channels: 3 } }).png().toFile(join(source, 'poster-art.png'));
  const result = await renderPrintCopy({ source, outputRoot: join(root, 'copy'), render: async (_html, pdf) => { writeFileSync(pdf, 'fixture'); return { rendered: true }; } });
  const { data, info } = await sharp(join(result.directory, 'poster-art.png')).greyscale().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [256, 1]);
  assert.ok(data[48] < 48, 'Dark lines become darker.');
  assert.equal(data[128], 128, 'Middle face shade is kept.');
  assert.ok(Math.abs(data[96] - 96) <= 4 && Math.abs(data[160] - 160) <= 4, 'Middle shades stay close to the drawing.');
  assert.equal(data[245], 255, 'Pale paper becomes white.');
  for (let shade = 1; shade < data.length; shade++) {
    assert.ok(data[shade] >= data[shade - 1], 'Shade order cannot reverse.');
    assert.ok(data[shade] - data[shade - 1] <= 2, 'No hard threshold breaks a gradient.');
  }
  assert.ok(new Set(data.slice(48, 217)).size > 150, 'Face and clothing gradients keep distinct shades.');
  assert.equal(result.receipt.version, printCopyVersion);
});
test('B/W updates use a new copy, retain old files and keep old downloads when sources are missing', async t => {
  const dataDirectory = temp(t), job = completed({ accountId: 'a' }), db = { accounts: [{ id: 'a' }], jobs: [job] };
  const source = join(dataDirectory, 'a', job.id); await sourceFixture(source);
  const oldDirectory = join(source, 'print-copies', 'bw-old'); mkdirSync(oldDirectory, { recursive: true });
  const outputs = {};
  for (const name of ['kit-bw.pdf', 'poster-bw.pdf']) { writeFileSync(join(oldDirectory, name), `old ${name}`); outputs[name] = digest(`old ${name}`); }
  job.printCopy = { status: 'ready', directory: 'bw-old', version: 'grayscale-paper-v1', outputs };
  const copies = createPrintCopies({ db, dataDirectory, persist() {}, flush: async () => {}, render: async ({ outputRoot }) => {
    const directory = join(outputRoot, 'bw-new'); mkdirSync(directory, { recursive: true });
    const next = {};
    for (const name of Object.keys(outputs)) { writeFileSync(join(directory, name), `new ${name}`); next[name] = digest(`new ${name}`); }
    return { directory, receipt: { outputs: next } };
  } });
  assert.equal(copies.view(job).status, 'available');
  assert.equal(copies.view(job).assets.kitPdf, `/api/jobs/${job.id}/files/kit-bw.pdf`);
  assert.equal(copies.view(job).refresh.status, 'available');
  assert.equal(copies.checkedFile(job, 'kit-bw.pdf').directory, oldDirectory);
  rmSync(join(source, 'poster.html'));
  assert.equal(copies.view(job).status, 'ready', 'Old copies remain readable without editable source.');
  writeFileSync(join(source, 'poster.html'), readFileSync(join(source, 'kit_final.html')));
  copies.prepare(job); await copies.settled();
  assert.equal(copies.view(job).status, 'ready'); assert.equal(job.printCopy.version, printCopyVersion);
  assert.equal(readFileSync(join(oldDirectory, 'kit-bw.pdf'), 'utf8'), 'old kit-bw.pdf');
  writeFileSync(join(copies.checkedFile(job, 'kit-bw.pdf').directory, 'kit-bw.pdf'), 'changed');
  assert.equal(copies.view(job).status, 'available', 'A changed cached PDF can be rebuilt instead of shown as ready.');
  assert.equal(copies.view(job).assets, undefined, 'Changed files never become public download choices.');
});
for (const failedAt of ['render', 'initial-persist', 'initial-flush', 'final-persist', 'final-flush']) test(`B/W refresh retains both old downloads through ${failedAt} failure and retry`, async t => {
  const dataDirectory = temp(t), job = completed({ accountId: 'a' }), db = { accounts: [{ id: 'a' }], jobs: [job] };
  const source = join(dataDirectory, 'a', job.id); await sourceFixture(source);
  const oldDirectory = join(source, 'print-copies', 'bw-old'); mkdirSync(oldDirectory, { recursive: true });
  const outputs = {};
  for (const name of ['kit-bw.pdf', 'poster-bw.pdf']) { writeFileSync(join(oldDirectory, name), `old ${name}`); outputs[name] = digest(`old ${name}`); }
  const previous = { status: 'ready', directory: 'bw-old', version: 'grayscale-paper-v1', outputs };
  job.printCopy = structuredClone(previous);
  const gate = deferred(); let persists = 0, flushes = 0, failing = true, preparingSnapshot;
  const copies = createPrintCopies({ db, dataDirectory,
    persist() {
      persists++;
      if (job.printCopy.status === 'preparing') preparingSnapshot = structuredClone(job.printCopy);
      if (failing && failedAt === (persists === 1 ? 'initial-persist' : 'final-persist')) throw Error('fixture persist failure');
    },
    flush: async () => {
      flushes++;
      for (const name of Object.keys(outputs)) assert.equal(copies.checkedFile(job, name)?.directory, oldDirectory, 'Old links survive initial and final storage work.');
      assert.equal(copies.view(job).status, 'preparing', 'Ready is not published before storage completes.');
      assert.equal(copies.view(job).refresh.status, 'preparing');
      assert.equal(copies.view(job).assets.kitPdf, `/api/jobs/${job.id}/files/kit-bw.pdf`);
      assert.equal(copies.view(job).assets.posterPdf, `/api/jobs/${job.id}/files/poster-bw.pdf`);
      if (failing && failedAt === (flushes === 1 ? 'initial-flush' : 'final-flush')) throw Error('fixture flush failure');
    },
    render: async ({ outputRoot }) => {
      await gate.promise;
      if (failing && failedAt === 'render') throw Error('fixture render failure');
      const directory = join(outputRoot, 'bw-new'); mkdirSync(directory, { recursive: true });
      const next = {};
      for (const name of Object.keys(outputs)) { writeFileSync(join(directory, name), `new ${name}`); next[name] = digest(`new ${name}`); }
      return { directory, receipt: { outputs: next } };
    },
  });
  if (failedAt === 'initial-persist') assert.throws(() => copies.prepare(job), /fixture persist failure/);
  else assert.equal(copies.prepare(job).status, 'preparing');
  await new Promise(setImmediate);
  for (const name of Object.keys(outputs)) assert.equal(copies.checkedFile(job, name)?.directory, oldDirectory, 'Old links survive the waiting/render phase.');
  // A process restart uses the saved old pointer, without trusting missing or
  // altered PDF files just because their metadata once said ready.
  const restarted = { ...job, printCopy: preparingSnapshot }, restartDB = { accounts: db.accounts, jobs: [restarted] };
  const restartCopies = createPrintCopies({ db: restartDB, dataDirectory, persist() {}, flush: async () => {} });
  assert.deepEqual(restarted.printCopy, previous);
  assert.equal(restartCopies.view(restarted).refresh.status, 'failed');
  assert.ok(restartCopies.view(restarted).assets.kitPdf);
  for (const name of Object.keys(outputs)) assert.equal(restartCopies.checkedFile(restarted, name)?.directory, oldDirectory);
  gate.resolve(); await copies.settled();
  assert.deepEqual(job.printCopy, previous);
  for (const name of Object.keys(outputs)) assert.equal(copies.checkedFile(job, name)?.directory, oldDirectory);
  assert.equal(copies.view(job).status, 'available');
  assert.equal(copies.view(job).refresh.status, 'failed');
  assert.ok(copies.view(job).assets.kitPdf && copies.view(job).assets.posterPdf, 'Both download choices remain visible after a failed refresh.');
  failing = false;
  copies.prepare(job); await copies.settled();
  assert.equal(copies.view(job).status, 'ready');
  assert.equal(copies.view(job).refresh, undefined);
  for (const name of Object.keys(outputs)) assert.equal(readFileSync(join(copies.checkedFile(job, name).directory, name), 'utf8'), `new ${name}`);
});
test('print source path traversal, symlink and failed PDF inspection never publish a ready copy', async t => {
  const root = temp(t), source = join(root, 'source'); await sourceFixture(source);
  await assert.rejects(renderPrintCopy({ source, outputRoot: join(root, 'copy'), render: async () => ({ rendered: false }) }), /did not pass/);
  const html = readFileSync(join(source, 'poster.html'), 'utf8');
  writeFileSync(join(source, 'poster.html'), html.replace('poster-art.png', '../private.png')); assert.throws(() => printCopySources(source), /unsupported/);
  writeFileSync(join(source, 'poster.html'), html); rmSync(join(source, 'poster-art.png')); symlinkSync(join(source, 'kit_final.pdf'), join(source, 'poster-art.png')); assert.throws(() => printCopySources(source), /regular file/);
});
test('print retries are single-flight, revoked families can export, restart clears preparing and deletion cleans late files', async t => {
  const dataDirectory = temp(t), job = completed({ accountId: 'a' }), db = { accounts: [{ id: 'a', creationEnabled: false }], jobs: [job] };
  const source = join(dataDirectory, 'a', job.id); await sourceFixture(source);
  const gate = deferred(); let count = 0;
  const copies = createPrintCopies({ db, dataDirectory, persist() {}, flush: async () => {}, render: async ({ outputRoot }) => {
    count++; await gate.promise; const directory = join(outputRoot, 'bw-fixture'); mkdirSync(directory, { recursive: true });
    for (const file of ['kit-bw.pdf', 'poster-bw.pdf']) writeFileSync(join(directory, file), file);
    return { directory, receipt: { outputs: Object.fromEntries(['kit-bw.pdf', 'poster-bw.pdf'].map(name => [name, digest(name)])) } };
  } });
  assert.equal(copies.prepare(job).status, 'preparing'); assert.equal(copies.prepare(job).status, 'preparing');
  await new Promise(setImmediate); assert.equal(count, 1);
  db.accounts = []; db.jobs = []; rmSync(source, { recursive: true, force: true }); gate.resolve(); await copies.settled();
  assert.equal(existsSync(source), false); assert.equal(copies.checkedFile(job, 'kit-bw.pdf'), null);
  const restarted = completed({ printCopy: { status: 'preparing' } }); createPrintCopies({ db: { jobs: [restarted], accounts: [] }, dataDirectory, persist() {}, flush: async () => {} }); assert.equal(restarted.printCopy.status, 'failed');
});

async function apiHarness(t, overrides = {}) {
  const directory = temp(t), accounts = ['one', 'two'].map(name => ({ id: randomUUID(), username: name, email: `${name}@example.test`, emailVerified: true, creationEnabled: false, ...passwordFields('fixture-password'), childIds: ['primary'], activeChildId: 'primary' }));
  const job = completed({ accountId: accounts[0].id }), db = { accounts, jobs: [job], sessions: [] };
  for (const account of accounts) saveJSON(join(directory, account.id, 'family.json'), { ...family, real: false });
  await sourceFixture(join(directory, job.accountId, job.id));
  const mails = [];
  let release; const wait = new Promise(resolve => { release = resolve; }); let renderCount = 0;
  const options = { dataDirectory: directory, sample: null, sampleOnly: false, generationRoute: 'subscription', publicOrigin: 'https://stories.example.test', stateStore: { initialState: db, assertWritable() {}, save() {}, flush: async () => {} }, sendMail: Object.assign(async message => { mails.push(message); return { accepted: true, providerId: 'fixture' }; }, { available: true }), ownerAccountIds: [accounts[1].id], printCopyRenderer: async ({ outputRoot }) => {
    renderCount++; await wait; const directory = join(outputRoot, 'bw-api'); mkdirSync(directory, { recursive: true });
    for (const name of ['poster-bw.pdf', 'kit-bw.pdf']) writeFileSync(join(directory, name), name);
    return { directory, receipt: { outputs: Object.fromEntries(['poster-bw.pdf', 'kit-bw.pdf'].map(name => [name, digest(name)])) } };
  }, ...overrides };
  let app = createApp(options); const listen = () => new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); await listen();
  t.after(async () => { release(); await app.close(); });
  const request = async (path, body, cookie, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const cookies = [];
  for (const account of accounts) cookies.push((await request('login', { email: account.email, password: 'fixture-password' })).cookie);
  return { request, cookies, job, db, directory, release, mails, renderCount: () => renderCount, restart: async () => { await app.close(); app = createApp(options); await listen(); } };
}
test('owned practice API persists with stale-edit protection and stays out of owner/sample/job snapshots', async t => {
  const h = await apiHarness(t), path = `jobs/${h.job.id}/practice`, first = h.cookies[0], other = h.cookies[1];
  assert.equal((await h.request(path)).status, 401); assert.equal((await h.request(path, undefined, other)).status, 404);
  assert.equal((await h.request(path, { revision: 0, answers: { notice: 'PRIVATE PLAN', action: 'Read slowly.' } }, first, 'PUT')).status, 200);
  const saves = await Promise.all([1, 2].map(() => h.request(path, { revision: 1, answers: { notice: 'PRIVATE PLAN', action: 'Read slowly.' } }, first, 'PUT'))); assert.deepEqual(saves.map(row => row.status).sort(), [200, 409]);
  await h.restart(); assert.equal((await h.request(path, undefined, first)).body.answers.notice, 'PRIVATE PLAN');
  for (const [route, cookie] of [[`jobs/${h.job.id}`, first], ['session', first], ['owner/kits', other], ['sample', undefined]]) assert.doesNotMatch(JSON.stringify((await h.request(route, undefined, cookie)).body), /PRIVATE PLAN/);
  assert.equal((await h.request(path, { revision: 2 }, first, 'DELETE')).status, 200);
  assert.equal((await h.request('family', {}, first, 'DELETE')).status, 200); assert.equal(h.db.practiceAnswers.length, 0);
});
test('owned print API single-flights without story allowance and keeps colour originals and other accounts isolated', async t => {
  const h = await apiHarness(t), first = h.cookies[0], other = h.cookies[1], path = `jobs/${h.job.id}/print-copy`;
  const before = readFileSync(join(h.directory, h.job.accountId, h.job.id, 'kit_final.pdf'));
  assert.equal((await h.request(path, {}, other)).status, 404);
  assert.equal((await h.request(path, undefined, first)).body.status, 'available');
  const requests = await Promise.all([1, 2].map(() => h.request(path, {}, first))); assert.ok(requests.every(row => row.status === 202));
  assert.equal(h.renderCount(), 1); h.release();
  let response; for (let i = 0; i < 50; i++) { response = await h.request(path, undefined, first); if (response.body.status === 'ready') break; await new Promise(setImmediate); }
  assert.equal(response.body.status, 'ready');
  assert.equal((await h.request(`jobs/${h.job.id}/files/kit-bw.pdf`, undefined, first)).status, 200);
  assert.equal((await h.request(`jobs/${h.job.id}/files/kit-bw.pdf`, undefined, other)).status, 404);
  assert.equal(h.db.storyReservations.length, 0); assert.deepEqual(readFileSync(join(h.directory, h.job.accountId, h.job.id, 'kit_final.pdf')), before);
  writeFileSync(join(h.directory, h.job.accountId, h.job.id, 'print-copies', h.job.printCopy.directory, 'kit-bw.pdf'), 'modified');
  assert.equal((await h.request(`jobs/${h.job.id}/files/kit-bw.pdf`, undefined, first)).status, 404);
});

test('new-job email choice is saved only when selected and sends after finished files, never retroactively', async t => {
  let release; const gate = new Promise(done => { release = done; });
  const h = await apiHarness(t, {
    transportFactory: () => ({ call: async () => assert.fail('This fixture makes no model calls.') }),
    runKit: async (_transport, memory, _tonight, options) => {
      await gate; mkdirSync(options.directory, { recursive: true });
      for (const name of ['poster.png', 'poster.pdf', 'kit_final.pdf']) writeFileSync(join(options.directory, name), 'synthetic completed export');
      const move = moves.find(move => move.id === 'name-it-exactly');
      return { ...kitText(move), world: 'comic strip', colourSet: 'warm', complete: true, move, moveId: move.id, recordAtStart: memory.exportRecord() };
    },
  });
  h.db.accounts[0].creationEnabled = true;
  const cookie = h.cookies[0], input = { tonight: 'Homework felt frustrating.', moveId: 'name-it-exactly', allowRepeat: true };
  assert.equal((await h.request('session', undefined, cookie)).body.readyEmailEligible, true);
  assert.equal((await h.request('jobs', { ...input, notifyWhenReady: 'yes' }, cookie)).status, 400);
  const created = await h.request('jobs', { ...input, notifyWhenReady: true }, cookie); assert.equal(created.status, 202, JSON.stringify(created.body));
  assert.deepEqual(created.body.readyEmail, { enabled: true, status: 'waiting' }); assert.equal(h.mails.length, 0);
  release();
  let result; for (let i = 0; i < 60; i++) { result = await h.request(`jobs/${created.body.id}`, undefined, cookie); if (result.body.status !== 'running') break; await new Promise(setImmediate); }
  assert.equal(result.body.status, 'complete', JSON.stringify(h.db.jobs.find(job => job.id === created.body.id)?.lastFailure?.error));
  for (let i = 0; i < 20 && h.mails.length === 0; i++) await new Promise(setImmediate);
  assert.equal(h.mails.length, 1); assert.equal(h.db.accessDeliveries.filter(row => row.kind === 'kit-ready').length, 1);
  assert.doesNotMatch(JSON.stringify(h.mails), /Homework|Pip|Confidence/);
  const noNotice = await h.request('jobs', input, cookie); assert.equal(noNotice.status, 202, JSON.stringify(noNotice.body));
  for (let i = 0; i < 60; i++) { result = await h.request(`jobs/${noNotice.body.id}`, undefined, cookie); if (result.body.status !== 'running') break; await new Promise(setImmediate); }
  assert.equal(result.body.status, 'complete'); assert.equal(result.body.readyEmail.status, 'off');
  await h.restart(); assert.equal(h.mails.length, 1); assert.equal(h.db.accessDeliveries.filter(row => row.kind === 'kit-ready').length, 1);
});

test('temporary email unavailability stays retryable without losing an opted-in completed job', async () => {
  const job = completed({ accountId: 'a', filesSaved: true, notifyWhenReady: true });
  const db = { accounts: [{ id: 'a', email: 'parent@example.test', emailVerified: true }], jobs: [job] };
  const sender = Object.assign(async () => assert.fail('Unavailable sender must not run.'), { available: false });
  const access = mailHarness({ db, sender, now: () => 100 });
  access.queueReady(job); await access.drainEmail(); access.close();
  assert.equal(db.accessDeliveries[0].status, 'failed'); assert.ok(db.accessDeliveries[0].nextAttemptAt < Number.MAX_SAFE_INTEGER);
});

for (const failedAt of ['initial', 'final']) test(`print ${failedAt} flush failure is contained, retryable, and cannot publish a ready response`, async t => {
  const dataDirectory = temp(t), job = completed({ accountId: 'a' }), db = { accounts: [{ id: 'a' }], jobs: [job] };
  await sourceFixture(join(dataDirectory, 'a', job.id));
  let flushes = 0, renders = 0, failing = true;
  const copies = createPrintCopies({ db, dataDirectory, persist() {}, flush: async () => { flushes++; if (failing && (failedAt === 'initial' || flushes >= 2)) throw Error('fixture storage unavailable'); }, render: async ({ outputRoot }) => {
    renders++; const directory = join(outputRoot, `bw-fixture-${renders}`); mkdirSync(directory, { recursive: true });
    for (const name of ['kit-bw.pdf', 'poster-bw.pdf']) writeFileSync(join(directory, name), name);
    return { directory, receipt: { outputs: Object.fromEntries(['kit-bw.pdf', 'poster-bw.pdf'].map(name => [name, digest(name)])) } };
  } });
  assert.equal(copies.prepare(job).status, 'preparing'); await copies.settled();
  assert.equal(copies.view(job).status, 'failed'); assert.equal(copies.busy('a'), false); assert.equal(copies.checkedFile(job, 'kit-bw.pdf'), null);
  assert.equal(renders, failedAt === 'initial' ? 0 : 1);
  failing = false; assert.equal(copies.prepare(job).status, 'preparing'); await copies.settled(); assert.equal(copies.view(job).status, 'ready');
});
