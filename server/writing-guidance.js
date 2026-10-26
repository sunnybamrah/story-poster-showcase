import { words, moves } from './files.js';
import { isUntimedSourceAction } from './format.js';
import { printedCapacity } from './printed-capacity.js';
import { fieldValue } from './validation-reason.js';

// Counts guide the writer and reviewer. Rendered bounds decide printed fit.
export function normalizeKitText(value, field = '') {
  if (typeof value === 'string') return field === 'story' ? value.replace(/\r\n?/g, '\n') : value.replace(/\s+/gu, ' ').trim();
  if (Array.isArray(value)) return value.map(item => normalizeKitText(item, field));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeKitText(item, key)]));
  return value;
}

export function writingGuidance(text, { age } = {}) {
  const rows = [];
  const count = (field, value, minimum, maximum, target, unit = 'words') => {
    const measured = typeof value === 'number' ? value : words(value ?? '').length;
    rows.push({ field, measured, unit, range: [minimum, maximum], target, outsideRange: measured < minimum || measured > maximum, reportOnly: true });
  };
  const capacity = printedCapacity(text.moveId, age);
  count('story', text.story?.replace(/^MADE UP\n/, ''), 0, capacity.story.ceilingWords, capacity.story.targetWords);
  const wordCount = value => typeof value === 'string' ? words(value).length : Array.isArray(value) ? value.reduce((sum, item) => sum + wordCount(item), 0) : 0;
  for (const page of ['try', 'for-you']) {
    let pageWords = 0;
    for (const [field, allowance] of Object.entries(capacity[page].fields)) {
      const measured = wordCount(fieldValue(text, field));
      count(field, measured, 0, allowance, `at most ${allowance}`);
      rows.at(-1).page = page;
      pageWords += measured;
    }
    count(`${page}.generated`, pageWords, 0, capacity[page].totalWords, `at most ${capacity[page].totalWords}`);
  }
  count('chapterTitle', text.chapterTitle, 1, capacity.story.titleWords, '3 to 6');
  count('tagline', text.tagline, 4, 7, '4 to 7 words in total');
  count('feelFirst.statements', text.feelFirst?.length ?? 0, 1, 3, '2', 'statements');
  text.panelLines?.forEach((panel, i) => count(`panelLines[${i}].line`, panel.line, 1, 10, '3 to 7'));
  const untimed = isUntimedSourceAction(moves.find(move => move.id === text.moveId));
  text.tinyTryOptions?.forEach((option, i) => { if (!(untimed && option.seconds === null)) count(`tinyTryOptions[${i}].seconds`, option.seconds, 30, 90, 'roughly 30 to 90', 'seconds'); });
  return rows;
}
