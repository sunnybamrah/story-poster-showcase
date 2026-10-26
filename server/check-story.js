import { learningActor } from './cast.js';
import { narrativeFaultKeys } from './story-rules.js';
import { assessGenerationCheck, assessCheck as assessHistoricalCheck } from './stop-policy.js';
import { inspectAnswer } from './answer-shape.js';
import { judgeParserSchema } from './answer-schemas.js';
import { extractJSON } from './files.js';
import { buildStoryCheckRequest } from './requests.js';
import { storyCheckKeys, posterQualityKeys, supportedFaults, brokenCheck, runCheck } from './checker-contract.js';
import { responseText } from './text-models.js';
import { needsTellingPanel } from './format.js';
import { judgeFaultFields, chapterShapeRules, chapterLimitText, isFixedStoryField, splitFixedStoryFaults } from './story-review.js';
const normalize = value => value.normalize('NFKC').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
const strings = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : [];
const tokens = text => normalize(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const legacyKeys = [...storyCheckKeys.filter(key => !posterQualityKeys.includes(key) && !narrativeFaultKeys.includes(key)), 'taglineDoesNotRhyme'];

// Direct parsing keeps saved evidence readable. checkStory requires a complete
// current content verdict by explicitly selecting generation:true.
export function parseStoryCheck(text, { story, move, record, generation = false } = {}) {
  let answers;
  try { answers = extractJSON(text); } catch { return brokenCheck('malformed story check'); }
  if (answers && legacyKeys.every(key => ['yes', 'no'].includes(answers[key]))) {
    return { ...brokenCheck('Legacy checker answer omits the current evidence and quality fields.', answers), qualityCoverage: 'legacy-unverified', extraKeys: [],
      ignoredFaults: [{ key: 'taglineDoesNotRhyme', reason: 'Legacy opinion has no supported sound verdict; no rhyme was derived by code.' }] };
  }
  const parsed = inspectAnswer(answers, judgeParserSchema), { extraKeys } = parsed;
  const broken = reason => ({ ...brokenCheck(reason, answers), extraKeys });
  const essentialIssues = parsed.issues.filter(issue => !issue.startsWith('chapterShapeFindings'));
  if (essentialIssues.length) return broken('incomplete story check: ' + essentialIssues.join(' '));
  const narrativePaths = narrativeFaultKeys.flatMap(key => [[key], ['evidence', key], ['affectedFields', key]]);
  const present = path => path.length === 1 ? Object.hasOwn(answers, path[0]) : answers[path[0]] && Object.hasOwn(answers[path[0]], path[1]);
  const currentNarrative = narrativePaths.some(present);
  const missingNarrative = narrativePaths.filter(path => !present(path));
  // A partial current verdict is malformed. An intact older verdict retains its known findings without invented false values.
  if (currentNarrative && missingNarrative.length) return broken('incomplete story check: ' + missingNarrative.map(path => path.join('.') + ' is required.').join(' '));
  const omittedNarrativeAssessments = currentNarrative ? [] : [...narrativeFaultKeys];
  const result = parsed.value;
  const pair = result.taglineEndWords;
  const namedPair = Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string' && tokens(value).length > 0);
  const written = typeof story?.tagline === 'string' ? ' ' + tokens(story.tagline).join(' ') + ' ' : null;
  if (!namedPair || written && pair.some(value => !written.includes(' ' + tokens(value).join(' ') + ' '))) return { ...broken('taglineEndWords must name two words occurring anywhere in the tagline; no sound verdict can be inferred by code.'), formatFault: 'taglineEndWords' };
  const evaluated = supportedFaults(result, storyCheckKeys), ignoredFaults = [...evaluated.ignoredFaults];
  const faults = [], affectedFields = {}, evidence = {}, reasons = {}, chapterShapeFindings = (Array.isArray(result.chapterShapeFindings) ? result.chapterShapeFindings : []).map(row => ({ ...row, ...(chapterShapeRules[row.rule] ? { field: chapterShapeRules[row.rule].field, unit: chapterShapeRules[row.rule].unit, limit: { min: chapterShapeRules[row.rule].min, max: chapterShapeRules[row.rule].max } } : {}), reportOnly: true }));
  const get = field => field.startsWith('move.') ? field.slice(5).split('.').reduce((value, key) => value?.[key], move) : story?.[field];
  for (const key of evaluated.faults) {
    const excerpt = normalize(result.evidence[key]).replace(/^["']|["']$/g, '');
    const named = result.affectedFields[key];
    if (!named.length) { ignoredFaults.push({ key, reason: 'No affected field was named; the unsupported claim cannot drive a correction.' }); continue; }
    const quotedFixed = [];
    const actualFields = named.filter(field => {
      if (isFixedStoryField(field)) return true;
      if (key === 'filledWhenINotice' && field === 'noticedFeeling') { ignoredFaults.push({ key, field, reason: 'noticedFeeling is the required parent script feeling, never the child blank.' }); return false; }
      if (!judgeFaultFields[key].includes(field)) { ignoredFaults.push({ key, field, reason: `This fault may name ${judgeFaultFields[key].join(', ') || 'approved wording only'}, not ${field}.` }); return false; }
      const values = strings(get(field));
      if (story && key === 'filledWhenINotice' && !values.some(value => /When I notice\b/i.test(value))) { ignoredFaults.push({ key, field, reason: 'This field has no When I notice frame. noticedFeeling belongs to the parent script, never the child blank.' }); return false; }
      if (story && key === 'filledWhenINotice' && values.every(value => (value.match(/When I notice\b/gi) ?? []).length === (value.match(/When I notice _+, I _+(?=[. "'’]|$)/gi) ?? []).length)) {
        ignoredFaults.push({ key, field, reason: 'Every When I notice frame in this field is empty, as required.' }); return false;
      }
      if (story && key === 'screenOnlyPlace' && field === 'whereElse' && /\baway from (?:a |the )?screens?\b/i.test(story.whereElse?.place ?? '')) {
        ignoredFaults.push({ key, field, reason: 'The supplied place explicitly says away from screens; that is the required off-screen setting.' }); return false;
      }
      if (story && key === 'screenOnlyPlace' && field === 'tinyTryOptions' && story.tinyTryOptions?.some(option => option.offScreen === true)) { ignoredFaults.push({ key, field, reason: 'At least one try is marked off screen. This key only faults a set with no off-screen option; a mislabeled individual try belongs to tinyTryWrong.' }); return false; }
      if (story && !values.some(value => normalize(value).includes(excerpt))) { ignoredFaults.push({ key, field, reason: 'The quoted evidence is absent from this supplied field.' }); return false; }
      if (story && ['secondMoveTaught', 'feelingGoesAwayPromise', 'adviceOutsideRecord', 'effortOnlyPraise', 'scienceClaimsTeachingHelped', 'tinyTryWrong'].includes(key)) {
        for (const fixed of ['practiceScript', 'positiveAction', 'bodyAction', 'kidScienceLine']) {
          let passage = move?.[fixed];
          if (fixed === 'practiceScript' && passage) passage = passage.replaceAll('[name]', record?.kitContext?.focusPersonId && record.kitContext.focusPersonId !== 'child' ? learningActor(record).storyName : record?.hero?.nickname ?? '[name]').replace(/\bDad\b/g, record?.parentLabel ?? 'Dad');
          if (!passage) continue;
          passage = normalize(passage);
          if (passage.includes(excerpt) && values.some(value => normalize(value).includes(passage)) && !values.some(value => normalize(value).replaceAll(passage, '').includes(excerpt))) {
            quotedFixed.push(`move.${fixed}`); return false;
          }
        }
      }
      return true;
    });
    actualFields.push(...quotedFixed);
    if (!actualFields.length) continue;
    if (key === 'chapterShapeWrong') reasons[key] = 'Chapter shape and counts are review only under pass 24. ' + result.evidence[key];
    faults.push(key); affectedFields[key] = actualFields; evidence[key] = result.evidence[key];
  }
  // The boolean is the judge's sound opinion. Code checks pair membership only.
  const reviewFlags = result.taglineRhymes ? [] : [{ key: 'taglineRhymes', fields: ['tagline'], evidence: result.evidence.taglineRhymes, reason: 'The judge reported a sound concern. Approved wording prints verbatim.', label: "FOR SUNNY'S READ", reportOnly: true }];
  for (const issue of parsed.issues.filter(issue => issue.startsWith('chapterShapeFindings'))) reviewFlags.push({ key: 'chapterShapeFindings', evidence: issue, label: "FOR SUNNY'S READ", reportOnly: true });
  const checked = splitFixedStoryFaults({ ready: faults.length === 0, faults, answers, extraKeys, affectedFields, evidence, reasons, chapterShapeFindings, ignoredFaults, reviewFlags, needsRecheck: false,
    qualityCoverage: omittedNarrativeAssessments.length ? 'historical-narrative-unverified' : 'current', verified: omittedNarrativeAssessments.length === 0, omittedNarrativeAssessments, translationWord: evidence.wordAChildMustTranslate ?? null,
    rhyme: { namedWords: pair, checkerRhymes: result.taglineRhymes, rhymes: result.taglineRhymes, source: 'judge' } });
  if (generation && omittedNarrativeAssessments.some(key => ['concernDrift', 'storyContinuity', 'scienceRecordMissingOrChanged'].includes(key))) { checked.contentNeedsRecheck = true; checked.needsRecheck = true; }
  if (omittedNarrativeAssessments.length) checked.reviewFlags.push({ key: 'narrative_checks_unverified', fields: ['story'],
    evidence: 'This saved answer has no assessments for: ' + omittedNarrativeAssessments.join(', ') + '.',
    reason: 'The earlier verdict is retained. Missing assessments are unverified, never filled with false values.', label: "FOR SUNNY'S READ", reportOnly: true });
  return (generation ? assessGenerationCheck : assessHistoricalCheck)(checked);
}

export async function checkStory(transport, story, move, { kit, retry = 0, record, tonight = '' } = {}) {
  return runCheck(transport, { provider: 'openai', path: '/v1/responses', familyRecord: { ...record, real: record?.real === true }, stage: 'story-check', kit, body: buildStoryCheckRequest(story, move, { record, tonight }) },
    response => parseStoryCheck(responseText(response), { story, move, record, generation: true }), { retry });
}
