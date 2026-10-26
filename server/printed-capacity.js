import { readJSON } from './files.js';

// Editorial budgets and any measured samples guide writing, never validation stops.
export const printedCapacity = (moveId, age) => {
  const capacity = readJSON(new URL('../content/printed-capacity.json', import.meta.url));
  // Shorter writing is an editorial choice for younger readers, not a new stop.
  if (Number.isInteger(age) && age <= 10) {
    const shorter = story => ({ ...story, targetWords: 350, ceilingWords: 450, pages: [175, 175] });
    capacity.story = shorter(capacity.story);
    capacity.byMove = Object.fromEntries(Object.entries(capacity.byMove ?? {}).map(([id, value]) => [id, { ...value, story: shorter(value.story ?? capacity.story) }]));
  }
  return { ...capacity, ...capacity.byMove?.[moveId] };
};
export function printedLengthRule(moveId, age) {
  const capacity = printedCapacity(moveId, age);
  const fields = page => Object.entries(capacity[page].fields).map(([field, words]) => `${field}: ${words} words`).join('; ');
  return `Writing guidance for the fixed readable sizes: story target ${capacity.story.targetWords}, advisory ceiling ${capacity.story.ceilingWords} spoken words total, about ${capacity.story.pages.join(' and ')} words of space planned on its two pages. These writing budgets are editorial choices, not a research rule. ${capacity.measured ? `Browser samples at these sizes fit ${capacity.story.measuredSamplePages.join(' and ')} words; a new chapter still needs its own fit check.` : 'Fresh browser fit is unverified.'} For the selected move use printedCapacity.byMove[moveId] when present; its budgets account for the fixed records. Show the same source action through the story. Keep the science idea brief; full research details print in the parent strip. Use short dialogue paragraphs, with the three short hook lines included. Chapter title: at most ${capacity.story.titleWords} words. TRY IT generated words: ${capacity.try.totalWords} total (${fields('try')}). CARDS generated words: ${capacity['for-you'].totalWords} total (${fields('for-you')}). The Try It budget assumes the restored short practice cards, without printed timings or the long science block. Type and panel sizes stay fixed. These are writing targets and advisory ceilings, never count-only rejection rules. Page cuts follow the middle two bubbles, so place those near the supplied page budgets. Actual browser fit can request shorter generated prose below these targets. Preserve all fixed wording and the other saved page when shortening. Use the supplied age-aware writing target when it fits. Never pad a saved chapter to meet a word count.`;
}
