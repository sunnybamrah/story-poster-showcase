import { createHash } from 'node:crypto';

export const sourceAuditHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const approvedSourceAuditHash = '3481460b1b1f5a99bb04103fbf88b24b4ebf1a5942c6164f34af19f0db5922e4';

export function withSavedSourceRows(move, editorial, originalMove = move) {
  const sources = editorial?.sources ?? originalMove?.sources;
  const identity = source => source.sourceId ?? source.pubmed ?? source.doi;
  if (!move || !Array.isArray(sources) || sources.length !== move.sources.length || sources.some((source, index) => !identity(source) || identity(source) !== identity(move.sources[index]) || typeof source.limitation !== 'string')) throw Error('The saved source notes do not match this kit. Keep the original files for review.');
  return { ...structuredClone(move), sources: structuredClone(sources), sourceMetadataRevision: editorial?.sourceMetadataRevision ?? null };
}

// Keep the source-owned file intact. A changed row or review requires a new audit.
export function applySourceAudit(records, audit) {
  if (audit?.version !== 1 || sourceAuditHash(audit) !== approvedSourceAuditHash || audit.review?.status !== 'checked' || audit.review.writer === audit.review.judge || audit.review.ownerApproved !== false) throw Error('The source note correction needs its frozen independent review.');
  const corrected = structuredClone(records), seen = new Set();
  for (const row of audit.rows) {
    const key = `${row.moveId}:${row.pubmed}`;
    const move = corrected.find(item => item.id === row.moveId);
    const sources = move?.sources?.filter(source => source.pubmed === row.pubmed) ?? [];
    if (seen.has(key) || sources.length !== 1 || sourceAuditHash(sources[0]) !== row.originalRowHash) throw Error('The source note correction no longer matches its original row.');
    if (Object.keys(row.correctedFields).sort().join() !== 'fitLabel,limitation' || !['DIRECT', 'ADJACENT', 'MECHANISM', 'ADULT ONLY'].includes(row.correctedFields.fitLabel) || !row.correctedFields.limitation?.trim()) throw Error('The source correction may change only the reviewed fit and limit.');
    seen.add(key);
    Object.assign(sources[0], row.correctedFields, {
      checkedOn: audit.checkedOn,
      notices: structuredClone(row.notices ?? []),
      ...(row.notices?.length ? { correctionDisposition: 'reviewed-no-impact' } : {}),
      audit: { id: audit.id, originalRowHash: row.originalRowHash, auditHash: approvedSourceAuditHash, checkedOn: audit.checkedOn, scope: audit.scope, noticeReviewScope: row.notices?.length ? 'source-note-only' : null, ownerApproved: false, primaryURLs: row.primaryURLs },
    });
    move.sourceMetadataRevision = audit.id;
  }
  return corrected;
}
