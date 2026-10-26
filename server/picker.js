import { moves, readJSON } from './files.js';
import { usedMoveIds, latestMoveFeedback } from './memory.js';
import { parentResponse, matchingEventContexts } from './route.js';
import { isPreparedMove, preparedMoveFits } from './library-prepared.js';
import { libraryMoveAudienceFits } from './library-action.js';
import { keyWordFitsHistory } from './format.js';

const rules = readJSON(new URL('../content/picker-rules.json', import.meta.url));
const helpRank = { yes: 3, 'a little': 2, no: 1, unanswered: 1, 'not for us': 0 };
const matches = (pattern, text) => matchingEventContexts(text, pattern).length > 0;
function ruleFits(rule, text) {
  const evidence = matchingEventContexts(text, rule.pattern);
  if (!evidence.length || rule.requires && !evidence.some(event => matches(rule.requires, event))) return false;
  // A reminder plan addresses the child's own remembering. Another person's
  // mistake or an external barrier is not an internal snag for the child.
  if (rule.goal === 'remembering-plan') {
    // Check the remembering verb itself. A composite match starting at "book"
    // must not hide "not forgotten" or make Dad's mistake the child's snag.
    const need = 'forgot(?:ten)?|forget(?:s|ting)?|(?:did not|didn.t|does not|doesn.t) remember|needs? to remember|wants? to remember|remember to|(?:needs?|wants?|asked for).{0,25}remind(?:er|ers|ing)?|remind(?:er|ers|ing)?.{0,35}(?:bring|return|pack|remember)|(?:bring|return|pack|remember).{0,25}remind(?:er|ers|ing)?|left.{0,65}(?:at home|behind|on (?:the )?(?:kitchen )?(?:counter|table))';
    const otherPerson = '(?:i|we|dad|mom|mum|mother|father|parents?|teacher|brother|sister)';
    const otherActor = new RegExp(`\\b${otherPerson}\\s+(?:(?:had|have|has|keeps?|kept|accidentally|was|is|the one who)\\s+)*(?:forgot|forget|left|lost|want|wants|need|needs|didn't|did not|wouldn't|would not|refused)\\b|\\b(?:forgotten|left).{0,45}\\bby\\s+(?:(?:his|her|their|the|my|our)\\s+)?${otherPerson}\\b`, 'u');
    return !matches('(?:someone|teacher|parent|dad|mom|mum|brother|sister).{0,25}(?:hid|took|locked|kept|stopped|prevented)|(?:lost|missing|stolen|broken|cannot find|can.t find).{0,25}(?:book|bag|slip|lunchbox)|(?:book|bag|slip|lunchbox).{0,25}(?:lost|missing|stolen|broken)', text)
      && evidence.some(event => matches(need, event) && !otherActor.test(event)
        && !/\b(?:(?:does not|doesn't|did not|didn't|do not|don't) need|never needs?) (?:a |any )?reminder\b/u.test(event));
  }
  return true;
}

export function eligibleMoves(record, weekNotes, { allowRepeat = false } = {}) {
  if (parentResponse(weekNotes, { parentEdition: Boolean(record.kitContext?.focusPersonId && record.kitContext.focusPersonId !== 'child'), remembranceRequested: record.kitContext?.remembranceChildLed === true, remembranceChildLed: record.kitContext?.remembranceChildLed === true })) return [];
  const used = new Set(usedMoveIds(record));
  const reasons = new Map(), excluded = new Set();
  const researched = record.libraryMatch;
  if (researched?.tonight === weekNotes.trim() && moves.some(move => move.id === researched.moveId && move.library?.status === 'reusable')) reasons.set(researched.moveId, 'This general guide was checked for the topic you described. Choose it only if it fits your family.');
  for (const rule of rules.rules) if (ruleFits(rule, weekNotes)) {
    for (const id of rule.moves) if (!reasons.has(id)) reasons.set(id, rule.reason);
    for (const id of rule.excludeMoves ?? []) excluded.add(id);
  }
  for (const rule of rules.exclusions) if (matches(rule.pattern, weekNotes)) for (const id of rule.moves) reasons.delete(id);
  for (const id of excluded) reasons.delete(id);
  for (const move of moves) if (isPreparedMove(move) && preparedMoveFits(move, record, weekNotes)) reasons.set(move.id, 'This prepared action fits the moment you described and the child’s checked age range. Choose it only if it fits your family.');
  for (const id of reasons.keys()) { const move = moves.find(move => move.id === id); if (isPreparedMove(move) && !preparedMoveFits(move, record, weekNotes)) reasons.delete(id); }
  // An explicit rejection is a preference, not an instruction to try it again.
  const latestFeedback = id => latestMoveFeedback(record, id);
  for (const id of reasons.keys()) if (latestFeedback(id)?.didItHelp === 'not for us') reasons.delete(id);
  const candidates = [...reasons].filter(([id]) => { const move = moves.find(item => item.id === id); return move && libraryMoveAudienceFits(move, record.kitContext) && keyWordFitsHistory(record, move); }).filter(([id]) => allowRepeat === true || !used.has(id))
    .map(([id, reason]) => ({ move: moves.find(move => move.id === id), reason, repeated: used.has(id) }));
  if (allowRepeat === true) {
    candidates.sort((a, b) => {
      const left = latestFeedback(a.move.id), right = latestFeedback(b.move.id);
      // Unknown choices sit between a helpful move and one already tried
      // without help. An untried move with "not yet" remains unknown.
      const score = item => ['yes', 'a little'].includes(item?.didItHelp) ? helpRank[item.didItHelp] : item?.triedMove === 'yes' ? 1 : 1.5;
      return score(right) - score(left) || Number(right?.triedMove === 'yes') - Number(left?.triedMove === 'yes');
    });
  }
  return candidates;
}

export function preparePick(record, tonight, options = {}) {
  const response = parentResponse(tonight, { parentEdition: Boolean(record.kitContext?.focusPersonId && record.kitContext.focusPersonId !== 'child'), remembranceRequested: record.kitContext?.remembranceChildLed === true, remembranceChildLed: record.kitContext?.remembranceChildLed === true });
  if (response) return response;
  // The parent's words are not a password. Matching ranks suggestions; the
  // story writer chooses from the source bank, or uses the parent's choice.
  const ranked = eligibleMoves(record, tonight, { allowRepeat: true });
  const reasons = new Map(ranked.map(item => [item.move.id, item.reason]));
  const used = new Set(usedMoveIds(record));
  const eligible = moves.filter(move => {
    if (!libraryMoveAudienceFits(move, record.kitContext) || !keyWordFitsHistory(record, move)) return false;
    if (isPreparedMove(move)) return preparedMoveFits(move, record, tonight, { parentSelected: true });
    if (move.library) return move.library.status === 'reusable' && record.libraryMatch?.moveId === move.id && record.libraryMatch.tonight === tonight.trim();
    return true;
  }).filter(move => options.chosenMoveId === move.id || latestMoveFeedback(record, move.id)?.didItHelp !== 'not for us')
    .map(move => ({ move, reason: reasons.get(move.id) ?? 'You can choose this guide. The story will use today’s moment and this guide’s own teaching.', repeated: used.has(move.id) }));
  eligible.sort((a, b) => Number(b.move.id === options.chosenMoveId) - Number(a.move.id === options.chosenMoveId) || Number(reasons.has(b.move.id)) - Number(reasons.has(a.move.id)) || Number(a.repeated) - Number(b.repeated));
  if (options.chosenMoveId && !eligible.some(item => item.move.id === options.chosenMoveId)) return { status: 'noMatch', reason: 'guide-unavailable', suggestions: [], canRepeat: false, message: 'This guide is not available for this child. Choose another guide.' };
  if (eligible.length) return { status: 'eligible', eligible };
  const repeats = eligibleMoves(record, tonight, { allowRepeat: true });
  return {
    status: 'noMatch', reason: 'no-fitting-move', suggestions: [], canRepeat: repeats.length > 0,
    message: repeats.length ? 'The fitting moves have been used before. You can choose to see them again.' : 'We did not find a prepared move that fits this moment. You can change the note or stop here without making a kit.',
  };
}

// No transport is accepted here. A short list is never padded with an unfitting move.
export function scout(weekNotes, record = { pastKits: [] }, options) {
  const response = parentResponse(weekNotes, { parentEdition: Boolean(record.kitContext?.focusPersonId && record.kitContext.focusPersonId !== 'child'), remembranceRequested: record.kitContext?.remembranceChildLed === true, remembranceChildLed: record.kitContext?.remembranceChildLed === true });
  if (response) return { ...response, suggestions: [] };
  const eligible = eligibleMoves(record, weekNotes, options);
  if (!eligible.length) return { status: 'noMatch', suggestions: [], canRepeat: eligibleMoves(record, weekNotes, { allowRepeat: true }).length > 0, message: 'Choose a guide or let the story choose from the source teaching.' };
  const suggestions = eligible.slice(0, 3).map(({ move, reason }) => ({ moveId: move.id, reason }));
  return { status: suggestions.length === 3 ? 'scout' : 'fewerThanThreeFit', suggestions, reviewFlags: [] };
}
