import { graphicStyleObservationSchema } from './graphic-style.js';
import { narrativeFaultKeys } from './story-rules.js';
import { chapterShapeRules } from './story-review.js';
import { objectShape as object, listShape as list, stringShape as str, booleanShape as bool, numberShape as num } from './answer-shape.js';
import { storyCheckKeys, pictureCheckKeys, wordCheckBooleans, geometryBooleanKeys } from './checker-contract.js';
import { castObservationsParserSchema, castIds } from './cast.js';
import { speakerObservationSchema } from './panel-contract.js';

const panel = object({ scene: str, line: str, speakerId: { type: 'string', enum: castIds } }, ['scene', 'line']);
const option = object({ text: str, seconds: { type: 'number' }, offScreen: bool });
export const writerAnswerSchema = object({ moveId: str, chapterTitle: str, tagline: str, story: str, panelLines: list(panel), jokeIdea: str, feelFirst: list(str), tinyTryOptions: list(option), whereElse: object({ line: str, place: str }), noticedFeeling: str, replayCue: str });
export function writerSchema(fields, { untimed = false } = {}) {
  const full = structuredClone(writerAnswerSchema);
  if (untimed) full.properties.tinyTryOptions.items.properties.seconds = { type: ['number', 'null'] };
  if (!fields) return full;
  const properties = { story: str };
  for (const field of fields) {
    let schema = full;
    for (const part of field.replace(/\[(\d+)\]/g, '.$1').split('.')) schema = /^\d+$/.test(part) ? schema?.items : schema?.properties?.[part];
    if (!schema) throw new Error(`Unknown correction schema field: ${field}`);
    properties[field] = schema;
  }
  return structuredClone(object(properties));
}
export function writerRequestSchema(fields, { speakers = true, untimed = false } = {}) {
  const schema = writerSchema(fields, { untimed });
  const visit = shape => {
    if (shape.properties?.speakerId && shape.properties?.scene) {
      if (speakers) shape.required.push('speakerId');
      else delete shape.properties.speakerId;
    }
    if (shape.items) visit(shape.items);
    for (const child of Object.values(shape.properties ?? {})) visit(child);
  };
  visit(schema);
  return schema;
}
const flags = (keys, optionalEvidence = []) => ({ ...Object.fromEntries(keys.map(key => [key, bool])), evidence: object(Object.fromEntries([...keys, ...optionalEvidence].map(key => [key, str])), keys) });
export const judgeAnswerSchema = object({
  ...flags([...storyCheckKeys, 'taglineRhymes']),
  affectedFields: object(Object.fromEntries(storyCheckKeys.map(key => [key, list(str)]))),
  taglineEndWords: { ...list(str), minItems: 2, maxItems: 2 },
  chapterShapeFindings: list(object({ rule: { type: 'string', enum: Object.keys(chapterShapeRules) }, observedCount: { type: 'integer', minimum: 0 }, evidence: str })),
});
// Saved boolean answers can predate narrative assessments. Production requests still require every current key.
export const judgeParserSchema = structuredClone(judgeAnswerSchema);
judgeParserSchema.required = judgeParserSchema.required.filter(key => key !== 'chapterShapeFindings' && !narrativeFaultKeys.includes(key));
for (const field of ['evidence', 'affectedFields']) judgeParserSchema.properties[field].required = judgeParserSchema.properties[field].required.filter(key => !narrativeFaultKeys.includes(key));
const outfit = list(object({ item: str, kind: { type: 'string', enum: ['clothing', 'prop'] }, visible: bool, differs: bool, expected: str, observed: str, evidence: str }));
const area = { type: 'string', enum: ['acting-hand', 'elsewhere', 'none'] };
export const pictureParserSchema = object({ ...flags(pictureCheckKeys, ['sceneTooEmpty']), castObservations: castObservationsParserSchema, transcription: list(str), sceneTooEmpty: bool, actionBackgroundArea: area, outfitObservations: outfit }, [...pictureCheckKeys, 'evidence', 'transcription']);
const coordinates = { x: num, y: num, w: num, h: num };
export const writableRowSchema = object({ blank: { type: 'string', enum: ['notice', 'action'] }, measurementKind: { type: 'string', enum: ['writable-area', 'underline-ink', 'unclear'] }, certainty: { type: 'string', enum: ['confirmed', 'uncertain'] }, evidence: str, baselineY: num, ...coordinates });
export const geometryParserSchema = object({
  ...flags(geometryBooleanKeys, ['jokeOutsideRegion']), templateVersion: str, observed: list(object({ id: str, ...coordinates })),
  actionBackgroundArea: area, coordinateSpace: object({ unit: { type: 'string', enum: ['source-pixels', 'letter-points'] }, width: num, height: num }),
  textLines: list(object({ boxId: str, text: str, ...coordinates }, ['boxId', ...Object.keys(coordinates)])), jokeOutsideRegion: bool,
  writableRows: list(writableRowSchema),
}, [...geometryBooleanKeys, 'evidence', 'templateVersion', 'observed', 'textLines']);
const savedGraphicStyleSchema = structuredClone(graphicStyleObservationSchema);
savedGraphicStyleSchema.required = savedGraphicStyleSchema.required.filter(key => key !== 'matchesSelectedStyle');
export const wordParserSchema = isPoster => object({ ...flags(wordCheckBooleans, ['sceneTooEmpty', 'jokeInScene']), graphicStyle: savedGraphicStyleSchema, castObservations: castObservationsParserSchema, bubbleSpeaker: speakerObservationSchema, boxes: list(object({ id: str, text: str })), extraText: list(str), sceneTooEmpty: bool, jokeInScene: bool, outfitObservations: outfit, ...(isPoster ? { geometry: geometryParserSchema } : {}) }, [...wordCheckBooleans, 'evidence', 'boxes', 'extraText', ...(isPoster ? ['geometry'] : [])]);
