import { assessCheck, reviewNote } from './stop-policy.js';
import { readJSON } from './files.js';
const readabilityCalibration = readJSON(new URL('../test/fixtures/readability-calibration.json', import.meta.url));
import { inspectAnswer } from './answer-shape.js';
import { geometryParserSchema } from './answer-schemas.js';
import { geometryBooleanKeys, faultShape, supportedFaults } from './checker-contract.js';
export { geometryBooleanKeys } from './checker-contract.js';
import { fitRectangles, boundsOf, transformRect, measurementProblems } from './geometry-fit.js';
export const geometryRuleVersion = 'writable-rows-canvas-scale-v2';
export const writingAreaMinimum = Object.freeze({ rows: 2, widthPoints: 72, rowHeightPoints: 12 });
// x, y, width and height are rounded to source units. Comparing x + width
// with another x adds three half-unit rounding errors, at most 1.5 units.
export const rectangleRoundingUnits = 3 * .5;
import { deflateSync } from 'node:zlib';
import { fitType } from './printed-type.js';
import { posterBoxes, backupPlanLineFor } from './format.js';

export function posterTypePlan(move, text, template = posterTemplate) {
  const boxes = posterBoxes(move, text), plan = {};
  for (const id of cardIds) {
    const box = boxes.find(box => box.id === ({ tinyTry: 'tiny', plan: 'move' }[id] ?? id));
    const slots = template.slots, heading = fitType(box.title, { width: slots[id].heading.w, height: slots[id].heading.h, maximum: 16, minimum: 12, family: 'Baloo2', lineHeight: 1.08 });
    const top = 12 + heading.height + 8, height = template.regions[id].h - top - 12;
    if (id === 'plan') {
      const backup = fitType(backupPlanLineFor(move), { width: slots[id].body.w, height: height - 24 - 8, maximum: 14, minimum: 12 });
      plan[id] = { heading, bodyTop: top, handwritingHeight: Math.max(24, height - backup.height - 8), backup };
    } else plan[id] = { heading, bodyTop: top, body: fitType(box.text, { width: slots[id].body.w, height, maximum: 14, minimum: 12 }) };
  }
  return { cards: plan, measured: false, note: 'Font advances give a layout starting point. The picture checker must measure the actual ink inside each card. Fixed words stay verbatim.' };
}

const rect = (x, y, w, h) => ({ x, y, w, h });
export const regionIds = ['tinyTry', 'science', 'source', 'plan', 'remember', 'hero', 'keyword', 'tagline'];
export const cardIds = ['tinyTry', 'science', 'plan', 'remember', 'source'];
const cards = {
  tinyTry: rect(36, 342, 172, 170), science: rect(220, 342, 172, 170), plan: rect(404, 342, 172, 170),
  remember: rect(36, 524, 172, 184), source: rect(220, 524, 172, 184),
};
const slots = Object.fromEntries(Object.entries(cards).map(([id, r]) => [id, {
  icon: rect(r.x + 12, r.y + 12, 20, 20), heading: rect(r.x + 40, r.y + 12, r.w - 52, 44),
  body: rect(r.x + 12, r.y + 64, r.w - 24, r.h - 76),
  ...(id === 'plan' ? { handwriting: rect(r.x + 12, r.y + 64, r.w - 24, 64), backup: rect(r.x + 12, r.y + 140, r.w - 24, 18) } : {}),
}]));
function freeze(value) { for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return Object.freeze(value); }
export const legacyPosterTemplate = freeze({
  version: 'letter-five-cards-v1', canvas: { width: 612, height: 792 }, safeMargin: 36, gutter: 12, padding: 12,
  type: { heading: 16, body: 14, minimum: 12 },
  regions: { ...cards, hero: rect(36, 150, 540, 180), keyword: rect(430, 552, 120, 120), tagline: rect(80, 104, 452, 34) },
  title: rect(36, 36, 540, 56), footer: rect(36, 720, 540, 36),
  slots,
});
// Sunny's October 15 photos: two wide rows, source across the bottom, a
// separate keyword and a larger scene. The old drawing contract stays readable.
const photoCards = {
  tinyTry: rect(36, 372, 264, 122), science: rect(312, 372, 264, 122),
  plan: rect(36, 506, 264, 110), remember: rect(312, 506, 264, 110),
  source: rect(36, 628, 540, 80),
};
const photoSlots = Object.fromEntries(Object.entries(photoCards).map(([id, r]) => [id, {
  icon: rect(r.x + 12, r.y + 12, 20, 20), heading: rect(r.x + 40, r.y + 12, r.w - 52, id === 'source' ? 20 : id === 'plan' ? 26 : 34),
  body: rect(r.x + 12, r.y + (id === 'source' ? 38 : 54), r.w - 24, r.h - (id === 'source' ? 50 : 66)),
  ...(id === 'plan' ? { handwriting: rect(r.x + 12, r.y + 42, r.w - 24, 24), backup: rect(r.x + 12, r.y + 76, r.w - 24, 22) } : {}),
}]));
export const posterTemplate = freeze({
  version: 'letter-photo-five-cards-v2', canvas: { width: 612, height: 792 }, safeMargin: 36, gutter: 12, padding: 12,
  type: { heading: 16, body: 14, minimum: 12 },
  regions: { ...photoCards, hero: rect(36, 116, 540, 204), keyword: rect(216, 332, 180, 28), tagline: rect(80, 76, 452, 28) },
  title: rect(36, 36, 540, 44), footer: rect(36, 720, 540, 36), slots: photoSlots,
});
// Owner decision, October 16: the same core parts on every poster, with the
// drawing model choosing the composition, art and palette. No target
// rectangles exist for this version; the checker measures the actual page.
// Saved kits keep the fixed-rectangle versions above and their own checks.
export const composedPosterTemplate = freeze({
  version: 'letter-composed-v3', composed: true, canvas: { width: 612, height: 792 }, safeMargin: 36,
  type: { heading: 16, body: 14, minimum: 12 }, footerType: { points: 14, lineHeight: 1.05, family: 'Baloo2' },
});
export const currentPosterTemplateVersion = composedPosterTemplate.version;
export function posterTemplateFor(version = posterTemplate.version) {
  const template = [composedPosterTemplate, posterTemplate, legacyPosterTemplate].find(template => template.version === version);
  if (!template) throw new Error(`Unknown poster template: ${version}`);
  return template;
}
// The image service's portrait canvas contains a Letter page at this exact transform.
export const drawingCanvas = freeze({ width: 1024, height: 1536 });
export function containTransform(canvas, container) {
  const scale = Math.min(container.width / canvas.width, container.height / canvas.height);
  return { scale, x: (container.width - canvas.width * scale) / 2, y: (container.height - canvas.height * scale) / 2 };
}
export const drawingTransform = containTransform(posterTemplate.canvas, drawingCanvas);
const wholeCanvasPrintScale = Math.min((posterTemplate.canvas.width - 2 * posterTemplate.safeMargin) / drawingCanvas.width, (posterTemplate.canvas.height - 2 * posterTemplate.safeMargin) / drawingCanvas.height);
export const minimumWritingPixels = Object.freeze({ width: Math.ceil(writingAreaMinimum.widthPoints / wholeCanvasPrintScale), height: Math.ceil(writingAreaMinimum.rowHeightPoints / wholeCanvasPrintScale) });
export function physicalPosterPlacement(canvas, observed = []) {
  // Current measurements are source pixels. Their printed size depends on the
  // image canvas, never on where a model estimated the card anchors.
  const legacy = canvas.unit === 'letter-points';
  const scale = legacy ? 1 : Math.min(540 / canvas.width, 720 / canvas.height);
  const offset = legacy ? { x: 0, y: 0 } : { x: (612 - canvas.width * scale) / 2, y: (792 - canvas.height * scale) / 2 };
  const bounds = legacy && observed.length ? boundsOf(observed) : transformRect({ x: 0, y: 0, w: canvas.width, h: canvas.height }, { scale, offset });
  return { scale, offset, bounds, margins: { left: bounds.x, right: 612 - bounds.x - bounds.w, top: bounds.y, bottom: 792 - bounds.y - bounds.h },
    method: legacy ? 'Legacy measurements already declared in physical Letter points.' : 'Whole source canvas contained uniformly in the 540 by 720 point print area; independent of measured anchors.' };
}
export const percentRect = (r, canvas = posterTemplate.canvas) => ({ left: 100 * r.x / canvas.width, top: 100 * r.y / canvas.height, width: 100 * r.w / canvas.width, height: 100 * r.h / canvas.height });
export const contains = (outer, inner, tolerance = 0) => inner && [inner.x, inner.y, inner.w, inner.h].every(Number.isFinite) && inner.w > 0 && inner.h > 0 && inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance && inner.x + inner.w <= outer.x + outer.w + tolerance && inner.y + inner.h <= outer.y + outer.h + tolerance;
export const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export function makePosterMap(version, imageSha256, geometry) {
  if (!version || !/^[a-f0-9]{64}$/.test(imageSha256)) throw new Error('A version and exact image checksum are required.');
  const template = posterTemplateFor(geometry ? geometry.templateVersion ?? legacyPosterTemplate.version : posterTemplate.version);
  // A composed page never falls back to old target boxes: unmeasured parts get no tap area.
  if (template.composed) { const regions = measuredRegions(geometry); return { version, templateVersion: template.version, imageSha256, canvas: { ...template.canvas }, regions, regionsMeasured: regionIds.every(id => regions[id]) }; }
  return { version, templateVersion: template.version, imageSha256, canvas: { ...template.canvas }, regions: geometry ? Object.fromEntries(regionIds.map(id => { const { x, y, w, h } = geometry.exported[id]; return [id, { x, y, w, h }]; })) : structuredClone(template.regions) };
}
const geometryRectsFixed = template => ({ title: template.title, tagline: template.regions.tagline, hero: template.regions.hero,
  ...Object.fromEntries(cardIds.map(id => [id, template.regions[id]])), keyword: template.regions.keyword, footer: template.footer,
  ...Object.fromEntries(cardIds.flatMap(id => [[`${id}.heading`, template.slots[id].heading], [`${id}.icon`, template.slots[id].icon], [`${id}.body`, template.slots[id].body]])),
  'plan.handwriting': template.slots.plan.handwriting, 'plan.backup': template.slots.plan.backup });
export function geometryRects(template = posterTemplate) {
  if (template.composed) throw new Error('A composed poster has no target rectangles. Measure the actual page.');
  return geometryRectsFixed(template);
}
// Every part the checker measures. A composed poster has the same parts and no
// target positions; its heading icons are optional decoration.
const sameParts = Object.keys(geometryRectsFixed(posterTemplate));
export const geometryIds = template => template.composed ? sameParts : Object.keys(geometryRectsFixed(template));
const optionalPart = (template, id) => Boolean(template.composed) && id.endsWith('.icon');
// Approved word box for each top-level part; the hero and the empty footer banner have none,
// so their measurements alone never prove them missing.
const composedWordsFor = id => ({ title: 'title', tagline: 'tagline', keyword: 'keyword', tinyTry: 'tiny', science: 'science', plan: 'move', remember: 'remember', source: 'source' })[id] ?? null;
// These roles are nested on purpose. Only disjoint sibling regions collide.
const parentOf = id => id.includes('.') ? id.split('.')[0] : null;
const nested = (a, b) => ([a, b].includes('title') && [a, b].includes('tagline')) || parentOf(a) === b || parentOf(b) === a ||
  ([a, b].includes('plan.body') && [a, b].some(id => ['plan.handwriting', 'plan.backup'].includes(id)));
const disjoint = (a, b) => !nested(a, b);
export const bodyTextBoxes = [...cardIds.map(id => `${id}.body`), 'plan.backup'];
const wordIdForCard = id => ({ tinyTry: 'tiny', plan: 'move' }[id] ?? id);
const letters = text => typeof text === 'string' && /[\p{L}\p{N}]/u.test(text);
const cardContains = (card, line) => contains({ x: card.x - card.w * .03, y: card.y - card.h * .03, w: card.w * 1.06, h: card.h * 1.06 }, line, 1e-8);
const overlapSize = (a, b) => ({ x: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), y: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) });
export function assessWritableRows(rows, placement, plan, canvas) {
  const result = { verified: false, rows: [], minimum: writingAreaMinimum, faults: [], measurementFaults: [], roundingPoints: rectangleRoundingUnits * placement.scale };
  const unknown = reason => { result.measurementFaults.push('Measure two writing rows as clear writable areas above their baselines, not underline ink: ' + reason); return result; };
  if (!Array.isArray(rows) || rows.length !== 2 || rows.map(row => row.blank).sort().join() !== 'action,notice') return unknown('one notice row and one action row are required. A legacy plan.handwriting rectangle does not prove either blank.');
  for (const row of rows) {
    if (row.measurementKind !== 'writable-area' || row.certainty !== 'confirmed' || !row.evidence?.trim()) return unknown(`${row.blank} is not a confirmed writable-area measurement.`);
    if (!contains({ x: 0, y: 0, w: canvas.width, h: canvas.height }, row, rectangleRoundingUnits) || !Number.isFinite(row.baselineY) || Math.abs(row.y + row.h - row.baselineY) > rectangleRoundingUnits) return unknown(`${row.blank} needs a real area ending at its own visible baseline.`);
    const area = transformRect(row, placement);
    result.rows.push({ ...area, baselineY: row.baselineY * placement.scale + placement.offset.y });
    if (!plan || !contains(transformRect(plan, placement), area, result.roundingPoints)) return unknown(`${row.blank} is not measured inside the plan card.`);
    // Collision rounding does not lower the existing writing-size minimum.
    if (area.w < writingAreaMinimum.widthPoints - 1e-8 || area.h < writingAreaMinimum.rowHeightPoints - 1e-8) result.faults.push(`insufficient_handwriting_space: ${row.blank} writable area is ${area.w.toFixed(2)} by ${area.h.toFixed(2)} points; each separate row needs at least 72 by 12 points. Evidence: ${row.evidence}`);
  }
  const [first, second] = result.rows;
  const sharedHeight = Math.max(0, Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y));
  if (sharedHeight > result.roundingPoints) result.faults.push(`insufficient_handwriting_space: notice and action blanks share a writing row by ${sharedHeight.toFixed(2)} points; draw two separate rows.`);
  result.verified = true;
  return result;
}
function inspectGeometryReceipt(receipt, { wordVerdicts = [], readback = [], subBoxesRechecked = false, expectedTemplateVersion, expectedCoordinateUnit, footerText } = {}) {
  const parsed = inspectAnswer(receipt, geometryParserSchema, 'geometry'), extraKeys = parsed.extraKeys;
  const broken = (reason, extra = {}) => ({ ready: false, faults: [], measurementFaults: [reason], needsRecheck: true, ignoredFaults: [], extraKeys, observations: [], ...extra });
  const textIssues = parsed.issues.filter(issue => issue.startsWith('geometry.textLines'));
  const shapeIssues = parsed.issues.filter(issue => !issue.startsWith('geometry.textLines'));
  if (shapeIssues.length) return broken(shapeIssues.join(' '));
  receipt = parsed.value;
  if (expectedCoordinateUnit && receipt.coordinateSpace?.unit !== expectedCoordinateUnit) return broken(`Fresh drawing checks require ${expectedCoordinateUnit} coordinates for the actual image, not legacy Letter-point measurements.`);
  if (expectedTemplateVersion && receipt.templateVersion !== expectedTemplateVersion) return broken(`geometry.templateVersion must equal ${expectedTemplateVersion}.`);
  let template;
  try { template = posterTemplateFor(receipt.templateVersion); } catch (error) { return broken(error.message); }
  let observed = receipt.observed.filter(r => r?.id !== 'joke');
  // A composed poster has the same parts and no target positions.
  const partIds = geometryIds(template), expected = template.composed ? null : geometryRects(template), faults = [], observations = [], measurementFaults = [];
  const seen = new Map();
  for (const [index, r] of observed.entries()) {
    if (!r || typeof r.id !== 'string') return broken(`geometry.observed[${index}].id is malformed.`);
    if (!partIds.includes(r.id) || seen.has(r.id)) { observations.push({ key: 'duplicate_or_extra_measurement', evidence: r.id, reportOnly: true }); continue; }
    seen.set(r.id, r);
  }
  observed = [...seen.values()];
  const missingSubBoxes = [];
  for (const id of partIds) if (!seen.has(id) && !optionalPart(template, id)) {
    // A composed page has no target to fall back on. A core part gets one recheck of
    // this same image; still missing with its words also missing means the drawing
    // lacks it, which buys a redraw. Words that read back keep the drawing for review.
    if (template.composed && !parentOf(id)) {
      // Only a part whose approved words are ALSO missing is proof the drawing lacks it.
      // An unmeasured hero, footer or card with readable words is an uncertain box, not broken content.
      const wordsId = composedWordsFor(id), wordsMissing = wordsId && wordVerdicts.find(row => row.id === wordsId)?.matches !== true;
      if (!subBoxesRechecked) measurementFaults.push(`Measure ${id} where it actually is on this same image. A composed poster has no target position.`);
      else if (wordsMissing) faults.push(`missing_core_part: ${id} and its approved words in box ${wordsId} could not be found after one recheck`);
      else observations.push({ key: 'unmeasuredPart', evidence: id, reportOnly: true, message: 'Not measured after one recheck. It gets no tap area; nothing is guessed.' });
      continue;
    }
    // On a composed page, the boxes inside an unmeasured card follow that card's own outcome.
    if (template.composed && parentOf(id) && !seen.has(parentOf(id))) { missingSubBoxes.push(id); continue; }
    const card = parentOf(id), wordsMatch = wordVerdicts.find(row => row.id === wordIdForCard(card))?.matches === true;
    if (card && seen.has(card) && wordsMatch) {
      missingSubBoxes.push(id);
      if (id === 'plan.handwriting' && receipt.writableRows?.length === 2) observations.push({ key: 'legacyWritingSummaryMissing', evidence: id, reportOnly: true, message: 'The two explicit writable rows replace the old summary rectangle.' });
      else if (id === 'plan.handwriting' && subBoxesRechecked) measurementFaults.push('Measure plan.handwriting: word readback alone does not prove room for two writing rows.');
      else if (!subBoxesRechecked) measurementFaults.push(`Measure missing sub box ${id} inside its present card. Its words already read back correctly. Recheck this same image once.`);
      else observations.push({ key: 'missingSubBox', evidence: id, reportOnly: true, message: 'Still missing after one recheck; the card and its approved words pass.' });
    } else faults.push(`missing_geometry_box: ${id}`);
  }
  // Fixed-rectangle versions compare against their target; a composed page has none.
  let fit = null;
  if (!template.composed) try { fit = fitRectangles(observed, expected, posterTemplate.canvas); } catch (error) { return broken(error.message, { faults }); }
  const measured = measurementProblems({ ...receipt, observed }, drawingCanvas);
  const checked = supportedFaults(receipt, geometryBooleanKeys);
  const codeMeasured = ['heroOutsideRegion', 'printTextTooSmall', 'textIconCollision', 'fillOutsideCard'];
  const ignoredFaults = [...checked.ignoredFaults, ...checked.faults.filter(key => codeMeasured.includes(key)).map(key => ({ key, reason: 'Use measured rectangles and the common fit, not the visual opinion flag.' }))];
  if (receipt.observed.some(r => r?.id === 'joke') || receipt.jokeOutsideRegion) ignoredFaults.push({ key: 'jokeGeometry', reason: 'Retired fixed joke slot. The joke is an observed scene detail, reported separately.' });
  if (measured.problems.length) return { ready: false, faults, fit, measurementFaults: [...measured.problems, ...textIssues], needsRecheck: true, ignoredFaults, extraKeys, observations };
  const placement = physicalPosterPlacement(measured.canvas, observed);
  const review = message => observations.push({ key: message.split(':')[0], evidence: message, reportOnly: true });
  const fitted = Object.fromEntries(observed.map(row => [row.id, transformRect(row, placement)]));
  const roundingPoints = rectangleRoundingUnits * placement.scale;
  for (const row of fit?.residuals ?? []) {
    if (row.id === 'tagline') {
      const ratio = row.fitted.w / row.target.w, centreDrift = Math.abs(row.fitted.x + row.fitted.w / 2 - row.target.x - row.target.w / 2) / row.target.w;
      // One source unit covers rectangle rounding. A small change elsewhere in
      // the common fit must not turn an exactly full-width pill into a fault.
      const rounding = fit.scale / row.target.w;
      if (ratio < .4 - rounding || ratio > 1 + rounding || centreDrift > .1 + rounding || ['y', 'h'].some(key => Math.abs(row.pageFraction[key]) > .08 + 1e-10)) review(`geometry_deviation_tagline: width ratio ${ratio.toFixed(3)}, centre drift ${centreDrift.toFixed(3)}, vertical residual ${JSON.stringify({ y: row.pageFraction.y, h: row.pageFraction.h })}`);
    } else if (Object.values(row.pageFraction).some(value => Math.abs(value) > (row.id === 'hero' ? .15 : .08) + 1e-10)) review(`geometry_deviation_${row.id}: ${JSON.stringify(row.pageFraction)}`);
  }
  const ids = Object.keys(fitted);
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (disjoint(ids[i], ids[j]) && overlaps(fitted[ids[i]], fitted[ids[j]])) {
      if (parentOf(ids[i]) && parentOf(ids[i]) === parentOf(ids[j])) observations.push({ key: 'innerSubBoxContact', evidence: `${ids[i]} / ${ids[j]}`, reportOnly: true, message: 'Inner measurements touch or overlap; word crossing is checked separately.' });
      else review(`geometry_overlap: ${ids[i]} / ${ids[j]}; measured text determines whether content is hidden`);
    }
  }
  faults.push(...checked.faults.filter(key => !codeMeasured.includes(key)));
  if (textIssues.length) return broken(textIssues.join(' '), { faults, fit, placement, ignoredFaults, observations });
  const lines = receipt.textLines;
  if (!Array.isArray(lines)) return broken('Measure individual text-line rectangles with their words; omit empty writing rules.', { faults, fit, placement, ignoredFaults, observations });
  const heights = [], excludedRules = [], textRects = [];
  for (const line of lines) {
    if (!bodyTextBoxes.includes(line?.boxId) || !contains({ x: 0, y: 0, w: measured.canvas.width, h: measured.canvas.height }, line, 1)) return broken('A text-line rectangle is invalid or outside the image.', { faults, fit, placement, ignoredFaults, observations });
    // Older receipts omitted line text. Only identify thin blank-plan rules where
    // the word readback independently includes empty handwriting lines.
    const blankReadback = readback.find(box => box.id === 'move')?.text.split('\n').some(text => /^\s*[_＿―─]+\s*$/.test(text));
    const legacyRule = line.text === undefined && line.boxId === 'plan.body' && blankReadback && line.h / measured.canvas.height <= .003 && line.w / line.h >= 20;
    if ((typeof line.text === 'string' && !letters(line.text)) || legacyRule) {
      excludedRules.push({ ...line, reason: legacyRule ? 'Thin writing rule corroborated by blank-plan readback.' : 'No letters or numbers on this line.' }); continue;
    }
    const textRect = transformRect(line, placement), card = fitted[parentOf(line.boxId)];
    // A body sub box is a measurement of text, not a drawn edge. The card is the boundary.
    if (card && !cardContains(card, textRect)) faults.push(`text_crosses_boundary: ${line.boxId}; line ${JSON.stringify(textRect)} exceeds card ${JSON.stringify(card)} plus its 3 percent measurement allowance`);
    for (const previous of textRects) if (overlaps(previous, textRect)) {
      const contact = overlapSize(previous, textRect);
      if (Math.min(contact.x, contact.y) <= roundingPoints + 1e-8) review(`coordinate_rounding_contact: ${previous.boxId} / ${line.boxId}; intersection ${JSON.stringify(contact)} points is within ${roundingPoints.toFixed(3)} points of source-coordinate rounding.`);
      else if (previous.boxId === line.boxId && (previous.text === undefined || line.text === undefined)) measurementFaults.push(`Overlapping legacy line measurements in ${line.boxId}; re-measure individual visible lines with their words.`);
      else faults.push(`text_lines_overlap: ${previous.boxId} / ${line.boxId}; rectangles ${JSON.stringify(previous)} and ${JSON.stringify(textRect)}`);
    }
    // Code prints the footer words into the measured banner, so no card text may sit under it.
    if (template.composed && fitted.footer && overlaps(fitted.footer, textRect) && Math.min(overlapSize(fitted.footer, textRect).x, overlapSize(fitted.footer, textRect).y) > roundingPoints + 1e-8) faults.push(`text_under_footer_banner: ${line.boxId}; line ${JSON.stringify(textRect)} lies under the footer banner ${JSON.stringify(fitted.footer)} where code prints the footer words`);
    const exportedLine = transformRect(line, placement);
    if (!contains({ x: 36, y: 36, w: 540, h: 720 }, exportedLine, .5)) faults.push(`text_clipped_at_safe_area: ${line.boxId}; bounds ${JSON.stringify(exportedLine)} points exceed [36,36,540,720] points`);
    for (const [id, icon] of Object.entries(fitted)) if (id.endsWith('.icon') && overlaps(icon, textRect)) {
      const contact = overlapSize(icon, textRect), evidence = receipt.evidence?.textIconCollision ?? '';
      if (Math.min(contact.x, contact.y) <= roundingPoints + 1e-8) review(`coordinate_rounding_contact: ${line.boxId} / ${id}; intersection ${JSON.stringify(contact)} points is within ${roundingPoints.toFixed(3)} points of source-coordinate rounding.`);
      else if (receipt.textIconCollision === true && evidence.includes(line.boxId) && evidence.includes(id)) faults.push(`text_icon_collision: ${line.boxId} / ${id}; text bounds ${JSON.stringify(textRect)}, icon bounds ${JSON.stringify(icon)}. Visible ink evidence: ${evidence}`);
      else measurementFaults.push(`Recheck possible ${line.boxId} / ${id} contact on this SAME image. Bounding rectangles overlap beyond rounding, but do not prove that icon ink hides text. In evidence.textIconCollision name both box ids and the obscured letters only if actual ink collides.`);
    }
    textRects.push({ ...textRect, boxId: line.boxId, text: line.text });
    heights.push({ boxId: line.boxId, ...(line.text !== undefined ? { text: line.text } : {}), sourceHeight: line.h, fittedHeight: line.h * placement.scale, anchorFitHeight: fit ? line.h * fit.scale : null, pointsPerSourceUnit: placement.scale, points: line.h * placement.scale,
      working: `${line.h} ${measured.canvas.unit} * ${placement.scale} points per source unit = ${line.h * placement.scale} points` });
  }
  for (const id of bodyTextBoxes) if (!heights.some(line => line.boxId === id)) {
    if (missingSubBoxes.includes(id) && subBoxesRechecked) observations.push({ key: 'textSizeUnmeasured', evidence: id, reportOnly: true, message: 'Words passed; the missing body measurement is reported after its recheck.' });
    else if (!missingSubBoxes.includes(id)) measurementFaults.push(`Measure visible text lines in ${id}; omit empty writing rules.`);
  }
  const smallestBodyTextHeight = heights.length ? Math.min(...heights.map(line => line.points)) : null;
  if (smallestBodyTextHeight !== null && smallestBodyTextHeight < readabilityCalibration.minimumObservedInkHeight) review(`small_ink_review: ${smallestBodyTextHeight.toFixed(2)} points of ink; saved 12-point sample ink starts at ${readabilityCalibration.minimumObservedInkHeight} points. Ink height is not font size. Readback decides unreadability.`);
  // The footer words are printed by code at a fixed size; the drawn banner must hold them.
  if (template.composed && fitted.footer && typeof footerText === 'string') {
    const { points, lineHeight, family } = template.footerType, room = fitType(footerText, { width: fitted.footer.w - 12, height: fitted.footer.h - 4, maximum: points, minimum: points, lineHeight, family });
    if (!room.fits) faults.push(`footer_banner_too_small: the empty footer banner is ${fitted.footer.w.toFixed(1)} by ${fitted.footer.h.toFixed(1)} points; the footer words need ${room.height.toFixed(1)} points of height on ${room.lines} line(s) at ${points} points`);
  }
  const writingAssessment = assessWritableRows(receipt.writableRows, placement, seen.get('plan'), measured.canvas);
  faults.push(...writingAssessment.faults); measurementFaults.push(...writingAssessment.measurementFaults);
  return { ready: faults.length === 0 && measurementFaults.length === 0, templateVersion: template.version, geometryRuleVersion, writingAssessment, rounding: { sourceUnits: rectangleRoundingUnits, fittedPoints: roundingPoints, method: 'Three half-unit errors: rounded x plus rounded width compared with rounded x.' }, faults, ignoredFaults, extraKeys, observations, needsRecheck: measurementFaults.length > 0, measurementFaults, fit, placement, coordinateSpace: measured.canvas,
    textMeasurement: { smallestBodyTextHeight, minimum: null, calibration: readabilityCalibration, method: 'Visible ink height times source-to-Letter export scale. Compared with the saved printed sample for review only; ink height is not font size.', pointsPerSourceUnit: placement.scale, excludedRules, lines: heights },
    missingSubBoxes, subBoxesRechecked, exported: Object.fromEntries(observed.map(r => [r.id, transformRect(r, placement)])) };
}
export function validateGeometryReceipt(receipt, options) { return assessCheck(inspectGeometryReceipt(receipt, options)); }
// Boxes measured on the actual drawing, never targets. A composed poster must have its
// footer banner measured, because code prints the family's footer words inside it.
const measuredBox = (geometry, id) => Boolean(geometry?.placement && geometry.measured !== false && geometry.exported
  && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(geometry.exported[id]?.[key])));
export const measuredFooter = geometry => measuredBox(geometry, 'footer');
// Tap areas exist only where a part was measured; the viewer shows plain buttons for the rest.
export const measuredRegions = geometry => Object.fromEntries(regionIds.filter(id => measuredBox(geometry, id)).map(id => { const { x, y, w, h } = geometry.exported[id]; return [id, { x, y, w, h }]; }));
export function unverifiedGeometry(dimensions = drawingCanvas, reason = 'Checker measurements remain incomplete after one recheck.', templateVersion = posterTemplate.version) {
  const template = posterTemplateFor(templateVersion);
  const scale = Math.min(540 / dimensions.width, 720 / dimensions.height);
  // A composed page has no target boxes to fall back on: nothing is guessed.
  if (template.composed) return { ready: false, templateVersion: template.version, verified: false, measured: false, faults: [], measurementFaults: [reason], needsRecheck: false,
    reviewFlags: [reviewNote('geometry_unverified', reason)], observations: [], ignoredFaults: [], coordinateSpace: { unit: 'source-pixels', ...dimensions },
    placement: { scale, offset: { x: (612 - dimensions.width * scale) / 2, y: (792 - dimensions.height * scale) / 2 } }, exported: null,
    method: 'Whole image contained inside Letter margins. A composed poster has no target boxes, so no tap area or footer position is guessed.' };
  return { ready: true, templateVersion: template.version, verified: false, measured: false, faults: [], measurementFaults: [], needsRecheck: false,
    reviewFlags: [reviewNote('geometry_unverified', reason)], observations: [], ignoredFaults: [],
    coordinateSpace: { unit: 'source-pixels', ...dimensions },
    placement: { scale, offset: { x: (612 - dimensions.width * scale) / 2, y: (792 - dimensions.height * scale) / 2 } },
    exported: geometryRects(template), method: 'Whole image contained inside Letter margins. Target regions are unverified guides, not measured drawing boxes.' };
}
export function posterImageTransform(geometry, dimensions = drawingCanvas) {
  // A review opinion does not change the image's physical size or placement.
  const fit = geometry?.placement;
  if (!geometry?.coordinateSpace || !Number.isFinite(fit?.scale) || fit.scale <= 0
      || !Number.isFinite(fit.offset?.x) || !Number.isFinite(fit.offset?.y)
      || !Number.isFinite(dimensions.width) || dimensions.width <= 0
      || !Number.isFinite(dimensions.height) || dimensions.height <= 0) throw new Error('The drawing needs a valid size and position for printing.');
  const pixels = geometry.coordinateSpace.unit === 'source-pixels';
  if (pixels && (geometry.coordinateSpace.width !== dimensions.width || geometry.coordinateSpace.height !== dimensions.height)) throw new Error('Drawing measurements use a different image size.');
  const source = pixels ? { scale: 1, x: 0, y: 0 } : drawingTransform;
  const scale = fit.scale / source.scale;
  return { scale, offset: { x: fit.offset.x - source.x * scale, y: fit.offset.y - source.y * scale } };
}
export function templatePrompt() {
  return [
    `Template ${posterTemplate.version}. Coordinates are points on a ${posterTemplate.canvas.width} by ${posterTemplate.canvas.height} US Letter page.`,
    `Output ${drawingCanvas.width} by ${drawingCanvas.height}. The target guide places Letter coordinates at scale ${drawingTransform.scale}, offset x=${drawingTransform.x}, y=${drawingTransform.y}. Print contains the WHOLE source canvas inside the safe area with centred margins, using ${wholeCanvasPrintScale} Letter points per source pixel. Measured card anchors never change this physical print scale. Never stretch the page.`,
    `Target layout rectangles {x,y,w,h}: ${JSON.stringify(geometryRects())}`,
    'Approved word box tiny uses region tinyTry. Approved word box move uses region plan. All other box ids match their named rectangles. Do not print these ids.',
    'Exactly FIVE cards: ONE TINY TRY FOR TODAY, WHAT SCIENCE SAYS, WHAT I CAN DO, HOW TO REMEMBER IT, WHERE IT CAME FROM.',
    'Follow the photographed page structure: expressive title banner and rhyme pill, a large hero scene, a separate keyword badge, two wide cards per row, a full-width source card, then the empty footer banner. Tiny try and science share the first row. Blank plan and memory share the second row. Source spans both columns. Use 36-point safe margins, 12-point equal gutters and 12-point inner padding. Target columns are 264 points wide. Keep the same arrangement and proportions. Code fits one uniform scale and offset to measured boxes; remaining position or size drift beyond 8 percent of the page for cards or 15 percent for the hero is reported for review. Measured clipping, collisions that hide content, unreadable words and missing writing space fail. Inner sub boxes touching inside one card are reported; text still stays inside the card. Never merge or overlap cards.',
    'Draw an illustrated page, with inked rounded frames, a ribbon-like title, an outlined rhyme pill, small illustrated heading icons, and world-specific decorative edges. The room or world feels lived in. Let scenery and decoration connect the page around the light cards without entering text or handwriting space. Keep these decorations wordless. Do not imitate a dashboard of plain rectangles.',
    'Icons stay in icon slots beside headings. A heading never sits over an icon. Headings may wrap to two lines; never compress lettering. Clip inner fills to the card. Longer card text is left aligned. Centre only title, rhyme and badge.',
    `Baloo 2 headings start at 16 points, Nunito body at 14 points; all text stays at least 12 points. Use the supplied code-fit type and line spacing plan before reporting overflow. Card outlines, 12-point inner padding and 12-point gutters stay fixed. In the plan, put "When I notice" and its blank on the FIRST row, then "I" and its blank on a SECOND row underneath. NEVER put both blanks on one line. Each blank itself must leave at least 72 Letter points of clear writable width and 12 Letter points of clear writable height ABOVE its own baseline after the whole image is fitted for print. On this ${drawingCanvas.width} by ${drawingCanvas.height} source canvas, reserve at least ${minimumWritingPixels.width} pixels of blank width and ${minimumWritingPixels.height} pixels of clear height above EACH baseline. These pixel minima come from containing the whole canvas inside the 540 by 720 point print area. Make the blanks generous, not short underscores. Put each label above its own blank when needed to give the writing room. Aim for at least 144 Letter points of clear width for each blank. No words, icons or decorations enter either writable area. Keep the separate backup below both writing rows. Preserve the exact approved words and empty blanks.`,
    'Keep the badge and ALL rays in its separate rectangle. Keep the hero inside its frame with a visible 12-point gap under the tagline. Keep the single small joke inside the hero scene; it has no fixed slot. The rhyme pill may sit inside the title band, centred, at 40 to 100 percent of the target pill width.',
    'Show the action and the body part doing it; a step must show the stepping foot. keep the background simple right around the hand or body part doing the move. Render the family in its selected picture style. Keep the action clear and each person recognisable.',
  ].join('\n');
}

// New posters: the core parts and the real print limits only. The drawing model
// chooses placement, sizes, borders, mini-scenes, ornaments and palette.
export function composedPosterPrompt({ monochrome = false } = {}) {
  const pixels = points => Math.ceil(points / wholeCanvasPrintScale);
  return [
    `CURRENT OWNER AMENDMENTS, October 24; where they differ from the original files above, these win. Poster version ${composedPosterTemplate.version}. Draw the whole US Letter portrait poster on this ${drawingCanvas.width} by ${drawingCanvas.height} canvas. Printing scales the whole canvas evenly onto the page; never stretch it.`,
    `YOU choose the composition, like a hand-made comic poster: where the cards, the hero scene and the keyword badge go and how big each is, restrained borders and a few useful themed accents, and ${monochrome ? 'how to use black ink, sparse hatching and the off-white paper, with no colour anywhere, because this family look is black ink only' : 'a palette that suits this topic and world'}. Every poster may be arranged differently. Keep the character and useful action rich and expressive while the background remains subtle.`,
    'These core parts appear on every poster, nothing more and nothing less:',
    '1. An illustrated title banner near the top with the title, and the rhyme in its own ribbon or pill close to the title.',
    '2. One large hero scene with the family and the action. Keep the single small joke inside it.',
    '3. Exactly FIVE cards, each with its own heading and approved words: ONE TINY TRY FOR TODAY, WHAT SCIENCE SAYS, WHAT I CAN DO, HOW TO REMEMBER IT, WHERE IT CAME FROM. A small heading icon or a small wordless picture inside a card is welcome but optional.',
    '4. ONE keyword badge with the single key word, as its own shape. It may sit between cards or overlap a card edge, never over card words.',
    `5. An EMPTY light footer banner along the bottom edge, at least ${pixels(200)} by ${pixels(36)} pixels with a clear centre, room for two lines of footer words that code adds. Draw no words in it and keep card words out of it.`,
    `Legibility: every word stays fully inside its own card, banner, ribbon or badge and at least ${pixels(12)} pixels inside the canvas edge. No word crosses a picture, frame, ray, ornament or another card. Heading lettering about ${pixels(16)} pixels in type size, card words about ${pixels(14)}, never below ${pixels(12)}, so every word prints at 12 points or more. Left align longer card text; never squeeze or stretch lettering.`,
    `Writing plan: in WHAT I CAN DO put "When I notice" and its blank on the FIRST row, then "I" and its blank on a SECOND row underneath. Each blank leaves at least ${minimumWritingPixels.width} pixels of clear width and ${minimumWritingPixels.height} pixels of clear height above its line. Aim for twice that minimum width so a child can write a short phrase. Put each label above its own blank when needed, never let the label use up the writing space. Keep two separate writing rows. Never fill either blank.`,
    'Decoration is secondary: use roughly half the background detail of a richly decorated scene, not half the useful content. Keep a few warm setting cues and gentle depth. No dense leaf borders, busy book spines, tiled floor patterns or scattered ornaments competing with the child, their action, the rhyme or the five cards. Keep all decoration out of the words and writing rows. Do not replace the scene with a bland empty background.',
    'Show the action and the body part doing it; a step must show the stepping foot; keep the background simple right around the hand or body part doing the move. Render the family in its selected picture style. Keep the action clear and each person recognisable.',
  ].join('\n');
}

// A local outline guide for the checker, not generated artwork or evidence of a pass.
const crc32 = bytes => { let c = 0xffffffff; for (const byte of bytes) { c ^= byte; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const label = Buffer.from(type), n = Buffer.alloc(4), crc = Buffer.alloc(4); n.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([label, data]))); return Buffer.concat([n, label, data, crc]); }
export function templateGuidePNG(template = posterTemplate, { canvas = drawingCanvas, rects = geometryRects(template), transform = drawingTransform } = {}) {
  const { width, height } = canvas, stride = width * 3 + 1, pixels = Buffer.alloc(stride * height, 255);
  for (let y = 0; y < height; y++) pixels[y * stride] = 0;
  for (const [id, r] of Object.entries(rects)) {
    const x1 = Math.round(r.x * transform.scale + transform.x), y1 = Math.round(r.y * transform.scale + transform.y);
    const x2 = Math.round((r.x + r.w) * transform.scale + transform.x), y2 = Math.round((r.y + r.h) * transform.scale + transform.y);
    const colour = id.includes('.') ? [13, 112, 104] : [175, 35, 55];
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) if (x - x1 < 2 || x2 - x < 2 || y - y1 < 2 || y2 - y < 2) {
      const at = y * stride + x * 3 + 1; for (let i = 0; i < 3; i++) pixels[at + i] = colour[i];
    }
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export function comparisonHTML(imageUrl, geometry, templateVersion) {
  const template = posterTemplateFor(geometry ? geometry.templateVersion ?? legacyPosterTemplate.version : templateVersion ?? posterTemplate.version);
  if (template.composed) {
    // Review view of what was actually measured; a composed page has no target outlines.
    const measuredBoxes = geometry?.exported ? Object.entries(geometry.exported).map(([id, r]) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="${id.includes('.') ? '#0f766e' : '#bc2341'}" stroke-width="1"><title>${id}</title></rect>`).join('') : '';
    const fit = geometry?.placement && geometry?.coordinateSpace ? posterImageTransform(geometry, drawingCanvas, { review: true }) : containTransform(drawingCanvas, { width: 612, height: 792 });
    const left = fit.offset?.x ?? fit.x, top = fit.offset?.y ?? fit.y;
    return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Composed poster review</title><body><p>Review only. ${measuredBoxes ? 'Outlines show the boxes the checker measured on this drawing.' : 'No measured boxes yet; a composed poster has no target layout.'} This view is not approval.</p><div style="position:relative;width:612px;height:792px;overflow:hidden"><img src="${imageUrl}" alt="Composed poster drawing" style="position:absolute;left:${left}px;top:${top}px;width:${drawingCanvas.width * fit.scale}px;height:auto"><svg viewBox="0 0 612 792" style="position:absolute;inset:0;width:100%;height:100%">${measuredBoxes}</svg></div></body></html>`;
  }
  const outlines = Object.entries(geometryRects(template)).map(([id, r]) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="${id.includes('.') ? '#0f766e' : '#bc2341'}" stroke-width="1"><title>${id}</title></rect>`).join('');
  if (geometry?.placement && geometry?.coordinateSpace) {
    const fit = posterImageTransform(geometry, drawingCanvas, { review: true });
    return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Fitted drawing and target comparison</title><body><p>Review only. ${geometry.ready ? 'Checks passed.' : 'Check faults remain.'} This view is not approval.</p><div style="position:relative;width:612px;height:792px;overflow:hidden"><img src="${imageUrl}" alt="Fitted drawing under target outlines" style="position:absolute;left:${fit.offset.x}px;top:${fit.offset.y}px;width:${drawingCanvas.width * fit.scale}px;height:auto"><svg viewBox="0 0 612 792" style="position:absolute;inset:0;width:100%;height:100%">${outlines}</svg></div></body></html>`;
  }
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Drawing and template comparison</title><body><p>Review only. Outline comparison is not approval.</p><div style="position:relative;width:612px;height:918px"><img src="${imageUrl}" alt="Drawing under template outlines" style="width:100%;height:auto;display:block"><svg viewBox="0 0 612 918" style="position:absolute;inset:0;width:100%;height:100%"><g transform="translate(0 63)">${outlines}</g></svg></div></body></html>`;
}
