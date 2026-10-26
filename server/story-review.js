import { narrativeFaultKeys } from './story-rules.js';
// Shared by the judge brief, parser and writer corrections. No sound heuristics.
export const isFixedStoryField = field => field === 'tagline' || field.startsWith('move.');
const generated = ['story', 'chapterTitle', 'panelLines', 'jokeIdea', 'feelFirst', 'tinyTryOptions', 'whereElse', 'noticedFeeling', 'replayCue'];
export const judgeFaultFields = {
  secondMoveTaught: generated,
  feelingGoesAwayPromise: generated,
  adviceOutsideRecord: generated,
  jokeAtPerson: generated,
  effortOnlyPraise: generated,
  filledWhenINotice: generated.filter(field => field !== 'noticedFeeling'),
  screenOnlyPlace: ['whereElse', 'tinyTryOptions'],
  chapterShapeWrong: ['story', 'panelLines'],
  tinyTryWrong: ['tinyTryOptions'],
  rhymeUsesStoryWords: [],
  rhymeDoesNotStateMove: [],
  wordAChildMustTranslate: [],
  scienceClaimsTeachingHelped: generated,
  ...Object.fromEntries(narrativeFaultKeys.map(key => [key, ['story']])),
};
// FORMAT v5 chapter and word rules, including its conditional telling-panel addition.
export const chapterShapeRules = {
  hookLines: { field: 'story', unit: 'hook lines', min: 3, max: 3 },
  wobble: { field: 'story', unit: 'wobble passages', min: 1, max: null },
  scienceIdea: { field: 'story', unit: 'science ideas', min: 1, max: 1 },
  try: { field: 'story', unit: 'attempts at the move', min: 1, max: null },
  outcome: { field: 'story', unit: 'outcome passages', min: 1, max: null },
  imperfectEnding: { field: 'story', unit: 'honest imperfect endings', min: 1, max: null },
  explainedWords: { field: 'story', unit: 'explained bigger words', min: 0, max: null },
  alignedBubbles: { field: 'panelLines', unit: 'bubbles aligned with their story pages', min: 4, max: 4 },
  unkindBubbles: { field: 'panelLines', unit: 'unkind bubbles', min: 0, max: 0 },
  grownUpTelling: { field: 'panelLines', unit: 'required grown-up telling scenes', min: 1, max: null },
};
export const chapterLimitText = rule => rule.max === null ? `at least ${rule.min}` : rule.min === rule.max ? `exactly ${rule.min}` : `${rule.min} to ${rule.max}`;
export const reviewFlag = (key, fields, evidence, reason) => ({ key, fields, evidence, reason, label: "FOR SUNNY'S READ", reportOnly: true });
export function splitFixedStoryFaults(check) {
  const faults = [], affectedFields = {}, reviewFlags = [...(check.reviewFlags ?? [])];
  for (const key of check.faults) {
    const fields = check.affectedFields?.[key] ?? [];
    const fixedField = field => isFixedStoryField(field) && !(key === 'freshRhymeInvalid' && field === 'tagline');
    const fixed = fields.filter(fixedField), authored = fields.filter(field => !fixedField(field));
    if (fixed.length) reviewFlags.push(reviewFlag(key, fixed, check.evidence?.[key] ?? '', 'Approved wording remains verbatim. This opinion cannot stop or rewrite a kit.'));
    if (authored.length || !fields.length) { faults.push(key); affectedFields[key] = authored; }
  }
  return { ...check, faults, affectedFields, reviewFlags, ready: !check.needsRecheck && faults.length === 0 };
}
export function formatReviewFlags(flags) {
  if (!flags.length) return 'No approved-wording concerns were reported.';
  return flags.map(flag => `${flag.label}: ${flag.fields.join(', ')}; ${flag.key}; ${flag.evidence}; ${flag.reason}`).join('\n');
}
