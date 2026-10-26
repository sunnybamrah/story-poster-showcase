import { assessGenerationCheck, assessCheck as assessHistoricalCheck } from './stop-policy.js';
import { inspectAnswer } from './answer-shape.js';
import { pictureParserSchema } from './answer-schemas.js';
import { extractJSON } from './files.js';
import { pictureMonochrome } from './graphic-style.js';
import { buildPictureCheckRequest, pictureCheckKeys, privacyFor } from './requests.js';
import { exactKeys, faultShape, supportedFaults, brokenCheck, runCheck, sceneObservations } from './checker-contract.js';
import { publicCast, assessCastObservations, castEvaluationVersion, appearanceBasisMissing, requireAppearanceBasisResult } from './cast.js';

export function parsePictureCheck(text, { generation = false, cast = [], picture = 'picture', requireAppearanceBasis = false, monochrome = false } = {}) {
  let rawAnswers;
  try { rawAnswers = extractJSON(text); } catch { return brokenCheck('malformed picture check'); }
  const parsed = inspectAnswer(rawAnswers, pictureParserSchema), answers = parsed.value;
  const contentIssues = generation ? parsed.issues.filter(issue => /^(?:lettersPresent|transcription)(?:\.|\[| |$)|^evidence(?: is required| must)|^evidence\.lettersPresent(?: |$)/.test(issue)) : parsed.issues;
  if (contentIssues.length) return { ...brokenCheck('incomplete picture check: ' + contentIssues.join(' '), rawAnswers), extraKeys: parsed.extraKeys };
  if (!generation && requireAppearanceBasis && appearanceBasisMissing(answers.castObservations, cast.length > 0)) return { ...brokenCheck('missing_cast_appearance_basis', rawAnswers), needsRecheck: false };
  const { faults, ignoredFaults } = supportedFaults(answers, pictureCheckKeys, { monochrome });
  const identity = cast.length && !parsed.issues.some(issue => issue.startsWith('castObservations')) ? assessCastObservations(answers.castObservations, cast, picture, undefined, { monochrome }) : { faults: [], reviewFlags: [] };
  faults.push(...identity.faults);
  if (answers.transcription.some(line => line.trim()) && !faults.includes('lettersPresent')) faults.push('lettersPresent');
  return (generation ? assessGenerationCheck : assessHistoricalCheck)({ contentNeedsRecheck: false, appearanceNeedsReview: generation && (parsed.issues.length > 0 || requireAppearanceBasis && appearanceBasisMissing(answers.castObservations, cast.length > 0)), castEvaluationVersion, ready: faults.length === 0, answers: rawAnswers, extraKeys: parsed.extraKeys, faults, ignoredFaults, reviewFlags: identity.reviewFlags, observations: sceneObservations(answers), needsRecheck: false } );
}

export function openaiText(response) {
  if (response.status !== 'completed') throw new Error('unfinished picture check');
  const text = (response.output ?? []).flatMap(item => item.content ?? []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
  if (!text) throw new Error('empty picture check');
  return text;
}
export function pictureCheckFromResponse(response, options) {
  try { return parsePictureCheck(openaiText(response), options); }
  catch (error) { return brokenCheck(error.message); }
}

export async function checkPicture(transport, record, move, tonight, imageData, { kit, retry = 0, hero = false, character, referenceImages } = {}) {
  const body = buildPictureCheckRequest(record, move, tonight, imageData, { character, referenceImages });
  const check = await runCheck(transport, { provider: 'openai', path: '/v1/responses', stage: character ? `${character.id}-reference-check` : hero ? 'hero-check' : 'picture-check', kit, body, privacy: privacyFor(record, tonight, move) }, response => pictureCheckFromResponse(response, { generation: true, cast: character ? [character] : publicCast(record), picture: character?.id ?? 'picture', requireAppearanceBasis: true, monochrome: pictureMonochrome(record) }), { retry });
  return requireAppearanceBasisResult(check);
}
