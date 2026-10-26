import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readJSON, saveJSON, moves } from './files.js';
import { selectedRhymeFor } from './rhyme.js';
import { validateV2Document, guideKey, knownActionMenu } from './library-action.js';
import { createPreparedLibrary, preparedGuideKey, bindPreparedVerifier } from './library-prepared.js';
import { loadSavedGeneralLibrary } from './library-saved-general.js';

export const generalTopicKey = topic => createHash('sha256').update(topic.normalize('NFKC').toLowerCase().replace(/[^\p{L}\s-]/gu, '').replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 24);
export const documentHash = document => { const { sha256, ...body } = document; return createHash('sha256').update(JSON.stringify(body)).digest('hex'); };
export function validateLibraryDocument(document, { preparedLibrary } = {}) {
  if (!document || ![1, 2, 3, 4].includes(document.version) || document.status !== 'reusable' || document.id !== `lib-${document.version >= 3 ? preparedGuideKey(document.topic, document.goal, document.move?.library?.actionIdentity?.fingerprint, document.version) : document.version === 2 ? guideKey(document.topic, document.goal, document.move?.library?.actionIdentity?.fingerprint) : generalTopicKey(document.topic)}` || document.move?.id !== document.id || document.sha256 !== documentHash(document)) throw Error('The shared teaching document has changed or is not reusable.');
  if (document.review?.status !== 'machine-reviewed' || document.review.ownerApproved !== false || !document.review.writer || !document.review.judge || document.review.writer === document.review.judge || !document.review.sourceVerified || !document.review.privacyChecked) throw Error('The teaching document needs separate source and privacy review.');
  if (document.move.library?.status !== 'reusable' || document.move.library.documentId !== document.id || document.version === 1 && !document.move.library.actionBaseMoveId || !document.move.sources?.length) throw Error('The teaching document is not linked to its source action and studies.');
  if (document.version === 2) validateV2Document(document);
  if (document.version >= 3) {
    if (!preparedLibrary) throw Error('Prepared guides require the reviewed server source bank.');
    preparedLibrary.validate(document);
  }
  selectedRhymeFor(document.move);
  return document;
}
export function createLibraryCatalog(directory, { preparedLibrary = createPreparedLibrary(), registerMove = move => {
  const current = moves.find(item => item.id === move.id);
  // One application catalogue is supported per server process. Tests that use
  // independent data directories inject registerMove. Conflicting wording for
  // one immutable id must fail rather than replace another guide's science.
  if (current && JSON.stringify(current) !== JSON.stringify(move)) throw Error('A reusable teaching move cannot be silently overwritten.');
  if (!current) moves.push(structuredClone(move));
  if (move.library?.schemaVersion >= 3) bindPreparedVerifier(current ?? moves.at(-1), () => { const document = preparedLibrary.documents().find(item => item.id === move.id); if (!document) throw Error('The prepared guide is missing.'); preparedLibrary.assertCurrent(document); });
} } = {}) {
  const savedGeneral = loadSavedGeneralLibrary();
  const validateDocument = document => {
    validateLibraryDocument(document, { preparedLibrary });
    const pinned = savedGeneral.entries.find(entry => entry.document.id === document.id)?.document;
    if (pinned && JSON.stringify(document) !== JSON.stringify(pinned)) throw Error('A saved general guide cannot replace its reviewed content.');
    return document;
  };
  const documents = new Map();
  const roots = () => new Set([...moves.filter(move => !move.library).map(move => move.id), ...[...documents.values()].filter(document => document.move.library.actionIdentity?.sameAs === null).map(document => document.move.library.actionIdentity.id)]);
  const checkAlias = document => {
    const identity = document.move.library.actionIdentity;
    if ([2, 3, 4].includes(document.version) && identity?.sameAs !== null && !roots().has(identity?.sameAs)) throw Error('A teaching action alias must point directly to an existing canonical action.');
  };
  if (existsSync(directory)) for (const name of readdirSync(directory).filter(name => /^lib-[a-f0-9]{24}\.json$/.test(name))) {
    const document = validateDocument(readJSON(join(directory, name))); documents.set(document.id, document);
  }
  for (const document of documents.values()) { checkAlias(document); registerMove(document.move); }
  const catalog = {
    list: () => [...documents.values()].map(document => structuredClone(document)),
    get: id => documents.has(id) ? structuredClone(documents.get(id)) : null,
    findTopic: (topic, goal) => [...documents.values()].find(document => generalTopicKey(document.topic) === generalTopicKey(topic) && (goal === undefined || document.version === 1 || document.goal === goal)) ?? null,
    mark(topic, status, goal) {
      if (!['draft', 'checked', 'reusable'].includes(status)) throw Error('Unknown teaching-library state.');
      const id = `lib-${generalTopicKey(topic)}`;
      saveJSON(join(directory, `${id}.status.json`), { id, topic, ...(goal ? { goal } : {}), status });
    },
    publish(document) {
      validateDocument(document);
      const current = documents.get(document.id);
      if (current) {
        if (current.sha256 !== document.sha256) throw Error('An immutable teaching document cannot be replaced with different content.');
        return structuredClone(current);
      }
      checkAlias(document);
      if ([2, 3, 4].includes(document.version) && document.move.library.actionKind === 'source-derived') {
        const currentIds = knownActionMenu([...moves.filter(move => !move.library), ...[...documents.values()].map(item => item.move)]).map(action => action.id).sort();
        if (document.version >= 3 ? currentIds.some(id => !document.review.knownActionIds.includes(id)) : [...document.review.knownActionIds].sort().join() !== currentIds.join()) throw Error('The action catalog changed during identity review. The saved draft needs a fresh review.');
      }
      saveJSON(join(directory, `${document.id}.json`), document);
      saveJSON(join(directory, `${document.id}.status.json`), { id: document.id, topic: document.topic, status: 'reusable' });
      registerMove(document.move); documents.set(document.id, structuredClone(document));
      return structuredClone(document);
    },
  };
  for (const document of preparedLibrary.documents()) catalog.publish(document);
  // These saved guides were reviewed against this exact earlier catalog.
  // Custom banks remain independent. The ordinary publish identity gate still
  // checks the maths guide before the turning guide, in their saved order.
  if (savedGeneral.requiredDocuments.length && savedGeneral.requiredDocuments.every(item => documents.has(item.id))) {
    if (savedGeneral.requiredDocuments.some(item => documents.get(item.id).sha256 !== item.sha256)) throw Error('The earlier catalog changed before saved general guide import.');
    for (const { document } of savedGeneral.entries) catalog.publish(document);
  }
  return catalog;
}
