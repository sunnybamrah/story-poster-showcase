import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// The owner's original ChatGPT Project files, preserved with privacy edits in this
// checkout. Public copy: names and identifying details in these files are
// replaced with the same neutral words projectStorySource() already
// substitutes, so every generated prompt is unchanged
// (test/public-copy-prompts.test.mjs).
// New drawing requests quote their actual lines. Each use names its file and
// line; every change to a line is listed with its reason. CHARACTER-SHEET,
// FAMILY-FACTS and SKILL-MAP hold one family's private details or older advice
// and are never sent for any family.
const directory = new URL('../war-room/research/chatgpt-growth-project/project-files/', import.meta.url);
export const projectSourceFiles = Object.freeze({
  'STYLE.txt': 'be272ffd2f3c878c42b11e2721aa6b16b8b816c1bf62e02fead6ac8bdf40fdc0',
  'FORMAT.txt': '4d793e60fdc6038d5b5cd72b41d180fde7689d00f7262638264141ac1c5bb440',
  'PROJECT-INSTRUCTIONS.txt': '2c2f3bf3a2dce3cd28a2dd4fabdb9dc70423cebc780dc51cd6b017a226c22b15',
  'POSTER-CHECK.txt': '8c41291b9f666c949ba14176f1135ffd4364cb0fb993d41985fcf36dc5818ada',
});
const lineCache = new Map();
function linesOf(file) {
  if (!projectSourceFiles[file]) throw new Error(`${file} is not a shared original Project file.`);
  if (!lineCache.has(file)) {
    const bytes = readFileSync(new URL(file, directory));
    if (createHash('sha256').update(bytes).digest('hex') !== projectSourceFiles[file]) throw new Error(`${file} changed. The original Project files must stay byte for byte.`);
    lineCache.set(file, bytes.toString('utf8').split('\n'));
  }
  return lineCache.get(file);
}
export function projectSourceLine(file, line) {
  const text = linesOf(file)[line - 1];
  if (typeof text !== 'string' || !text.trim()) throw new Error(`${file} line ${line} is empty or missing.`);
  return text;
}
// Apply only the listed changes; a change that no longer matches the original fails loudly.
function adapted({ file, line, changes = [] }) {
  let text = projectSourceLine(file, line);
  for (const [find, replace] of changes) {
    if (!text.includes(find)) throw new Error(`${file} line ${line} no longer contains: ${find}`);
    text = text.replace(find, replace);
  }
  return text.replace(/^- /, '').trim();
}
const family = 'family substitution: the original names one family; each family supplies its own people';
const owner = 'owner decision, October 16: same core parts, the drawing model chooses places and sizes';
const app = 'the app does this step itself';
// The original lines a new poster drawing request quotes, in order.
export const posterSourceUses = Object.freeze([
  { file: 'STYLE.txt', line: 5 },
  { file: 'STYLE.txt', line: 6 },
  { file: 'STYLE.txt', line: 8, changes: [['one big hero picture at the top third, the text blocks below in rounded cards', 'one big hero picture and the text blocks in rounded cards']], why: owner },
  { file: 'STYLE.txt', line: 9 },
  { file: 'STYLE.txt', line: 10 },
  { file: 'STYLE.txt', line: 31, changes: [['showing her DOING', 'showing the hero DOING']], why: family },
  { file: 'STYLE.txt', line: 32 },
  { file: 'STYLE.txt', line: 33 },
  { file: 'STYLE.txt', line: 35, changes: [[' Run POSTER-CHECK.txt before the final PDF.', '']], why: app },
  { file: 'FORMAT.txt', line: 11, changes: [['Under 110 words. ', '']], why: 'owner: the poster word count is report-only' },
  { file: 'PROJECT-INSTRUCTIONS.txt', line: 19, changes: [[' If you cannot open the reference images, say so in one line and DRAW IT ANYWAY from STYLE.txt and CHARACTER-SHEET.txt, then ask Dad to upload them.', '']], why: app },
  { file: 'PROJECT-INSTRUCTIONS.txt', line: 20, why: `${owner}; ${family}; ${app}`, changes: [
    ['Read STYLE.txt. ', ''],
    ["Keep the poster reference's STRUCTURE (same boxes, same places) but draw a NEW scene", "Keep the poster's familiar parts, placed where you think best, and draw a NEW scene"],
    [' Check memory for the last two worlds and colour sets; do not repeat.', ''],
    ['the learner exactly as CHARACTER-SHEET.txt.', 'Each person exactly as their own reference.'],
    ['Put every word inside quotes in the image prompt, and every word must', 'Every word must']] },
  { file: 'PROJECT-INSTRUCTIONS.txt', line: 21, why: family, changes: [
    ['ALWAYS the learner DOING THE MOVE, never the moment she struggled, never her watching', 'ALWAYS the hero DOING THE MOVE, never the moment the hero struggled, never the hero watching'],
    ['never the thing she could not do', 'never the thing the hero could not do'],
    ['hangs on her wall for weeks where her friends and family see it', 'hangs on the wall for weeks where friends and family see it'],
    // FORMAT line 17 records the drawing model printing an old box from its name; it never sees that name.
    [' For the same reason the worried thoughts box (WHAT YOUR BRAIN SAYS) goes in the story, NOT on the poster: use that space for the one tiny try.', ''],
    ['what would they learn about her? That she has a move, never that she was the one who could not.', 'what would they learn about the hero? That the hero has a move, never that the hero was the one who could not.']] },
]);
// The owner's chosen looks (October 16) each have their own drawing style, so the
// original single style line gives way to the family's look, by name. For the
// black-ink look the original colour words give way too. Older looks keep the
// quoting above exactly.
const chosenLookWhy = "owner decision, October 16: the family's chosen look replaces the original single drawing style";
const inkLookWhy = 'owner decision, October 16: Diary doodles is black ink on off-white paper, so the original colour words give way';
export function posterSourceUsesFor(chosenLook) {
  if (!chosenLook) return posterSourceUses;
  const more = ({ file, line }) => {
    if (file === 'STYLE.txt' && line === 5) return { changes: [['middle grade graphic novel like Smile or The Baby Sitters Club. Clean ink lines, flat warm colours, normal proportions, real expressions, no oversized eyes, no toy shine.', `the family's chosen look, ${chosenLook.label}, as its look rule in this request describes it, with real expressions and no toy shine.`]], why: chosenLookWhy };
    if (file === 'STYLE.txt' && line === 9 && chosenLook.monochrome) return { changes: [['in its own colour and box', 'in its own bold box']], why: inkLookWhy };
    if (file === 'PROJECT-INSTRUCTIONS.txt' && line === 20) return { changes: [['Graphic novel style.', `Drawn in ${chosenLook.label}.`], ...(chosenLook.monochrome ? [['new colour set, new hero picture, rich and colourful, hand drawn', 'new hero picture, rich in drawn detail, hand drawn in black ink']] : [])], why: chosenLook.monochrome ? `${chosenLookWhy}; ${inkLookWhy}` : chosenLookWhy };
    return null;
  };
  return Object.freeze(posterSourceUses.map(use => {
    const extra = more(use);
    return extra ? { ...use, changes: [...(use.changes ?? []), ...extra.changes], why: [use.why, extra.why].filter(Boolean).join('; ') } : use;
  }));
}
export const projectPosterSource = chosenLook => ['FROM THE ORIGINAL PROJECT FILES (style, format and drawing instructions):', ...posterSourceUsesFor(chosenLook).map(adapted)].join('\n');
// The original style line every family drawing starts from.
export const originalStyleLine = () => adapted({ file: 'STYLE.txt', line: 5 });
// POSTER-CHECK steps 1 and 6, for the poster word checker. Its other steps
// (redraw, counting, key word history) are done by the app itself.
export const originalPosterCheck = () => [`${projectSourceLine('POSTER-CHECK.txt', 14).trim()} ${projectSourceLine('POSTER-CHECK.txt', 15).trim()}`, projectSourceLine('POSTER-CHECK.txt', 23).trim()];

// The shared story brief comes from the same preserved Project as the poster.
// Only these named owner changes and family substitutions alter its words.
const younger = 'owner, October 17: plain language and shorter age-aware stories; no vocabulary quota';
export const storySourceUses = Object.freeze([
  { file: 'PROJECT-INSTRUCTIONS.txt', line: 1, changes: [
    ['You make "the learner\'s Confidence Guide": a five page kit for the learner (a child aged 8 to 13). Dad leads: he picks the topics and reads the kit aloud at night. A sibling appears in a story only when they were really there.', 'Make a five-page family kit. The parent chooses the moment and reads it aloud at a calm time. Use only the people supplied for this kit, including a sibling only when selected.'],
  ], why: family },
  { file: 'PROJECT-INSTRUCTIONS.txt', line: 5, changes: [['Tag it MADE UP.', 'Use the supplied storyMode to label factual retelling versus inspired fiction.']], why: 'owner, October 17: honest factual or inspired mode' },
  { file: 'FORMAT.txt', line: 7 },
  { file: 'FORMAT.txt', line: 8 },
  { file: 'FORMAT.txt', line: 15, changes: [['fresh every time: catchy, short, something she can say back tomorrow.', 'the familiar saved reminder for this topic, copied exactly throughout the kit. New moments change the story and pictures.']], why: 'owner, October 19: keep familiar topic reminders across stories' },
  { file: 'FORMAT.txt', line: 26, changes: [
    ['550 to 750 spoken words. Written to be read aloud to a bright 10 year old: natural dialogue, mixed sentence lengths, rich feeling words, two or three bigger words explained inside the story.', 'Use the supplied age-aware writing target. Short sentences, familiar words, natural dialogue and clear actions. No minimum length and no required bigger words.'],
  ], why: younger },
  { file: 'FORMAT.txt', line: 27 },
  { file: 'FORMAT.txt', line: 28, changes: [['the science whispered once by Dad, Mom, a friend or her own thinking;', 'the learning noticed once in simple family words; research findings and limits stay in the poster and parent notes;']], why: 'owner, October 19: simple age-eight language, including parent guides; keep factual events exact' },
  { file: 'FORMAT.txt', line: 29 },
  { file: 'FORMAT.txt', line: 32 },
  { file: 'FORMAT.txt', line: 33 },
  { file: 'FORMAT.txt', line: 34, changes: [['TINY TRY (30 to 90 seconds, she picks one): two or three real world or rehearsal options that fit the moment.', 'TINY TRY: three brief real-world or rehearsal choices for the same action. The learner chooses. Use source-owned timing only when supplied; an untimed guide stays untimed.']], why: 'app answer shape; owner: simple optional practice without invented timing' },
  { file: 'FORMAT.txt', line: 35 },
  { file: 'FORMAT.txt', line: 36 },
  { file: 'FORMAT.txt', line: 37 },
  { file: 'FORMAT.txt', line: 40 },
  { file: 'FORMAT.txt', line: 45 },
]);
export function projectStorySource() {
  const generic = value => value
    .replace(/\bDad\b/g, 'the parent').replace(/\bSHE\b/g, 'THE LEARNER');
  return ['FROM THE ORIGINAL PROJECT, WITH THE LISTED OWNER CHANGES:', ...storySourceUses.map(use => `[${use.file}:${use.line}] ${generic(adapted(use))}`)].join('\n');
}
