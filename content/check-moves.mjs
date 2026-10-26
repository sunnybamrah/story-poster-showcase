import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const historyField = /Original$|BeforePass|Review$|WrittenByCodex$|ChosenByCodex$|^draftStatus$/;
const activeApprovalFields = new Set(['kidScienceLineReview', 'actionLineWrittenByCodex', 'bodyActionWrittenByCodex', 'shortLineWrittenByCodex', 'searchPhraseWrittenByCodex']);

export function checkMoves() {
  const moves = JSON.parse(readFileSync(new URL('./moves.json', import.meta.url)));
  assert.equal(moves.length, 14, 'The public edition includes the 14 base guides.');
  assert.equal(new Set(moves.map(move => move.id)).size, 14, 'Guide IDs must be unique.');
  for (const move of moves) {
    for (const key of Object.keys(move)) assert.equal(historyField.test(key) && !activeApprovalFields.has(key), false, `${move.id}: redundant edit history is excluded (${key}).`);
    for (const key of ['name', 'childPhrase', 'practiceScript', 'positiveAction', 'kidScienceLine', 'whereItCameFromShort']) {
      assert.ok(typeof move[key] === 'string' && move[key].trim(), `${move.id}: ${key} is required.`);
    }
    assert.ok(Array.isArray(move.sources) && move.sources.length > 0, `${move.id}: source records are required.`);
    assert.ok(move.sources.every(source => source.doi || source.pubmed), `${move.id}: each source needs an identifier.`);
    assert.ok(typeof move.source?.limitation === 'string' && move.source.limitation.trim(), `${move.id}: keep the source limitation.`);
    assert.ok(move.actionLineWrittenByCodex && move.bodyActionWrittenByCodex && move.shortLineWrittenByCodex, `${move.id}: keep active authorship and approval checks.`);
  }
  return { count: 14, status: 'PASS', scope: 'Public base catalog shape, citations, limits, and edit-history removal. No new source claims were checked.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(checkMoves()));
