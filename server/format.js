import { reviewNote } from './stop-policy.js';
import { moves, words } from './files.js';
import { selectedRhymeFor } from './rhyme.js';
import { createHash } from 'node:crypto';
import { validationFailure, validationErrors, requireCount, requireLine } from './validation-reason.js';
import { isPreparedMove } from './library-prepared.js';
import { keywordHistory } from './memory.js';
import { readerClarity, practiceReaderText } from '../app/reader-notes.js';

// FORMAT v6 slots. No reference-family prose or artwork is stored here.
export const emptyMove = 'When I notice ______, I ______.';
export const talkQuestions = ['What did it feel like right before?', 'What helped most, and how did you know?'];
export const replayQuestions = ['Think back. What did you first notice in your thoughts or body?', 'What is your move? Try to remember and show it. Then turn over and check.', 'Think of another time. Would this move fit? Would another way or some help fit better?'];
export const whereElsePrompt = 'Think of a place you might be tomorrow, away from a screen. What would you notice? Picture trying your move.';
export const replayQuietNight = 'Try it again on another calm night, even if you have not needed it yet.';
export const replayRule = 'If they forget, give a clue and try again another time. If they know the words but need help doing it, show it together. If they use it, wait longer before the next practice. If it does not help, choose another way. If they remember but do not use it, ask what got in the way. Make the action smaller or choose a clue they notice.';
// The complete v6 guidance stays in the parent's companion notes.
export const printedReplayRule = 'Forgot? Give a clue. Hard to show? Try together. Used it? Wait longer before the next practice. Not used? Ask why. Not helpful? Choose another way.';
export const cardPurpose = 'On another calm day, try to remember the idea together. Turn the card over for help. To make a paper card, cut around the outside and fold down the middle.';
export const parentChoice = 'Want me to listen, help you think of an idea, or give you some space?';
export const parentAcceptance = 'No or later is okay. Practice is a choice. Give a clue or show the move if it is hard to remember.';
// The cut-out parent card contains speech; directions stay in the parent notes.
export function parentSpokenLines(move, noticedFeeling, { parentFocus = false } = {}) {
  const sentenceCase = text => text.replace(/^\p{Lu}/u, letter => letter.toLocaleLowerCase('en-US'));
  if (parentFocus) return ['My feelings are mine to handle. You do not need to fix them.', 'You can sit with me or have some space.', `I can practise “${sentenceCase(move.name)}”.`, 'I will notice what I do and try again.'];
  return [`I noticed you looked ${sentenceCase(noticedFeeling)}. That makes sense.`, parentChoice,
    `Want to try “${sentenceCase(move.name)}” now, or later?`, 'You did the move. What did you notice?'];
}
// Presentation only. Saved evidence classifications and limitations never change.
const evidenceLabels = Object.freeze({ DIRECT: 'Children, same skill', ADJACENT: 'Related child research', MECHANISM: 'How it may work', 'ADULT ONLY': 'Studied in adults', DESCRIPTIVE: 'A pattern was seen, not proof of what caused it', GUIDANCE: 'Official guidance' });
export function evidenceLabelFor(label) {
  if (!Object.hasOwn(evidenceLabels, label)) throw new Error(`Unknown evidence classification: ${label}`);
  return evidenceLabels[label];
}
export const talkOffer = 'Offer the two questions. The child may choose one or skip both. Ask a second only if the child wants to keep talking.';
export const replayTransfer = 'Let the child choose a moment. This move may not fit every time. Get help if someone is being hurt. Try the move when it fits and the child wants to.';
export const parentGuidance = 'This guide is for practice. It does not replace health care. If big feelings keep getting in the way of sleep, school, friends or home life, ask a doctor or someone trained to help children.';
export function guidanceFor({ parentFocus = false } = {}) {
  if (!parentFocus) return { parentAcceptance, talkOffer, replayTransfer, parentGuidance, replayQuietNight, replayRule };
  return {
    parentAcceptance: 'This is the grown-up’s practice. The child can listen or leave. It is not the child’s job to calm or check the grown-up.',
    talkOffer: 'The grown-up answers. The child can listen, join in, or skip this.',
    replayTransfer: 'Choose another moment when this move fits your own actions. Getting adult help is also a choice.',
    parentGuidance: 'This guide is for practice. It does not replace health care. Ask a doctor or counselor if you need help with your own feelings or actions.',
    replayQuietNight,
    replayRule: 'Practise when it helps. If you forget, make the move smaller. If it does not fit, try another way or ask an adult for help. The child does not need to check your progress.',
  };
}
export const noDirectEvidence = 'Direct evidence in kids her age: not found. Related research suggests it may help.';
export const cardTitles = ['ONE TINY TRY FOR TODAY', 'WHAT SCIENCE SAYS', 'WHAT I CAN DO', 'HOW TO REMEMBER IT', 'WHERE IT CAME FROM'];
export const parentLabelFor = record => record.parentLabel ?? 'Dad';
export const isUntimedSourceAction = move => (move?.library?.schemaVersion === 2 || isPreparedMove(move)) && move.library.actionKind === 'source-derived' && move.library.practiceMode === 'untimed';
export function backupFor(move) {
  if (isUntimedSourceAction(move) && move.approvedBackup === null) return null;
  const backup = moves.find(item => item.id === move.approvedBackup && item.id !== move.id);
  if (!backup) throw new Error('A backup from the fixed move list is required.');
  return backup;
}
export const backupNameFor = move => backupFor(move)?.name ?? 'Leave this for later';
export const backupPlanLineFor = move => backupFor(move) ? `Backup: ${backupNameFor(move)}` : backupNameFor(move);
export const backupPracticeLineFor = move => backupFor(move) ? `Another way to try: ${backupActionFor(move)}` : backupNameFor(move);
// One proposed science record supplies every surface. Legacy wording stays in moves.json for review.
export function scienceFor(move) {
  const record = move.science ?? {};
  return { ...(move.detail?.science ?? {}), ...record,
    claim: record.claim ?? move.kidScienceLine,
    limitation: record.limitation ?? move.detail?.science?.limitation ?? move.source?.limitation ?? '',
    reviewLabel: record.reviewLabel ?? '', approval: record.approval ?? { status: 'pending', by: null } };
}
export function backupActionFor(move) {
  const backup = backupFor(move);
  if (!backup) return 'Leave this for later';
  const text = backup.tryItDraft?.backupAction;
  if (!text) throw new Error(`neutral_backup_missing: ${backup.id} needs context-neutral wording.`);
  return text;
}
export function tinyTryOptionsFor(move) {
  const options = move.tryItDraft?.options;
  if (!Array.isArray(options) || options.length !== 3) throw new Error(`distinct_tiny_tries_missing: ${move.id} needs three different small actions.`);
  return structuredClone(options).map(({ kind, ...option }) => ({ ...option, text: practiceReaderText('guide-try', move, option.text) }));
}
export function rhymeReviewLabelFor(move, tagline) {
  if (!tagline) return '';
  const selected = selectedRhymeFor(move);
  return tagline && tagline === selected.tagline ? selected.reviewLabel : '';
}
// Keep a fixed example's instruction and action, but do not print its sample
// person's name as though it belonged to this family. No identity goes to art.
// This presentation rule applies to any own-name example, not one nickname.
export const practiceFor = (move, nickname = '[name]', parentLabel = 'Dad') => practiceReaderText('guide-practice', move, move.practiceScript).replaceAll('[name]', nickname).replace(/\bDad\b/g, parentLabel);
export const positiveActionFor = move => practiceReaderText('guide-action', move, move.positiveAction).replace(/(\bUse your name:\s*['“"])[\p{Lu}][\p{L}'’-]*,\s*/gu, '$1').replace(/(\bUse your name:\s*['“"])(\p{Ll})/gu, (_, opening, initial) => opening + initial.toLocaleUpperCase('en-US'));
export const posterScienceClaimFor = move => readerClarity('poster-claim', move.id, scienceFor(move).claim);
export function posterBoxes(move, { tagline = '' } = {}) {
  if (!move.bodyAction || words(move.keyWord).length !== 1) throw new Error('Poster needs one key word and a body action.');
  return [
    { id: 'title', text: move.name },
    { id: 'tagline', text: tagline },
    { id: 'tiny', title: cardTitles[0], text: positiveActionFor(move), card: true },
    { id: 'science', title: cardTitles[1], text: posterScienceClaimFor(move), card: true },
    { id: 'keyword', text: move.keyWord },
    { id: 'move', title: cardTitles[2], text: `${emptyMove.replace(', I ', ',\nI ')}\n${backupPlanLineFor(move)}`, card: true },
    { id: 'remember', title: cardTitles[3], text: [tagline, move.bodyAction].filter(Boolean).join('\n'), card: true },
    { id: 'source', title: cardTitles[4], text: `${move.whereItCameFromShort} Search: ${move.searchPhrase}`, card: true },
    { id: 'footer', text: '' },
  ];
}
export const boxText = box => [box.title, box.text].filter(Boolean).join('\n');
export const posterFooter = (nickname = 'Pip') => `${nickname}'s Confidence Guide`;
// Contractions and hyphenated words count once. Empty handwriting rules are not words.
export const visibleWords = text => text.match(/[\p{L}\p{N}]+(?:['’‘-][\p{L}\p{N}]+)*/gu) ?? [];
export const approvedPosterWords = (move, kit, { nickname = 'Pip' } = {}) => posterBoxes(move, kit).map(box => box.id === 'footer' ? { ...box, text: posterFooter(nickname) } : box);
export const posterSlotWordCounts = (move, kit, options) => Object.fromEntries(approvedPosterWords(move, kit, options).map(box => [box.title ?? box.id, visibleWords(boxText(box)).length]));
export const posterWordCount = (move, kit, options) => Object.values(posterSlotWordCounts(move, kit, options)).reduce((sum, value) => sum + value, 0);
export function posterCountReport(count, id = 'poster') {
  if (!Number.isInteger(count) || count < 0) throw new Error(`Poster word count is not a number for ${id}.`);
  return { id, count, cap: 109, status: count <= 109 ? 'PASS' : 'WARN', reportOnly: true };
}
export function assertPosterWordCap(count, id = 'poster') {
  const report = posterCountReport(count, id);
  return report;
}
export const posterWordReport = (move, kit, options) => ({ ...posterCountReport(posterWordCount(move, kit, options), move.id), slots: posterSlotWordCounts(move, kit, options) });
export const keyWordFitsHistory = (record, move) => !keywordHistory(record).some(kit => kit.keyWord.toLocaleLowerCase() === move.keyWord.toLocaleLowerCase() && kit.keyWordMeaning !== move.positiveAction);
export function assertKeyWordHistory(record, move) {
  if (!keyWordFitsHistory(record, move)) throw new Error('repeated_key_word: This saved key word already has a different meaning. Choose another guide or keep its original meaning.');
}
export const needsTellingPanel = move => ['bring-in-my-person', 'one-brave-step', 'dont-feed-the-fire'].includes(move.library?.actionBaseMoveId ?? move.id);

const bubbleWords = text => text.toLowerCase().replace(/\p{P}/gu, '').match(/[\p{L}\p{N}]+/gu) ?? [];
const containsBubble = (sentence, line) => {
  const target = bubbleWords(line);
  if (!target.length) return false;
  let next = 0;
  for (const word of bubbleWords(sentence)) {
    if (word === target[next]) next++;
    if (next === target.length) return true;
  }
  return false;
};
function storySentences(body) {
  const sentences = []; let paragraph = 0;
  for (const match of body.matchAll(/[^\r\n]+/gu)) {
    const text = match[0]; let start = 0;
    for (const endMatch of text.matchAll(/[.!?]+["'”’)\]]*/gu)) {
      const end = endMatch.index + endMatch[0].length;
      if (bubbleWords(text.slice(start, end)).length) sentences.push({ start: match.index + start, end: match.index + end, text: text.slice(start, end), paragraph });
      start = end;
    }
    if (bubbleWords(text.slice(start)).length) sentences.push({ start: match.index + start, end: match.index + text.length, text: text.slice(start), paragraph });
    paragraph++;
  }
  return sentences;
}
function bubbleMatches(sentences, line, matchText = text => text) {
  return sentences.flatMap((sentence, i) => {
    if (containsBubble(matchText(sentence.text), line)) return [{ start: i, end: i }];
    const next = sentences[i + 1];
    return next?.paragraph === sentence.paragraph && !containsBubble(matchText(next.text), line) && containsBubble(matchText(sentence.text + ' ' + next.text), line) ? [{ start: i, end: i + 1 }] : [];
  });
}
export const bubbleInStory = (story, line, { matchText } = {}) => bubbleMatches(storySentences(story), line, matchText).length > 0;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const storyKey = (story, panelLines) => digest({ story, panelLines });

export function assertStoryPagination(story, panelLines, pagination) {
  if (!pagination || pagination.source !== storyKey(story, panelLines)) throw validationFailure('stored_pagination_mismatch', { field: 'pagination.source', value: pagination?.source, measured: 0, unit: 'matches to this story and its bubbles', limit: { exactly: 1 }, instruction: 'rebuild exactly 1 saved cut in code because Stored chapter pages do not match this story and its bubbles' });
  const { receipt, ...saved } = pagination;
  if (receipt !== digest(saved)) throw validationFailure('stored_pagination_changed', { field: 'pagination.receipt', value: receipt, measured: 0, unit: 'matching saved checksums', limit: { exactly: 1 }, instruction: 'restore exactly 1 validated cut in code because Stored chapter pages changed after validation' });
  return pagination;
}

function splitStoryByBubbles(story, panelLines, { matchText, lockedPage, pageIndex } = {}) {
  const errors = [];
  try { requireCount(panelLines, 'panelLines', 4, 'panels', 'need_four_short_panel_lines'); } catch (error) { errors.push(error); }
  if (!Array.isArray(panelLines)) throw validationErrors(errors);
  const body = story.replace(/^(?:MADE UP|REAL)\n/, '').trim();
  const sentences = storySentences(body), ranges = [];
  panelLines.forEach((panel, index) => {
    if (typeof panel?.line !== 'string' || !panel.line.trim()) {
      try { requireLine(panel?.line, `panelLines[${index}].line`, 7, 'panel_bubble_too_long'); } catch (error) { errors.push(...(error.errors ?? [error])); }
      ranges.push(null); return;
    }
    const matches = bubbleMatches(sentences, panel.line, matchText);
    if (!matches.length) { ranges.push(null); errors.push(validationFailure('panel_bubble_not_in_story', { field: `panelLines[${index}].line`, value: panel.line, measured: 0, unit: 'story matches', limit: { min: 1 }, instruction: 'copy a bubble with at least 1 match in a story sentence or 2 adjacent sentences in the same paragraph' })); return; }
    const priorIndex = ranges.findLastIndex(Boolean), prior = ranges[priorIndex];
    const at = matches.find(range => range.start > (prior?.end ?? -1)) ?? matches.at(-1);
    if (index && prior && (at.start < prior.start || (at.start <= prior.end && index !== 2))) {
      errors.push(validationFailure('panel_bubbles_out_of_order', { field: `panelLines[${index}].line`, value: panel.line, measured: at.start + 1, unit: 'as its sentence index', limit: { min: prior.end + 2 }, instruction: `choose sentence ${prior.end + 2} or later, after panel ${priorIndex + 1} in sentence ${prior.end + 1}` }));
    }
    ranges.push(at);
  });
  if (errors.length) throw validationErrors(errors);
  const indices = ranges.map(range => range.start);
  const pair = [panelLines[1].line, panelLines[2].line];
  const pairFields = ['panelLines[1].line', 'panelLines[2].line'];
  const tooClose = () => validationFailure('panel_bubbles_2_and_3_too_close', { field: pairFields.join(' / '), fields: pairFields, value: pair, measured: 0, unit: 'available sentence breaks and 0 full sentences between them', limit: { min: 1 }, instruction: 'leave at least 1 sentence break for the cut and aim for at least 2 full sentences between the bubbles near the middle' });
  if (ranges[1].end >= ranges[2].start) throw tooClose();
  const total = words(body).length;
  const boundaries = [];
  for (let i = ranges[1].end; i < ranges[2].start; i++) {
    const end = sentences[i].end;
    const whitespace = body.slice(end).match(/^\s*/u)[0];
    const at = end + whitespace.length;
    const before = words(body.slice(0, at)).length;
    if (at <= sentences[indices[2]].start + body.slice(sentences[indices[2]].start).match(/^\s*/u)[0].length) {
      boundaries.push({ at, before, paragraph: /[\r\n]/u.test(body.slice(end - 1, at)) });
    }
  }
  const closest = (a, b) => Math.abs(a.before - total / 2) - Math.abs(b.before - total / 2) || a.at - b.at;
  if (!boundaries.length) throw tooClose();
  const paragraphs = boundaries.filter(cut => cut.paragraph);
  const cut = lockedPage === undefined ? (paragraphs.length ? paragraphs : boundaries).sort(closest)[0] : boundaries.find(cut => (pageIndex === 0 ? body.slice(cut.at) : body.slice(0, cut.at)).trim() === lockedPage);
  if (!cut) throw new Error('layout_shortening_changed_other_page: Keep the other saved chapter page exactly and keep its two bubbles on that page.');
  const pagination = { source: storyKey(story, panelLines), pages: [body.slice(0, cut.at).trim(), body.slice(cut.at).trim()],
    panelPages: [0, 0, 1, 1], bubbleSentenceIndices: indices, bubbleSentenceRanges: ranges, wordCounts: [cut.before, total - cut.before],
    cut: { at: cut.at, paragraph: cut.paragraph, pageOnePercent: 100 * cut.before / total } };
  return { ...pagination, receipt: digest(pagination) };
}


export function splitStory(story, panelLines, options = {}) {
  try { return splitStoryByBubbles(story, panelLines, options); }
  catch (error) {
    if (options.lockedPage !== undefined) throw error;
    if (typeof story !== 'string' || !Array.isArray(panelLines)) throw error;
    const body = story.replace(/^(?:MADE UP|REAL)\n/, '').trim();
    const boundaries = [...body.matchAll(/(?<=[.!?])\s+|\n+/gu)].map(match => match.index + match[0].length);
    const at = boundaries.sort((a, b) => Math.abs(a - body.length / 2) - Math.abs(b - body.length / 2))[0] ?? body.lastIndexOf(' ', Math.floor(body.length / 2));
    const cutAt = Math.max(0, at);
    const pages = [body.slice(0, cutAt).trim(), body.slice(cutAt).trim()];
    const pagination = { source: storyKey(story, panelLines), pages, panelPages: panelLines.map((_, index) => index < 2 ? 0 : 1),
      bubbleSentenceIndices: [], bubbleSentenceRanges: [], wordCounts: pages.map(page => words(page).length),
      cut: { at: cutAt, paragraph: body[cutAt - 1] === '\n', pageOnePercent: words(body).length ? words(pages[0]).length / words(body).length * 100 : 0 },
      reviewFlags: (error.errors ?? [error]).map(item => ({ ...reviewNote(item.message.split(':')[0], item.message, item.correctionFields ?? ['panelLines'], 'No story words changed. Code chose a sentence or paragraph cut; actual page fit is measured next.'), failure: { ...item.failure, code: item.message.split(':')[0] } })) };
    return { ...pagination, receipt: digest(pagination) };
  }
}
