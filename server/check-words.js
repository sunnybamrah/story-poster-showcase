import { pictureStyleIdFor } from '../app/picture-styles.js';
import { assessGraphicStyle, pictureMonochrome } from './graphic-style.js';
import { assessGenerationCheck, assessCheck as assessHistoricalCheck } from './stop-policy.js';
import { inspectAnswer } from './answer-shape.js';
import { wordParserSchema } from './answer-schemas.js';
import { extractJSON } from './files.js';
import { boxText, posterFooter, visibleWords, posterCountReport } from './format.js';
import { posterTemplateFor, validateGeometryReceipt, measuredFooter, currentPosterTemplateVersion } from './poster-template.js';
import { buildWordCheckRequest, buildComicWordCheckRequest, privacyFor, wordCheckBooleans } from './requests.js';
import { faultShape, supportedFaults, brokenCheck, runCheck, sceneObservations } from './checker-contract.js';
import { openaiText } from './check-picture.js';
import { assessSpeaker, pictureCast } from './panel-contract.js';
import { learningActor, publicCast, assessCastObservations, castEvaluationVersion, appearanceBasisMissing, requireAppearanceBasisResult } from './cast.js';

import { compareBoxWords, wordDifferenceReason } from './word-comparison.js';
const extraWrittenText = lines => lines.filter(line => /[\p{L}\p{N}]/u.test(line));
// Read-only saved verdicts keep their historical policy. Every current check
// and current export explicitly sets generation:true for required actual words.
export function parseWordCheck(text, expectedBoxes, { generation = false, footerText = posterFooter(), subBoxesRechecked = false, cast = [], picture = 'picture', expectedTemplateVersion, expectedSpeakerId, expectedVisibleCast, expectedCoordinateUnit, requireGraphicStyle = false, pictureStyleId, requireAppearanceBasis = false } = {}) {
  let rawAnswers;
  try { rawAnswers = extractJSON(text); } catch { return brokenCheck('malformed_word_check'); }
  const isPoster = expectedBoxes.some(box => box.id === 'footer');
  const parsed = inspectAnswer(rawAnswers, wordParserSchema(isPoster)), answers = parsed.value;
  // Geometry measurement slips keep their existing same-image recheck path.
  const appearanceIssue = issue => (!expectedSpeakerId && issue.startsWith('bubbleSpeaker')) || /^(?:geometry|graphicStyle|castObservations|outfitObservations)(?:\.|\[| |$)|^(?:outfitMismatch|actionMismatch|peopleCountMismatch|sceneTooEmpty|jokeInScene)(?: |$)|^evidence\.(?:outfitMismatch|actionMismatch|peopleCountMismatch|sceneTooEmpty|jokeInScene)(?: |$)/.test(issue);
  const issues = parsed.issues.filter(issue => generation ? !appearanceIssue(issue) : !issue.startsWith('geometry.'));
  if (issues.length) return { ...brokenCheck('incomplete_word_check: ' + issues.join(' '), rawAnswers), extraKeys: parsed.extraKeys };
  if (!generation && requireAppearanceBasis && appearanceBasisMissing(answers.castObservations, (expectedVisibleCast?.length ?? cast.length) > 0)) return { ...brokenCheck('missing_cast_appearance_basis', rawAnswers), needsRecheck: false };
  const monochrome = pictureMonochrome(pictureStyleId);
  const { faults, ignoredFaults } = supportedFaults(answers, isPoster ? wordCheckBooleans.filter(key => key !== 'textCrossesBoundary') : wordCheckBooleans, { monochrome });
  const identity = cast.length && !parsed.issues.some(issue => issue.startsWith('castObservations')) ? assessCastObservations(answers.castObservations, cast, picture, expectedVisibleCast, { monochrome }) : { faults: [], reviewFlags: [] };
  faults.push(...identity.faults);
  const speaker = isPoster ? { faults: [], reviewFlags: [] } : assessSpeaker(answers.bubbleSpeaker, expectedSpeakerId);
  faults.push(...speaker.faults);
  const graphicStyle = assessGraphicStyle(answers.graphicStyle, { required: requireGraphicStyle, pictureStyleId });
  faults.push(...graphicStyle.faults);
  const planReadback = answers.boxes.find(box => box.id === 'move')?.text ?? '';
  const hasEmptyPlan = /When I notice\s+_+[,\s]+I\s+_+[.\s]*(?:Backup:|$)/i.test(planReadback);
  const saysEmpty = /\b(?:they|both blanks|the blanks|these blanks) (?:are|remain|stay) empty\b/i.test(answers.evidence.filledBlank ?? '');
  if (isPoster && answers.filledBlank && hasEmptyPlan && saysEmpty) {
    const index = faults.indexOf('filledBlank'); if (index >= 0) faults.splice(index, 1);
    ignoredFaults.push({ key: 'filledBlank', reason: 'The readback shows both blank rules, and the quoted evidence explicitly says they are empty.' });
  }
  if (isPoster && answers.textCrossesBoundary) ignoredFaults.push({ key: 'textCrossesBoundary', reason: 'Use measured body lines and the 3 percent card-edge tolerance.' });
  if (answers.jokeInScene === true && !(typeof answers.evidence?.jokeInScene === 'string' && answers.evidence.jokeInScene.trim())) ignoredFaults.push({ key: 'jokeInScene', reason: 'True observation treated as false because its evidence is empty.' });
  const extraText = generation ? extraWrittenText(answers.extraText) : answers.extraText.filter(line => line.trim());
  if (extraText.length) faults.push(`extra_words_outside_boxes: ${JSON.stringify(extraText)}`);
  if (answers.boxes.map(box => box.id).sort().join() !== expectedBoxes.map(box => box.id).sort().join()) faults.push('missing_extra_or_reordered_boxes');
  const wordVerdicts = expectedBoxes.map(box => compareBoxWords(box, answers.boxes.find(actual => actual.id === box.id)?.text ?? ''));
  for (const box of answers.boxes) if (!expectedBoxes.some(expected => expected.id === box.id)) wordVerdicts.push(compareBoxWords({ id: box.id, text: '' }, box.text));
  for (const diff of wordVerdicts) if (!diff.matches) faults.push(wordDifferenceReason(diff));
  let wordCap, transcriptionWordCap, geometry;
  if (isPoster) {
    const footerCount = visibleWords(footerText).length;
    wordCap = posterCountReport(expectedBoxes.reduce((sum, box) => sum + visibleWords(boxText(box)).length, 0) + footerCount);
    transcriptionWordCap = posterCountReport(wordVerdicts.reduce((sum, diff) => sum + visibleWords(boxText(expectedBoxes.find(box => box.id === diff.id) ?? { text: '' })).length + diff.extra.length - diff.missing.length, 0) + answers.extraText.reduce((sum, line) => sum + visibleWords(line).length, 0) + footerCount);
    geometry = validateGeometryReceipt(rawAnswers.geometry, { wordVerdicts, readback: answers.boxes, subBoxesRechecked, expectedTemplateVersion, expectedCoordinateUnit, footerText });
    faults.push(...geometry.faults); ignoredFaults.push(...geometry.ignoredFaults);
  }
  const appearanceUnknown = Boolean(parsed.issues.some(appearanceIssue) || geometry?.needsRecheck || !graphicStyle.verified || speaker.reviewFlags.some(flag => flag.key === 'speaker_unverified') || requireAppearanceBasis && appearanceBasisMissing(answers.castObservations, (expectedVisibleCast?.length ?? cast.length) > 0));
  return (generation ? assessGenerationCheck : assessHistoricalCheck)({ castEvaluationVersion, graphicStyle, ready: faults.length === 0 && !geometry?.needsRecheck, faults, answers: rawAnswers, extraKeys: [...new Set([...parsed.extraKeys, ...(geometry?.extraKeys ?? [])])], wordVerdicts, ignoredFaults, reviewFlags: [...identity.reviewFlags, ...speaker.reviewFlags, ...(geometry?.reviewFlags ?? [])], observations: [...sceneObservations(answers), ...(geometry?.observations ?? [])], contentNeedsRecheck: Boolean(speaker.needsRecheck), appearanceNeedsReview: appearanceUnknown, ...(generation ? { contentVerified: !speaker.needsRecheck, verified: !appearanceUnknown } : {}), needsRecheck: Boolean(geometry?.needsRecheck || speaker.needsRecheck || graphicStyle.needsRecheck), measurementFaults: geometry?.measurementFaults ?? [], ...(isPoster ? { wordCap, transcriptionWordCap, geometry } : {}) } );
}

export async function checkWords(transport, record, move, tonight, imageData, expectedBoxes, { kit, retry = 0, panel, jokeIdea, referenceImages, stage = 'poster-word-check', inspect, templateVersion = currentPosterTemplateVersion } = {}) {
  const result = await runCheck(transport, { provider: 'openai', path: '/v1/responses', stage, kit,
    body: buildWordCheckRequest(record, move, tonight, imageData, { panel, jokeIdea, referenceImages, templateVersion }), privacy: privacyFor(record, tonight, move) },
    (response, { attempt }) => parseWordCheck(openaiText(response), expectedBoxes, { generation: true, footerText: posterFooter(learningActor(record).storyName), subBoxesRechecked: attempt > 0, cast: publicCast(record), picture: stage, expectedTemplateVersion: templateVersion, expectedCoordinateUnit: panel ? undefined : 'source-pixels', expectedSpeakerId: record.kitContext?.storyMode === 'factual' ? undefined : panel?.speakerId, expectedVisibleCast: pictureCast(record, move, panel), requireAppearanceBasis: false, requireGraphicStyle: false, pictureStyleId: pictureStyleIdFor(record) }), { retry, inspect });
  // Preserve observations for the parent. Missing style or geometry opinions
  // never hide a valid drawing or start another paid check.
  if (!panel && !measuredFooter(result.geometry)) result.reviewFlags = [...(result.reviewFlags ?? []), {
    key: 'footer_outside_art', evidence: 'The family footer will print in its own strip below the drawing.', reportOnly: true,
  }];
  return requireAppearanceBasisResult(result);
}


export function parseComicWordCheck(text, record, move, panels) {
  let answers;
  try { answers = extractJSON(text); } catch { return brokenCheck('malformed_comic_word_check'); }
  const ids = panels.map((_, index) => `panel-${index + 1}`);
  if (!Array.isArray(answers?.panels) || answers.panels.length !== 4 || answers.panels.some((row, index) => row?.panelId !== ids[index]) || !Array.isArray(answers.extraText) || answers.extraText.some(value => typeof value !== 'string')) return brokenCheck('incomplete_comic_word_check', answers);
  const parsed = answers.panels.map((row, index) => parseWordCheck(JSON.stringify(row.check), [{ id: 'bubble', text: panels[index].line }], {
    generation: true, cast: publicCast(record), picture: row.panelId, expectedSpeakerId: record.kitContext?.storyMode === 'factual' ? undefined : panels[index].speakerId,
    expectedVisibleCast: pictureCast(record, move, panels[index]), pictureStyleId: pictureStyleIdFor(record),
  }));
  const faults = parsed.flatMap((check, index) => check.faults.map(key => `${key}: ${ids[index]}`));
  const extraText = extraWrittenText(answers.extraText);
  if (extraText.length) faults.push('extra_words_outside_boxes: ' + JSON.stringify(extraText));
  return assessGenerationCheck({ ready: false, answers, panels: parsed, faults, reviewFlags: parsed.flatMap(check => check.reviewFlags ?? []),
    contentNeedsRecheck: parsed.some(check => check.contentNeedsRecheck), needsRecheck: parsed.some(check => check.needsRecheck), verified: parsed.every(check => check.verified !== false) });
}
export async function checkComicWords(transport, record, move, tonight, imageData, panels, { kit, retry = 0, referenceImages = [] } = {}) {
  return runCheck(transport, { provider: 'openai', path: '/v1/responses', stage: 'comic-word-check', kit,
    body: buildComicWordCheckRequest(record, move, tonight, imageData, { panels, referenceImages }), privacy: privacyFor(record, tonight, move) },
    response => parseComicWordCheck(openaiText(response), record, move, panels), { retry });
}
