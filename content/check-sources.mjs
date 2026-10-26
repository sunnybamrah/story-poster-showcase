import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');

export function checkSourceRegistry(records = JSON.parse(readFileSync(new URL('./moves.json', import.meta.url))), registry = JSON.parse(readFileSync(new URL('./source-registry.json', import.meta.url)))) {
  assert.equal(registry.schemaVersion, 1, 'Source registry version is missing');
  assert.equal(registry.originalMovesFileHash, digest(readFileSync(new URL('./moves.json', import.meta.url))), 'The original source file changed after the registry check');
  assert.ok(Array.isArray(registry.records), 'Source registry records are missing');
  let occurrences = 0;
  const used = new Set();
  for (const move of records) for (const [sourceIndex, source] of move.sources.entries()) {
    const matches = registry.records.filter(record => source.pubmed ? record.pubmed === source.pubmed : record.doi?.toLowerCase() === source.doi?.toLowerCase());
    assert.equal(matches.length, 1, `${move.id}: source identity must have one registry record`);
    const record = matches[0], occurrence = record.occurrences.find(row => row.moveId === move.id && row.sourceIndex === sourceIndex);
    assert.equal(occurrence?.originalRowHash, digest(JSON.stringify(source)), `${move.id}: source row no longer matches its registry check`);
    assert.equal(record.review.sourceFetchIsClaimApproval, false, `${move.id}: fetching a source cannot approve its claims`);
    assert.deepEqual(record.review.approvedClaims, [], `${move.id}: metadata checks cannot approve teaching claims`);
    assert.equal(record.abstract, undefined, 'The public registry must not copy study abstracts');
    assert.equal(record.bodyText, undefined, 'The public registry must not copy full papers');
    assert.ok(record.retrieval?.state && record.indexedNotices?.types, `${move.id}: source scope or notice state is missing`);
    used.add(record.id); occurrences++;
  }
  assert.equal(used.size, registry.records.length, 'The original registry contains an unrelated source');
  assert.equal(occurrences, registry.counts.sourceOccurrences);
  return { sources: used.size, occurrences, checkedOn: registry.createdOn, scope: registry.scope, method: 'Local identity and hash checks against the saved source bank. No fresh network or claim review.' };
}

export function checkSources(records = JSON.parse(readFileSync(new URL('./moves.json', import.meta.url)))) {
  let count = 0;
  for (const move of records) {
    assert.ok(Array.isArray(move.sources) && move.sources.length >= 1, `${move.id}: needs at least one source`);
    for (const source of move.sources) {
      assert.ok((typeof source.doi === 'string' && /^10\.\d{4,9}\/\S+$/.test(source.doi)) ||
        (typeof source.pubmed === 'string' && /^\d+$/.test(source.pubmed)), `${move.id}: source lacks an id`);
      assert.ok(['DIRECT', 'ADJACENT', 'MECHANISM', 'ADULT ONLY'].includes(source.fitLabel), `${move.id}: source lacks a fit label`);
      for (const key of ['title', 'people', 'limitation']) assert.ok(typeof source[key] === 'string' && source[key].trim(), `${move.id}: missing ${key}`);
      assert.ok(Number.isInteger(source.year), `${move.id}: missing year`);
      assert.ok(typeof source.place === 'string' || (source.place === null && source.placeNotStatedInMarkdown === true), `${move.id}: unmarked missing place`);
      count++;
    }
  }
  return { status: 'PASS', moves: records.length, sources: count, method: 'Local identifiers and fit labels only. No network verification.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify({ ...checkSources(), sourceRegistry: checkSourceRegistry() }));
