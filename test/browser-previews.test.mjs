import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createBrowserPreviews, createFileDigests } from '../server/browser-previews.js';
import { createReaderPageCache } from '../app/reader-page-cache.js';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'browser-previews-')), source = join(directory, 'kit');
  mkdirSync(source); t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, source };
}

test('file hashes reuse unchanged bytes but detect replacement, same-size edits, restored timestamps, deletion and links', t => {
  const { source } = fixture(t), file = join(source, 'file');
  writeFileSync(file, 'before'); let reads = 0;
  const hash = createFileDigests({ read: path => { reads++; return readFileSync(path); } });
  const before = hash(file), stat = statSync(file);
  assert.equal(hash(file), before); assert.equal(reads, 1);
  writeFileSync(file, 'after!'); utimesSync(file, stat.atime, stat.mtime);
  assert.notEqual(hash(file), before); assert.equal(reads, 2);
  rmSync(file); assert.throws(() => hash(file));
  const target = join(source, 'target'); writeFileSync(target, 'before'); symlinkSync(target, file);
  assert.throws(() => hash(file));
});

test('browser copies preserve originals, share conversion, repair tampering and change with source bytes', async t => {
  const { source } = fixture(t), file = join(source, 'poster.png');
  const original = await sharp({ create: { width: 1800, height: 2300, channels: 3, background: '#f4d27b' } }).png().toBuffer();
  writeFileSync(file, original);
  const previews = createBrowserPreviews();
  const [first, second] = await Promise.all([1, 2].map(() => previews.previewFile({ source: file })));
  assert.deepEqual(first, second);
  const path = join(first.directory, first.name), bytes = readFileSync(path);
  assert.equal((await sharp(bytes).metadata()).width, 1600);
  assert.deepEqual(readFileSync(file), original);
  writeFileSync(path, 'bad copy');
  await previews.previewFile({ source: file }); assert.deepEqual(readFileSync(path), bytes);
  writeFileSync(file, await sharp(original).negate().png().toBuffer());
  assert.notEqual((await previews.previewFile({ source: file })).version, first.version);
  await assert.rejects(previews.previewFile({ source: file, isCurrent: () => false }), { status: 404 });
});

test('an in-flight preview cannot recreate a deleted kit or publish after access is revoked', async t => {
  for (const deleting of [true, false]) {
    const { source } = fixture(t), file = join(source, 'poster.png'); writeFileSync(file, 'original');
    let release, began, allowed = true;
    const started = new Promise(resolve => { began = resolve; });
    const previews = createBrowserPreviews({ convert: async () => { began(); await new Promise(resolve => { release = resolve; }); return Buffer.from('copy'); } });
    const pending = previews.previewFile({ source: file, isCurrent: () => allowed });
    await started;
    if (deleting) rmSync(source, { recursive: true }); else allowed = false;
    release(); await assert.rejects(pending, { status: 404 });
    assert.equal(existsSync(join(source, 'browser-previews')), false);
  }
});

test('reader shares current/next requests, bounds page numbers and releases private blobs on close', async () => {
  const calls = [], revoked = [];
  const cache = createReaderPageCache('/pages/', {
    fetchPage: async (url, options) => { calls.push({ url, options }); return { ok: true, blob: async () => new Blob([url]) }; },
    makeURL: () => 'blob:' + calls.length, revokeURL: url => revoked.push(url),
  });
  const first = await cache.get(1); assert.equal(await cache.get(1), first);
  await Promise.all([2, 3, 4, 5].map(page => cache.get(page)));
  assert.equal(calls.length, 5); await assert.rejects(cache.get(6));
  cache.invalidate(1); await cache.get(1); assert.equal(calls.length, 6);
  cache.dispose(); assert.equal(revoked.length, 6);
  assert.ok(calls.every(({ options }) => options.signal.aborted));
  await assert.rejects(cache.get(1));
});

test('reader close aborts unfinished fetches and never creates a late private blob', async () => {
  let finish, created = 0;
  const cache = createReaderPageCache('/pages/', {
    fetchPage: async () => new Promise(resolve => { finish = resolve; }),
    makeURL: () => { created++; return 'blob:late'; }, revokeURL() {},
  });
  const pending = cache.get(1); cache.dispose();
  finish({ ok: true, blob: async () => new Blob(['late']) });
  await assert.rejects(pending); assert.equal(created, 0);
});
