import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, moves } from './files.js';
import { actionFromMove, canonicalActionId, valueHash } from './library-action.js';
import { sourceBody, validateSourceReceipt } from './library-sources.js';

// This pin preserves the exact saved documents and their actual review records.
// It does not grant owner wording approval or a new source-status review.
export const savedGeneralBundleHash = '9fccb6ee8259f962d3eeeff06b0dd3f8b4bd730ebef4dcf07671fb823675c75b';
const normalize = value => value.normalize('NFKC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const fail = message => { throw Error(`The saved general library ${message}.`); };
export function validateSavedGeneralBundle(bundle) {
  if (bundle?.version !== 1 || bundle.kind !== 'saved-general-guides' || !Array.isArray(bundle.entries) || bundle.entries.length !== 3 || !Array.isArray(bundle.requiredDocuments) || bundle.requiredDocuments.length !== 17) fail('is incomplete');
  if (new Set(bundle.entries.map(entry => entry.document?.id)).size !== bundle.entries.length || new Set(bundle.requiredDocuments.map(item => item.id)).size !== bundle.requiredDocuments.length) fail('repeats a guide');
  for (const { document, sources, reviewRecord } of bundle.entries) {
    if (![1, 2].includes(document.version) || !Array.isArray(sources) || sources.length !== document.sourceReceipts.length) fail('needs its saved source bodies');
    sources.forEach(validateSourceReceipt);
    for (const receipt of document.sourceReceipts) {
      const source = sources.find(item => item.id === receipt.id);
      if (!source || ['id', 'url', 'title', 'authors', 'journal', 'year', 'doi', 'contentHash', 'metadataHash', 'contentScope', 'fetchedAt', 'retrieval', 'notices', 'transport'].some(key => valueHash(source[key]) !== valueHash(receipt[key]))) fail('source receipt changed');
    }
    const { draft, review, writer, judge, topic } = reviewRecord ?? {};
    if (!draft || !review || writer?.model !== document.review.writer || judge?.model !== document.review.judge || writer.model === judge.model || !/^[a-f0-9]{64}$/.test(writer.artifactHash ?? '') || !/^[a-f0-9]{64}$/.test(judge.artifactHash ?? '') || review.noPrivateDetails !== true || document.review.ownerApproved !== false) fail('needs its actual separate review');
    if (draft.title !== document.title || topic.topic !== document.topic || valueHash(draft.evidence) !== valueHash(document.evidence)) fail('reviewed wording changed');
    for (const finding of document.evidence) {
      const source = sources.find(item => item.id === finding.sourceId);
      if (!source || !normalize(sourceBody(source)).includes(normalize(finding.quote)) || !review.claims?.some(item => item.sourceId === finding.sourceId && item.claim === finding.claim && item.entailed === true && item.fitLabelCorrect === true)) fail('finding lost its source or review');
    }
    if (document.version === 1) {
      const base = moves.find(move => !move.library && move.id === document.move.library.actionBaseMoveId);
      if (!base || canonicalActionId(document.move) !== base.id || valueHash(actionFromMove(document.move)) !== valueHash(actionFromMove(base)) || document.move.library.actionProvenance.practiceHash !== valueHash(base.practiceScript)) fail('alias changed its original action');
      if (review.passed !== true || !writer.responseId || !judge.responseId) fail('alias review did not pass');
    } else {
      const binding = document.review.binding;
      if (binding.draftHash !== valueHash(draft) || binding.topicHash !== valueHash(topic) || valueHash(document.review.actionReview) !== valueHash(review)) fail('saved action review changed');
      for (const [receipt, answer, model] of [[reviewRecord.writerReceipt, draft, writer.model], [reviewRecord.judgeReceipt, review, judge.model]]) {
        if (receipt?.model !== model || receipt.valueHash !== valueHash(answer) || !['provider-response', 'requested-model'].includes(receipt.modelBasis)) fail('model receipt changed');
      }
      for (const ingredient of document.move.library.actionProvenance.adaptation.ingredientEvidence) {
        const source = sources.find(item => item.id === ingredient.sourceId);
        if (!source || source.contentHash !== ingredient.sourceContentHash || !normalize(sourceBody(source)).includes(normalize(ingredient.quote))) fail('home practice lost its source ingredient');
      }
    }
  }
  return bundle;
}

export function loadSavedGeneralLibrary({ file = join(root, 'content/saved-general-library/bundle.json'), allowMissing = process.env.STORY_POSTER_PUBLIC_CATALOG_ONLY === '1' } = {}) {
  if (!existsSync(file)) {
    if (allowMissing) return { version: 1, kind: 'saved-general-guides', entries: [], requiredDocuments: [], publicCatalogOnly: true };
    fail('is missing');
  }
  const bytes = readFileSync(file);
  if (createHash('sha256').update(bytes).digest('hex') !== savedGeneralBundleHash) fail('changed after its saved review');
  return validateSavedGeneralBundle(JSON.parse(bytes));
}
