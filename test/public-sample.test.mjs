import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { loadPublicSample, publicSampleDirectory, publicSampleManifestSHA256 } from '../server/public-sample.js';

test('the inspected public example is explicitly fictional and contains only its read/download data', () => {
  const sample = loadPublicSample();
  assert.equal(sample.record.real, false);
  assert.equal(sample.record.hero.age, 8);
  assert.equal(sample.text.ready, true);
  assert.equal(sample.text.tagline, 'Name it to tame it');
  assert.equal(sample.move.id, sample.text.moveId);
  assert.equal(sample.printCopy.status, 'ready');
  assert.equal(sample.printCopy.assets.kitPdf, '/api/sample/files/kit-bw.pdf');
  assert.equal(sample.printCopy.assets.posterPdf, '/api/sample/files/poster-bw.pdf');
  const bytes = readFileSync(join(publicSampleDirectory, 'manifest.json'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), publicSampleManifestSHA256);
  assert.doesNotMatch(bytes.toString(), /\/Users\/|\/var\/|@|authTokens|dataPolicyConsent|cachedRequests/);
  assert.ok(sample.record.cast.every(person => person.referencePath === ''));
  sample.text.tagline = 'changed by a caller';
  assert.equal(loadPublicSample().text.tagline, 'Name it to tame it');
});

test('changed words, real-family flags, unknown files and absent files cannot become public examples', () => {
  const directory = mkdtempSync(join(tmpdir(), 'story-public-sample-'));
  try {
    assert.equal(loadPublicSample({ directory }), null);
    const original = JSON.parse(readFileSync(join(publicSampleDirectory, 'manifest.json')));
    for (const change of [m => { m.record.real = true; }, m => { delete m.record.real; }, m => { m.text.story = 'Different text'; }, m => { m.assets['../private.json'] = {}; }]) {
      const altered = structuredClone(original); change(altered);
      writeFileSync(join(directory, 'manifest.json'), JSON.stringify(altered));
      assert.equal(loadPublicSample({ directory }), null);
    }
  } finally { rmSync(directory, { recursive: true }); }
});

test('a changed download is refused even when its public manifest is unchanged', () => {
  const directory = mkdtempSync(join(tmpdir(), 'story-public-assets-'));
  try {
    cpSync(publicSampleDirectory, directory, { recursive: true });
    assert.ok(loadPublicSample({ directory }));
    for (const name of ['kit_final.pdf', 'kit-bw.pdf', 'poster-bw.pdf']) {
      const original = readFileSync(join(directory, name));
      writeFileSync(join(directory, name), 'replaced');
      assert.equal(loadPublicSample({ directory }), null);
      writeFileSync(join(directory, name), original);
    }
    assert.ok(loadPublicSample());
  } finally { rmSync(directory, { recursive: true }); }
});
