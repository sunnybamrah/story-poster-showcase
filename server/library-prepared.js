import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, readJSON, words } from './files.js';
import { actionFromMove, actionFingerprint, canonicalActionId, libraryAudienceFor, libraryMoveAudienceFits, libraryRouteOptions, generalGoal, instructionEntries, newActionId, safeActionText, valueHash } from './library-action.js';
import { matchingEventContexts, parentResponse } from './route.js';
import { isSchoolGrade } from './library-grade.js';

export const preparedPolicyVersion = 'subscription-prepared-v3';
export const adaptationPolicyVersion = 'subscription-adaptation-v4';
export const approvedAdaptationBundleHashes = Object.freeze(['dff891ac60888af231475223ac700b3ec2a4ecb9e406637925ff5ac76ed86e8c']);
// Added only after the lead checks the exact authored bundle and separate review.
// A manifest's own claim of approval never grants runtime use.
export const approvedPreparedBundleHashes = Object.freeze(['76ec9f54f047103ee4867b8134bb633642d385e5c8bb639fe2c1c3b3e545b3d5']);
const sha = value => createHash('sha256').update(value).digest('hex');
const digest = value => /^[a-f0-9]{64}$/.test(value ?? '');
const normalize = value => value.normalize('NFKC').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
const requiredText = (value, label) => { if (typeof value !== 'string' || !value.trim()) throw Error(`The prepared ${label} is missing.`); return value; };
const safeURL = value => { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.port) throw Error('Prepared sources need their exact reviewed public HTTPS link.'); return value; };
const hashMatches = (value, expected, label) => { if (!digest(expected) || valueHash(value) !== expected) throw Error(`The prepared ${label} changed after review.`); };
export const preparedGuideKey = (topic, goal, fingerprint, version = 3) => valueHash({ version, topic: normalize(topic).toLowerCase(), goal: normalize(goal).toLowerCase(), actionHash: fingerprint }).slice(0, 24);
export const isPreparedMove = move => [3, 4].includes(move?.library?.schemaVersion) && move.library.preparedPolicyVersion === (move.library.schemaVersion === 4 ? adaptationPolicyVersion : preparedPolicyVersion);
const preparedVerifiers = new WeakMap();
export const bindPreparedVerifier = (move, verify) => preparedVerifiers.set(move, verify);
const preparedURLChecks = new Map();
export const preparedSourceURLAllowed = url => [...(preparedURLChecks.get(url) ?? [])].some(check => { try { return check(); } catch { return false; } });

export function validatePreparedSource(source) {
  if (!source || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(source.id ?? '') || !['full-paper', 'abstract-record', 'official-guidance'].includes(source.sourceType)) throw Error('A prepared source needs its pinned identity and actual source type.');
  safeURL(source.url);
  for (const field of ['title', 'publisher', 'actualPopulation', 'scope', 'fetchedAt', 'retrieval', 'license']) requiredText(source[field], `source ${field}`);
  const undatedGuidance = source.sourceType === 'official-guidance' && source.year === null && source.dateNotStated === true && source.dateLabel === 'No publication date shown';
  if (!Array.isArray(source.authors) || !source.authors.length || !source.authors.every(value => typeof value === 'string' && value.trim()) || !Number.isInteger(source.year) && !undatedGuidance) throw Error('The prepared source metadata is incomplete. Undated guidance must state that its date is not shown.');
  if (typeof source.bodyText !== 'string' || source.bodyText.length < 80 || source.bodyText.length > 2_000_000 || source.bodyHash !== sha(source.bodyText)) throw Error('The prepared source body does not match its exact saved text.');
  const status = source.status;
  if (!status || status.state !== 'active' || !Array.isArray(status.notices) || !['none', 'reviewed-no-impact', 'reviewed-incorporated'].includes(status.correctionDisposition)) throw Error('The prepared source has not cleared its current notice review.');
  for (const field of ['checkedAt', 'reviewer', 'reason']) requiredText(status[field], `source status ${field}`);
  if (!Array.isArray(status.evidenceUrls) || !status.evidenceUrls.length) throw Error('The prepared source status needs dated check evidence.');
  status.evidenceUrls.forEach(safeURL);
  if (status.notices.some(notice => /retract|expression of concern/i.test(typeof notice === 'string' ? notice : JSON.stringify(notice))) || status.notices.length && status.correctionDisposition === 'none' || !status.notices.length && status.correctionDisposition !== 'none') throw Error('A prepared source notice needs its exact reviewed disposition.');
  if (status.notices.length && (!digest(status.dispositionEvidenceHash) || !requiredText(status.dispositionReviewId, 'correction review'))) throw Error('A source correction needs its bound review evidence.');
  return source;
}

export function preparedApplicability(move, record) {
  if (!libraryMoveAudienceFits(move, record?.kitContext)) return { eligible: false, label: 'For a different learner', reason: 'This guide has not been reviewed for the selected adult or child.' };
  const scope = move?.library?.applicability;
  if (!scope || !requiredText(scope.label, 'applicability label')) return { eligible: false, reason: 'This guide needs a checked age range.', label: 'Age range needs review' };
  if (scope.kind === 'grade-only') {
    // This exact source states fourth grade through college. The optional
    // family field records U.S. K to 12 only; it never converts age or grades.
    const checkedSchoolScope = move.id === 'lib-a62c761d55f32a57db3af28f' && scope.sourceId === 'ies-study-2007'
      && scope.populationSourceContentHash === '82c39f590a00ea0facc621fbb9276481526668ab8ae826d529e98e48a8d516fa'
      && scope.populationQuote === 'The students in these studies have typically ranged from fourth grade to college';
    if (!checkedSchoolScope) return { eligible: false, label: scope.label, reason: 'This guide needs a checked school-grade range.' };
    const grade = record?.hero?.schoolGrade;
    if (!grade) return { eligible: false, label: 'School grade needed', needsSchoolGrade: true, reason: 'This source reports school grades rather than ages. Choose another guide or let us find a fitting one.' };
    const eligible = isSchoolGrade(grade) && grade.level >= 4 && Number.isInteger(record?.hero?.age) && record.hero.age >= 8 && record.hero.age <= 13;
    return { eligible, label: 'Studies from fourth grade to college', reason: eligible ? 'The saved U.S. school grade fits the source. This home practice was not tested; the moment still needs to fit.' : 'This guide needs a saved U.S. grade from four through twelve and a child in the app age range.' };
  }
  if (scope.kind === 'home-adaptation') {
    const parent = libraryAudienceFor(record?.kitContext) === 'parent';
    const audience = move.library.audience ?? 'child';
    const age = record?.hero?.age;
    const eligible = audience === (parent ? 'parent' : 'child') && (parent || Number.isInteger(age) && age >= 8 && age <= 13);
    return { eligible, label: scope.label, reason: eligible ? 'Home practice suitability was reviewed. The source population and untested use remain labelled.' : 'This guide is for a different person or outside the app age range.' };
  }
  const age = record?.hero?.age;
  const eligible = scope.kind === 'age-range' && Number.isInteger(age) && age >= scope.minAge && age <= scope.maxAge;
  return { eligible, label: scope.label, reason: eligible ? 'The child is within the checked age range. The moment still needs to fit.' : 'The child is outside this guide’s checked age range.' };
}
const patternMatch = (note, pattern) => matchingEventContexts(note, pattern).length > 0;
export function preparedMoveFits(move, record, note, { sourceVerified = false, parentSelected = false } = {}) {
  if (!isPreparedMove(move) || typeof note !== 'string' || parentResponse(note, libraryRouteOptions(record?.kitContext)) || !preparedApplicability(move, record).eligible) return false;
  if (!sourceVerified) {
    const verify = preparedVerifiers.get(move);
    if (!verify) return false;
    try { verify(); } catch { return false; }
  }
  if (parentSelected) return true;
  const rule = move.library.matchRule;
  const events = rule.any.flatMap(pattern => matchingEventContexts(note, pattern));
  return events.some(event => rule.all.every(pattern => patternMatch(event, pattern))) && !rule.exclude.some(pattern => patternMatch(note, pattern));
}

export function validatePreparedDocument(document, sources) {
  const library = document?.move?.library, action = actionFromMove(document?.move ?? {}), identity = library?.actionIdentity;
  const { sha256, ...documentBody } = document ?? {};
  if (!digest(sha256) || valueHash(documentBody) !== sha256) throw Error('The prepared document hash changed.');
  const adaptation = document.version === 4;
  if (![3, 4].includes(document.version) || document.status !== 'reusable' || library?.schemaVersion !== document.version || library.preparedPolicyVersion !== (adaptation ? adaptationPolicyVersion : preparedPolicyVersion) || library.status !== 'reusable' || document.id !== document.move.id || library.documentId !== document.id) throw Error('The prepared document is not a version three reusable guide.');
  generalGoal(document.topic, 'prepared topic', { allowPronouns: adaptation }); generalGoal(document.goal, 'general learning goal', { allowPronouns: adaptation }); generalGoal(document.actionTarget, 'prepared action target', { allowPronouns: adaptation });
  if (library.goal !== document.goal || library.actionTarget !== document.actionTarget || library.title !== document.title) throw Error('The prepared topic, goal or title changed.');
  if (document.id !== `lib-${preparedGuideKey(document.topic, document.goal, identity?.fingerprint, document.version)}` || identity?.fingerprint !== actionFingerprint(action) || (identity.sameAs === null ? identity.id !== newActionId(action) : identity.id !== identity.sameAs)) throw Error('The prepared action identity changed.');
  if (library.actionKind !== 'source-derived' || library.actionBaseMoveId !== null || library.practiceMode !== 'untimed' || document.move.approvedBackup !== null) throw Error('A prepared action must be untimed with permission to leave it for later.');
  for (const entry of instructionEntries(action)) safeActionText(entry.text, entry.field === 'practiceScript' ? 900 : 500, entry.field);
  for (const field of ['name', 'keyWord']) safeActionText(action[field], 250, field);
  if (words(action.keyWord).length !== 1 || ![1, 2].includes(action.expectedPeopleCount) || !Array.isArray(action.tinyTries) || action.tinyTries.length !== 3 || action.tinyTries.some(option => option.seconds !== null || !['notice', 'show', 'choose'].includes(option.kind) || typeof option.offScreen !== 'boolean') || !action.tinyTries.some(option => option.offScreen) || new Set(action.tinyTries.map(option => normalize(option.text))).size !== 3) throw Error('The prepared action choices or visual count are invalid.');
  for (const field of ['title', 'explanation', 'whyThisActionFits']) safeActionText(field === 'title' ? document.title : library[field], 1600, field);
  const applicability = library.applicability;
  if (!applicability || !(adaptation ? ['home-adaptation'] : ['age-range', 'grade-only']).includes(applicability.kind) || !applicability.label || !applicability.sourceId || !sources.some(source => source.id === applicability.sourceId)) throw Error('The prepared guide needs its actual supported population.');
  if (applicability.kind === 'age-range' && (!Number.isInteger(applicability.minAge) || !Number.isInteger(applicability.maxAge) || applicability.minAge < 8 || applicability.maxAge > 13 || applicability.minAge > applicability.maxAge)) throw Error('Prepared guides cannot widen the supported child ages.');
  if (adaptation && (!['child', 'parent'].includes(library.audience) || applicability.productScope !== 'Home practice, not a tested intervention' || !applicability.actualSourcePopulation || !applicability.suitabilityReason)) throw Error('A home adaptation needs its honest audience and source population.');
  const rule = library.matchRule;
  if (!rule || !rule.id || !Number.isInteger(rule.version) || rule.version < 1 || !['any', 'all', 'exclude'].every(key => Array.isArray(rule[key]) && rule[key].length <= 20 && rule[key].every(pattern => typeof pattern === 'string' && pattern.length > 0 && pattern.length <= 1200)) || !rule.any.length) throw Error('The prepared guide needs a bounded reviewed fit rule.');
  for (const pattern of [...rule.any, ...rule.all, ...rule.exclude]) new RegExp(pattern, 'iu');
  const sourceMap = new Map(sources.map(source => [validatePreparedSource(source).id, source]));
  if (!Array.isArray(document.sourceReceipts) || JSON.stringify(document.sourceReceipts) !== JSON.stringify(sources.map(({ bodyText, ...source }) => source))) throw Error('The prepared source summaries changed.');
  if (!Array.isArray(document.move.sources) || document.move.sources.length !== sources.length || document.move.sources.some(source => { const original = sourceMap.get(source.sourceId); return !original || source.title !== original.title || source.url !== original.url || source.sourceType !== original.sourceType || source.contentScope !== original.scope || source.sourceType === 'official-guidance' && source.fitLabel !== 'GUIDANCE'; })) throw Error('The prepared displayed sources no longer match the checked records.');
  const provenance = library.actionProvenance, entries = instructionEntries(action);
  if (!adaptation && (provenance?.kind !== 'prepared-source-derived-general-action' || provenance.contractVersion !== 3 || provenance.actionHash !== valueHash(action) || provenance.instructionEvidence?.length !== entries.length)) throw Error('The prepared action needs evidence for every instruction.');
  const seen = new Set();
  const quoteIn = (source, quote) => typeof quote === 'string' && quote.trim() && words(quote).length <= 25 && normalize(source.bodyText).includes(normalize(quote));
  for (const item of adaptation ? [] : provenance.instructionEvidence) {
    const entry = entries.find(entry => entry.field === item.field);
    if (Object.keys(item).sort().join() !== ['field', 'textHash', 'limitation', 'supportType', 'evidence'].sort().join() || !entry || seen.has(item.field) || item.textHash !== valueHash(entry.text) || item.supportType !== 'described-procedure' || !item.limitation || !Array.isArray(item.evidence) || item.evidence.length < 2 || item.evidence.length > 12 || !['procedure', 'population'].every(role => item.evidence.some(row => row.role === role))) throw Error('A prepared instruction lacks exact procedure and population support.');
    for (const row of item.evidence) {
      const source = sourceMap.get(row.sourceId);
      if (Object.keys(row).sort().join() !== ['role', 'sourceId', 'sourceContentHash', 'quote', 'locator'].sort().join() || !['procedure', 'population'].includes(row.role) || !source || row.sourceContentHash !== source.bodyHash || !quoteIn(source, row.quote) || !row.locator) throw Error('A prepared instruction quote does not match its own source body and section.');
    }
    seen.add(item.field);
  }
  if (adaptation) {
    if (provenance?.kind !== 'evidence-informed-home-adaptation' || provenance.contractVersion !== 4 || provenance.actionHash !== valueHash(action) || provenance.label !== 'BEST GUESS: home practice, not tested' || !provenance.rationale || !provenance.limitations || !Array.isArray(provenance.ingredientEvidence) || !provenance.ingredientEvidence.length) throw Error('The home adaptation must state what was invented and what its evidence cannot show.');
    for (const item of provenance.ingredientEvidence) { const source = sourceMap.get(item.sourceId); if (!source || item.sourceContentHash !== source.bodyHash || !quoteIn(source, item.quote) || !item.locator || !item.supports || !item.limitations) throw Error('The home adaptation ingredient does not match its fetched source.'); }
  }
  if (!Array.isArray(document.evidence) || !document.evidence.length || document.evidence.length > 2) throw Error('A prepared finding needs its own evidence.');
  for (const item of document.evidence) { const source = sourceMap.get(item.sourceId); if (!source || !quoteIn(source, item.quote) || !item.locator || !item.claim || !item.limitation || !(source.sourceType === 'official-guidance' ? item.fitLabel === 'GUIDANCE' : ['DIRECT', 'ADJACENT', 'MECHANISM', 'ADULT ONLY', 'DESCRIPTIVE'].includes(item.fitLabel))) throw Error('The prepared finding lacks exact source support and its actual guidance or research label.'); }
  const science = document.move.science;
  if (!document.evidence.some(item => item.claim === science?.claim && item.fitLabel === science.evidenceLabel && sourceMap.get(item.sourceId)?.url === science.studyUrl) || !science?.limitation?.includes('not tested') || [document.move.kidScienceLine, document.move.whereItCameFrom, document.move.source?.text, document.move.detail?.science?.claim].some(claim => claim !== science.claim)) throw Error('The prepared science needs its exact supported claim and home-use limit.');
  const prep = document.preparation, review = document.review, check = review?.actionReview;
  if (prep?.kind !== 'subscription-session-prepared' || prep.writer?.modelBasis !== 'subscription-session-recorded' || prep.judge?.modelBasis !== 'subscription-session-recorded' || !prep.writer.model || !prep.judge.model || prep.writer.model === prep.judge.model || review.writer !== prep.writer.model || review.judge !== prep.judge.model || review.ownerApproved !== false) throw Error('Prepared authorship needs truthful records from different subscription models.');
  for (const role of ['writer', 'judge']) if (!prep[role].sessionId || !prep[role].recordedAt || !digest(prep[role].artifactHash)) throw Error('The prepared session evidence is incomplete.');
  if (review.status !== 'machine-reviewed' || review.sourceVerified !== true || review.privacyChecked !== true || !review.scope || !digest(prep.draftHash) || prep.reviewHash !== valueHash(check)) throw Error('The prepared independent review is incomplete or changed.');
  const binding = prep.binding;
  hashMatches({ goal: document.goal, actionTarget: document.actionTarget, move: document.move, evidence: document.evidence }, binding?.documentFieldsHash, 'reviewed fields');
  hashMatches(rule, binding.ruleHash, 'fit rule'); hashMatches(applicability, binding.eligibilityHash, 'population rule');
  const sourceBindings = sources.map(source => ({ id: source.id, bodyHash: source.bodyHash, statusHash: valueHash(source.status) }));
  hashMatches(sourceBindings, binding.sourceSetHash, 'source set');
  if (!Array.isArray(prep.knownActionIds) || new Set(prep.knownActionIds).size !== prep.knownActionIds.length || !Array.isArray(review.knownActionIds) || [...review.knownActionIds].sort().join() !== [...prep.knownActionIds].sort().join() || !Array.isArray(check?.comparedActionIds) || [...prep.knownActionIds].sort().join() !== [...check.comparedActionIds].sort().join() || check.sameActionAs !== identity.sameAs || (identity.sameAs === null && check.distinctFromKnownActions !== true) || ['passed', 'sourceFit', 'actionFits', 'noNewClinicalAdvice', 'noPrivateDetails', 'rhymeCorrect', 'goalPreserved', 'instructionsSupported', 'populationFits', 'identityCertain', 'noAdditionalInstructions', 'noUnsupportedPromise', 'applicabilityConfirmed', 'matchRuleConfirmed'].some(field => check[field] !== true)) throw Error('The independent prepared action, population or matching review did not pass.');
  if (check.claims?.length !== document.evidence.length || document.evidence.some(item => !check.claims.some(row => row.sourceId === item.sourceId && row.claim === item.claim && row.entailed === true && row.fitLabelCorrect === true))) throw Error('The prepared reviewer did not clear every exact finding.');
  if (!adaptation && (check.instructionChecks?.length !== entries.length || provenance.instructionEvidence.some(item => !check.instructionChecks.some(row => row.field === item.field && row.textHash === item.textHash && row.evidenceHash === valueHash(item.evidence) && ['supported', 'populationFits', 'noAddedInstruction', 'noBenefitInference'].every(key => row[key] === true))))) throw Error('The prepared reviewer did not clear every exact instruction and its whole evidence set.');
  if (adaptation && (check.adaptationReviewed !== true || check.adaptationLabelHonest !== true || check.sourcePopulationPreserved !== true || check.actionHash !== valueHash(action) || check.adaptationHash !== valueHash(provenance) || check.audience !== library.audience)) throw Error('The different model did not review this exact home adaptation and audience.');
  return document;
}

export function createPreparedLibrary({ directory = join(root, 'content/prepared-library'), approvedHashes = approvedPreparedBundleHashes, adaptationDirectory = directory === join(root, 'content/prepared-library') ? join(root, 'content/adaptation-library') : null, adaptationHashes = approvedAdaptationBundleHashes } = {}) {
  const file = join(directory, 'bundle.json');
  const load = () => {
    if (!existsSync(file)) return { sources: [], documents: [], bundleHash: null };
    const bytes = readFileSync(file); let bundleHash = sha(bytes);
    if (!approvedHashes.includes(bundleHash)) throw Error('The prepared library bundle has no frozen independent review approval.');
    const bundle = JSON.parse(bytes);
    if (bundle.policyVersion !== preparedPolicyVersion || !Array.isArray(bundle.sources) || !Array.isArray(bundle.documents)) throw Error('The prepared source bank is invalid.');
    const extensionFile = adaptationDirectory && join(adaptationDirectory, 'bundle.json');
    if (extensionFile && existsSync(extensionFile)) {
      const extensionBytes = readFileSync(extensionFile), extensionHash = sha(extensionBytes);
      if (!adaptationHashes.includes(extensionHash)) throw Error('The home-adaptation bundle has no frozen independent review approval.');
      const extension = JSON.parse(extensionBytes);
      if (extension.policyVersion !== adaptationPolicyVersion || !Array.isArray(extension.sources) || !Array.isArray(extension.documents) || extension.documents.some(document => document.version !== 4)) throw Error('The home-adaptation source bank is invalid.');
      bundle.sources.push(...extension.sources); bundle.documents.push(...extension.documents);
      bundleHash = valueHash([bundleHash, extensionHash]);
    }
    if (new Set(bundle.sources.map(source => source.id)).size !== bundle.sources.length || new Set(bundle.documents.map(document => document.id)).size !== bundle.documents.length) throw Error('The prepared bank repeats an immutable identity.');
    bundle.sources.forEach(validatePreparedSource);
    for (const document of bundle.documents) {
      const ids = document.sourceReceipts?.map(source => source.id);
      if (!ids?.length || new Set(ids).size !== ids.length || ids.some(id => !bundle.sources.some(source => source.id === id))) throw Error('A prepared guide refers to missing sources.');
      validatePreparedDocument(document, ids.map(id => bundle.sources.find(source => source.id === id)));
    }
    return { ...bundle, bundleHash };
  };
  const initial = load();
  const sourceStatuses = document => {
    const current = load(), statusFile = join(document.version === 4 && adaptationDirectory ? adaptationDirectory : directory, 'source-status.json');
    const statuses = existsSync(statusFile) ? readJSON(statusFile) : null;
    return document.sourceReceipts.map(receipt => ({ id: receipt.id, status: structuredClone(statuses ? statuses[receipt.id] ?? { state: 'needs-review', notices: [], correctionDisposition: 'unresolved' } : current.sources.find(source => source.id === receipt.id)?.status) }));
  };
  const currentSources = document => {
    const current = load(), statuses = sourceStatuses(document);
    const ids = document.sourceReceipts.map(source => source.id);
    return ids.map(id => current.sources.find(source => source.id === id)).map(source => {
      const status = statuses.find(item => item.id === source.id)?.status;
      return validatePreparedSource({ ...source, status });
    });
  };
  for (const source of initial.sources) {
    const checks = preparedURLChecks.get(source.url) ?? new Set();
    checks.add(() => { const document = initial.documents.find(item => item.sourceReceipts.some(receipt => receipt.id === source.id)); return document && currentSources(document).some(current => current.id === source.id && current.url === source.url); });
    preparedURLChecks.set(source.url, checks);
  }
  return {
    documents: () => structuredClone(initial.documents),
    sourceStatuses,
    validate(document) {
      const current = load(), pinned = current.documents.find(item => item.id === document.id);
      if (!pinned || JSON.stringify(pinned) !== JSON.stringify(document)) throw Error('The prepared guide changed or is no longer in the reviewed bank.');
      return document;
    },
    assertCurrent(document) { this.validate(document); return currentSources(document); },
    binding(move, record, note) {
      const current = load(), document = current.documents.find(item => item.id === move.id);
      if (!document || JSON.stringify(document.move) !== JSON.stringify(move) || !preparedMoveFits(move, record, note, { sourceVerified: true, parentSelected: true })) throw Error('This prepared guide is not available for this child or checked source bank.');
      const sources = currentSources(document);
      return { documentId: document.id, documentHash: document.sha256, actionIdentity: canonicalActionId(move), bundleHash: current.bundleHash, ruleHash: valueHash(move.library.matchRule), eligibilityHash: valueHash(move.library.applicability), sourceSetHash: document.preparation.binding.sourceSetHash, sourceStatusHash: valueHash(sources.map(source => ({ id: source.id, status: source.status }))) };
    },
    assertBinding(binding, move, record, note) {
      const current = this.binding(move, record, note);
      if (!isDeepStrictEqual(current, binding)) throw Error('The prepared guide or source status changed after this kit started.');
      return current;
    },
    sourceURLAllowed(url) { return load().sources.some(source => source.url === url); },
  };
}
