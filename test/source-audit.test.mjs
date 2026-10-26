import test from 'node:test';
import assert from 'node:assert/strict';
import { readJSON, moves } from '../server/files.js';
import { applySourceAudit, withSavedSourceRows } from '../server/source-audit.js';
import { checkSourceRegistry } from '../content/check-sources.mjs';

const originals = readJSON(new URL('../content/moves.json', import.meta.url));
const audit = readJSON(new URL('../content/source-row-audit.json', import.meta.url));

test('saved output restores its own source notes while fresh output keeps the correction', () => {
  for (const id of audit.rows.map(row => row.moveId)) {
    const original = originals.find(move => move.id === id), fresh = moves.find(move => move.id === id);
    const restored = withSavedSourceRows(fresh, { sources: original.sources });
    assert.deepEqual(restored.sources, original.sources);
    assert.equal(restored.practiceScript, fresh.practiceScript);
    assert.deepEqual(restored.science, fresh.science);
    assert.equal(restored.sourceMetadataRevision, null);
    assert.notDeepEqual(restored.sources, fresh.sources);
    assert.deepEqual(withSavedSourceRows(fresh, null, original).sources, original.sources);
  }
  const wrong = structuredClone(originals[4].sources); wrong[0].pubmed = '30707442';
  assert.throws(() => withSavedSourceRows(moves.find(move => move.id === originals[4].id), { sources: wrong }), /saved source notes/);
});

test('the saved source bank binds all original rows and does not claim that a metadata fetch approves teaching', () => {
  assert.equal(checkSourceRegistry().sources, 28);
  const changed = structuredClone(originals); changed[4].sources[1].pubmed = '38518585';
  assert.throws(() => checkSourceRegistry(changed), /source row/);
});

test('source-row attribution corrections cover every reviewed row without changing the original records or practice', () => {
  const before = JSON.stringify(originals), revised = applySourceAudit(originals, audit);
  assert.equal(JSON.stringify(originals), before);
  let count = 0;
  for (const [index, original] of originals.entries()) {
    const { sources: oldSources, ...oldRest } = original;
    const { sources: newSources, sourceMetadataRevision, ...newRest } = revised[index];
    assert.deepEqual(newRest, oldRest);
    for (const [at, source] of oldSources.entries()) {
      const row = audit.rows.find(row => row.moveId === original.id && row.pubmed === source.pubmed);
      if (!row) assert.deepEqual(newSources[at], source);
      else {
        count++;
        assert.equal(sourceMetadataRevision, audit.id);
        assert.equal(newSources[at].fitLabel, row.correctedFields.fitLabel);
        assert.equal(newSources[at].limitation, row.correctedFields.limitation);
        assert.equal(newSources[at].audit.ownerApproved, false);
      }
    }
  }
  assert.equal(count, 7);
  assert.equal(moves.find(move => move.id === 'cool-off-break').sources[1].fitLabel, 'ADJACENT');
  const corrected = moves.find(move => move.id === 'worry-parking-spot').sources[1];
  assert.equal(corrected.notices[0].type, 'ErratumIn');
  assert.equal(corrected.correctionDisposition, 'reviewed-no-impact');
  assert.equal(corrected.audit.noticeReviewScope, 'source-note-only');
  assert.match(corrected.notices[0].evidenceHash, /^[a-f0-9]{64}$/);
});

test('a changed source row, swapped study or altered review cannot inherit a source correction', () => {
  for (const change of [
    rows => { rows[4].sources[1].pubmed = '38518585'; },
    rows => { rows[5].sources[1].limitation = 'Changed after review.'; },
    rows => { rows[12].sources.reverse(); rows[12].sources[0].title = 'Another source'; },
  ]) {
    const rows = structuredClone(originals); change(rows);
    assert.throws(() => applySourceAudit(rows, audit), /original row/);
  }
  const changed = structuredClone(audit); changed.rows[0].correctedFields.limitation = 'Unreviewed wording.';
  assert.throws(() => applySourceAudit(originals, changed), /frozen independent review/);
});
