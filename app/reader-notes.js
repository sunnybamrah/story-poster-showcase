import notes from '../content/source-reader-notes.json' with { type: 'json' };
import clarity from '../content/guide-reader-clarity.json' with { type: 'json' };
import { researchWordHelp } from './research-words.js';

// Match saved evidence, never a similar sentence or a guide's name.
export function readerClarity(kind, sourceId, original, records = clarity) {
  if (typeof original !== 'string' || !['source-limit', 'guide-limit', 'guide-claim', 'poster-claim', 'guide-action', 'guide-practice', 'guide-try'].includes(kind)) return original;
  if (sourceId != null && (typeof sourceId !== 'string' || !sourceId)) return original;
  const matching = records.filter(row => row?.kind === kind && row.originalText === original);
  const hasId = typeof sourceId === 'string' && sourceId.length > 0;
  const candidates = hasId ? matching.filter(row => row.sourceId === sourceId) : kind === 'source-limit' ? matching : [];
  if (!candidates.length || hasId && candidates.length !== 1 || candidates.some(row => typeof row.plainText !== 'string' || !row.plainText.trim())) return original;
  return new Set(candidates.map(row => row.plainText)).size === 1 ? candidates[0].plainText : original;
}

// Reviewed aliases may reuse an original practice. Only exact source wording
// inherits that practice's correction; an alias's own research stays separate.
export function practiceReaderText(kind, move, original) {
  const current = readerClarity(kind, move.id, original);
  if (current !== original || !['guide-action', 'guide-practice', 'guide-try'].includes(kind)) return current;
  return readerClarity(kind, move.library?.actionBaseMoveId, original);
}

// Presentation only. Never replace a source record or infer a near text match.
export function readerLimitation(kind, sourceId, original, records = notes) {
  if (typeof original !== 'string' || !['source-limit', 'guide-limit'].includes(kind)) return original;
  if (sourceId != null && (typeof sourceId !== 'string' || !sourceId)) return original;
  const matching = records.filter(row => row?.kind === kind && row.originalLimitation === original);
  const hasId = typeof sourceId === 'string' && sourceId.length > 0;
  const candidates = hasId ? matching.filter(row => row.sourceId === sourceId) : kind === 'source-limit' ? matching : [];
  if (!candidates.length || hasId && candidates.length !== 1 || candidates.some(row => typeof row.plainLimitation !== 'string' || !row.plainLimitation.trim())) return original;
  const wording = new Set(candidates.map(row => row.plainLimitation));
  return wording.size === 1 ? candidates[0].plainLimitation : original;
}

const currentLimitation = (kind, id, original) => {
  const updated = readerClarity(kind, id, original);
  return updated !== original ? updated : readerLimitation(kind, id, original);
};
export const sourceReaderLimitation = source => currentLimitation('source-limit', source?.sourceId ?? source?.pubmed ?? source?.doi ?? source?.id, source?.limitation);
export const guideReaderLimitation = (moveId, original) => currentLimitation('guide-limit', moveId, original);
export const guideReaderClaim = (moveId, original) => readerClarity('guide-claim', moveId, original);

// Share only identical displayed notes. Keep every source and its own metadata.
// Definitions belong to the whole section, so readers meet each one once.
export function sourceNoteGroups(sources = [], { definitionText = '' } = {}) {
  const groups = [], byText = new Map();
  sources.forEach((source, index) => {
    const limitation = sourceReaderLimitation(source);
    let group = typeof limitation === 'string' && limitation.length ? byText.get(limitation) : null;
    if (!group) {
      group = { limitation, sources: [] };
      groups.push(group);
      if (typeof limitation === 'string' && limitation.length) byText.set(limitation, group);
    }
    group.sources.push({ source, index });
  });
  const text = [definitionText, ...groups.map(group => group.limitation)].filter(Boolean).join(' ');
  // This reviewed note already explains the word in its own sentence.
  const definitions = researchWordHelp(text).filter(line => line !== 'Adolescents are young people growing from children into adults.' || !text.includes('adolescents, young people growing into adults'));
  return { groups, definitions };
}
