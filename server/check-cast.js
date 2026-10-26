import { inspectAnswer } from './answer-shape.js';
import { extractJSON } from './files.js';
import { castObservationsParserSchema, publicCast, assessCastObservations, castEvaluationVersion, appearanceBasisMissing, requireAppearanceBasisResult } from './cast.js';
import { buildCastCheckRequest, privacyFor } from './requests.js';
import { openaiText } from './check-picture.js';
import { brokenCheck, runCheck } from './checker-contract.js';
import { assessCheck } from './stop-policy.js';
import { pictureMonochrome } from './graphic-style.js';

export function parseCastCheck(text, cast, pictureIds, expectedByPicture, { requireAppearanceBasis = false, monochrome = false } = {}) {
  let raw;
  try { raw = extractJSON(text); } catch { return brokenCheck('malformed_cast_check'); }
  const schema = { type: 'object', properties: { pictures: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, castObservations: castObservationsParserSchema }, required: ['id', 'castObservations'], additionalProperties: false } } }, required: ['pictures'], additionalProperties: false };
  const parsed = inspectAnswer(raw, schema);
  if (parsed.issues.length) return brokenCheck('incomplete_cast_check: ' + parsed.issues.join(' '), raw);
  if (parsed.value.pictures.map(picture => picture.id).sort().join() !== [...pictureIds].sort().join()) return brokenCheck('cast_check_missing_or_repeated_picture', raw);
  if (parsed.value.pictures.some(picture => !picture.castObservations.length && (expectedByPicture?.[picture.id]?.length ?? cast.length))) return brokenCheck('cast_observations_missing', raw);
  if (requireAppearanceBasis && parsed.value.pictures.some(picture => appearanceBasisMissing(picture.castObservations, (expectedByPicture?.[picture.id]?.length ?? cast.length) > 0))) return { ...brokenCheck('missing_cast_appearance_basis', raw), needsRecheck: false };
  const rows = parsed.value.pictures.map(picture => ({ id: picture.id, ...assessCastObservations(picture.castObservations, cast, picture.id, expectedByPicture?.[picture.id], { monochrome }) }));
  return assessCheck({ castEvaluationVersion, ready: rows.every(row => !row.faults.length), faults: rows.flatMap(row => row.faults), reviewFlags: rows.flatMap(row => row.reviewFlags), failedPictures: rows.filter(row => row.faults.length).map(row => row.id), answers: raw, needsRecheck: false });
}
export async function checkCast(transport, record, move, tonight, pictures, referenceImages, { kit, retry = 0 } = {}) {
  const check = await runCheck(transport, { provider: 'openai', path: '/v1/responses', stage: 'cast-continuity-check', kit,
    body: buildCastCheckRequest(record, move, tonight, pictures, referenceImages), privacy: privacyFor(record, tonight, move) },
  response => parseCastCheck(openaiText(response), publicCast(record), pictures.map(picture => picture.id), Object.fromEntries(pictures.map(picture => [picture.id, picture.expectedVisibleCast])), { requireAppearanceBasis: true, monochrome: pictureMonochrome(record) }), { retry });
  return requireAppearanceBasisResult(check);
}
