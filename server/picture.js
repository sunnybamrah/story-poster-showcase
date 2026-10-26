import { pictureStyleFor } from './graphic-style.js';
import { legacyPictureStyleId, pictureStyleIdFor } from '../app/picture-styles.js';
import { assessGenerationCheck as assessCheck, reviewNote } from './stop-policy.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { buildPictureRequest, buildPosterRequest, buildPanelRequest, buildWordCheckRequest, privacyFor } from './requests.js';
import { checkPicture } from './check-picture.js';
import { checkWords, parseWordCheck, checkComicWords } from './check-words.js';
import { posterBoxes, approvedPosterWords, posterFooter, boxText } from './format.js';
import { readJSON, saveJSON } from './files.js';
import { readLog } from './transport.js';
import { chooseWorld } from './worlds.js';
import * as geometryRules from './poster-template.js';
import { legacyPosterTemplate, drawingCanvas, unverifiedGeometry, comparisonHTML, templateGuidePNG, currentPosterTemplateVersion, posterTemplateFor } from './poster-template.js';
import { panelWithSpeaker, pictureCast } from './panel-contract.js';
import { lockedCast, publicCast, castEvaluationVersion, learningActor } from './cast.js';
import { checkCast, parseCastCheck } from './check-cast.js';
import sharp from 'sharp';

const savedAppearanceNeedsReview = () => false;

const nextImage = (directory, kind) => {
  let number = 1;
  while (existsSync(join(directory, `${kind}-attempt-${number}.png`))) number++;
  return join(directory, `${kind}-attempt-${number}.png`);
};

export const imageData = path => `data:image/png;base64,${readFileSync(path).toString('base64')}`;
export const imageHash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex');
const exact = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const exactWords = text => typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim() : text;
const knownPreflight = message => /^(?:Daily budget\b|Missing (?:openai|OpenAI) key\.|OpenAI request contains\b|Real family details need your permission\.|Photo use needs your permission\.|The current family permission record is unavailable\.|The two-kit call limit was reached\.|Kit paused\.|real families wait for zero retention approval)/.test(message ?? '');
const provenPreflight = (error, beforeWire, afterWire) => {
  if (error.receipt || error.response || error.preflight === false) return false;
  if (error.preflight === true) return true;
  return knownPreflight(error.message) && Number.isFinite(beforeWire) && afterWire === beforeWire;
};
const savedCheckRetries = new WeakMap();
const useSavedCheckRetry = (transport, artifact) => {
  if (transport.allowSavedCheckRetry !== true) return false;
  let used = savedCheckRetries.get(transport);
  if (!used) { used = new Set(); savedCheckRetries.set(transport, used); }
  if (used.has(artifact)) return false;
  used.add(artifact); return true;
};
const unverifiedWords = (check, message) => Object.assign(new Error(message), { code: 'content_check_unverified', canResume: true, checkerNotSent: check?.checkerNotSent === true });
const candidatePath = (directory, candidate) => candidate.acceptedStageEvidence && candidate.externalPath ? candidate.externalPath : join(directory, candidate.file);

export const pictureStyleFingerprint = record => { const style = pictureStyleFor(record); return { pictureStyleId: style.id, pictureStyleVersion: style.version, pictureStyleReferenceHash: style.referenceHash ?? null }; };
function sameDrawingContext(saved, current) {
  if (saved.pictureStyleId) return exact(saved, current);
  if (current.pictureStyleId !== legacyPictureStyleId) return false;
  const { pictureStyleId, pictureStyleVersion, pictureStyleReferenceHash, ...legacy } = current;
  return exact(saved, legacy);
}
function drawingContext(record, move, kitText, panel, selection, templateVersion) {
  for (const person of lockedCast(record)) if (person.referencePath && person.referenceHash && imageHash(person.referencePath) !== person.referenceHash) throw Error(`Locked ${person.id} reference bytes changed. No new picture was bought.`);
  const references = castReferences(record).map(({ characterId, hash }) => ({ characterId, hash }));
  return { ...pictureStyleFingerprint(record), expectedBoxes: panel ? [{ id: 'bubble', text: panel.line }] : posterBoxes(move, kitText),
    referenceHash: imageHash(record.hero.heroPicturePath), references, cast: publicCast(record), visibleCast: pictureCast(record, move, panel), panel: panel ?? null,
    action: panel ? panel.scene : move.bodyAction, jokeIdea: kitText.jokeIdea, selection, templateVersion };
}

// Older rejected art has no stage checkpoint. Bind it to the actual saved image
// response, its saved word-check target, and unchanged checked cast references.
// Missing or ambiguous evidence is never a reason to buy a replacement.
function importLegacyCandidates(directory, kind, state, context, record, move, kitText) {
  const checkpointPath = join(directory, 'checkpoint.json'), ledgerPath = join(directory, 'kit-log.json');
  const names = readdirSync(directory).filter(name => new RegExp(`^${kind}-attempt-\\d+\\.png$`).test(name));
  const ledger = existsSync(ledgerPath) ? readJSON(ledgerPath) : [];
  const requests = readLog(join(directory, 'requests.jsonl'));
  const sent = new Set(requests.filter(row => row.event === 'request' && row.stage === kind).map(row => row.logicalRequestId ?? row.id)).size;
  const exempt = new Map((state.preflightStops ?? []).filter(stop => stop.ledgerEntry).map(stop => [stop.ledgerEntry.index, stop.ledgerEntry.sha256]));
  state.drawRequests = Math.max(state.drawRequests, names.length, sent, ledger.filter((row, index) => row.stage === kind && (row.requestId || exempt.get(index) !== digest(row) && !knownPreflight(row.verdict))).length);
  if (!existsSync(checkpointPath) || !existsSync(join(directory, 'requests.jsonl')) || !ledger.length) return;
  const source = readJSON(checkpointPath), original = source.recordAtStart;
  if (original && pictureStyleIdFor(original) !== pictureStyleIdFor(record)) return;
  if (!original?.cast?.length || source.stages?.text?.moveId !== kitText.moveId || source.stages.text.jokeIdea !== kitText.jokeIdea) return;
  if (!exact(publicCast(original), context.cast) || !original.hero.heroPicturePath || imageHash(original.hero.heroPicturePath) !== context.referenceHash) return;
  if (!exact(original.cast.filter(person => person.referencePath).map(person => ({ characterId: person.id, hash: person.referenceHash })), context.references)) return;
  if (!original.cast.every(person => person.referencePath && person.referenceHash === imageHash(person.referencePath))) return;
  if (!exact({ world: source.stages.text.world, colourSet: source.stages.text.colourSet }, context.selection)) return;
  const sourceBoxes = kind === 'poster' ? posterBoxes(move, source.stages.text) : [{ id: 'bubble', text: source.stages.text.panelLines?.[Number(kind.slice(6)) - 1]?.line }];
  if (!exact(sourceBoxes, context.expectedBoxes)) return;
  for (let index = 0; index < ledger.length; index++) {
    const draw = ledger[index]; if (draw.stage !== kind || !draw.requestId) continue;
    const response = requests.find(row => row.event === 'response' && row.stage === kind && row.id === draw.requestId);
    const input = requests.find(row => row.event === 'request' && row.stage === kind && row.id === draw.requestId);
    if (!input || !response) continue;
    const prompt = input.body?.prompt;
    if (typeof prompt !== 'string' || !context.references.every((reference, at) => prompt.includes(`Reference image ${at + 1} is ${reference.characterId}.`))) continue;
    if (kind === 'poster' && !context.expectedBoxes.filter(box => box.id !== 'footer').every(box => {
      const line = prompt.split('\n').find(line => line.startsWith(`Box ${box.id}: `));
      if (!line) return false;
      try { return exactWords((line.match(/"(?:\\.|[^"\\])*"/g) ?? []).map(part => JSON.parse(part)).join(' ')) === exactWords(boxText(box)); } catch { return false; }
    })) continue;
    if (kind !== 'poster' && !prompt.includes(JSON.stringify(context.panel.line))) continue;
    let hash; try { hash = bytesHash(pngFrom(response.body)); } catch { continue; }
    const matches = names.filter(name => imageHash(join(directory, name)) === hash);
    if (matches.length !== 1 || state.candidates.some(candidate => candidate.file === matches[0])) continue;
    const end = ledger.findIndex((row, at) => at > index && row.stage === kind);
    const rows = ledger.slice(index + 1, end < 0 ? ledger.length : end).filter(row => row.stage === `${kind}-word-check`);
    const checks = [];
    for (const row of rows) {
      const path = join(directory, `picture-check-${kind}-${row.attempt}.json`);
      const request = requests.find(item => item.event === 'request' && item.stage === `${kind}-word-check` && item.id === row.requestId);
      if (!existsSync(path) || !request) continue;
      let payload; try { payload = JSON.parse(request.body.input[0].content[0].text); } catch { continue; }
      if (!exact(payload.cast, context.cast) || !exact(payload.expectedVisibleCast, context.visibleCast)
        || !exact(payload.identityReferences?.map(item => item.characterId), context.references.map(item => item.characterId))
        || payload.actionLine !== context.action || kind === 'poster' && payload.expectedJoke !== context.jokeIdea) continue;
      const saved = readJSON(path), check = saved.check;
      if (!check || !exact(check.wordVerdicts?.map(item => ({ id: item.id, text: exactWords(item.approvedText) })), context.expectedBoxes.map(box => ({ id: box.id, text: exactWords(boxText(box)) })))) continue;
      checks.push(check);
    }
    if (!checks.length) continue;
    const templateVersion = checks.at(-1).geometry?.templateVersion ?? context.templateVersion;
    state.candidates.push({ file: matches[0], hash, context: { ...context, templateVersion }, generationRuleVersion: kind === 'poster' && checks.every(check => !check.answers?.geometry?.writableRows) ? 'legacy-handwriting-summary-v0' : 'legacy-unrecorded', checks, rechecks: {}, legacyEvidence: { responseId: draw.requestId, checks: rows.map(row => `picture-check-${kind}-${row.attempt}.json`), references: 'Unchanged original checkpoint reference hashes, generation word targets/reference order, and matching saved checker cast/order.' } });
  }
}

function pageAttemptState(directory, kind, context, record, move, kitText, savedCandidate) {
  const path = join(directory, `${kind}-drawing-state.json`);
  const state = existsSync(path) ? readJSON(path) : { version: 1, kind, drawRequests: 0, candidates: [] };
  if (state.version !== 1 || state.kind !== kind || !Number.isSafeInteger(state.drawRequests) || state.drawRequests < 0 || !Array.isArray(state.candidates)) throw Error('Saved drawing allowances are invalid. No new picture was bought.');
  importLegacyCandidates(directory, kind, state, context, record, move, kitText);
  if (state.candidates.some(candidate => (candidate.context?.pictureStyleId ?? legacyPictureStyleId) !== pictureStyleIdFor(record))) throw Error('This saved drawing attempt belongs to a different family look. Its allowance is unchanged.');
  const savedWords = savedCandidate?.expectedBoxes?.map(box => ({ id: box.id, text: boxText(box) }))
    ?? savedCandidate?.checks?.at(-1)?.wordVerdicts?.map(row => ({ id: row.id, text: row.approvedText })) ?? savedCandidate?.checks?.at(-1)?.answers?.boxes;
  if (savedCandidate && (savedCandidate.pictureStyleId ?? legacyPictureStyleId) === pictureStyleIdFor(record) && savedCandidate.ready && savedCandidate.hash === imageHash(savedCandidate.path)
    && exact(savedWords?.map(box => ({ id: box.id, text: exactWords(box.text) })), context.expectedBoxes.map(box => ({ id: box.id, text: exactWords(boxText(box)) }))) && savedCandidate.referenceHash === context.referenceHash
    && exact(savedCandidate.castReferenceHashes, context.references)) {
    if (!state.candidates.some(candidate => candidatePath(directory, candidate) === savedCandidate.path)) {
      state.drawRequests = Math.max(state.drawRequests, 1);
      state.candidates.push({ file: basename(savedCandidate.path), externalPath: savedCandidate.path, hash: savedCandidate.hash, context: { ...context, templateVersion: savedCandidate.templateVersion ?? savedCandidate.checks?.at(-1)?.answers?.geometry?.templateVersion ?? context.templateVersion }, generationRuleVersion: savedCandidate.generationRuleVersion ?? 'legacy-unrecorded', checks: structuredClone(savedCandidate.checks), rechecks: {}, acceptedStageEvidence: true });
    }
  }
  return { state, save: () => saveJSON(path, state) };
}
export function inspectSavedDrawingRecovery(record, move, kitText, { directory, selection = chooseWorld(record), panelIndex } = {}) {
  const panel = panelIndex === undefined ? undefined : panelWithSpeaker(record, kitText.panelLines[panelIndex], kitText.story), kind = panel ? `panel-${panelIndex + 1}` : 'poster';
  const context = drawingContext(record, move, kitText, panel, selection, currentPosterTemplateVersion);
  const { state } = pageAttemptState(directory, kind, context, record, move, kitText);
  return { kind, drawRequestsSpent: state.drawRequests, remainingDraws: Math.max(0, 3 - state.drawRequests), geometryRuleVersion: geometryRules.geometryRuleVersion ?? 'legacy-geometry-v0',
    candidates: state.candidates.map(candidate => ({ file: candidate.file, hash: candidate.hash, generationRuleVersion: candidate.generationRuleVersion, eligibleForSameImageCheck: sameDrawingContext(candidate.context, { ...context, templateVersion: candidate.context.templateVersion }) && existsSync(candidatePath(directory, candidate)) && imageHash(candidatePath(directory, candidate)) === candidate.hash, evidence: candidate.legacyEvidence ?? 'Durable generation candidate receipt.' })) };
}
export function pngDimensions(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.subarray(12, 16).toString() !== 'IHDR') throw new Error('PNG dimensions are missing.');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height) throw new Error('PNG dimensions are empty.');
  return { width, height };
}
export function pngFrom(response) {
  if (!Array.isArray(response.data) || response.data.length !== 1 || !response.data[0].b64_json) throw new Error('The picture service did not return one image.');
  const bytes = Buffer.from(response.data[0].b64_json, 'base64');
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('The picture is not a PNG.');
  return bytes;
}

export async function readyPicture(transport, record, move, tonight, { kit, directory, hero = false, character, selection } = {}) {
  mkdirSync(directory, { recursive: true });
  const referencePath = hero ? null : record.hero.heroPicturePath;
  if (!hero && !referencePath) throw new Error('A checked hero reference is required.');
  const referenceData = referencePath ? imageData(referencePath) : undefined;
  const referenceHash = referencePath ? imageHash(referencePath) : null;
  const checks = [];
  let faults = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = buildPictureRequest(record, move, tonight, { hero, character, referenceData, selection, faults });
    const response = await transport.call({ provider: 'openai', path: body.image ? '/v1/images/edits' : '/v1/images/generations',
      body, privacy: privacyFor(record, tonight, move), kit, stage: character ? `${character.id}-reference` : hero ? 'hero' : 'picture', retry: attempt });
    let bytes;
    try { bytes = pngFrom(response); }
    catch (error) { transport.recordRejection(response, error.message); if (attempt >= 1) throw new Error('Malformed picture after one retry: ' + error.message); continue; }
    const file = nextImage(directory, hero ? 'hero' : 'picture');
    writeFileSync(file, bytes, { mode: 0o600 });
    const check = { ready: true, verified: false, faults: [], reviewFlags: [reviewNote('parent_picture_choice', 'Generated from the supplied reference. The parent reviews the drawing.')] };
    transport.recordVerdict?.(response, 'DRAWN: parent review, no automatic appearance judge.');
    checks.push(check);
    return { path: file, hash: imageHash(file), referenceHash, checks, ready: true,
      lookChips: record.hero.lookChips, lockedOutfit: record.hero.lockedOutfit, expectedPeopleCount: move.expectedPeopleCount };
    // Keep the original reference. The rejected picture is evidence, never an edit input.
  }
}

export const castReferences = record => lockedCast(record).filter(person => person.referencePath).map(person => ({ characterId: person.id, data: imageData(person.referencePath), hash: imageHash(person.referencePath) }));
export async function readyCastReferences(transport, record, move, tonight, { kit, directory, selection, saved = {}, saveStage, heroReference } = {}) {
  const cast = lockedCast(record);
  for (const person of cast) {
    if (person.referencePath) {
      if (['photo', 'description'].includes(person.referenceSource) && (person.referenceStyleId ?? legacyPictureStyleId) !== pictureStyleIdFor(record)) throw Error('A selected person belongs to a different family look.');
      if (person.referenceHash && imageHash(person.referencePath) !== person.referenceHash) throw new Error(`Locked ${person.id} reference bytes changed.`);
      person.referenceHash = imageHash(person.referencePath); continue;
    }
    if (person.role === 'child' && heroReference?.ready && record.hero.heroPicturePath === heroReference.path) {
      if (imageHash(heroReference.path) !== heroReference.hash) throw new Error('Checked hero reference bytes changed.');
      person.referencePath = heroReference.path; person.referenceHash = heroReference.hash;
      continue;
    }
    const name = `reference-${person.id}`;
    let reference = saved[name];
    if (reference && (!reference.ready || imageHash(reference.path) !== reference.hash)) throw new Error(`Saved ${person.id} reference no longer matches its checked bytes.`);
    if (!reference) {
      reference = await readyPicture(transport, record, move, tonight, { kit, directory: join(directory, name), hero: true, character: person, selection });
      saveStage?.(name, reference);
    }
    person.referencePath = reference.path; person.referenceHash = reference.hash;
  }
  return cast;
}

// Page art always starts from the checked hero, including both redraws.
export async function readyDrawnPage(transport, record, move, tonight, kitText, { kit, directory, selection, panelIndex, priorHashes = [], faults: initialFaults = [], savedCandidate, layoutRevision, forceRedraw = false } = {}) {
  const evidenceDirectory = directory;
  if (layoutRevision !== undefined && (typeof layoutRevision !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(layoutRevision))) throw Error('Invalid explicit poster layout revision.');
  if (layoutRevision && panelIndex === undefined) directory = join(directory, `poster-layout-${layoutRevision}`);
  mkdirSync(directory, { recursive: true });
  selection ??= chooseWorld(record);
  const referencePath = record.hero.heroPicturePath;
  if (!referencePath) throw new Error('A checked hero reference is required.');
  const referenceData = imageData(referencePath);
  const referenceHash = imageHash(referencePath);
  const referenceImages = castReferences(record);
  const panel = panelIndex === undefined ? undefined : panelWithSpeaker(record, kitText.panelLines[panelIndex], kitText.story);
  const kind = panel ? `panel-${panelIndex + 1}` : 'poster';
  const expectedBoxes = panel ? [{ id: 'bubble', text: panel.line }] : posterBoxes(move, kitText);
  const context = drawingContext(record, move, kitText, panel, selection, currentPosterTemplateVersion);
  const { state, save } = pageAttemptState(directory, kind, context, record, move, kitText, savedCandidate);
  const wirePath = transport.logFile ?? join(evidenceDirectory, 'requests.jsonl');
  const wireCount = stage => { try { return typeof transport.wireCount === 'function' ? transport.wireCount() : readLog(wirePath).filter(row => row.event === 'request' && row.stage === stage).length; } catch { return NaN; } };
  const keyFor = candidate => {
    const body = buildWordCheckRequest(record, move, tonight, imageData(candidatePath(directory, candidate)), { panel, jokeIdea: kitText.jokeIdea, referenceImages, templateVersion: candidate.context.templateVersion });
    return digest({ imageHash: candidate.hash, context: candidate.context, ...pictureStyleFingerprint(record), model: body.model, reasoning: body.reasoning, maxOutputTokens: body.max_output_tokens, geometryRuleVersion: geometryRules.geometryRuleVersion ?? 'legacy-geometry-v0', instructions: body.input[0].content[0].text, schema: body.text?.format?.schema, castEvaluationVersion, recoveryVersion: 1 });
  };
  const resultFor = candidate => ({ castEvaluationVersion, ...pictureStyleFingerprint(record), path: candidatePath(directory, candidate), hash: candidate.hash, generationRuleVersion: candidate.generationRuleVersion, referenceHash, castReferenceHashes: context.references, checks: [...state.candidates.filter(other => other !== candidate).flatMap(other => other.checks), ...candidate.checks], ready: true, kind, expectedBoxes,
    ...(!panel ? { templateVersion: candidate.context.templateVersion, approvedPrinted: approvedPosterWords(move, kitText, { nickname: learningActor(record).storyName }), ...(layoutRevision ? { layoutRevision } : {}) } : {}),
    lookChips: record.hero.lookChips, lockedOutfit: record.hero.lockedOutfit });
  const parentReview = (candidate, reason, previous = {}) => {
    const known = assessCheck(previous);
    if (!known.ready) return known;
    const check = { ...known, ready: true, verified: false, contentVerified: known.contentVerified ?? known.verified !== false, needsRecheck: false, reviewStatus: 'parent-review',
      reviewFlags: [...(known.reviewFlags ?? []), reviewNote('parent_picture_review', reason)],
      ...(!panel && !known.geometry ? { geometry: unverifiedGeometry(pngDimensions(candidatePath(directory, candidate)), reason, candidate.context.templateVersion) } : {}) };
    candidate.checks ??= []; candidate.checks.push(check);
    save(); return check;
  };
  const checkFile = async (candidate, retry, recovering) => {
    const key = keyFor(candidate);
    const beforeWire = wireCount(`${kind}-word-check`);
    candidate.rechecks ??= {};
    const previous = candidate.rechecks[key];
    const latest = candidate.checks?.at(-1);
    const savedUnknown = !latest?.checkerNotSent && Boolean(previous && (['checking', 'failed'].includes(previous.status) || previous.check?.contentNeedsRecheck || previous.check?.canRedraw === false) || latest?.contentNeedsRecheck || latest?.canRedraw === false);
    const explicitResume = savedUnknown && useSavedCheckRetry(transport, `${kind}:${candidate.hash}`);
    if (savedUnknown && !explicitResume) return { ready: false, verified: false, canRedraw: false, faults: ['content_check_unverified'], needsRecheck: false };
    candidate.wordCheckInvocations = (candidate.wordCheckInvocations ?? 0) + 1;
    candidate.recheckHistory ??= []; if (previous) candidate.recheckHistory.push(structuredClone(previous));
    candidate.rechecks[key] = { invocation: candidate.wordCheckInvocations, explicitResume, status: 'checking', modelRuleKey: key, geometryRuleVersion: geometryRules.geometryRuleVersion ?? 'legacy-geometry-v0', recovering, at: new Date().toISOString() }; save();
    let check;
    try {
      transport.onStage?.(`${kind}-word-check`);
      check = await checkWords(transport, record, move, tonight, imageData(candidatePath(directory, candidate)), expectedBoxes,
        { kit, retry, panel, referenceImages, jokeIdea: kitText.jokeIdea, stage: `${kind}-word-check`, templateVersion: candidate.context.templateVersion, inspect(check) {
          if (!panel) { const dimensions = pngDimensions(candidatePath(directory, candidate)); if (dimensions.width !== drawingCanvas.width || dimensions.height !== drawingCanvas.height) { check.ready = false; check.faults.push('wrong_drawing_canvas'); } }
          if (priorHashes.includes(candidate.hash)) { check.ready = false; check.faults.push('duplicate_panel_drawing'); }
        } });
      candidate.checks.push(check);
      const verified = check.ready;
      candidate.rechecks[key] = { ...candidate.rechecks[key], status: check.ready && (!recovering || verified) ? 'accepted' : 'rejected', check };
      const dimensions = !panel ? pngDimensions(candidatePath(directory, candidate)) : null;
      if (!panel && (!check.geometry?.placement || !check.geometry?.exported || dimensions.width !== drawingCanvas.width || dimensions.height !== drawingCanvas.height)) {
        check.geometry = unverifiedGeometry(pngDimensions(candidatePath(directory, candidate)), undefined, candidate.context.templateVersion);
        check.reviewFlags = [...(check.reviewFlags ?? []), ...check.geometry.reviewFlags]; transport.recordReviewFlags?.(`${kind}-geometry`, check.geometry.reviewFlags);
      }
      if (!panel) writeFileSync(join(directory, candidate.file.replace(/\.png$/, '-comparison.html')), comparisonHTML(candidate.file, check.geometry), { mode: 0o600 });
      save();
      if (recovering) transport.recordLocalResult?.('saved-art-recheck', { kind, file: candidate.file, hash: candidate.hash, ruleKey: key, ready: verified, geometryRuleVersion: geometryRules.geometryRuleVersion ?? 'legacy-geometry-v0' }, verified ? 'PASS: same saved bytes, no drawing bought.' : 'REJECTED: original drawing allowance remains spent.');
      return check;
    } catch (error) {
      const afterWire = wireCount(`${kind}-word-check`);
      // runCheck may contain two logical calls. A no-send flag on its second
      // call cannot refund a workflow whose first call already reached OpenAI.
      const checkerNotSent = provenPreflight(error, beforeWire, afterWire) && Number.isFinite(beforeWire) && afterWire === beforeWire;
      if (checkerNotSent) {
        delete candidate.rechecks[key]; candidate.preflightStops ??= []; candidate.preflightStops.push({ reason: error.message, sent: false, at: new Date().toISOString() });
      } else candidate.rechecks[key] = { ...candidate.rechecks[key], status: 'failed', reason: error.message };
      save();
      transport.recordLocalResult?.('picture-check-unavailable', { kind, hash: candidate.hash, reason: error.message }, 'The drawing is saved. Its words could not be checked, so printing waits.');
      const failed = { ready: false, verified: false, faults: ['content_check_unverified'], needsRecheck: false, canRedraw: false, checkerNotSent, reason: error.message };
      candidate.checks.push(failed); save(); return failed;
    }
  };
  save();
  let savedFaults = [];
  for (const candidate of [...state.candidates].reverse()) {
    if (forceRedraw) break;
    if (basename(candidate.file) !== candidate.file || !candidate.acceptedStageEvidence && !new RegExp(`^${kind}-attempt-\\d+\\.png$`).test(candidate.file)) throw Error('Saved drawing candidate path is invalid.');
    if (!existsSync(candidatePath(directory, candidate)) || imageHash(candidatePath(directory, candidate)) !== candidate.hash) throw Error('Saved drawing candidate bytes changed. No new picture was bought.');
    if (!sameDrawingContext(candidate.context, { ...context, templateVersion: candidate.context.templateVersion })) continue;
    const local = candidate.checks?.at(-1);
    const parsed = local?.answers ? assessCheck(parseWordCheck(JSON.stringify(local.answers), expectedBoxes, {
      generation: true, footerText: posterFooter(learningActor(record).storyName), cast: publicCast(record), picture: kind,
      expectedTemplateVersion: candidate.context.templateVersion, pictureStyleId: pictureStyleIdFor(record),
    })) : local;
    const unknown = local?.canRedraw === false || local?.contentNeedsRecheck || parsed?.contentNeedsRecheck;
    const check = unknown || !local?.answers && !local?.wordVerdicts ? await checkFile(candidate, Math.max(0, state.drawRequests - 1), true) : parentReview(candidate, 'Reused the unchanged saved drawing with the same words and family references. No new drawing or checker call.', parsed);
    if (check.ready) return resultFor(candidate);
    if (check.canRedraw === false || check.contentNeedsRecheck) throw unverifiedWords(check, 'The saved drawing words remain unverified. Saved work is kept.');
    savedFaults = check.faults;
  }
  let faults = [...initialFaults, ...savedFaults];
  for (;;) {
    const options = { referenceData, referenceImages, selection, faults };
    const body = panel ? buildPanelRequest(record, move, tonight, panel, options) : buildPosterRequest(record, move, tonight, kitText, options);
    const outgoing = { provider: 'openai', path: body.image ? '/v1/images/edits' : '/v1/images/generations', body,
      privacy: privacyFor(record, tonight, move), kit, stage: kind };
    const recovering = transport.hasRecovery?.(outgoing) === true;
    if (!recovering && state.drawRequests >= 2) break;
    const attempt = recovering ? Math.max(0, state.drawRequests - 1) : state.drawRequests;
    const beforeWire = wireCount(kind);
    if (!recovering) { state.drawRequests++; save(); }
    let response;
    try { response = await transport.call({ ...outgoing, retry: attempt }); }
    catch (error) {
      if (!recovering && provenPreflight(error, beforeWire, wireCount(kind))) {
        const path = join(evidenceDirectory, 'kit-log.json'), ledger = existsSync(path) ? readJSON(path) : [], index = ledger.length - 1, row = ledger[index];
        const ledgerEntry = row?.stage === kind && !row.requestId && row.verdict === error.message ? { index, sha256: digest(row) } : undefined;
        state.drawRequests--; state.preflightStops ??= []; state.preflightStops.push({ reason: error.message, sent: false, ...(ledgerEntry ? { ledgerEntry } : {}), at: new Date().toISOString() }); save();
      }
      throw error;
    }
    let bytes;
    try { bytes = pngFrom(response); }
    catch (error) { transport.recordRejection(response, error.message); if (attempt >= 1) throw new Error('Malformed picture after one retry: ' + error.message); continue; }
    const file = nextImage(directory, kind);
    writeFileSync(file, bytes, { mode: 0o600 });
    const hash = imageHash(file);
    const candidate = { file: basename(file), hash, context, generationRuleVersion: geometryRules.geometryRuleVersion ?? 'legacy-geometry-v0', checks: [], rechecks: {} };
    state.candidates.push(candidate); save();
    if (!panel) {
      // A composed poster has no target layout, so no guide file is written for it.
      if (!posterTemplateFor(context.templateVersion).composed) writeFileSync(join(directory, 'template-guide.png'), templateGuidePNG(), { mode: 0o600 });
      writeFileSync(file.replace(/\.png$/, '-comparison.html'), comparisonHTML(basename(file), null, context.templateVersion), { mode: 0o600 });
    }
    const check = await checkFile(candidate, attempt, false);
    transport.recordVerdict?.(response, check.ready ? 'PASS' : [...check.faults, ...(check.measurementFaults ?? [])].join('; '));
    if (check.ready) return resultFor(candidate);
    if (check.canRedraw === false || check.contentNeedsRecheck) throw unverifiedWords(check, 'The drawing words remain unverified after one recheck. Saved work is kept.');
    faults = check.faults;
    if (attempt >= 1) throw Object.assign(new Error(`${kind} words still differ after one repair: ${faults.join('; ')}`), { canResume: false });
  }
  throw Error(`${kind} drawing allowance is spent after the initial drawing and one repair. Saved images and review evidence are retained; Resume cannot renew it.`);
}

export async function comicPanelCrops(path) {
  const { width, height } = pngDimensions(path);
  const { data, info } = await sharp(path, { limitInputPixels: 24_000_000 }).toColourspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const divider = vertical => {
    const size = vertical ? width : height, across = vertical ? height : width, middle = Math.floor(size / 2);
    const whiteLines = [];
    for (let line = Math.max(1, Math.floor(size * .46)); line < Math.min(size - 1, Math.ceil(size * .54)); line++) {
      let white = 0;
      for (let other = 0; other < across; other++) {
        const x = vertical ? line : other, y = vertical ? other : line, at = (y * width + x) * info.channels;
        if (data[at] > 240 && data[at + 1] > 240 && data[at + 2] > 240) white++;
      }
      // A divider crosses the entire sheet. White paper inside a bordered
      // panel does not. A few coloured edge pixels may interrupt the gap.
      if (white / across >= .999) whiteLines.push(line);
    }
    const groups = [];
    for (const line of whiteLines) {
      const last = groups.at(-1);
      if (last && line - last.end <= Math.max(2, Math.ceil(size * .006))) last.end = line + 1;
      else groups.push({ start: line, end: line + 1 });
    }
    const gap = groups.filter(row => row.end - row.start < size * .08).sort((a, b) => Math.abs((a.start + a.end) / 2 - middle) - Math.abs((b.start + b.end) / 2 - middle))[0];
    return gap ?? { start: middle, end: middle };
  };
  const x = divider(true), y = divider(false);
  return [
    { left: 0, top: 0, width: x.start, height: y.start },
    { left: x.end, top: 0, width: width - x.end, height: y.start },
    { left: 0, top: y.end, width: x.start, height: height - y.end },
    { left: x.end, top: y.end, width: width - x.end, height: height - y.end },
  ];
}

async function readyComicSheet(transport, record, move, tonight, kitText, options) {
  const { directory, kit } = options;
  const references = castReferences(record);
  const bodies = kitText.panelLines.map(panel => buildPanelRequest(record, move, tonight, panelWithSpeaker(record, panel, kitText.story), { referenceImages: references, selection: options.selection }));
  const contract = digest({ prompts: bodies.map(body => body.prompt), references: references.map(({ characterId, hash }) => ({ characterId, hash })), version: 'four-comic-scenes-v1' });
  const statePath = join(directory, 'comic-sheet-state.json');
  const state = existsSync(statePath) ? readJSON(statePath) : { version: 1, contract, attempts: 0 };
  if (state.contract !== contract) throw Error('The saved comic belongs to different words or family drawings.');
  const path = join(directory, 'comic-sheet.png');
  const approvedPanels = kitText.panelLines.map(panel => panelWithSpeaker(record, panel, kitText.story));
  for (;;) {
    if (state.hash) {
      if (!existsSync(path) || imageHash(path) !== state.hash) throw Error('The saved comic picture changed.');
    } else {
      const prompt = 'Draw ONE finished comic contact sheet with FOUR DIFFERENT landscape scenes, in a two-column, two-row grid of equal cells. Separate cells with narrow WHITE gutters across the full sheet. Read top left, top right, bottom left, bottom right. Each block describes ONLY its own cell. Keep the same family and chosen look. Put each exact short speech bubble inside its cell, tail pointing to the named speaker. No panel numbers or other words.\n\n' + bodies.map((body, index) => `CELL ${index + 1}:\n${body.prompt}`).join('\n\n') + (state.repairFaults?.length ? '\nRepair only these observed word or speaker errors: ' + state.repairFaults.join('; ') : '');
      const body = { ...bodies[0], size: '1536x1024', quality: 'high', prompt };
      const outgoing = { provider: 'openai', path: '/v1/images/edits', body, privacy: privacyFor(record, tonight, move), kit, stage: 'comic-panels' };
      const recovering = transport.hasRecovery?.(outgoing) === true;
      if (!recovering && state.attempts >= 2) throw Error('This comic used its initial drawing and one repair. Saved work is kept.');
      const before = transport.wireCount?.();
      if (!recovering) { state.attempts++; saveJSON(statePath, state); }
      let response;
      try { response = await transport.call({ ...outgoing, retry: state.attempts - 1 }); }
      catch (error) { if (!recovering && provenPreflight(error, before, transport.wireCount?.())) { state.attempts--; saveJSON(statePath, state); } throw error; }
      let bytes;
      try { bytes = pngFrom(response); await sharp(bytes, { limitInputPixels: 24_000_000 }).raw().toBuffer(); }
      catch (error) { transport.recordRejection?.(response, error.message); throw error; }
      writeFileSync(path, bytes, { mode: 0o600 });
      writeFileSync(join(directory, `comic-sheet-attempt-${state.attempts}.png`), bytes, { mode: 0o600 });
      state.hash = imageHash(path); delete state.check; delete state.crops; saveJSON(statePath, state);
      transport.recordVerdict?.(response, 'DRAWN: four scenes saved, word readback pending.');
    }
    if (state.check?.checkerNotSent) { delete state.check; saveJSON(statePath, state); }
    if (!state.check && state.checkStarted) { state.check = { ready: false, verified: false, canRedraw: false, needsRecheck: false, faults: ['content_check_unverified'], reason: 'The earlier word check was interrupted. Its saved work and spent allowance are kept.' }; saveJSON(statePath, state); }
    if (state.check && !state.check.ready && !state.check.checkerNotSent && (state.check.canRedraw === false || state.check.contentNeedsRecheck) && useSavedCheckRetry(transport, `comic:${state.hash}`)) { delete state.check; delete state.checkStarted; state.explicitResumeChecks = (state.explicitResumeChecks ?? 0) + 1; saveJSON(statePath, state); }
    if (!state.check) {
      state.wordCheckInvocations = (state.wordCheckInvocations ?? 0) + 1;
      const checkWireCount = () => typeof transport.wireCount === 'function' ? transport.wireCount() : readLog(join(directory, 'requests.jsonl')).filter(row => row.event === 'request' && row.stage === 'comic-word-check').length;
      const beforeCheckWire = checkWireCount();
      state.checkStarted = true; saveJSON(statePath, state);
      transport.onStage?.('comic-word-check');
      try { state.check = await checkComicWords(transport, record, move, tonight, imageData(path), approvedPanels, { kit, retry: state.attempts - 1, referenceImages: references }); }
      catch (error) { state.check = { ready: false, verified: false, canRedraw: false, needsRecheck: false, faults: ['content_check_unverified'], checkerNotSent: provenPreflight(error, beforeCheckWire, checkWireCount()) && Number.isFinite(beforeCheckWire) && checkWireCount() === beforeCheckWire, reason: error.message }; }
      delete state.checkStarted;
      state.history ??= []; state.history.push({ hash: state.hash, attempt: state.attempts, invocation: state.wordCheckInvocations, check: state.check }); saveJSON(statePath, state);
    }
    if (state.check.ready) break;
    if (state.check.canRedraw === false || state.check.contentNeedsRecheck) throw unverifiedWords(state.check, 'Comic words remain unverified. Saved pictures and checker answers are kept.');
    if (state.attempts >= 2) throw Object.assign(Error('Comic words still differ after one repair. Saved pictures and checker answers are kept.'), { canResume: false });
    state.repairFaults = state.check.faults; delete state.hash; saveJSON(statePath, state);
  }
  const { width, height } = pngDimensions(path), halfWidth = Math.floor(width / 2), halfHeight = Math.floor(height / 2);
  if (!state.crops) {
    // Already placed historical panels keep their original cuts on Resume.
    state.crops = Object.keys(options.saved ?? {}).some(key => /^panel-[1-4]$/.test(key))
      ? [0, 1, 2, 3].map(index => ({ left: index % 2 * halfWidth, top: Math.floor(index / 2) * halfHeight, width: index % 2 ? width - halfWidth : halfWidth, height: index > 1 ? height - halfHeight : halfHeight }))
      : await comicPanelCrops(path);
    saveJSON(statePath, state);
  }
  const panels = [];
  for (let index = 0; index < 4; index++) {
    const saved = options.saved?.[`panel-${index + 1}`];
    if (saved?.sourceSheet?.hash === state.hash && existsSync(saved.path)) {
      if (imageHash(saved.path) !== saved.hash) throw Error('A saved comic panel changed.');
      panels.push(saved); continue;
    }
    const crop = state.crops[index];
    const panelPath = join(directory, `panel-${index + 1}-from-sheet.png`);
    const bytes = await sharp(path).extract(crop).png().toBuffer(); writeFileSync(panelPath, bytes, { mode: 0o600 });
    const panel = { ...pictureStyleFingerprint(record), ready: true, path: panelPath, hash: imageHash(panelPath), referenceHash: imageHash(record.hero.heroPicturePath),
      castReferenceHashes: references.map(({ characterId, hash }) => ({ characterId, hash })), expectedBoxes: [{ id: 'bubble', text: kitText.panelLines[index].line }],
      sourceSheet: { hash: state.hash, crop }, checks: [{ ...state.check.panels[index], contentVerified: true, reviewStatus: 'parent-review', reviewFlags: [...(state.check.panels[index].reviewFlags ?? []), reviewNote('parent_picture_review', 'Words checked together on the actual comic sheet. Picture appearance is for your choice.')] }] };
    options.saveStage?.(`panel-${index + 1}`, panel); panels.push(panel);
  }
  return panels;
}

export async function readyKitArt(transport, record, move, tonight, kitText, options) {
  if (!record.cast?.length || lockedCast(record).some(person => !person.referencePath)) throw new Error('Every recurring character needs a checked reference before drawing kit art.');
  const priorContinuity = options.saved?.['cast-continuity'];
  if (priorContinuity?.checks?.at(-1)?.answers) {
    const answer = priorContinuity.checks.at(-1).answers;
    const parsed = parseCastCheck(JSON.stringify(answer), publicCast(record), ['poster', 'panel-1', 'panel-2', 'panel-3', 'panel-4']);
    if (savedAppearanceNeedsReview(parsed)) throw Object.assign(Error('saved_appearance_review_required: ' + parsed.faults.join('; ')), { code: 'saved_appearance_review_required', canResume: false });
  }
  // Check every outgoing text payload before buying any page art.
  buildPosterRequest(record, move, tonight, kitText, options);
  for (const panel of kitText.panelLines) buildPanelRequest(record, move, tonight, panelWithSpeaker(record, panel, kitText.story), options);
  const cached = async (name, run) => {
    const saved = options.saved?.[name];
    if (saved && name === 'poster' && options.layoutRevision && saved.layoutRevision !== options.layoutRevision) {
      const revised = await run(); options.saveStage?.(name, revised); return revised;
    }
    if (saved) {
      const style = pictureStyleFor(record);
      if ((saved.pictureStyleId ?? legacyPictureStyleId) !== style.id || saved.pictureStyleVersion && saved.pictureStyleVersion !== style.version) throw Error('Saved drawing belongs to a different family look. No new picture was bought.');
      if (!saved.ready || saved.referenceHash !== imageHash(record.hero.heroPicturePath) || imageHash(saved.path) !== saved.hash) throw new Error(`Saved ${name} no longer matches its checked bytes or hero.`);
      if (record.cast && JSON.stringify(saved.castReferenceHashes) !== JSON.stringify(castReferences(record).map(({ characterId, hash }) => ({ characterId, hash })))) throw new Error(`Saved ${name} no longer matches the complete locked cast.`);
      if (name === 'poster' && saved.checks?.at(-1)?.answers) {
        const latest = saved.checks.at(-1), dimensions = pngDimensions(saved.path);
        const parsed = assessCheck(parseWordCheck(JSON.stringify(latest.answers), posterBoxes(move, kitText), {
          generation: true, footerText: posterFooter(learningActor(record).storyName), expectedTemplateVersion: saved.templateVersion,
          pictureStyleId: pictureStyleIdFor(record), expectedCoordinateUnit: 'source-pixels',
        }));
        if (!parsed.ready) return run();
        if (parsed.geometry?.placement && parsed.geometry?.exported && dimensions.width === drawingCanvas.width && dimensions.height === drawingCanvas.height) {
          const updated = { ...saved, reviewStatus: 'parent-review', checks: [...saved.checks, { ...parsed, locallyReevaluated: true }] };
          options.saveStage?.(name, updated); return updated;
        }
      }
      if (!saved.checks?.at(-1)?.answers) return { ...saved, verified: false, contentVerified: false, reviewStatus: 'parent-review', reviewFlags: [...(saved.reviewFlags ?? []), reviewNote('historical_word_check_unverified', 'Accepted saved picture bytes are retained. This older record has no current word verdict. No new picture or approval was bought.')] };
      return { ...saved, reviewStatus: 'parent-review' };
    }
    const art = await run(); options.saveStage?.(name, art); return art;
  };
  let poster = await cached('poster', () => readyDrawnPage(transport, record, move, tonight, kitText, options));
  const panels = [];
  if (transport.route === 'codex-subscription' && (existsSync(join(options.directory, 'comic-sheet-state.json')) || !kitText.panelLines.some((_, index) => options.saved?.[`panel-${index + 1}`]))) {
    panels.push(...await readyComicSheet(transport, record, move, tonight, kitText, options));
  } else for (let panelIndex = 0; panelIndex < kitText.panelLines.length; panelIndex++) {
    panels.push(await cached(`panel-${panelIndex + 1}`, () => readyDrawnPage(transport, record, move, tonight, kitText, { ...options, panelIndex, priorHashes: panels.map(panel => panel.hash) })));
  }
  const continuityChecks = [];
  options.saveStage?.('cast-continuity', { ready: true, verified: false, reviewStatus: 'parent-review', checks: [],
    pictureHashes: [{ id: 'poster', hash: poster.hash }, ...panels.map((panel, index) => ({ id: `panel-${index + 1}`, hash: panel.hash }))],
    castReferenceHashes: castReferences(record).map(({ characterId, hash }) => ({ characterId, hash })) });
  transport.recordLocalResult?.('cast-continuity', { automaticRedraws: 0, reviewStatus: 'parent-review' }, 'The family’s chosen references were used. Parent review, no automatic redraw loop.');
  return { poster, panels, continuityChecks, ready: true };
}
