import { pictureStyleFor, comicFaceRuleVersion } from './graphic-style.js';
import { pictureStyleOptions, pictureStyleOptionFor, pictureStyleIdFor } from '../app/picture-styles.js';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config, assertPhotoAllowed, assertFamilyAllowed } from './config.js';
import { lockedCast } from './cast.js';
import { buildPortraitRequest, buildPortraitStageRequest, buildPortraitIdentityCheckRequest, assessPortraitIdentity, portraitIdentityCheckVersion, buildPortraitRenderCheckRequest, assessPortraitRender, portraitRenderCheckVersion, legacyPortraitKeyBody, normalizePortraitDescription, portraitDescriptionMaxLength, privacyFor } from './requests.js';
import { imageHash, pngFrom } from './picture.js';
import { saveJSON, readJSON, extractJSON } from './files.js';
import { openaiText } from './check-picture.js';
import { wireCeiling } from './app-budget.js';
import { createFileDigests } from './browser-previews.js';

export { portraitDescriptionMaxLength };
export const inkPortraitPipelineVersion = 'ink-base-v1';
// Jobs made from October 16 send only the person's own photo, description or
// generated ink base as images, and check the ink sketch before any finish.
// Older jobs keep their files, attempts and charges and stay readable.
export const portraitReferencePolicy = 'identity-refs-only-v1';
const currentPolicy = job => job?.referencePolicy === portraitReferencePolicy;
const chosenFrom = (job, person) => Boolean(person?.portraitCandidateId) && job.candidates.some(candidate => candidate.id === person.portraitCandidateId);
// Job kinds are stored, never guessed from slots. No kind: older three choices in
// one look. 'style-comparison': a new family's first person in each offered look.
// 'selected-style': one drawing in the chosen family look, more only on request.
// Both new kinds draw each look straight from the photo, or restyle one neutral
// checked sketch made from appearance words, and check every drawing before it
// is shown.
// v2, October 16: recognisable comic family faces (comicFaceRuleVersion). Drawings made
// under v1 keep their files, attempts and charges but are not offered as current.
export const personalLookVersion = 'personal-look-v2';
export const directRenderPipelineVersion = 'direct-render-v1';
const targetsFor = job => job.targets ?? [0, 1, 2].map(slot => ({ slot, pictureStyleId: job.pictureStyleId, pictureStyleVersion: job.pictureStyleVersion }));
const missingTargets = job => targetsFor(job).filter(target => !job.candidates.some(candidate => candidate.slot === target.slot));
export const comparisonTargets = () => pictureStyleOptions.map((style, slot) => ({ slot, pictureStyleId: style.id, pictureStyleVersion: pictureStyleFor(style.id).version }));
export const photoByteLimit = 8 * 1024 * 1024;
export const photoJSONLimit = Math.ceil(photoByteLimit / 3) * 4 + 4096;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export async function normalizePhoto(photo) {
  if (!photo || !['image/jpeg', 'image/png', 'image/webp'].includes(photo.mime) || typeof photo.base64 !== 'string' || photo.base64.length > Math.ceil(photoByteLimit / 3) * 4 || photo.base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(photo.base64)) throw fail('Choose a JPG, PNG or WebP photo under 8 MB.');
  const padding = photo.base64.indexOf('=');
  if (padding !== -1 && !['=', '=='].includes(photo.base64.slice(padding))) throw fail('Choose a JPG, PNG or WebP photo under 8 MB.');
  const bytes = Buffer.from(photo.base64, 'base64');
  if (!bytes.length || bytes.length > photoByteLimit || bytes.toString('base64') !== photo.base64) throw fail('Choose a JPG, PNG or WebP photo under 8 MB.');
  const mime = bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? 'image/png' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg' : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : '';
  if (mime !== photo.mime) throw fail('This file does not match its photo type. Choose a JPG, PNG or WebP photo.');
  try {
    const { default: sharp } = await import('sharp');
    const image = sharp(bytes, { limitInputPixels: 64_000_000, failOn: 'warning', animated: false });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw Error('Invalid photo');
    // A new PNG drops EXIF and other source metadata. Rotation uses EXIF first.
    return await image.rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch { throw fail('This photo could not be opened. Choose another JPG, PNG or WebP photo.'); }
}

async function pixelFingerprint(bytes, { requirePNG = false } = {}) {
  const { default: sharp } = await import('sharp');
  const image = sharp(bytes, { limitInputPixels: 24_000_000, failOn: 'warning' });
  const meta = await image.metadata();
  if (requirePNG && meta.format !== 'png' || (meta.pages ?? 1) !== 1) throw Error('The generated drawing is not a single PNG.');
  const { data, info } = await image.toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  try { return sha(Buffer.concat([Buffer.from(`${info.width}:${info.height}:rgba:`), data])); }
  finally { data.fill(0); }
}

export function portraitFingerprint(record, person, { inputMode = 'photo', pipelineVersion } = {}) {
  const { image, ...drawing } = legacyPortraitKeyBody(record, person);
  const style = pictureStyleFor(record);
  const legacy = { pictureStyleId: style.id, pictureStyleVersion: style.version, pictureStyleReferenceHash: style.referenceHash ?? null, drawing };
  return sha(JSON.stringify(inputMode === 'photo' && !pipelineVersion ? legacy : { ...legacy, inputMode, pipelineVersion: pipelineVersion ?? null }));
}

// A new-family job's own key: kind, input mode, and each offered look's drawing
// request for this person. A comparison never depends on the family look, so a
// choice never hides it; a one-drawing job follows the family look. Older
// person keys stay exactly as they were.
export function personalLookFingerprint(record, person, { kind, inputMode = 'photo', targets }) {
  // A one-drawing job belongs to the family look, so a later look change hides it.
  const family = pictureStyleFor(record);
  const looks = (kind === 'style-comparison' ? targets : [{ slot: 0, pictureStyleId: family.id, pictureStyleVersion: family.version }]).map(target => {
    const { image, ...body } = buildPortraitStageRequest({ ...record, pictureStyleId: target.pictureStyleId }, person, { phase: 'render', inputMode: 'photo', referenceData: 'data:image/png;base64,AAAA' });
    return [target.slot, target.pictureStyleId, target.pictureStyleVersion, body];
  });
  return sha(JSON.stringify({ kind, version: personalLookVersion, faceRule: comicFaceRuleVersion, inputMode, looks }));
}
// A comparison is current only for the looks offered now. Earlier three-look
// sets keep their files, attempts and charges but are not offered or chosen.
const keyFor = (record, person, job) => job.kind ? personalLookFingerprint(record, person, job.kind === 'style-comparison' ? { ...job, targets: comparisonTargets() } : job) : portraitFingerprint(record, person, job);
const readyMessage = job => job.kind === 'style-comparison' ? 'Your three looks are ready. Choose a drawing.' : job.kind === 'selected-style' ? 'Choose this drawing, or try another.' : 'Choose the drawing that looks most like this person.';

export function createPortraits({ db, persist, dataDirectory, active, budget, sampleOnly, memoryFor, childIdFor, readKey, transportFactory, allowSyntheticPortraits = false, lookFor = () => ({ pending: false, flow: null, revision: 0, chosenCandidateId: null }), commitLook = () => { throw fail('Family look choice is not available here.', 409); }, beforeReferenceChange = () => {}, config: settings = config }) {
  const checkedImageHash = createFileDigests();
  db.portraits ??= [];
  db.portraitSelections ??= [];
  db.portraitDrafts ??= [];
  for (const job of db.portraits) if (job.status === 'running') { job.status = job.inputMode === 'description' ? 'needs-input' : 'needs-photo'; job.message = 'Your saved drawings are safe. Use the same input to finish the remaining choices.'; }
  const directoryFor = job => join(dataDirectory, job.accountId, 'portraits', job.id);
  const exhausted = job => job && (job.requestCount >= 6 || job.pipelineVersion === inkPortraitPipelineVersion && !job.inkBase && ((job.baseAttempts ?? 0) >= 2 && !job.pendingInk || (job.inkChecks ?? 0) >= 3) || missingTargets(job).some(target => (job.attempts[target.slot] ?? 0) >= 2 || (job.renderChecks?.[target.slot] ?? 0) >= 3));
  // A saved candidate receipt is the stage commit. Recover it if the process
  // stopped after that write but before the account index was updated.
  for (const job of db.portraits) for (const { slot } of targetsFor(job)) {
    const file = join(directoryFor(job), `slot-${slot}.json`);
    if (!existsSync(file) || job.candidates.some(candidate => candidate.slot === slot)) continue;
    const candidate = readJSON(file);
    if (existsSync(candidate.path) && imageHash(candidate.path) === candidate.hash) job.candidates.push(candidate);
  }
  for (const job of db.portraits) if (job.pipelineVersion === inkPortraitPipelineVersion && !job.inkBase && existsSync(join(directoryFor(job), 'ink-base.json'))) {
    const base = readJSON(join(directoryFor(job), 'ink-base.json'));
    if (existsSync(base.path) && imageHash(base.path) === base.hash && base.sourceHash === job.sourceHash) job.inkBase = base;
  }
  for (const job of db.portraits) if (job.pipelineVersion === inkPortraitPipelineVersion && !job.inkBase && !job.pendingInk && existsSync(join(directoryFor(job), 'ink-pending.json'))) {
    const pending = readJSON(join(directoryFor(job), 'ink-pending.json'));
    if (pending.status === 'pending' && existsSync(pending.path) && imageHash(pending.path) === pending.hash && pending.sourceHash === job.sourceHash) job.pendingInk = pending;
  }
  for (const job of db.portraits) if (job.kind) for (const { slot } of missingTargets(job)) {
    const file = join(directoryFor(job), `render-${slot}-pending.json`);
    if (job.pendingRenders?.[slot] || !existsSync(file)) continue;
    const pending = readJSON(file);
    if (pending.status === 'pending' && existsSync(pending.path) && imageHash(pending.path) === pending.hash && pending.sourceHash === job.sourceHash) (job.pendingRenders ??= {})[slot] = pending;
  }
  for (const job of db.portraits) if (job.candidates.length && !missingTargets(job).length) { job.status = 'complete'; job.message = readyMessage(job); }
  const canDrawAnother = job => job.kind === 'selected-style' && job.status === 'complete' && (job.pipelineVersion === directRenderPipelineVersion || Boolean(job.inkBase)) && targetsFor(job).length < 3 && (job.requestCount ?? 0) < 6;
  const timingFor = job => {
    const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(job.createdAt)) / 1000));
    const durations = db.portraits.filter(item => item.status === 'complete' && item.kind === job.kind && !item.restartedFrom).slice(-20).flatMap(item => {
      try {
        const finished = item.completedAt ? Date.parse(item.completedAt) : Math.max(...item.candidates.map(candidate => statSync(candidate.path).mtimeMs));
        const minutes = (finished - Date.parse(item.createdAt)) / 60000;
        return Number.isFinite(minutes) && minutes > 0 ? [minutes] : [];
      } catch { return []; }
    });
    const low = durations.length ? Math.max(1, Math.floor(Math.min(...durations))) : null;
    const high = durations.length ? Math.max(low, Math.ceil(Math.max(...durations))) : null;
    return { elapsedSeconds: seconds, elapsedText: `${Math.floor(seconds / 60)} min ${seconds % 60} sec so far.`, sampleCount: durations.length,
      estimateText: durations.length ? `Recent completed drawings of this kind took ${low === high ? low : low + ' to ' + high} minutes. Yours may take longer.` : 'Allow a few minutes for drawings. We will show your progress here.' };
  };
  const publicJob = job => job ? { timing: timingFor(job), id: job.id, kind: job.kind ?? 'legacy-variations', inputMode: job.inputMode ?? 'photo', ...(job.inputMode === 'description' ? { description: job.description } : {}), status: job.status, message: job.message, completed: job.candidates.length, expected: targetsFor(job).length, canRestart: job.status !== 'running' && job.status !== 'complete' && Boolean(exhausted(job)), canDrawAnother: canDrawAnother(job) } : null;
  const assetURL = (job, candidate) => `/api/portrait-assets/${job.id}/${candidate.id}/preview.webp`;
  const assertAllowed = (record, inputMode = 'photo') => {
    assertFamilyAllowed(record, settings);
    if (inputMode === 'photo') assertPhotoAllowed(record, settings, { allowSyntheticPortraits });
    if (sampleOnly) throw fail('This preview makes no new drawings. Open a saved kit instead.', 503);
  };
  const personFor = (account, childId, id) => {
    const record = memoryFor(account, childId).exportRecord();
    const person = lockedCast(record).find(person => person.id === id);
    if (!person) throw fail('Choose a person in this family.', 404);
    return { person, record };
  };
  const labelFor = (record, person) => person.role === 'child' ? record.hero.nickname : record.storyPeople?.find(item => item.castId === person.id)?.storyName ?? person.label;
  const draftIdentity = (record, person) => sha(JSON.stringify([person.id, labelFor(record, person), person.pronouns]));
  const draftFor = (account, childId, record, person) => db.portraitDrafts.find(row => row.accountId === account.id && row.childId === childId && row.personId === person.id && row.identity === draftIdentity(record, person));
  function pruneDrafts(account, childId) {
    const record = memoryFor(account, childId).exportRecord(), people = lockedCast(record);
    db.portraitDrafts = db.portraitDrafts.filter(row => row.accountId !== account.id || row.childId !== childId || people.some(person => person.id === row.personId && row.identity === draftIdentity(record, person)));
  }
  function saveDraft(account, id, data) {
    const childId = childIdFor(account, data.childId), { record, person } = personFor(account, childId, id);
    if (data.personIdentity !== draftIdentity(record, person)) throw fail('This person changed in another window. Reopen this person before saving.', 409);
    if (typeof data.description !== 'string') throw fail('Add an appearance description.');
    const description = data.description.trim() ? normalizePortraitDescription(data.description) : '';
    const previous = draftFor(account, childId, record, person);
    if (!Number.isInteger(data.revision) || data.revision !== (previous?.revision ?? 0)) throw fail('This description changed in another window. Reopen this person before saving.', 409);
    db.portraitDrafts = db.portraitDrafts.filter(row => !(row.accountId === account.id && row.childId === childId && row.personId === id));
    db.portraitDrafts.push({ accountId: account.id, childId, personId: id, identity: draftIdentity(record, person), description, revision: (previous?.revision ?? 0) + 1 });
    persist(); return list(account, childId, data.pictureStyleId);
  }
  // While a new family has not chosen its look, one person's comparison at a
  // time can be drawing or waiting for the choice.
  const openComparison = account => db.portraits.findLast(job => {
    if (job.accountId !== account.id || job.kind !== 'style-comparison') return false;
    if (job.status === 'running') return true;
    // Looks that can still be chosen or finished keep this person first.
    if (!job.candidates.length && exhausted(job)) return false;
    try { const record = memoryFor(account, job.childId).exportRecord(), person = lockedCast(record).find(item => item.id === job.personId); return Boolean(person) && job.personFingerprint === keyFor(record, person, job); } catch { return false; }
  });
  const lookView = (account, record) => {
    const look = lookFor(account), open = look.pending ? openComparison(account) : null;
    let openLabel = null;
    if (open) try { const openRecord = memoryFor(account, open.childId).exportRecord(); openLabel = labelFor(openRecord, lockedCast(openRecord).find(item => item.id === open.personId)); } catch { openLabel = null; }
    return { flow: look.flow, pending: look.pending, revision: look.revision, pictureStyleId: pictureStyleIdFor(record), ...(open ? { comparison: { childId: open.childId, personId: open.personId, label: openLabel } } : {}) };
  };
  const referenceFields = (job, candidate) => ({ referencePath: candidate.path, referenceHash: candidate.hash, referenceSource: job.inputMode === 'description' ? 'description' : 'photo', portraitCandidateId: candidate.id, referenceStyleId: candidate.pictureStyleId ?? job.pictureStyleId, referenceStyleVersion: candidate.pictureStyleVersion ?? job.pictureStyleVersion });
  const selectedFor = (account, childId, person, record, styleId) => {
    const choice = db.portraitSelections.findLast(item => item.accountId === account.id && item.childId === childId && item.personId === person.id && item.pictureStyleId === styleId);
    const job = choice && db.portraits.find(item => item.id === choice.jobId && item.accountId === account.id && item.childId === childId && item.personId === person.id);
    const candidate = job?.candidates.find(item => item.id === choice.candidateId && (item.pictureStyleId ?? job.pictureStyleId) === styleId);
    if (candidate && job.personFingerprint === keyFor({ ...record, pictureStyleId: styleId }, person, job) && intact(candidate)) return { job, candidate };
    if ((person.referenceStyleId ?? pictureStyleIdFor(record)) !== styleId) return null;
    const original = db.portraits.find(item => item.accountId === account.id && item.candidates.some(candidate => candidate.id === person.portraitCandidateId));
    const saved = original?.candidates.find(item => item.id === person.portraitCandidateId);
    return intact(saved) ? { job: original, candidate: saved } : null;
  };
  const recordInStyle = (account, childId, styleId) => {
    const record = memoryFor(account, childId).exportRecord(), next = { ...record, pictureStyleId: styleId };
    next.cast = lockedCast(record).map(person => {
      const selected = selectedFor(account, childId, person, record, styleId);
      if (selected) return { ...person, ...referenceFields(selected.job, selected.candidate) };
      if ((person.referenceStyleId ?? pictureStyleIdFor(record)) === styleId) return person;
      const clean = { ...person, referencePath: '' };
      for (const key of ['referenceHash', 'referenceSource', 'portraitCandidateId', 'referenceStyleId', 'referenceStyleVersion']) delete clean[key];
      return clean;
    });
    next.hero = { ...record.hero, heroPicturePath: next.cast.find(person => person.id === 'child').referencePath };
    return next;
  };
  const comparisonFor = (account, childId, personId) => db.portraits.findLast(job => {
    if (job.accountId !== account.id || job.childId !== childId || personId && job.personId !== personId || job.kind !== 'style-comparison' || job.status !== 'complete') return false;
    const record = memoryFor(account, childId).exportRecord(), person = lockedCast(record).find(item => item.id === job.personId);
    return person && job.personFingerprint === keyFor(record, person, job) && pictureStyleOptions.every(style => job.candidates.some(candidate => candidate.pictureStyleId === style.id && intact(candidate)));
  });
  const previews = (account, requestedChildId) => {
    const childId = childIdFor(account, requestedChildId);
    // A sibling's saved face is never a preview for the selected child.
    const comparison = comparisonFor(account, childId, 'child') ?? comparisonFor(account, childId);
    const record = memoryFor(account, childId).exportRecord(), person = lockedCast(record).find(item => item.id === 'child');
    return pictureStyleOptions.map(style => {
      const candidate = comparison?.candidates.find(candidate => candidate.pictureStyleId === style.id);
      const selected = !candidate && person ? selectedFor(account, childId, person, record, style.id) : null;
      return { ...style, ...(candidate ? { url: assetURL(comparison, candidate) } : selected ? { url: assetURL(selected.job, selected.candidate) } : {}) };
    });
  };
  const list = (account, childId, requestedStyle) => {
    childId = childIdFor(account, childId);
    const original = memoryFor(account, childId).exportRecord();
    const styleId = requestedStyle === undefined ? pictureStyleIdFor(original) : pictureStyleIdFor(requestedStyle);
    const record = { ...original, pictureStyleId: styleId };
    return { waitEstimate: { comparison: timingFor({ kind: 'style-comparison', createdAt: new Date().toISOString() }).estimateText, single: timingFor({ kind: 'selected-style', createdAt: new Date().toISOString() }).estimateText }, look: { ...lookView(account, record), previews: previews(account, childId) }, people: lockedCast(original).map(person => {
      const job = db.portraits.findLast(job => job.accountId === account.id && job.childId === childId && job.personId === person.id && job.personFingerprint === keyFor(record, person, job) && (job.kind !== 'selected-style' || job.pictureStyleId === styleId));
      const selected = selectedFor(account, childId, person, original, styleId);
      const ordered = job?.kind ? job.candidates.toSorted((left, right) => left.slot - right.slot) : job?.candidates ?? [];
      const draft = draftFor(account, childId, original, person);
      return { id: person.id, personIdentity: draftIdentity(original, person), ...(draft ? { draft: { description: draft.description, revision: draft.revision } } : {}), inputMode: job?.inputMode ?? (person.referenceSource === 'description' ? 'description' : 'photo'), ...(job?.inputMode === 'description' ? { description: job.description } : {}), label: labelFor(record, person), role: person.role, hasStyleComparison: Boolean(comparisonFor(account, childId, person.id)),
        selectedUrl: selected ? assetURL(selected.job, selected.candidate) : null, candidates: ordered.filter(candidate => job.kind === 'style-comparison' || !requestedStyle || (candidate.pictureStyleId ?? job.pictureStyleId) === styleId).map(candidate => ({ id: candidate.id, url: assetURL(job, candidate), selected: candidate.id === selected?.candidate.id,
          ...(candidate.renderCheck?.status === 'uncertain' || candidate.inkBaseHash && job.inkBase?.identityCheck?.status === 'uncertain' ? { checkNote: 'Look closely before choosing this drawing.' } : {}),
          ...(job.kind === 'style-comparison' ? { pictureStyleId: candidate.pictureStyleId, styleLabel: pictureStyleOptionFor(candidate.pictureStyleId).label, recommended: pictureStyleOptions.some(style => style.id === candidate.pictureStyleId && style.recommended === true) } : {}) })), job: publicJob(job) };
    }) };
  };
  // A target's look id comes from the job's frozen list. The family record only
  // lends its people and clothes; every permission check reads the real record.
  function stageBody(record, person, job, source, target) {
    const personal = Boolean(job.kind);
    if (job.pipelineVersion === directRenderPipelineVersion) return buildPortraitStageRequest({ ...record, pictureStyleId: target.pictureStyleId }, person, { phase: 'render', inputMode: 'photo', referenceData: `data:image/png;base64,${source.toString('base64')}` });
    if (job.pipelineVersion === inkPortraitPipelineVersion) return job.inkBase
      ? buildPortraitStageRequest(personal ? { ...record, pictureStyleId: target.pictureStyleId } : record, person, { phase: 'finish', inputMode: job.inputMode, restyle: personal, referenceData: `data:image/png;base64,${readFileSync(job.inkBase.path).toString('base64')}` })
      : buildPortraitStageRequest(record, person, { phase: 'ink', inputMode: job.inputMode, description: job.description, neutral: personal, ...(job.inputMode === 'photo' ? { referenceData: `data:image/png;base64,${source.toString('base64')}` } : {}) });
    if (job.inputMode === 'description') return buildPortraitStageRequest(record, person, { phase: 'description', inputMode: 'description', description: job.description });
    return buildPortraitRequest(record, person, `data:image/png;base64,${source.toString('base64')}`);
  }
  async function checkInk(transport, record, person, job, source, pending, directory) {
    if ((job.inkChecks ?? 0) >= 3) throw fail('This drawing attempt is finished. Your saved drawings stay safe.');
    if (job.inputMode === 'photo' && !source) throw fail('Use the same photo to finish checking the first sketch.');
    const body = buildPortraitIdentityCheckRequest(record, person, { inputMode: job.inputMode,
      inkData: `data:image/png;base64,${readFileSync(pending.path).toString('base64')}`,
      ...(job.inputMode === 'photo' ? { sourceData: `data:image/png;base64,${source.toString('base64')}` } : { description: job.description }) });
    job.inkChecks = (job.inkChecks ?? 0) + 1; persist();
    const number = job.inkChecks;
    let response;
    // A check stopped before it was sent gives its count back, like a drawing request.
    try { response = await transport.call({ provider: 'openai', path: '/v1/responses', body, privacy: privacyFor(record, ''), familyRecord: record, stage: 'portrait-identity-check', retry: number - 1 }); }
    catch (error) { if (error.preflight === true) { job.inkChecks--; (job.preflightStops ??= []).push({ sent: false, stage: 'portrait-identity-check', reason: error.message }); persist(); } throw error; }
    let answer = null, verdict;
    try { answer = extractJSON(openaiText(response)); verdict = assessPortraitIdentity(answer, person); } catch { verdict = { status: 'unreadable' }; }
    // Every checker answer is kept. It holds words only, never image data.
    saveJSON(join(directory, `ink-check-${number}.json`), { version: portraitIdentityCheckVersion, stage: 'portrait-identity-check', model: body.model, inputMode: job.inputMode, inkHash: pending.hash, sourceHash: job.sourceHash, usage: response?.usage ?? null, answer, verdict, imagePayloadsOmitted: true });
    if (verdict.status === 'unreadable') throw Object.assign(Error('The sketch check returned no usable answer.'), { code: 'portrait_identity_unchecked' });
    return verdict;
  }
  async function checkRender(transport, record, person, job, target, render, referenceData, directory) {
    const done = job.renderChecks?.[target.slot] ?? 0;
    if (done >= 3) throw fail('This drawing attempt is finished. Your saved drawings stay safe.');
    const body = buildPortraitRenderCheckRequest(record, person, { inputMode: job.inputMode, pictureStyleId: target.pictureStyleId, renderData: `data:image/png;base64,${readFileSync(render.path).toString('base64')}`, referenceData, ...(job.inputMode === 'description' ? { description: job.description } : {}) });
    (job.renderChecks ??= {})[target.slot] = done + 1; persist();
    let response;
    try { response = await transport.call({ provider: 'openai', path: '/v1/responses', body, privacy: privacyFor(record, ''), familyRecord: record, stage: 'portrait-render-check', retry: done }); }
    catch (error) { if (error.preflight === true) { job.renderChecks[target.slot] = done; (job.preflightStops ??= []).push({ sent: false, stage: 'portrait-render-check', reason: error.message }); persist(); } throw error; }
    let answer = null, verdict;
    try { answer = extractJSON(openaiText(response)); verdict = assessPortraitRender(answer, person, target.pictureStyleId); } catch { verdict = { status: 'unreadable' }; }
    saveJSON(join(directory, `render-check-${target.slot}-${done + 1}.json`), { version: portraitRenderCheckVersion, stage: 'portrait-render-check', model: body.model, inputMode: job.inputMode, pictureStyleId: target.pictureStyleId, pictureStyleVersion: target.pictureStyleVersion, renderHash: render.hash, sourceHash: job.sourceHash, usage: response?.usage ?? null, answer, verdict, imagePayloadsOmitted: true });
    if (verdict.status === 'unreadable') throw Object.assign(Error('The drawing check returned no usable answer.'), { code: 'portrait_render_unchecked' });
    return verdict;
  }
  async function run(account, job, source, record, person) {
    try {
      const key = readKey(); if (!key) throw Error('Missing image key');
      const directory = directoryFor(job); mkdirSync(directory, { recursive: true, mode: 0o700 });
      const transport = transportFactory({ config: settings, keys: { openai: key }, maxCalls: 76, budget, logFile: join(directory, 'requests.jsonl'), allowSyntheticPortraits, familyRecordFor: () => memoryFor(account, job.childId).exportRecord() });
      const sourcePixels = source ? await pixelFingerprint(source) : null;
      const generate = async (slot, target) => {
        assertAllowed(memoryFor(account, job.childId).exportRecord(), job.inputMode ?? 'photo');
        if (exhausted(job)) throw fail('This drawing attempt is finished. Your saved drawings stay safe.');
        if (job.inkBase && (!existsSync(job.inkBase.path) || imageHash(job.inkBase.path) !== job.inkBase.hash)) throw Error('The saved ink drawing changed.');
        if (target && job.targets && pictureStyleFor(target.pictureStyleId).version !== target.pictureStyleVersion) throw fail('This look was updated after these drawings started. Make new drawings.', 409);
        const body = stageBody(record, person, job, source, target), ink = slot === 'ink';
        const stage = job.pipelineVersion === directRenderPipelineVersion ? 'portrait-render' : job.pipelineVersion === inkPortraitPipelineVersion ? ink ? 'portrait-ink' : 'portrait-finish' : job.inputMode === 'description' ? 'portrait-description' : 'portrait';
        job.requestCount = (job.requestCount ?? 0) + 1; persist();
        let response;
        try { response = await transport.call({ provider: 'openai', path: body.image ? '/v1/images/edits' : '/v1/images/generations', body, privacy: privacyFor(record, ''), familyRecord: record, stage, retry: ink ? job.baseAttempts ?? 0 : job.attempts[slot] ?? 0 }); }
        catch (error) { if (error.preflight === true) { job.requestCount--; (job.preflightStops ??= []).push({ sent: false, reason: error.message }); persist(); } throw error; }
        if (ink) job.baseAttempts = (job.baseAttempts ?? 0) + 1; else job.attempts[slot] = (job.attempts[slot] ?? 0) + 1;
        persist();
        const safeText = value => typeof value === 'string' ? value.replace(/(?:data:image\/[^;]+;base64,)?[A-Za-z0-9+/]{64,}={0,2}/g, '[image payload omitted]') : undefined;
        saveJSON(join(directory, `attempt-${slot}-${job.requestCount}-answer.json`), { created: typeof response.created === 'number' ? response.created : null, usage: response.usage ?? null,
          data: Array.isArray(response.data) ? response.data.map(item => ({ b64_json: '[image payload omitted; validated drawing stored separately]', ...(typeof item.revised_prompt === 'string' ? { revised_prompt: safeText(item.revised_prompt) } : {}) })) : [], imagePayloadsOmitted: true });
        let bytes;
        try {
          bytes = pngFrom(response); const pixels = await pixelFingerprint(bytes, { requirePNG: true });
          if (sourcePixels && pixels === sourcePixels) throw Error('The image service returned the unchanged source photo.');
          if (!ink && job.inkBase && pixels === await pixelFingerprint(readFileSync(job.inkBase.path), { requirePNG: true })) throw Error('The image service returned the unchanged ink base.');
        } catch (error) { saveJSON(join(directory, `attempt-${slot}-${job.requestCount}-rejection.json`), { reason: /unchanged source photo/.test(error.message) ? 'unchanged-source-pixels' : /unchanged ink base/.test(error.message) ? 'unchanged-ink-base' : 'invalid-generated-png', inputSaved: false }); throw error; }
        return bytes;
      };
      if (job.pipelineVersion === inkPortraitPipelineVersion && !job.inkBase) {
        // A sketch that already cost a request is checked again, never redrawn.
        if (!job.pendingInk || !existsSync(job.pendingInk.path) || imageHash(job.pendingInk.path) !== job.pendingInk.hash || job.pendingInk.sourceHash !== job.sourceHash) {
          const bytes = await generate('ink'), path = join(directory, `ink-base-${job.requestCount}.png`); writeFileSync(path, bytes, { mode: 0o600 });
          job.pendingInk = { status: 'pending', path, hash: imageHash(path), sourceHash: job.sourceHash, pipelineVersion: job.pipelineVersion };
          saveJSON(join(directory, 'ink-pending.json'), job.pendingInk); persist();
        }
        const pending = job.pendingInk;
        pending.identityCheck = { version: 'parent-choice-v1', status: 'parent-review', evidence: 'The parent chooses whether this drawing looks right.' };
        const base = { path: pending.path, hash: pending.hash, sourceHash: job.sourceHash, pipelineVersion: job.pipelineVersion, ...(pending.identityCheck ? { identityCheck: pending.identityCheck } : {}) };
        saveJSON(join(directory, 'ink-base.json'), base); saveJSON(join(directory, 'ink-pending.json'), { ...pending, status: 'committed' }); job.inkBase = base; delete job.pendingInk; persist();
      }
      if (job.kind) {
        if (job.pipelineVersion === directRenderPipelineVersion && !source) throw fail('Use the same photo to finish these drawings.');
        const reference = job.pipelineVersion === directRenderPipelineVersion ? `data:image/png;base64,${source.toString('base64')}` : `data:image/png;base64,${readFileSync(job.inkBase.path).toString('base64')}`;
        const hidden = [];
        for (const target of targetsFor(job)) {
          const { slot } = target, saved = job.pendingRenders?.[slot];
          if (job.candidates.some(candidate => candidate.slot === slot)) continue;
          // A drawing that already cost a request is checked again, never redrawn.
          let render = saved && existsSync(saved.path) && imageHash(saved.path) === saved.hash && saved.sourceHash === job.sourceHash && saved.pictureStyleId === target.pictureStyleId && saved.pictureStyleVersion === target.pictureStyleVersion ? saved : null;
          if (!render) {
            const bytes = await generate(slot, target), path = join(directory, `render-${slot}-${job.requestCount}.png`); writeFileSync(path, bytes, { mode: 0o600 });
            render = { status: 'pending', slot, path, hash: imageHash(path), sourceHash: job.sourceHash, pictureStyleId: target.pictureStyleId, pictureStyleVersion: target.pictureStyleVersion, ...(job.inkBase ? { inkBaseHash: job.inkBase.hash } : {}) };
            (job.pendingRenders ??= {})[slot] = render; saveJSON(join(directory, `render-${slot}-pending.json`), render); persist();
          }
          const verdict = { status: 'parent-review', evidence: 'Generated from this person’s input. The parent chooses the drawing.' };
          const candidate = { id: randomUUID(), slot, path: render.path, hash: render.hash, pictureStyleId: target.pictureStyleId, pictureStyleVersion: target.pictureStyleVersion, jobKind: job.kind, renderCheck: { version: 'parent-choice-v1', status: verdict.status, evidence: verdict.evidence }, ...(render.inkBaseHash ? { inkBaseHash: render.inkBaseHash } : {}) };
          saveJSON(join(directory, `slot-${slot}.json`), candidate); job.candidates.push(candidate);
          saveJSON(join(directory, `render-${slot}-pending.json`), { ...render, status: 'committed', candidateId: candidate.id }); delete job.pendingRenders[slot]; persist();
        }
        if (hidden.length) throw Object.assign(Error('A drawing did not match.'), { code: 'portrait_render_mismatch', looks: hidden });
        job.status = 'complete'; job.completedAt ??= new Date().toISOString(); job.message = readyMessage(job); return;
      }
      if (job.inkBase) source?.fill(0);
      for (const target of targetsFor(job)) {
        const { slot } = target;
        if (job.candidates.some(candidate => candidate.slot === slot)) continue;
        const bytes = await generate(slot, target), id = randomUUID(), path = join(directory, `${id}.png`); writeFileSync(path, bytes, { mode: 0o600 });
        const candidate = { id, slot, path, hash: imageHash(path), pictureStyleId: target.pictureStyleId, pictureStyleVersion: target.pictureStyleVersion, ...(job.kind ? { jobKind: job.kind } : {}), ...(job.inkBase ? { inkBaseHash: job.inkBase.hash } : {}) };
        saveJSON(join(directory, `slot-${slot}.json`), candidate); job.candidates.push(candidate); persist();
      }
      job.status = 'complete'; job.completedAt ??= new Date().toISOString(); job.message = readyMessage(job);
    } catch (error) {
      job.status = job.inputMode === 'description' ? 'needs-input' : 'needs-photo';
      const credit = ['insufficient_quota', 'credit_balance_exhausted'].includes(error.response?.error?.code) || error.response?.error?.type === 'insufficient_quota';
      job.message = /Daily budget/.test(error.message) ? 'The daily drawing budget is used up. Your choices are saved. Return tomorrow with the same input.' : error.code === 'portrait_identity_mismatch' && !exhausted(job) ? 'The first sketch did not look like this person, so no colour drawings were made. Use the same input to try the one remaining sketch, or choose a clearer one.' : error.code === 'portrait_identity_unchecked' && !exhausted(job) ? 'The first sketch is saved but could not be checked yet. Use the same input to check it again.' : error.code === 'portrait_render_mismatch' && !exhausted(job) ? `The ${error.looks.join(' and ')} drawing did not look right for this person, so it is not shown. Use the same ${job.inputMode === 'description' ? 'description' : 'photo'} to try ${error.looks.length > 1 ? 'those looks' : 'that look'} again.` : error.code === 'portrait_render_mismatch' ? `The ${error.looks.join(' and ')} drawing did not look right for this person, so it is not shown. This drawing attempt is finished.` : error.code === 'portrait_render_unchecked' && !exhausted(job) ? 'A new drawing is saved but could not be checked yet. Use the same input to check it again.' : exhausted(job) ? 'This drawing attempt is finished. Your choices are saved. Start a fresh attempt for the missing choices.' : credit ? 'The picture service has no credit available. Your choices are saved. Try after credit is restored.' : 'The drawing stopped. Your finished work is saved. Use the same input to finish.';
    } finally { source?.fill(0); active.delete(account.id); persist(); }
  }
  async function start(account, id, data) {
    const childId = childIdFor(account, data.childId);
    const { record: savedRecord, person } = personFor(account, childId, id);
    const record = { ...savedRecord, pictureStyleId: data.pictureStyleId === undefined ? pictureStyleIdFor(savedRecord) : pictureStyleIdFor(data.pictureStyleId) };
    const inputMode = data.inputMode ?? 'photo';
    if (data.compareStyles !== undefined && typeof data.compareStyles !== 'boolean') throw fail('Choose whether to compare three looks.');
    if (data.compareStyles === true && (data.redraw === true || data.another === true)) throw fail('Compare three looks or redraw one look, not both.');
    if (!['photo', 'description'].includes(inputMode) || inputMode === 'photo' && Object.hasOwn(data, 'description') || inputMode === 'description' && Object.hasOwn(data, 'photo')) throw fail('Choose either a photo or an appearance description, not both.');
    const description = inputMode === 'description' ? normalizePortraitDescription(data.description) : undefined;
    assertAllowed(record, inputMode);
    if (active.has(account.id)) throw fail('Another drawing or kit is being made. Let it finish first.', 409);
    const source = inputMode === 'photo' ? await normalizePhoto(data.photo) : null;
    try {
      if (active.has(account.id)) throw fail('Another drawing or kit is being made. Let it finish first.', 409);
      // The record may have changed while the decoder was working.
      if (JSON.stringify(memoryFor(account, childId).exportRecord()) !== JSON.stringify(savedRecord)) throw fail('The family record changed. Open this person again.', 409);
      const sourceHash = inputMode === 'photo' ? sha(source) : sha('description:' + description);
      // A new family that has not chosen its look sees this first person in each
      // offered look. Once a family has its look, every new drawing is one
      // drawing in it, also for families set up before October 16. Older
      // three-choice jobs stay readable but never start again.
      const look = lookFor(account), kind = look.pending || data.compareStyles === true ? 'style-comparison' : 'selected-style';
      if (look.pending) {
        const open = openComparison(account);
        if (open && (open.childId !== childId || open.personId !== id)) throw fail('Choose your family’s look from the first person’s drawings before drawing anyone else.', 409);
      }
      const style = pictureStyleFor(record), targets = kind === 'style-comparison' ? comparisonTargets() : [{ slot: 0, pictureStyleId: style.id, pictureStyleVersion: style.version }];
      const pipelineVersion = inputMode === 'photo' ? directRenderPipelineVersion : inkPortraitPipelineVersion;
      const fingerprint = personalLookFingerprint(record, person, { kind, inputMode, targets });
      const belongs = job => job.accountId === account.id && job.childId === childId && job.personId === id && job.kind === kind && job.personFingerprint === fingerprint && (job.inputMode ?? 'photo') === inputMode;
      let job = db.portraits.findLast(belongs);
      if (data.restartJobId !== undefined && (!job || data.restartJobId !== job.id || !exhausted(job))) throw fail('Choose the fresh-attempt button for this person’s current saved work.', 409);
      // An older finished batch is reused only when the parent chose one of its
      // drawings. Unchosen older batches were never identity checked.
      const completed = db.portraits.findLast(job => belongs(job) && job.sourceHash === sourceHash && job.status === 'complete' && (currentPolicy(job) || chosenFrom(job, person)));
      // "Try another drawing": one more drawing in the family look for the same
      // input, only when the parent asks, inside the job's six-request cap.
      let extra = null;
      if (data.another === true) {
        if (data.restartJobId !== undefined || !completed || data.anotherJobId !== completed.id || !canDrawAnother(completed)) throw fail('Use the same photo or description to try another drawing.', 409);
        job = completed; extra = { ...completed.targets[0], slot: completed.targets.length };
      } else if (completed && data.redraw !== true) {
        db.portraits = db.portraits.filter(item => item !== completed); db.portraits.push(completed); persist();
        return list(account, childId, data.pictureStyleId);
      }
      // A chosen drawing from an older three-choice batch or from the first
      // person's comparison is already in the family look; the same input
      // again hands it back instead of buying a new one.
      const chosen = data.redraw !== true && kind === 'selected-style' && !extra && db.portraits.findLast(job => job.accountId === account.id && job.childId === childId && job.personId === id && job.kind !== 'selected-style' && (job.inputMode ?? 'photo') === inputMode && job.sourceHash === sourceHash && chosenFrom(job, person) && job.personFingerprint === keyFor(record, person, job));
      if (chosen) {
        db.portraits = db.portraits.filter(item => item !== chosen); db.portraits.push(chosen); persist();
        return list(account, childId, data.pictureStyleId);
      }
      if (data.redraw === true) {
        if (kind !== 'selected-style' || data.another === true || data.restartJobId !== undefined) throw fail('Redraw one person in one chosen look.', 409);
        if (job && job.status !== 'complete') throw fail('Finish this person’s saved drawing first.', 409);
        job = null;
      }
      const prior = data.restartJobId !== undefined ? job : null;
      if (prior) job = null;
      if (job?.status === 'complete' && !extra) {
        job = null;
      }
      // Older unfinished work keeps its files and charges but never seeds new drawings.
      if (job && !currentPolicy(job) && !chosenFrom(job, person)) job = null;
      const carry = prior?.sourceHash === sourceHash && currentPolicy(prior);
      if (job && job.sourceHash !== sourceHash) throw fail('Use the same input to finish these saved choices.');
      if (exhausted(job)) throw fail('Use Start a fresh attempt to finish the missing choices. Your saved drawings stay safe.', 409);
      const draftJob = job ?? { kind, targets, inputMode, description, pipelineVersion, referencePolicy: portraitReferencePolicy, ...(carry && prior.inkBase ? { inkBase: prior.inkBase } : {}) };
      const body = stageBody(record, person, draftJob, source, extra ?? missingTargets({ ...draftJob, candidates: draftJob.candidates ?? [] })[0]);
      const request = { path: body.image ? '/v1/images/edits' : '/v1/images/generations', body };
      if (!settings.subscriptionMode) {
        const status = budget.status(), ceiling = wireCeiling(request, readJSON(new URL('../content/prices.json', import.meta.url)));
        if (status.uncertain || status.limit - status.spent - status.reserved < ceiling) throw fail('The daily drawing budget is used up. Your saved choices are safe. Return tomorrow.', 429);
      }
      if (extra) job.targets.push(extra);
      if (!job) {
        job = { id: randomUUID(), accountId: account.id, childId, personId: id, ...(kind ? { kind, targets: structuredClone(carry ? prior.targets : targets) } : {}), inputMode, ...(description ? { description } : {}), referencePolicy: portraitReferencePolicy, ...(pipelineVersion === inkPortraitPipelineVersion ? { pipelineVersion, baseAttempts: 0, inkChecks: 0, ...(carry && prior.inkBase ? { inkBase: structuredClone(prior.inkBase) } : {}) } : pipelineVersion ? { pipelineVersion } : {}), personFingerprint: fingerprint,
          // A comparison has no single look; each target and drawing carries its own.
          pictureStyleId: kind === 'style-comparison' ? null : style.id, pictureStyleVersion: kind === 'style-comparison' ? null : style.version, sourceHash, candidates: carry ? structuredClone(prior.candidates) : [], attempts: [], requestCount: 0, createdAt: new Date().toISOString(), ...(prior ? { restartedFrom: prior.id } : {}) };
        db.portraits.push(job);
      }
      job.status = 'running'; job.message = job.kind === 'style-comparison' ? 'Drawing three looks. You can leave this page.' : job.kind === 'selected-style' ? extra ? 'Making another drawing. You can leave this page.' : 'Making their drawing. You can leave this page.' : 'Making three drawings. You can leave this page.';
      active.set(account.id, job.id); persist();
      const retained = source ? Buffer.from(source) : null;
      Promise.resolve().then(() => run(account, job, retained, record, person));
      return list(account, childId, data.pictureStyleId);
    } finally { source?.fill(0); }
  }
  const ownedJob = (account, childId, id, jobId, record, person) => db.portraits.find(job => job.id === jobId && job.accountId === account.id && job.childId === childId && job.personId === id && job.personFingerprint === keyFor(record, person, job));
  const intact = candidate => { try { return Boolean(candidate) && checkedImageHash(candidate.path) === candidate.hash; } catch { return false; } };
  function applyCandidate(account, childId, personId, job, candidate) {
    const record = memoryFor(account, childId).exportRecord();
    beforeReferenceChange(account);
    const styleId = candidate.pictureStyleId ?? job.pictureStyleId;
    db.portraitSelections.push({ accountId: account.id, childId, personId, pictureStyleId: styleId, jobId: job.id, candidateId: candidate.id });
    if (styleId === pictureStyleIdFor(record)) {
      const cast = lockedCast(record).map(person => person.id === personId ? { ...person, ...referenceFields(job, candidate) } : person);
      memoryFor(account, childId).setCast(cast);
    }
    persist();
  }
  // Choosing a comparison drawing chooses the family look and that drawing in
  // one server step. Everything is checked before anything is written.
  function chooseLook(account, { childId, id, job, candidate, revision }) {
    const look = lookFor(account);
    if (!look.pending) {
      if (look.chosenCandidateId === candidate.id) return;
      throw fail('Your family look is already chosen. Saved drawings keep it.', 409);
    }
    if (revision !== look.revision) throw fail('Your family look changed in another tab. Open Story people again.', 409);
    const target = job.targets.find(item => item.slot === candidate.slot);
    if (job.status === 'running' || !target || target.pictureStyleId !== candidate.pictureStyleId || target.pictureStyleVersion !== candidate.pictureStyleVersion) throw fail('Wait for the looks to finish drawing, then choose.', 409);
    if (!job.candidates.every(intact)) throw fail('A saved drawing changed. Make new drawings.', 409);
    if (!pictureStyleOptions.some(style => style.id === candidate.pictureStyleId) || pictureStyleFor(candidate.pictureStyleId).version !== candidate.pictureStyleVersion) throw fail('This look was updated after these drawings were made. Make new drawings.', 409);
    commitLook(account, { childId, personId: id, jobId: job.id, candidateId: candidate.id, pictureStyleId: candidate.pictureStyleId, pictureStyleVersion: candidate.pictureStyleVersion, revision: look.revision + 1 });
  }
  // Called by the account owner after it saved the intent; also on restart.
  function applyChoice(account, intent) {
    const job = db.portraits.find(item => item.id === intent.jobId && item.accountId === account.id && item.kind === 'style-comparison' && item.childId === intent.childId && item.personId === intent.personId);
    const candidate = job?.candidates.find(item => item.id === intent.candidateId && item.pictureStyleId === intent.pictureStyleId && item.pictureStyleVersion === intent.pictureStyleVersion);
    if (!intact(candidate)) throw fail('The chosen drawing is missing or changed.', 409);
    applyCandidate(account, intent.childId, intent.personId, job, candidate);
  }
  function select(account, id, data) {
    const childId = childIdFor(account, data.childId);
    if (active.has(account.id)) throw fail('Let the current drawings finish before choosing.', 409);
    const { record: savedRecord, person } = personFor(account, childId, id);
    const record = { ...savedRecord, pictureStyleId: data.pictureStyleId === undefined ? pictureStyleIdFor(savedRecord) : pictureStyleIdFor(data.pictureStyleId) };
    const job = ownedJob(account, childId, id, data.jobId, record, person);
    const candidate = job?.candidates.find(candidate => candidate.id === data.candidateId);
    if (!intact(candidate)) throw fail('Choose one of this person’s saved drawings.', 404);
    if (job.kind === 'style-comparison' && (lookFor(account).pending || data.pictureStyleId === undefined && lookFor(account).chosenCandidateId === candidate.id)) chooseLook(account, { childId, id, job, candidate, revision: data.lookRevision });
    else {
      if (lookFor(account).pending) throw fail('Choose your family’s look first.', 409);
      if (job.kind === 'style-comparison' && data.pictureStyleId === undefined) throw fail('Your family look is already chosen. Choose the look for this drawing.', 409);
      if ((job.kind === 'selected-style' || data.pictureStyleId !== undefined) && (candidate.pictureStyleId ?? job.pictureStyleId) !== pictureStyleIdFor(record)) throw fail('This drawing is in a different look from your family look.', 409);
      applyCandidate(account, childId, id, job, candidate);
    }
    return list(account, childId, data.pictureStyleId);
  }
  function assetFile(account, jobId, candidateId) {
    const job = db.portraits.find(job => job.id === jobId && job.accountId === account.id);
    const candidate = job?.candidates.find(candidate => candidate.id === candidateId);
    const isCurrent = () => db.portraits.includes(job) && job.accountId === account.id && job.candidates.includes(candidate) && intact(candidate);
    if (!candidate || !isCurrent()) throw fail('Drawing not found.', 404);
    return { path: candidate.path, isCurrent };
  }
  function asset(account, jobId, candidateId) { return readFileSync(assetFile(account, jobId, candidateId).path); }

  return { list, start, saveDraft, pruneDrafts, select, applyChoice, asset, assetFile, assertAllowed, recordInStyle, previews };
}
