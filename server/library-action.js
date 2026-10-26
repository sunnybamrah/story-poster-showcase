import { createHash } from 'node:crypto';
import { words } from './files.js';
import { validateSourceReceipt, sourceBody } from './library-sources.js';

export const libraryPolicyVersion = 'goal-action-v2';
export const actionContractVersion = 2;
export const sourceActionPopulation = 'Parent-led reading and practice for children ages eight through thirteen.';
export const libraryAudienceFor = (context = {}) => context.focus === 'parent' || context.focusPersonId && context.focusPersonId !== 'child' ? 'parent' : 'child';
export const libraryMoveAudienceFits = (move, context) => {
  const audience = libraryAudienceFor(context);
  if (move.library?.audience) return move.library.audience === audience || move.library.audience === 'both';
  if (audience === 'child') return true;
  // Reuse an original adult-evidence action without changing its claim or limits.
  return !move.library && move.science?.evidenceLabel === 'ADULT ONLY' && move.sources?.some(source => source.fitLabel === 'ADULT ONLY');
};
export const libraryRouteOptions = (context = {}) => ({ parentEdition: libraryAudienceFor(context) === 'parent', remembranceRequested: context.remembranceChildLed === true, remembranceChildLed: context.remembranceChildLed === true });
export const valueHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalized = value => value.normalize('NFKC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const exact = (value, fields, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== [...fields].sort().join()) throw Error(`The ${label} has missing or unexpected fields.`);
};
const bounded = (value, limit, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > limit) throw Error(`The ${label} needs bounded plain text.`);
  return value.trim();
};
export const clinicalAction = /\b(?:dose|dosage|medicat\w*|medicin\w*|milligrams?|micrograms?|mg|mcg|prescri\w*|diagnos\w*|treatment|therap\w*|suicid\w*|self[- ]harm|puberty|sexual|genitals?|hormones?|dieting|weight loss)\b/i;
const timedAction = /\d|\b(?:seconds?|minutes?|hours?|daily|weekly|per day|per week)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|sixty|ninety)\s+(?:days?|weeks?|breaths?|times|repetitions?)\b/i;
const promise = /\b(?:guarantee\w*|cure\w*|will (?:improve|prevent|fix|stop|make|reduce)|always works|never fail)\b/i;
export function safeActionText(value, limit, label) {
  const result = bounded(value, limit, label);
  if (clinicalAction.test(result) || timedAction.test(result) || promise.test(result) || /[\u2013\u2014]|\s-\s/.test(result)) throw Error(`The ${label} introduces clinical advice, timing, numbers, a promise or unclear punctuation. It needs human review.`);
  return result;
}
export function generalGoal(value, label = 'general learning goal', { allowPronouns = false } = {}) {
  const goal = bounded(value, 220, label);
  if (goal !== goal.toLowerCase() || !/^[\p{L}][\p{L}\s'’,.;:()?!-]*$/u.test(goal) || (!allowPronouns && /\b(?:my|our|his|her|their)\b/u.test(goal)) || /\b(?:mr|mrs|street|address)\b/u.test(goal)) throw Error(`The ${label} must contain only general words without private details.`);
  return goal;
}
export function canonicalActionId(move) {
  return move?.library?.actionIdentity?.id ?? move?.library?.actionBaseMoveId ?? move?.id;
}
export function knownActionMenu(all) {
  const byId = new Map();
  for (const move of all) {
    const id = canonicalActionId(move);
    if (!id || byId.has(id)) continue;
    byId.set(id, { id, name: move.name, positiveAction: move.positiveAction, practiceScript: move.practiceScript, bodyAction: move.bodyAction, whenNotToUse: move.whenNotToUse });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
const actionFields = ['name', 'childPhrase', 'positiveAction', 'practiceScript', 'whenNotToUse', 'keyWord', 'actionLine', 'bodyAction', 'expectedPeopleCount', 'keyword', 'tinyTries'];
export function instructionEntries(action) {
  return [
    ...['childPhrase', 'positiveAction', 'practiceScript', 'whenNotToUse', 'actionLine', 'bodyAction'].map(field => ({ field, text: action[field] })),
    ...['meaning', 'example'].map(field => ({ field: `keyword.${field}`, text: action.keyword[field] })),
    ...action.tinyTries.map((option, index) => ({ field: `tinyTries[${index}].text`, text: option.text })),
  ];
}
export const actionFingerprint = action => valueHash(instructionEntries(action).map(({ field, text }) => ({ field, text: normalized(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '') })));
export const newActionId = action => `action-${actionFingerprint(action).slice(0, 24)}`;
export function validateDerivedAction(value, sources, knownActions, { allowAdaptation = false } = {}) {
  exact(value.action, actionFields, 'new teaching action');
  const raw = value.action;
  const action = Object.fromEntries(['name', 'childPhrase', 'positiveAction', 'practiceScript', 'whenNotToUse', 'keyWord', 'actionLine', 'bodyAction'].map(field => [field, safeActionText(raw[field], field === 'practiceScript' ? 900 : field === 'whenNotToUse' ? 500 : 250, field)]));
  if (words(action.keyWord).length !== 1 || action.keyWord.length > 24 || words(action.name).length > 10) throw Error('The new action needs a short name and one key word.');
  if (![1, 2].includes(raw.expectedPeopleCount)) throw Error('The action illustration must describe one or two visible people.');
  action.expectedPeopleCount = raw.expectedPeopleCount;
  exact(raw.keyword, ['meaning', 'example'], 'key word explanation');
  action.keyword = Object.fromEntries(['meaning', 'example'].map(field => [field, safeActionText(raw.keyword[field], 250, `key word ${field}`)]));
  if (!Array.isArray(raw.tinyTries) || raw.tinyTries.length !== 3) throw Error('The new action needs three distinct untimed small choices.');
  action.tinyTries = raw.tinyTries.map(option => {
    exact(option, ['kind', 'text', 'seconds', 'offScreen'], 'small choice');
    if (!['notice', 'show', 'choose'].includes(option.kind) || option.seconds !== null || typeof option.offScreen !== 'boolean') throw Error('New source-derived choices must be untimed and have an explicit off-screen label.');
    return { kind: option.kind, text: safeActionText(option.text, 300, 'small choice'), seconds: null, offScreen: option.offScreen };
  });
  if (new Set(action.tinyTries.map(option => normalized(option.text).toLowerCase())).size !== 3 || !action.tinyTries.some(option => option.offScreen)) throw Error('The choices must be distinct, with an off-screen choice.');
  if (value.sameActionAs !== null && (typeof value.sameActionAs !== 'string' || !knownActions.some(action => action.id === value.sameActionAs))) throw Error('The action identity must name a supplied existing action or be explicitly new.');
  if (allowAdaptation && value.adaptation) return { action, sameActionAs: value.sameActionAs, adaptation: validateHomeAdaptation(value.adaptation, sources), instructionEvidence: [] };
  const entries = instructionEntries(action);
  if (!Array.isArray(value.instructionEvidence) || value.instructionEvidence.length !== entries.length) throw Error('Every new instruction needs its own fetched source support.');
  const used = new Set();
  const instructionEvidence = value.instructionEvidence.map(item => {
    exact(item, ['field', 'sourceId', 'quote', 'populationQuote', 'limitation', 'supportType'], 'instruction evidence');
    const entry = entries.find(entry => entry.field === item.field), source = sources.find(source => source.id === item.sourceId);
    if (!entry || used.has(item.field) || !source || item.supportType !== 'described-procedure') throw Error('Instruction evidence must cover each exact field once and describe an actual procedure.');
    validateSourceReceipt(source); used.add(item.field);
    const quote = bounded(item.quote, 350, 'instruction quote'), populationQuote = bounded(item.populationQuote, 350, 'population quote');
    for (const passage of [quote, populationQuote]) if (words(passage).length > 25 || !normalized(sourceBody(source)).includes(normalized(passage))) throw Error('Instruction and population quotations must occur in the fetched source body.');
    return { field: item.field, textHash: valueHash(entry.text), sourceId: source.id, sourceContentHash: source.contentHash, quote, populationQuote, limitation: bounded(item.limitation, 500, 'instruction limitation'), supportType: 'described-procedure' };
  });
  return { action, sameActionAs: value.sameActionAs, instructionEvidence };
}
const adaptationProse = (value, limit, label) => {
  if (Array.isArray(value)) {
    if (!value.length || value.some(item => typeof item !== 'string' || !item.trim())) throw Error(`Invalid ${label}.`);
    value = value.join(' ');
  }
  return bounded(value, limit, label);
};
export function validateHomeAdaptation(adaptation, sources) {
  if (!adaptation || !Array.isArray(adaptation.ingredientEvidence) || !adaptation.ingredientEvidence.length || adaptation.ingredientEvidence.length > 4) throw Error('A home adaptation needs its reason, limits and fetched ingredient evidence.');
  const ingredientEvidence = adaptation.ingredientEvidence.map(item => {
    const source = sources.find(source => source.id === item.sourceId), body = sourceBody(source);
    if (!source || !body || typeof item.quote !== 'string' || !item.quote.trim() || words(item.quote).length > 25 || !normalized(body).includes(normalized(item.quote)) || !item.supports || !item.limitations || !item.locator) throw Error('A home adaptation ingredient must match the actual fetched source.');
    return { sourceId: source.id, sourceContentHash: source.contentHash ?? source.bodyHash, quote: item.quote, locator: adaptationProse(item.locator, 500, 'ingredient location'), supports: adaptationProse(item.supports, 500, 'ingredient scope'), limitations: adaptationProse(item.limitations, 700, 'ingredient limit') };
  });
  return { rationale: adaptationProse(adaptation.rationale, 1000, 'adaptation reason'), limitations: adaptationProse(adaptation.limitations, 1000, 'adaptation limits'), ingredientEvidence };
}
export function validateActionReview(draft, review, knownActions) {
  if (review?.populationScope !== sourceActionPopulation) throw Error('The population review must use the fixed product scope, not an individual child age or a different age range.');
  if (['goalPreserved', 'instructionsSupported', 'populationFits', 'identityCertain', 'noAdditionalInstructions'].some(key => review?.[key] !== true)) throw Error('The independent action, goal, population or identity review did not pass.');
  if (review.sameActionAs !== draft.sameActionAs || (draft.sameActionAs === null && review.distinctFromKnownActions !== true)) throw Error('The independent reviewer did not establish the same action identity.');
  const ids = knownActions.map(action => action.id).sort();
  if (!Array.isArray(review.comparedActionIds) || [...review.comparedActionIds].sort().join() !== ids.join() || new Set(review.comparedActionIds).size !== ids.length) throw Error('The identity review must compare every known action.');
  if (draft.adaptation) {
    if (review.adaptationReviewed !== true || review.adaptationLabelHonest !== true || review.sourcePopulationPreserved !== true || review.actionHash !== valueHash(draft.action) || review.adaptationHash !== valueHash(draft.adaptation) || !['child', 'parent'].includes(review.audience)) throw Error('The exact home adaptation needs an independent review of suitability, claims and source limits.');
    return { id: draft.sameActionAs ?? newActionId(draft.action), fingerprint: actionFingerprint(draft.action), sameAs: draft.sameActionAs };
  }
  if (!Array.isArray(review.instructionChecks) || review.instructionChecks.length !== draft.instructionEvidence.length) throw Error('The independent review did not check every instruction.');
  const checked = new Set();
  for (const item of review.instructionChecks) {
    const evidence = draft.instructionEvidence.find(row => row.field === item.field);
    if (!evidence || checked.has(item.field) || item.textHash !== evidence.textHash || item.sourceId !== evidence.sourceId || item.sourceContentHash !== evidence.sourceContentHash || ['supported', 'populationFits', 'noAddedInstruction', 'noBenefitInference'].some(key => item[key] !== true)) throw Error('An instruction is unsupported, changed, or outside the source population or procedure.');
    checked.add(item.field);
  }
  return { id: draft.sameActionAs ?? newActionId(draft.action), fingerprint: actionFingerprint(draft.action), sameAs: draft.sameActionAs };
}
export function actionFromMove(move) {
  return { ...Object.fromEntries(['name', 'childPhrase', 'positiveAction', 'practiceScript', 'whenNotToUse', 'keyWord', 'actionLine', 'bodyAction', 'expectedPeopleCount'].map(key => [key, move[key]])), keyword: move.detail.keyword, tinyTries: move.tryItDraft.options };
}
export function guideKey(topic, goal, actionHash) {
  return valueHash({ version: 2, topic: normalized(topic).toLowerCase(), goal: normalized(goal).toLowerCase(), actionHash }).slice(0, 24);
}
export function validateV2Document(document) {
  const { move, review } = document, library = move?.library;
  generalGoal(document.goal);
  generalGoal(document.actionTarget, 'general action target');
  if (library?.schemaVersion !== 2 || library.goal !== document.goal || library.actionTarget !== document.actionTarget || review.goalPreserved !== true || !review.binding || review.binding.writer === review.binding.judge || review.writer !== review.binding.writer || review.judge !== review.binding.judge || !['provider-response', 'requested-model'].includes(review.binding.writerModelBasis) || !['provider-response', 'requested-model'].includes(review.binding.judgeModelBasis)) throw Error('The versioned guide lacks bound independent goal and action review.');
  if (!review.binding.draftHash || !review.binding.sourceHashes || !review.binding.topicHash || review.binding.documentFieldsHash !== valueHash({ goal: document.goal, actionTarget: document.actionTarget, move, evidence: document.evidence })) throw Error('The reviewed guide fields no longer match their review binding.');
  const sources = document.sourceReceipts;
  if (!Array.isArray(sources) || !sources.length || review.binding.sourceHashes.length !== sources.length || sources.some(source => !review.binding.sourceHashes.some(row => row.id === source.id && row.hash === source.contentHash))) throw Error('The reviewed sources no longer match the guide.');
  if (library.actionKind === 'reviewed-seed') {
    if (!library.actionBaseMoveId || library.actionIdentity?.id !== library.actionBaseMoveId) throw Error('The existing action identity changed.');
    return;
  }
  if (library.actionKind !== 'source-derived' || library.actionBaseMoveId !== null || library.practiceMode !== 'untimed' || move.approvedBackup !== null) throw Error('A new source-derived action must not pretend to be a seed or timed practice.');
  const action = actionFromMove(move), provenance = library.actionProvenance, identity = library.actionIdentity;
  if (!identity || identity.fingerprint !== actionFingerprint(action) || (identity.sameAs === null ? identity.id !== newActionId(action) : identity.id !== identity.sameAs) || !/^(?:action-[a-f0-9]{24}|[a-z][a-z-]+)$/.test(identity.id)) throw Error('The source-derived action identity is invalid.');
  if (provenance?.kind === 'evidence-informed-home-adaptation') {
    if (provenance.contractVersion !== 4 || provenance.actionHash !== valueHash(action) || provenance.label !== 'BEST GUESS: home practice, not tested') throw Error('The home adaptation identity or label changed.');
    const adaptation = provenance.adaptation;
    if (!adaptation || !adaptation.rationale || !adaptation.limitations || !adaptation.ingredientEvidence?.length || adaptation.ingredientEvidence.some(item => !sources.some(source => source.id === item.sourceId && source.contentHash === item.sourceContentHash))) throw Error('The home adaptation source binding changed.');
    validateActionReview({ action, adaptation, sameActionAs: identity.sameAs }, review.actionReview, review.knownActionIds.map(id => ({ id })));
    return;
  }
  if (provenance?.kind !== 'source-derived-general-action' || provenance.contractVersion !== 2 || provenance.actionHash !== valueHash(action) || !Array.isArray(provenance.instructionEvidence)) throw Error('The new action provenance changed.');
  const entries = instructionEntries(action);
  if (provenance.instructionEvidence.length !== entries.length || new Set(provenance.instructionEvidence.map(item => item.field)).size !== entries.length) throw Error('Instruction provenance is incomplete.');
  for (const entry of entries) {
    const item = provenance.instructionEvidence.find(item => item.field === entry.field);
    if (!item || item.textHash !== valueHash(entry.text) || item.supportType !== 'described-procedure' || !sources.some(source => source.id === item.sourceId && source.contentHash === item.sourceContentHash)) throw Error('An instruction no longer matches its source provenance.');
  }
  validateActionReview({ action, instructionEvidence: provenance.instructionEvidence, sameActionAs: identity.sameAs }, review.actionReview, review.knownActionIds.map(id => ({ id })));
}
