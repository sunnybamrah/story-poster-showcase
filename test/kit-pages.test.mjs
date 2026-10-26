import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createKitPages } from '../server/kit-pages.js';
import { createApp } from '../server/app-server.mjs';
import { passwordFields } from '../server/accounts.js';
import { loadPublicSample } from '../server/public-sample.js';
import { saveJSON } from '../server/files.js';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'kit-pages-')), source = join(directory, 'kit');
  mkdirSync(source); writeFileSync(join(source, 'kit_final.pdf'), 'saved PDF snapshot');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, source };
}
const fakeRender = async ({ pdf, output }) => {
  const bytes = readFileSync(pdf);
  for (let page = 1; page <= 5; page++) writeFileSync(join(output, `${page}.png`), Buffer.concat([bytes, Buffer.from(` page ${page}`)]));
};

test('saved pages share one render, repair altered cache and follow the exact PDF snapshot', async t => {
  const { source } = fixture(t); let calls = 0;
  const pages = createKitPages({ render: async options => { calls++; await fakeRender(options); } });
  const files = await Promise.all([1, 2, 3, 4, 5].map(page => pages.pageFile({ source, page })));
  assert.equal(calls, 1);
  assert.equal(readFileSync(join(files[4].directory, files[4].name), 'utf8'), 'saved PDF snapshot page 5');
  await pages.pageFile({ source, page: 2 }); assert.equal(calls, 1);
  writeFileSync(join(files[0].directory, files[0].name), 'altered cache');
  await pages.pageFile({ source, page: 1 }); assert.equal(calls, 2);
  writeFileSync(join(source, 'kit_final.pdf'), 'changed saved PDF');
  const changed = await pages.pageFile({ source, page: 1 }); assert.equal(calls, 3);
  assert.notEqual(changed.directory, files[0].directory);
  assert.equal(readFileSync(join(source, 'kit_final.pdf'), 'utf8'), 'changed saved PDF');
  for (const page of [0, 6, 1.5, '../1']) await assert.rejects(pages.pageFile({ source, page }), { status: 404 });
});

test('in-flight pages cannot recreate a deleted kit or survive revoked read access', async t => {
  const { source } = fixture(t); let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const pages = createKitPages({ render: async options => { started(); await new Promise(resolve => { release = resolve; }); await fakeRender(options); } });
  const pending = pages.pageFile({ source, page: 1 });
  await ready; rmSync(source, { recursive: true }); release();
  await assert.rejects(pending, { status: 404 }); assert.equal(existsSync(source), false);
  mkdirSync(source); writeFileSync(join(source, 'kit_final.pdf'), 'another saved PDF');
  let allowed = true;
  const cached = createKitPages({ render: fakeRender });
  await cached.pageFile({ source, page: 1, isCurrent: () => allowed }); allowed = false;
  await assert.rejects(cached.pageFile({ source, page: 1, isCurrent: () => allowed }), { status: 404 });
});

test('a source link does not expose another kit', async t => {
  const { source, directory } = fixture(t);
  symlinkSync(source, join(directory, 'linked-kit'));
  await assert.rejects(createKitPages({ render: fakeRender }).pageFile({ source: join(directory, 'linked-kit'), page: 1 }), { status: 404 });
});

test('the public example and owned pages load the saved five-page PDF, with private access checked on every request', async t => {
  const { directory } = fixture(t), sample = loadPublicSample(); assert.ok(sample, 'The checked public example must exist.');
  const dataDirectory = join(directory, 'accounts'), password = 'fictional-reader-password';
  const accounts = ['reader', 'other'].map(name => ({ id: randomUUID(), username: name, email: `${name}@example.test`, emailVerified: true, creationEnabled: false, ...passwordFields(password), childIds: ['primary'], activeChildId: 'primary' }));
  const job = { id: randomUUID(), accountId: accounts[0].id, childId: 'primary', status: 'complete', stage: 'ready', result: {}, createdAt: new Date().toISOString() };
  const db = { accounts, jobs: [job], sessions: [] };
  for (const account of accounts) saveJSON(join(dataDirectory, account.id, 'family.json'), sample.record);
  const source = join(dataDirectory, accounts[0].id, job.id); mkdirSync(source, { recursive: true });
  for (const name of ['kit_final.pdf', 'poster.png', 'panel-1.png']) copyFileSync(join(sample.directory, name), join(source, name));
  const original = readFileSync(join(source, 'kit_final.pdf'));
  const app = createApp({ dataDirectory, sample, sampleOnly: false, generationRoute: 'subscription',
    publicOrigin: 'http://localhost', stateStore: { initialState: db, assertWritable() {}, save() {}, flush: async () => {} },
    sendMail: Object.assign(async () => assert.fail('No email in this proof.'), { available: true }),
    transportFactory: () => ({ call() { assert.fail('No generation in this proof.'); } }) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`, url = `/api/jobs/${job.id}/pages/1.png`;
  const login = async account => {
    const response = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify({ email: account.email, password }) });
    assert.equal(response.status, 200); return response.headers.get('set-cookie').split(';')[0];
  };
  assert.equal((await fetch(base + url)).status, 401);
  const ownerCookie = await login(accounts[0]), otherCookie = await login(accounts[1]);
  assert.equal((await fetch(base + url, { headers: { cookie: otherCookie } })).status, 404);
  const publicBytes = [];
  for (let page = 1; page <= 5; page++) {
    const response = await fetch(base + `/api/sample/pages/${page}.png`);
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /image\/png/);
    const bytes = Buffer.from(await response.arrayBuffer()), image = await sharp(bytes).metadata();
    assert.equal(Math.max(image.width, image.height), 1800); publicBytes.push(bytes);
  }
  assert.notDeepEqual(publicBytes[0], publicBytes[1]);
  const own = await fetch(base + url, { headers: { cookie: ownerCookie } });
  assert.equal(own.status, 200); assert.equal(own.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await own.arrayBuffer()), publicBytes[0]);
  assert.deepEqual(readFileSync(join(source, 'kit_final.pdf')), original);
  assert.equal((await fetch(base + url, { headers: { cookie: otherCookie } })).status, 404);
  for (let page = 1; page <= 5; page++) {
    const publicPath = `/api/sample/pages/${page}.webp`;
    const redirect = await fetch(base + publicPath, { redirect: 'manual' });
    assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('cache-control'), 'no-store');
    const versioned = await fetch(base + redirect.headers.get('location'));
    assert.match(versioned.headers.get('cache-control'), /public.*immutable/);
    assert.match(versioned.headers.get('content-type'), /image\/webp/);
    const webp = Buffer.from(await versioned.arrayBuffer()), image = await sharp(webp).metadata();
    assert.equal(image.width, 1200); assert.ok(webp.length < publicBytes[page - 1].length);
    if (page === 1) {
      const privatePath = `/api/jobs/${job.id}/pages/1.webp`;
      assert.equal((await fetch(base + privatePath)).status, 401);
      assert.equal((await fetch(base + privatePath, { headers: { cookie: otherCookie } })).status, 404);
      const ownPreview = await fetch(base + privatePath, { headers: { cookie: ownerCookie } });
      assert.equal(ownPreview.status, 200); assert.equal(ownPreview.headers.get('cache-control'), 'private, no-cache');
      assert.deepEqual(Buffer.from(await ownPreview.arrayBuffer()), webp);
      const headers = { cookie: ownerCookie, 'if-none-match': ownPreview.headers.get('etag') };
      assert.equal((await fetch(base + privatePath, { headers })).status, 304);
      assert.equal((await fetch(base + privatePath, { headers: { 'if-none-match': headers['if-none-match'] } })).status, 401);
      assert.equal((await fetch(base + privatePath, { headers: { ...headers, cookie: otherCookie } })).status, 404);
    }
  }
  for (const name of ['poster', 'panel-1']) {
    const path = `/api/jobs/${job.id}/previews/${name}.webp`;
    assert.equal((await fetch(base + path)).status, 401);
    assert.equal((await fetch(base + path, { headers: { cookie: otherCookie } })).status, 404);
    const ownPreview = await fetch(base + path, { headers: { cookie: ownerCookie } });
    assert.equal(ownPreview.status, 200); assert.equal(ownPreview.headers.get('cache-control'), 'private, no-cache');
    assert.equal((await sharp(Buffer.from(await ownPreview.arrayBuffer())).metadata()).format, 'webp');
    const pub = await fetch(base + `/api/sample/previews/${name}.webp`);
    assert.equal(pub.status, 200); assert.match(pub.headers.get('cache-control'), /public.*immutable/);
    const invalidVersion = await fetch(base + `/api/sample/previews/${name}.webp?v=wrong`, { redirect: 'manual' });
    assert.equal(invalidVersion.status, 302); assert.equal(invalidVersion.headers.get('cache-control'), 'no-store');
    assert.deepEqual(readFileSync(join(source, name + '.png')), readFileSync(join(sample.directory, name + '.png')));
  }
  assert.deepEqual(readFileSync(join(source, 'kit_final.pdf')), original);
  db.jobs.splice(0, 1);
  for (const suffix of ['pages/1.webp', 'previews/poster.webp']) assert.equal((await fetch(base + `/api/jobs/${job.id}/${suffix}`, { headers: { cookie: ownerCookie } })).status, 404);
  assert.equal((await fetch(base + url, { headers: { cookie: ownerCookie } })).status, 404);
});
