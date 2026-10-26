import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { lockedCast, publicCast, castEvaluationVersion, learningActor } from './cast.js';
import { assertNoFamilyText, privacyFor } from './requests.js';
import { rememberCodeDigits, pictureSegments } from './picture-code-digits.js';
import { readJSON, saveJSON, extractJSON } from './files.js';
import { openaiText } from './check-picture.js';
import { pictureStyleFor, pictureStyleReferenceFor, comicFaceRuleFor, comicFaceCheckNote, pictureMonochrome } from './graphic-style.js';
import { inkOutfitRule } from './checker-contract.js';
import { legacyPictureStyleId } from '../app/picture-styles.js';
import { templateGuidePNG } from './poster-template.js';

export const readingArtVersion = 'family-comic-cells-guide-v2';
export const readingArtLayoutVersion = 'normalize-layout-v1';
export const readingArtStyleFor = record => pictureStyleFor(record).rule + (comicFaceRuleFor(record) ? ' ' + comicFaceRuleFor(record) : '') + ' Match the chosen reference faces and locked outfits exactly. Preserve maximum likeness in the family-selected rendering style.';
const guideDirection = 'The LAST reference image is ONLY a geometry guide, not a person or an art-style example. Its six outlined rectangles mark safe drawing areas INSIDE the six cells. Keep every head, hair, hand, sleeve and the complete lower end of each waist-up vignette inside its own safe rectangle. At 1536 by 1024, every 512 by 512 cell has 40 pixels of empty padding on ALL FOUR SIDES, including below the torso. Leave the full row gap empty. A vignette must end inside the rectangle, never continue to a tile edge or the image bottom. The right column stays entirely empty when no person is assigned. Do NOT draw the guide outlines, grid, labels or any text in the final sheet.';
const drawingDirection = 'Draw ONE reusable private family character sheet. Exactly 3 columns by 2 rows of equal square cells on a plain cream background, no drawn grid or labels. Each occupied cell contains just its assigned person as a large waist-up vignette with the full head, hair and hands inside its cell, with clear padding on every edge. Left column is the child, centre is the first grown-up, right is the second grown-up or completely EMPTY when absent. Top row: relaxed attentive expression. Bottom row: gentle encouraging smile. Grown-ups listen calmly. Hands relaxed, no skill-specific pose, props, action instructions or story. Faces remain the same between rows. No lettering, numbers, signs, words, bubbles, logos or clothing text anywhere. Do not copy the reference sheet layout or draw extra portraits. Each reference identifies only its assigned person.';
const checkerDirection = 'Independently inspect the FIRST image as a 3 column by 2 row character sheet; the next images are identity references, not sheet cells. The LAST image is a geometry-only safe-area guide, never another person or the target artwork. If styleReferenceImageIndex is supplied, that one-based image is ONLY a rendering-style example, not a cast member. Never copy its identity or count its people as sheet cells. Return JSON with styleId:string,matchesSelectedStyle:boolean,photographicTexture:boolean,flatInkStyle:boolean,styleEvidence:string,gridCorrect:boolean,uncertain:boolean,words:[every visible string],cells:[exactly six {column,row,personId,peopleCount,identityMatches,outfitMatches,fullyInsideCell,neutralPose,certainty,evidence}]. Positions are zero based. Check each expected cell separately, including EMPTY cells with personId:null and peopleCount:0. Occupied cells must have exactly one correct human, matching their OWN reference face, hair, build and outfit. Expressions may differ, identity must not. Compare each outfit against its own locked list. Judge only visible garments; hidden lower-body clothes are not contradictions. All people must match the supplied selectedStyle.id and selectedStyle.rule. Judge that actual chosen profile, not one universal flat-art rule. Playful comic is expressive two-dimensional storybook comic; animated film is visibly dimensional soft animation; detailed comic permits fine facial and surface detail. Report flatInkStyle and photographicTexture honestly as observations. They pass or fail according to selectedStyle.requireFlatInk and selectedStyle.forbidPhotographicTexture, never by an unrelated profile. FullyInsideCell means every visible head, hair, hand, sleeve and the complete lower end of the waist-up body lies INSIDE the supplied safeRect for that cell, with the required clear padding on all four sides. A waist-up ending is fine inside the safeRect, never on a tile boundary. The guide outlines must not appear in the final sheet. No words, signs, text or extra faces. Pose must be neutral and reusable, never a specific teaching action. For empty cells mark identityMatches,outfitMatches,fullyInsideCell,neutralPose true only when genuinely empty. Give direct visual evidence per cell, and certainty:"confirmed" only when all its observations are clear; otherwise "uncertain". Set uncertain:true if anything cannot be verified. Do not approve by assumption. The source reference rendering may differ; preserve likeness while checking the selected family style. ' + comicFaceCheckNote;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => hash(JSON.stringify(value));
const inside = (parent, path) => { const rel = relative(parent, path); return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel); };
const locks = new Map();
const omitted = (reason, extra = {}) => ({ version: readingArtVersion, ready: false, verified: false, status: 'omitted', reason, ...extra });
const cellsFor = (people, width, height) => Array.from({ length: 6 }, (_, index) => {
  const column = index % 3, row = Math.floor(index / 3), person = people[column];
  const padding = width / 3 * 40 / 512;
  return { personId: person?.id ?? null, role: person?.role ?? null, column, row, rect: { x: column * width / 3, y: row * height / 2, width: width / 3, height: height / 2 }, safeRect: { x: column * width / 3 + padding, y: row * height / 2 + padding, width: width / 3 - padding * 2, height: height / 2 - padding * 2 } };
});

const correctionRules = {
  matchesSelectedStyle: 'Follow the supplied family-selected style consistently across every person, while preserving maximum likeness. Do not substitute a different family look.',
  photographicTexture: 'Remove photographic surface texture forbidden by this selected family style; preserve recognizable facial features.',
  flatInkStyle: 'Remove modeled skin shading, individual photographic hair or beard texture, and textured fabric. Preserve face features with simple clean ink and flat cel-colour shapes.',
  gridCorrect: 'Respect the supplied six-cell geometry and keep the entire unassigned column blank. No part of one person may enter another cell.',
  words: 'Remove all lettering and symbols that read as text. The sheet is wordless.',
  personId: "Put only the assigned person in this cell; use that person's own reference.",
  peopleCount: 'Draw exactly one person in an occupied cell, and nothing at all in an empty cell.',
  identityMatches: "Match this assigned person's own reference face, hair and build without copying photographic texture.",
  outfitMatches: "Use this assigned person's locked outfit, not another character's clothes.",
  fullyInsideCell: 'Keep the full visible silhouette, including sleeves, hands and the lower torso ending, inside the safe rectangle with clear padding below and at both sides.',
  neutralPose: 'Use a relaxed neutral pose without a teaching action.',
};
export function confirmedReadingArtFaults(answer, expectedCells, { styleProfile } = {}) {
  if (!answer || answer.uncertain !== false) return [];
  const faults = [];
  if (styleProfile && answer.matchesSelectedStyle === false && typeof answer.styleEvidence === 'string' && answer.styleEvidence.trim()) faults.push({ code: 'matchesSelectedStyle' });
  if (styleProfile?.forbidPhotographicTexture && answer.photographicTexture === true) faults.push({ code: 'photographicTexture' });
  if ((!styleProfile || styleProfile.requireFlatInk) && answer.flatInkStyle === false && typeof answer.styleEvidence === 'string' && answer.styleEvidence.trim()) faults.push({ code: 'flatInkStyle' });
  if (answer.gridCorrect === false && answer.cells?.length === 6 && answer.cells.every(cell => cell.certainty === 'confirmed')) faults.push({ code: 'gridCorrect' });
  if (Array.isArray(answer.words) && answer.words.some(word => typeof word === 'string' && word.trim())) faults.push({ code: 'words' });
  for (const cell of expectedCells) {
    const rows = Array.isArray(answer.cells) ? answer.cells.filter(row => row?.column === cell.column && row?.row === cell.row) : [];
    if (rows.length !== 1 || rows[0].certainty !== 'confirmed' || typeof rows[0].evidence !== 'string' || !rows[0].evidence.trim()) continue;
    const row = rows[0], failed = ['identityMatches', 'outfitMatches', 'fullyInsideCell', 'neutralPose'].filter(key => row[key] === false);
    if (row.personId !== cell.personId) failed.push('personId');
    if (row.peopleCount !== (cell.personId ? 1 : 0)) failed.push('peopleCount');
    for (const code of failed) faults.push({ code, column: cell.column, row: cell.row });
  }
  return faults;
}
function feedbackDirections(faults) {
  return [...new Set(faults.map(fault => {
    if (!Object.hasOwn(correctionRules, fault.code) || fault.column !== undefined && (!Number.isInteger(fault.column) || fault.column < 0 || fault.column > 2 || !Number.isInteger(fault.row) || fault.row < 0 || fault.row > 1)) throw Error('Invalid confirmed reading-art feedback.');
    const location = fault.column === undefined ? 'whole sheet' : `column ${fault.column}, row ${fault.row}`;
    return `Confirmed prior check, ${location}: ${correctionRules[fault.code]}`;
  }))];
}

function checked(body, record, constants = [], inputCode = {}) {
  const machine = Object.fromEntries(['model', 'quality', 'size', 'n', 'store', 'max_output_tokens', 'reasoning', 'text'].filter(key => key in body).map(key => [key, body[key]]));
  rememberCodeDigits(body, [...pictureSegments(machine), ...constants.map(text => ({ field: body.prompt ? 'request.prompt' : 'request.instructions', text })), ...pictureSegments(inputCode, 'request.input[0].content[0].text')]);
  assertNoFamilyText(body, privacyFor(record, '')); return body;
}
export function readingArtGuidePNG() {
  const rects = Object.fromEntries(cellsFor([], 1536, 1024).map(cell => { const r = cell.safeRect; return [`cell.${cell.column}.${cell.row}`, { x: r.x, y: r.y, w: r.width, h: r.height }]; }));
  return templateGuidePNG(undefined, { canvas: { width: 1536, height: 1024 }, rects, transform: { scale: 1, x: 0, y: 0 } });
}
export function buildReadingArtRequest(record, people, references, models, { faults = [] } = {}) {
  // Only the family's chosen drawings and the geometry guide are images here;
  // the public style example shows other people (see styleExampleUse).
  const corrections = feedbackDirections(faults), style = readingArtStyleFor(record);
  return checked({ model: models.poster, quality: 'high', size: '1536x1024', n: 1, image: [...references.map(reference => reference.data), `data:image/png;base64,${readingArtGuidePNG().toString('base64')}`],
    prompt: [style, drawingDirection, guideDirection, ...corrections, 'Anonymous column assignments and locked clothes: ' + JSON.stringify(people), ...people.map((person, index) => `Reference image ${index + 1} identifies ${person.id}.`)].join('\n') }, record,
  [style, drawingDirection, guideDirection, ...corrections, ...people.map((person, index) => `Reference image ${index + 1} identifies ${person.id}.`)]);
}
export function buildReadingArtCheckRequest(record, people, references, bytes, dimensions, models, { sourceBytes, derivation } = {}) {
  const styleReference = pictureStyleReferenceFor(record);
  const code = { ...(styleReference ? { styleReferenceImageIndex: references.length + 2 } : {}), width: dimensions.width, height: dimensions.height, expectedCells: cellsFor(people, dimensions.width, dimensions.height) };
  const selectedStyle = pictureStyleFor(record), style = readingArtStyleFor(record);
  const payload = { ...code, selectedStyle, ...(derivation ? { derivation } : {}), cast: people, referenceOrder: people.map(person => person.id), style, ...(pictureMonochrome(record) ? { outfitRule: inkOutfitRule } : {}) };
  const body = { model: models.pictureCheck, store: false, reasoning: { effort: 'medium' }, max_output_tokens: 6000, text: { format: { type: 'json_object' } }, instructions: checkerDirection + (derivation ? ' ' + derivedCheckDirection : ''),
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(payload) }, { type: 'input_image', image_url: `data:image/png;base64,${bytes.toString('base64')}`, detail: 'high' }, ...references.map(reference => ({ type: 'input_image', image_url: reference.data, detail: 'high' })), ...(styleReference ? [{ type: 'input_image', image_url: styleReference.data, detail: 'high' }] : []), ...(sourceBytes ? [{ type: 'input_image', image_url: `data:image/png;base64,${sourceBytes.toString('base64')}`, detail: 'high' }] : []), { type: 'input_image', image_url: `data:image/png;base64,${readingArtGuidePNG().toString('base64')}`, detail: 'high' }] }] };
  return checked(body, record, [checkerDirection, ...(derivation ? [derivedCheckDirection] : [])], { ...code, selectedStyle, ...(derivation ? { derivation } : {}), style });
}
function selectedStylePassed(answer, { styleProfile, legacyContract } = {}) {
  if (!answer || typeof answer.flatInkStyle !== 'boolean' || typeof answer.styleEvidence !== 'string' || !answer.styleEvidence.trim()) return false;
  if (styleProfile) return answer.styleId === styleProfile.id && answer.matchesSelectedStyle === true && typeof answer.photographicTexture === 'boolean' && (!styleProfile.requireFlatInk || answer.flatInkStyle === true) && (!styleProfile.forbidPhotographicTexture || answer.photographicTexture === false);
  return legacyContract?.version === 'family-comic-cells-guide-v2' && legacyContract.graphicStyleVersion === 'flat-ink-graphic-novel-v1' && !legacyContract.pictureStyleId && answer.flatInkStyle === true;
}
export function parseReadingArtCheck(answer, expectedCells, styleOptions = {}) {
  const evidence = value => typeof value === 'string' && value.trim().length > 0;
  if (!selectedStylePassed(answer, styleOptions) || !evidence(answer.styleEvidence) || answer.gridCorrect !== true || answer.uncertain !== false || !Array.isArray(answer.words) || answer.words.length !== 0 || !Array.isArray(answer.cells) || answer.cells.length !== 6) return false;
  return expectedCells.every(cell => {
    const matches = answer.cells.filter(row => row?.column === cell.column && row?.row === cell.row);
    const row = matches[0];
    return matches.length === 1 && row.personId === cell.personId && row.peopleCount === (cell.personId ? 1 : 0) && row.certainty === 'confirmed' && evidence(row.evidence)
      && ['identityMatches', 'outfitMatches', 'fullyInsideCell', 'neutralPose'].every(key => row[key] === true);
  });
}
const derivedCheckDirection = 'This is a placement-only derived image. The SECOND-LAST image is its ORIGINAL raw source sheet; the LAST remains the geometry guide. Return the additional boolean sourceContentIntact. Inspect the original source as well as the derived image: every original occupied tile must already contain exactly its assigned person, and every unassigned tile must already be empty with no words or extra people hidden by blanking. All original heads, hair and hands must be intact inside their original whole tile. Padding does not repair a cut-off head, hair or hand. A deliberate waist-up bottom ending is allowed, but must now sit inside the padded safe area. Set sourceContentIntact:true only when the complete visible figure was preserved by uniform scaling and translation, with no erased, repaired, repainted or clipped features. If source integrity is uncertain or false, do not approve. Continue all original style, likeness, outfit, word, pose and exact-cell checks on the derived image.';
export function readingArtGeometryOnly(answer, cells, styleOptions = {}) {
  if (!selectedStylePassed(answer, styleOptions) || answer.uncertain !== false || !Array.isArray(answer.words) || answer.words.length || !Array.isArray(answer.cells) || answer.cells.length !== 6) return false;
  if (parseReadingArtCheck(answer, cells, styleOptions)) return false;
  return cells.every(cell => {
    const found = answer.cells.filter(row => row?.column === cell.column && row?.row === cell.row), row = found[0];
    return found.length === 1 && row.personId === cell.personId && row.peopleCount === (cell.personId ? 1 : 0) && row.certainty === 'confirmed' && typeof row.evidence === 'string' && row.evidence.trim()
      && ['identityMatches', 'outfitMatches', 'neutralPose'].every(key => row[key] === true) && typeof row.fullyInsideCell === 'boolean';
  }) && typeof answer.gridCorrect === 'boolean';
}
export async function normalizeReadingArtLayout(sourceBytes, cells) {
  const dimensions = await png(sourceBytes), transforms = [], layers = [];
  for (const cell of cells) {
    if (!cell.personId) continue;
    const r = cell.rect;
    if (![r.x, r.y, r.width, r.height].every(Number.isSafeInteger) || r.width !== r.height || r.x < 0 || r.y < 0 || r.x + r.width > dimensions.width || r.y + r.height > dimensions.height) throw Error('Whole source tiles are required for reading-art placement.');
    const size = Math.floor(r.width * 392 / 512), padding = Math.floor((r.width - size) / 2), scale = size / r.width;
    const target = { x: r.x + padding, y: r.y + padding, width: size, height: size };
    const safe = cell.safeRect;
    if (!safe || target.x < safe.x || target.y < safe.y || target.x + size > safe.x + safe.width || target.y + size > safe.y + safe.height) throw Error('Derived placement must remain inside its safe rectangle.');
    const input = await sharp(sourceBytes).extract({ left: r.x, top: r.y, width: r.width, height: r.height }).resize(size, size, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
    layers.push({ input, left: target.x, top: target.y });
    transforms.push({ personId: cell.personId, column: cell.column, row: cell.row, sourceRect: r, targetRect: target, scaleX: scale, scaleY: scale, translateX: target.x - r.x * scale, translateY: target.y - r.y * scale });
  }
  const bytes = await sharp({ create: { ...dimensions, channels: 3, background: { r: 255, g: 249, b: 237 } } }).composite(layers).png().toBuffer();
  return { bytes, receipt: { version: readingArtLayoutVersion, sourceHash: hash(sourceBytes), sha256: hash(bytes), ...dimensions, transforms, operation: 'Whole occupied tiles uniformly scaled and placed on a blank cream sheet. No artwork repainted or repaired.' } };
}

async function png(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 16 * 1024 * 1024) throw Error('Drawing bytes are invalid.');
  const image = sharp(bytes, { limitInputPixels: 24_000_000, failOn: 'warning' }), meta = await image.metadata();
  if (meta.format !== 'png' || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height) throw Error('A single readable PNG is required.');
  await image.raw().toBuffer();
  return { width: meta.width, height: meta.height };
}
async function prepare(transport, record, { directory, cacheDirectory, kit } = {}) {
  let state, save, cacheKey;
  const receipt = result => { saveJSON(join(directory, 'reading-art.json'), result); transport.recordLocalResult?.('reading-art-result', result, result.ready ? 'Reusable family art, ready for parent review.' : 'Optional family art omitted: ' + result.reason); return result; };
  try {
    if (!directory || !cacheDirectory || !isAbsolute(directory) || !isAbsolute(cacheDirectory)) throw Error('A private family cache and output directory are required.');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 });
    const familyRoot = realpathSync(dirname(cacheDirectory));
    if (!inside(familyRoot, realpathSync(cacheDirectory)) || !inside(familyRoot, realpathSync(directory))) throw Error('Reading art must stay inside its family directory.');
    const cast = lockedCast(record), actor = learningActor(record);
    const selected = [cast.find(person => person.id === actor.id), ...cast.filter(person => person.id !== actor.id)].slice(0, 3);
    if (selected.some(person => !['photo', 'description'].includes(person.referenceSource) || !person.portraitCandidateId || !person.referencePath || !person.referenceHash)) return receipt(omitted('Chosen person drawings are not available.'));
    const styleProfile = pictureStyleFor(record), styleOptions = { styleProfile };
    const references = [];
    for (const person of selected) {
      if ((person.referenceStyleId ?? legacyPictureStyleId) !== styleProfile.id || person.referenceStyleVersion && person.referenceStyleVersion !== styleProfile.version) throw Error('The selected person belongs to a different family look.');
      const path = realpathSync(person.referencePath);
      if (!inside(familyRoot, path)) throw Error('A selected reference is outside this family.');
      const bytes = readFileSync(path);
      if (hash(bytes) !== person.referenceHash) throw Error('Selected reference bytes changed.');
      await png(bytes);
      references.push({ hash: person.referenceHash, data: `data:image/png;base64,${bytes.toString('base64')}` });
    }
    const people = publicCast(record).filter(person => selected.some(item => item.id === person.id)).sort((a, b) => selected.findIndex(item => item.id === a.id) - selected.findIndex(item => item.id === b.id)).map(({ id, role, outfit }) => ({ id, role, outfit }));
    const models = readJSON(new URL('../content/prices.json', import.meta.url)).selected;
    const contract = { version: readingArtVersion, pictureStyleId: styleProfile.id, pictureStyleVersion: styleProfile.version, style: readingArtStyleFor(record), styleProfile, guideHash: hash(readingArtGuidePNG()), cells: cellsFor(people, 1536, 1024), people, references: references.map(reference => reference.hash), imageModel: models.poster, checkerModel: models.pictureCheck };
    cacheKey = digest(contract);
    const cache = join(cacheDirectory, cacheKey); mkdirSync(cache, { recursive: true, mode: 0o700 });
    const statePath = join(cache, 'state.json');
    state = existsSync(statePath) ? readJSON(statePath) : { version: readingArtVersion, cacheKey, contract, attempts: [] };
    if (state.version !== readingArtVersion || state.cacheKey !== cacheKey || digest(state.contract) !== cacheKey || !Array.isArray(state.attempts) || state.attempts.length > 3 || state.attempts.some((attempt, index) => attempt.number !== index + 1 || !Number.isSafeInteger(attempt.checkCalls) || attempt.checkCalls < 0 || attempt.checkCalls > 2)) throw Error('Saved reading art allowances are invalid.');
    save = () => saveJSON(statePath, state); save();
    const manifest = attempt => ({ castEvaluationVersion, version: readingArtVersion, pictureStyleId: styleProfile.id, pictureStyleVersion: styleProfile.version, ready: true, verified: false, status: 'parent-review', cacheKey, file: join(cache, `pack-${attempt.number}.png`), sha256: attempt.sha256, width: attempt.width, height: attempt.height, cells: cellsFor(people, attempt.width, attempt.height), checkerModel: null });
    // Checked bytes and the actual independent answer must still agree on reuse.
    for (const attempt of state.attempts) if (['checked', 'parent-review', 'needs-check'].includes(attempt.status) && attempt.sha256) {
      const bytes = readFileSync(join(cache, `pack-${attempt.number}.png`)), dimensions = await png(bytes);
      if (hash(bytes) !== attempt.sha256 || dimensions.width !== attempt.width || dimensions.height !== attempt.height) throw Error('Checked reading art changed. No replacement was bought.');
      return receipt(manifest(attempt));
    }
    state.derivations ??= [];
    if (!Array.isArray(state.derivations) || state.derivations.some(item => item.version !== readingArtLayoutVersion || !Number.isSafeInteger(item.checkCalls) || item.checkCalls < 0 || item.checkCalls > 2)) throw Error('Saved reading-art layout check allowances are invalid.');
    const derivedPath = item => join(cache, `derived-${item.sourceHash}-${readingArtLayoutVersion}.png`);
    const derivedManifest = item => ({ ...manifest(item), file: derivedPath(item), derivation: { version: item.version, sourceHash: item.sourceHash, sha256: item.sha256, transforms: item.transforms }, checkerModel: models.pictureCheck });
    const readSource = attempt => {
      const bytes = readFileSync(join(cache, `pack-${attempt.number}.png`));
      if (hash(bytes) !== attempt.sha256) throw Error('Original reading-art bytes changed.');
      return bytes;
    };
    const matchingDerivation = attempt => state.derivations.find(item => item.sourceHash === attempt.sha256 && item.version === readingArtLayoutVersion);
    const eligible = attempt => attempt.sha256 && (attempt.status === 'needs-check' && !attempt.answer && attempt.checkCalls === 0 || readingArtGeometryOnly(attempt.answer, cellsFor(people, attempt.width, attempt.height), styleOptions));
    for (const item of state.derivations) if (item.status === 'checked') {
      const attempt = state.attempts.find(attempt => attempt.sha256 === item.sourceHash);
      if (!attempt) throw Error('Derived reading art has no original source receipt.');
      readSource(attempt);
      const bytes = readFileSync(derivedPath(item)), dimensions = await png(bytes);
      if (hash(bytes) !== item.sha256 || dimensions.width !== item.width || dimensions.height !== item.height || item.checkerModel !== models.pictureCheck || item.answer?.sourceContentIntact !== true || !parseReadingArtCheck(item.answer, cellsFor(people, item.width, item.height), styleOptions)) throw Error('Checked derived reading art changed. No replacement was bought.');
      return receipt(derivedManifest(item));
    }
    buildReadingArtRequest(record, people, references, models);
    while (true) {
      let attempt = state.attempts.find(item => eligible(item) && matchingDerivation(item)?.status !== 'rejected');
      if (!attempt) {
        if (state.attempts.some(item => item.status === 'needs-check' && item.answer && !matchingDerivation(item))) return receipt(omitted('An earlier raw image check remains uncertain. No replacement drawing was bought.', { cacheKey }));
        if (state.attempts.length >= 3) return receipt(omitted('The three drawing attempts are spent.', { cacheKey, attempts: state.attempts.length }));
        const priorAnswers = [...state.attempts.filter(item => item.status === 'rejected'), ...state.derivations.filter(item => item.status === 'rejected')];
        const faults = priorAnswers.filter(item => item.answer).flatMap(item => confirmedReadingArtFaults(item.answer, cellsFor(people, item.width, item.height), styleOptions)).filter(fault => !['gridCorrect', 'fullyInsideCell'].includes(fault.code));
        const drawing = buildReadingArtRequest(record, people, references, models, { faults });
        attempt = { number: state.attempts.length + 1, status: 'drawing', checkCalls: 0, feedback: faults }; state.attempts.push(attempt); save();
        let response;
        try { response = await transport.call({ provider: 'openai', path: '/v1/images/edits', stage: 'reading-art', kit, retry: attempt.number - 1, body: drawing, familyRecord: record, privacy: privacyFor(record, '') }); }
        catch (error) { if (error.preflight === true) state.attempts.pop(); else attempt.status = 'unknown'; save(); throw error; }
        saveJSON(join(cache, `drawing-${attempt.number}-receipt.json`), { model: models.poster, usage: response.usage ?? null, imageCount: response.data?.length ?? 0, imagePayloadsStoredSeparately: true });
        try {
          if (response.data?.length !== 1 || typeof response.data[0].b64_json !== 'string') throw Error('One generated PNG was not returned.');
          const bytes = Buffer.from(response.data[0].b64_json, 'base64'), dimensions = await png(bytes);
          if (dimensions.width % 3 || dimensions.height % 2 || dimensions.width / 3 !== dimensions.height / 2) throw Error('The sheet must have three by two equal square cells.');
          writeFileSync(join(cache, `pack-${attempt.number}.png`), bytes, { mode: 0o600 });
          Object.assign(attempt, dimensions, { sha256: hash(bytes), status: 'parent-review' }); save();
          return receipt(manifest(attempt));
        } catch (error) { attempt.status = 'rejected'; attempt.reason = error.message; save(); transport.recordVerdict?.(response, error.message); continue; }
      }
      const sourceBytes = readSource(attempt);
      let item = matchingDerivation(attempt);
      if (!item) {
        const normalized = await normalizeReadingArtLayout(sourceBytes, cellsFor(people, attempt.width, attempt.height));
        item = { ...normalized.receipt, number: attempt.number, checkerModel: models.pictureCheck, sourceCheckHash: attempt.answer ? digest(attempt.answer) : null, eligibility: attempt.answer ? 'confirmed-geometry-only' : 'fresh-before-first-check', checkCalls: 0, status: 'needs-check' };
        writeFileSync(derivedPath(item), normalized.bytes, { mode: 0o600 });
        state.derivations.push(item); save();
        saveJSON(join(cache, `derived-${item.sourceHash}-${readingArtLayoutVersion}-placement.json`), normalized.receipt);
      }
      if (item.status === 'rejected') continue;
      if (item.checkCalls >= 2) return receipt(omitted('The derived drawing could not be verified after two checks.', { cacheKey, attempts: state.attempts.length }));
      const bytes = readFileSync(derivedPath(item));
      if (hash(bytes) !== item.sha256) throw Error('Derived reading-art bytes changed.');
      const derivation = { version: item.version, sourceHash: item.sourceHash, sha256: item.sha256, transforms: item.transforms };
      const body = buildReadingArtCheckRequest(record, people, references, bytes, item, models, { sourceBytes, derivation });
      item.checkCalls++; save();
      let response;
      try { response = await transport.call({ provider: 'openai', path: '/v1/responses', stage: 'reading-art-check', kit, retry: item.checkCalls - 1, body, familyRecord: record, privacy: privacyFor(record, '') }); }
      catch (error) { if (error.preflight === true) item.checkCalls--; save(); throw error; }
      saveJSON(join(cache, `derived-${item.sourceHash}-check-${item.checkCalls}.json`), response);
      try { item.answer = extractJSON(openaiText(response)); }
      catch { save(); return receipt(omitted('The image checker did not return a complete answer.', { cacheKey })); }
      const passed = item.answer.sourceContentIntact === true && parseReadingArtCheck(item.answer, cellsFor(people, item.width, item.height), styleOptions);
      const faults = confirmedReadingArtFaults(item.answer, cellsFor(people, item.width, item.height), styleOptions);
      const contentFaults = faults.filter(fault => !['gridCorrect', 'fullyInsideCell'].includes(fault.code));
      item.status = passed ? 'checked' : item.answer.uncertain === false && (contentFaults.length || item.answer.sourceContentIntact === false) ? 'rejected' : 'needs-check'; save();
      transport.recordVerdict?.(response, passed ? 'PASS' : 'Derived art did not pass source-integrity, style, identity, cell and lettering checks.');
      if (passed) return receipt(derivedManifest(item));
      if (item.status !== 'rejected') return receipt(omitted('Derived art remains uncertain or outside its safe area. No replacement drawing was bought.', { cacheKey }));
    }
  } catch (error) {
    const result = omitted(error.preflight === true ? 'Art paused before a request was sent.' : 'Art is unavailable or unverified. Saved attempts remain spent.', { ...(cacheKey ? { cacheKey } : {}), detail: error.message, ...(state ? { attempts: state.attempts.length } : {}) });
    if (save) { state.lastStop = { reason: error.message, preflight: error.preflight === true }; save(); }
    return receipt(result);
  }
}

export async function prepareReadingArt(transport, record, options = {}) {
  // The app already holds its account job lock. This also serializes direct
  // trusted helper calls sharing a private cache, so parallel kits cannot buy twice.
  const key = resolve(options.cacheDirectory ?? options.directory ?? '.');
  while (locks.has(key)) await locks.get(key);
  let release; const lock = new Promise(resolve => { release = resolve; }); locks.set(key, lock);
  try { return await prepare(transport, record, options); }
  finally { if (locks.get(key) === lock) locks.delete(key); release(); }
}
