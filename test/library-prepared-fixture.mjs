// Synthetic source and subscription records only. Never a shipped teaching guide.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { moves } from '../server/files.js';
import { valueHash, knownActionMenu, instructionEntries } from '../server/library-action.js';
import { buildTeachingDocument } from '../server/library.js';
import { createPreparedLibrary, preparedPolicyVersion } from '../server/library-prepared.js';
import { actionTopic, actionSource, actionDraft, actionReview } from './library-action-fixture.mjs';

export const byteHash = value => createHash('sha256').update(value).digest('hex');
export function preparedFixture({ applicability, sameActionAs = null, undated = false, multiSource = false } = {}) {
  const abstract = actionSource(), bodyText = abstract.abstract;
  const source = { id: abstract.id, sourceType: 'official-guidance', url: 'https://fixture.example/fictional-guidance', title: 'Synthetic prepared guide source, not a real paper', authors: ['Synthetic Researcher'], publisher: 'Synthetic source fixture', year: 2024, bodyText, bodyHash: byteHash(bodyText), actualPopulation: 'Synthetic children aged eight to twelve', scope: 'Synthetic fixture body, not a real full-paper audit', fetchedAt: '2026-10-16T10:00:00Z', retrieval: 'Synthetic local test body, no fetch', license: 'Synthetic test text', status: { state: 'active', checkedAt: '2026-10-16', reviewer: 'Synthetic separate checker', notices: [], correctionDisposition: 'none', reason: 'Synthetic test fixture only', evidenceUrls: ['https://fixture.example/fictional-guidance'] } };
  if (undated) Object.assign(source, { year: null, dateNotStated: true, dateLabel: 'No publication date shown' });
  const sources = [source];
  if (multiSource) {
    const populationBody = 'Synthetic separate population document only. The participants were schoolchildren aged eight to twelve. This is not a real source or evidence of a home teaching effect.';
    sources.push({ ...structuredClone(source), id: 'synthetic-population', title: 'Synthetic separate population guide', bodyText: populationBody, bodyHash: byteHash(populationBody) });
  }
  const topic = actionTopic(), draft = actionDraft();
  draft.sameActionAs = sameActionAs;
  draft.evidence = draft.evidence.map(item => ({ ...item, locator: 'Synthetic finding paragraph', fitLabel: 'GUIDANCE' }));
  draft.instructionEvidence = draft.instructionEvidence.map(item => ({ field: item.field, textHash: valueHash(instructionEntries(draft.action).find(entry => entry.field === item.field).text), limitation: item.limitation, supportType: 'described-procedure', evidence: [{ role: 'procedure', sourceId: source.id, sourceContentHash: source.bodyHash, quote: item.quote, locator: 'Synthetic procedure paragraph' }, { role: 'population', sourceId: sources.at(-1).id, sourceContentHash: sources.at(-1).bodyHash, quote: item.populationQuote, locator: 'Synthetic population paragraph' }] }));
  if (multiSource) draft.instructionEvidence.find(item => item.field === 'practiceScript').evidence.push({ role: 'procedure', sourceId: source.id, sourceContentHash: source.bodyHash, quote: 'Adults supplied safe familiar objects and stopped when a child declined.', locator: 'Synthetic second procedure paragraph' });
  const seeds = moves.filter(move => !move.library), knownActions = knownActionMenu(seeds);
  const review = { ...actionReview({ draft, knownActions }), applicabilityConfirmed: true, matchRuleConfirmed: true, instructionChecks: draft.instructionEvidence.map(item => ({ field: item.field, textHash: item.textHash, evidenceHash: valueHash(item.evidence), supported: true, populationFits: true, noAddedInstruction: true, noBenefitInference: true })) };
  const proof = { prepared: true, models: { model: 'synthetic-subscription-author', judge: 'synthetic-subscription-checker' }, knownActions, goalPreserved: true, draftHash: valueHash(draft), topicHash: valueHash(topic), applicability: applicability ?? { kind: 'age-range', minAge: 10, maxAge: 12, label: 'Synthetic ages ten through twelve only', sourceId: source.id }, matchRule: { id: 'synthetic-sort-goal', version: 1, any: ['(?:the child|he|she|they) (?:wants?|asked|learns?|practi[cs]es?).{0,55}(?:sort|group).{0,30}material'], all: [], exclude: ['(?:dad|mom|teacher).{0,20}wants?.{0,30}sort'] }, reviewScope: 'Synthetic excerpt and procedure review, not real research', preparation: { writer: { model: 'synthetic-subscription-author', modelBasis: 'subscription-session-recorded', sessionId: 'synthetic-author-session', recordedAt: '2026-10-16T10:00:00Z', artifactHash: byteHash('synthetic author fixture') }, judge: { model: 'synthetic-subscription-checker', modelBasis: 'subscription-session-recorded', sessionId: 'synthetic-checker-session', recordedAt: '2026-10-16T11:00:00Z', artifactHash: byteHash('synthetic checker fixture') }, reviewHash: valueHash(review) } };
  const document = buildTeachingDocument(topic, draft, sources, review, seeds, '2026-10-16T12:00:00Z', proof);
  return { source, sources, topic, draft, review, proof, document };
}
export function savePreparedFixture(directory, fixture = preparedFixture()) {
  mkdirSync(directory, { recursive: true });
  const bytes = JSON.stringify({ policyVersion: preparedPolicyVersion, sources: fixture.sources, documents: [fixture.document] }, null, 2) + '\n';
  writeFileSync(join(directory, 'bundle.json'), bytes);
  return { ...fixture, directory, bytes, bank: createPreparedLibrary({ directory, approvedHashes: [byteHash(bytes)] }) };
}
