import { judgeFaultFields } from '../server/story-review.js';
import { storyCheckKeys, pictureCheckKeys, wordCheckBooleans, geometryBooleanKeys } from '../server/checker-contract.js';
import { posterTemplate, geometryRects, bodyTextBoxes, drawingTransform, currentPosterTemplateVersion } from '../server/poster-template.js';
import { boxText } from '../server/format.js';
export const flags = keys => ({ ...Object.fromEntries(keys.map(key => [key, false])), evidence: Object.fromEntries(keys.map(key => [key, ''])) });
export const castObservation = person => ({ characterId: person.id, observedSpecies: person.species, identityMatches: true, certainty: 'confirmed', identityEvidence: '',
  appearance: person.description.map(expected => ({ basis: ['photo', 'description'].includes(person.referenceSource) ? 'chosen-reference' : 'locked-description', expected, observed: expected, visible: true, matches: true, evidence: '' })),
  clothing: person.outfit.map(expected => ({ expected, observed: expected, visible: true, matches: true, evidence: '' })) });
// Use only at an offline reply boundary. The request supplies the anonymous
// expected people; these are explicit test observations, never historical OCR.
export function syntheticCastEvidence(request) {
  const payload = JSON.parse(request.body.input[0].content[0].text);
  const people = payload.expectedVisibleCast ?? payload.cast?.slice(0, payload.expectedPeopleCount);
  if (!Array.isArray(people)) throw new Error('This synthetic reply needs the request’s expected cast.');
  return { castObservations: people.map(person => ({ ...castObservation(person),
    identityEvidence: 'Synthetic fixture only: this body matches its anonymous supplied person.',
    appearance: castObservation(person).appearance.map(item => ({ ...item, evidence: 'Synthetic fixture only: visible appearance agrees with this comparison source.' })),
  })) };
}
export function storyCheckAnswer(tagline = 'Name it to tame it.') {
  // Synthetic sound opinion, not a rhyme algorithm. Tests needing a real pair name it explicitly.
  const ends = /Name it to tame it/i.test(tagline) ? ['Name', 'tame'] : tagline.split(/\s+/).map(word => word.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean).slice(0, 2);
  return { ...flags(storyCheckKeys), affectedFields: Object.fromEntries(storyCheckKeys.map(key => [key, []])),
    chapterShapeFindings: [], taglineEndWords: ends, taglineRhymes: true, evidence: { ...flags(storyCheckKeys).evidence, taglineRhymes: ends.map(value => JSON.stringify(value)).join(' / ') } };
}
export function markFault(answer, key, evidence, fields = [judgeFaultFields[key]?.[0] ?? 'tagline']) {
  answer[key] = true; answer.evidence[key] = evidence;
  if (key === 'chapterShapeWrong') answer.chapterShapeFindings = [{ rule: 'wobble', observedCount: 0, evidence }];
  if (key === 'outfitMismatch') answer.outfitObservations = [{ item: 'hoodie', kind: 'clothing', visible: true, differs: true, expected: 'green hoodie', observed: 'purple hoodie', evidence }];
  if (key === 'clutteredActionBackground') answer.actionBackgroundArea = 'acting-hand';
  if (answer.affectedFields) answer.affectedFields[key] = fields;
  return answer;
}
export const pictureCheckAnswer = () => ({ ...flags(pictureCheckKeys), actionBackgroundArea: 'none', sceneTooEmpty: false, evidence: { ...flags(pictureCheckKeys).evidence, sceneTooEmpty: '' }, transcription: [] });
// Measurements at the old grid positions. New drawings use the composed version, where any
// measured position is valid; pass posterTemplate.version to replay an older saved kit.
export const geometryAnswer = (templateVersion = currentPosterTemplateVersion) => ({ templateVersion, actionBackgroundArea: 'none', coordinateSpace: { unit: 'letter-points', width: 612, height: 792 }, textLines: bodyTextBoxes.map(boxId => ({ boxId, text: 'Synthetic visible words', x: geometryRects()[boxId].x + 2, y: geometryRects()[boxId].y + 1, w: geometryRects()[boxId].w - 4, h: 14 })), observed: Object.entries(geometryRects()).map(([id, rect]) => ({ id, ...rect })),
  writableRows: [{ blank: 'notice', x: 160, y: 548, w: 128, h: 12, baselineY: 560 }, { blank: 'action', x: 72, y: 560, w: 216, h: 12, baselineY: 572 }].map(row => ({ ...row, measurementKind: 'writable-area', certainty: 'confirmed', evidence: 'Synthetic fixture: clear area above this separate baseline, excluding the printed prompt.' })), ...flags(geometryBooleanKeys) });
export const sourceGeometryAnswer = (templateVersion) => {
  const answer = geometryAnswer(templateVersion), t = drawingTransform;
  const source = rect => ({ ...rect, x: rect.x * t.scale + t.x, y: rect.y * t.scale + t.y, w: rect.w * t.scale, h: rect.h * t.scale });
  answer.coordinateSpace = { unit: 'source-pixels', width: 1024, height: 1536 };
  answer.observed = answer.observed.map(source); answer.textLines = answer.textLines.map(source);
  answer.writableRows = [{ blank: 'notice', x: 250, y: 1016, w: 220, h: 26, baselineY: 1042 }, { blank: 'action', x: 100, y: 1043, w: 370, h: 26, baselineY: 1069 }].map(row => ({ ...row, measurementKind: 'writable-area', certainty: 'confirmed', evidence: 'Synthetic source-pixel fixture: clear writing area above its own baseline.' }));
  return answer;
};
// Synthetic panel fixtures use the child unless a test supplies a different endpoint.
export const wordCheckAnswer = boxes => ({ graphicStyle: { matchesSelectedStyle: true, flatInk: true, photographicTexture: false, toyShine: false, oversizedEyes: false, evidence: 'Explicit synthetic fixture, not an actual image style review.' }, ...(boxes.some(box => box.id === 'bubble') ? { bubbleSpeaker: { characterId: 'child', certainty: 'confirmed', evidence: 'Synthetic fixture tail touches the child mouth.' } } : {}), boxes: boxes.map(box => ({ id: box.id, text: boxText(box) })), extraText: [], ...flags(wordCheckBooleans), sceneTooEmpty: false, evidence: { ...flags(wordCheckBooleans).evidence, sceneTooEmpty: '' }, ...(boxes.some(box => box.id === 'footer') ? { geometry: sourceGeometryAnswer() } : {}) });
