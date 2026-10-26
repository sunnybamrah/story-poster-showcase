import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app-server.mjs';
import { root } from '../server/files.js';

async function media(t) {
  const directory = mkdtempSync(join(tmpdir(), 'story-poster-media-')), name = 'media-probe-' + randomUUID() + '.mp4';
  const path = join(root, 'app-dist', name), emptyPath = join(root, 'app-dist', 'empty-' + name);
  mkdirSync(join(root, 'app-dist'), { recursive: true });
  const bytes = Buffer.from('0123456789abcdef'); writeFileSync(path, bytes); writeFileSync(emptyPath, '');
  let keyReads = 0;
  const app = createApp({ dataDirectory: directory, sampleOnly: true, sample: null, keyReader: () => { keyReads++; throw Error('Media must never read a key.'); } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(path); rmSync(emptyPath); rmSync(directory, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const request = async (range, { method = 'GET', file = name, headers = {} } = {}) => {
    const response = await fetch(base + '/' + file, { method, headers: { ...(range ? { Range: range } : {}), ...headers } });
    return { response, bytes: Buffer.from(await response.arrayBuffer()) };
  };
  return { request, bytes, name, base, keyReads: () => keyReads };
}

test('video playback gets exact full, head, prefix, suffix and seek bytes without a paid call', async t => {
  const h = await media(t), full = await h.request();
  assert.equal(full.response.status, 200); assert.equal(full.response.headers.get('content-type'), 'video/mp4');
  assert.equal(full.response.headers.get('accept-ranges'), 'bytes'); assert.equal(full.response.headers.get('content-length'), String(h.bytes.length)); assert.deepEqual(full.bytes, h.bytes);
  for (const [header, first, last] of [['bytes=0-3', 0, 3], ['bytes=4-', 4, 15], ['bytes=-4', 12, 15], ['bytes=13-99', 13, 15], ['bytes=-999999999999999999999', 0, 15], ['BYTES=2-999999999999999999999', 2, 15]]) {
    const got = await h.request(header);
    assert.equal(got.response.status, 206, header); assert.equal(got.response.headers.get('content-range'), 'bytes ' + first + '-' + last + '/16');
    assert.equal(got.response.headers.get('content-length'), String(last - first + 1)); assert.deepEqual(got.bytes, h.bytes.subarray(first, last + 1));
  }
  const head = await h.request('bytes=0-3', { method: 'HEAD' });
  assert.equal(head.response.status, 200); assert.equal(head.response.headers.get('content-length'), '16'); assert.equal(head.bytes.length, 0); assert.equal(head.response.headers.get('content-range'), null);
  assert.equal(h.keyReads(), 0);
});

test('range bounds fail safely while ignored ranges preserve full content and private files still need sign in', async t => {
  const h = await media(t);
  for (const header of ['bytes=16-', 'bytes=999999999999999999999999-', 'bytes=10-2', 'bytes=-0']) {
    const got = await h.request(header); assert.equal(got.response.status, 416, header); assert.equal(got.response.headers.get('content-range'), 'bytes */16'); assert.equal(got.bytes.length, 0);
  }
  const empty = await h.request('bytes=0-', { file: 'empty-' + h.name }); assert.equal(empty.response.status, 416); assert.equal(empty.response.headers.get('content-range'), 'bytes */0');
  for (const header of ['chapters=1-2', 'bytes=bad', 'bytes=0-1,4-5']) {
    const got = await h.request(header); assert.equal(got.response.status, 200); assert.deepEqual(got.bytes, h.bytes);
  }
  const conditional = await h.request('bytes=0-1', { headers: { 'If-Range': '"unverified"' } }); assert.equal(conditional.response.status, 200); assert.deepEqual(conditional.bytes, h.bytes);
  const privateRead = await fetch(h.base + '/api/jobs/' + randomUUID() + '/files/kit_final.pdf', { headers: { Range: 'bytes=0-3' } });
  assert.equal(privateRead.status, 401); assert.equal(privateRead.headers.get('content-range'), null);
  assert.equal(h.keyReads(), 0);
});
