import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibraryCatalog } from '../server/library-catalog.js';
import { createPreparedLibrary } from '../server/library-prepared.js';
import { loadSavedGeneralLibrary } from '../server/library-saved-general.js';
import { moves } from '../server/files.js';

test('public mode starts with the 14 base guides and no imported saved-source bundle', t => {
  const previous = process.env.STORY_POSTER_PUBLIC_CATALOG_ONLY;
  process.env.STORY_POSTER_PUBLIC_CATALOG_ONLY = '1';
  const directory = mkdtempSync(join(tmpdir(), 'public-guides-'));
  t.after(() => {
    if (previous === undefined) delete process.env.STORY_POSTER_PUBLIC_CATALOG_ONLY;
    else process.env.STORY_POSTER_PUBLIC_CATALOG_ONLY = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  const preparedLibrary = createPreparedLibrary({ directory: join(directory, 'missing-prepared') });
  const saved = loadSavedGeneralLibrary({ file: join(directory, 'missing-saved') });
  const catalog = createLibraryCatalog(join(directory, 'catalog'), { preparedLibrary, registerMove() {} });
  assert.equal(moves.filter(move => !move.library).length, 14);
  assert.deepEqual(preparedLibrary.documents(), []);
  assert.deepEqual(saved.entries, []);
  assert.deepEqual(saved.requiredDocuments, []);
  assert.deepEqual(catalog.list(), []);
});

test('normal saved-library mode still fails closed if its bundle is missing', t => {
  const directory = mkdtempSync(join(tmpdir(), 'missing-saved-guides-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => loadSavedGeneralLibrary({ file: join(directory, 'bundle.json'), allowMissing: false }), /is missing/);
});
