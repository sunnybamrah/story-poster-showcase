import { researchLecturePhrases } from './story-rules.js';
import { writerFailureStops, reviewNote } from './stop-policy.js';
import { splitFixedStoryFaults } from './story-review.js';
import { normalizeKitText, writingGuidance } from './writing-guidance.js';
import { printedLengthRule } from './printed-capacity.js';
import { inspectAnswer } from './answer-shape.js';
import { writerSchema } from './answer-schemas.js';
import { callStructured } from './structured-call.js';
import { picturePrivacyHits } from './family-privacy.js';
import { validationFailure, validationErrors, minimalFields, requireKeys, requireCount, requireLine, textFields, correctionPath, pathParts, fieldValue } from './validation-reason.js';
import { responseText } from './text-models.js';
import { assertFamilyAllowed } from './config.js';
import { extractJSON } from './files.js';
import { snapshotTopicRhyme, savedRhymeSelection, rhymeWords } from './rhyme.js';
import { scrubWriterImageText, scrubIdentityText, identityHits, writerImageFields } from './writer-image-text.js';
import { isDeepStrictEqual } from 'node:util';
import { storyFields, smallFields, storyFaults } from './checker-contract.js';
import { moves, words } from './files.js';
import { buildStoryRequest, privacyFor } from './requests.js';
import { checkStory } from './check-story.js';
import { preparePick } from './picker.js';
import { usedMoveIds } from './memory.js';
import { chooseWorld } from './worlds.js';
import { publicCast, isCastId } from './cast.js';
import { needsTellingPanel, splitStory, assertStoryPagination, scienceFor, practiceFor, isUntimedSourceAction } from './format.js';

export const kitTextKeys = storyFields;
export const spokenWordCount = story => words(story.replace(/^MADE UP\n/, '')).length;
const exactKeys = (value, keys) => value && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
export const tellingScene = scene => /\b(adult|grown.up)\b/i.test(scene) && /\b(tell\w*|talk\w*|speak\w*|show\w*)\b/i.test(scene);

export const diagnosisWords = /\b(adhd|autism|autistic|depression|depressive|anxiety disorder|ocd|ptsd|bipolar|schizophren\w*|diagnos\w*|therapy|therapist|medication|dosage|milligrams)\b/iu;

export function validateStory(result, { nickname, parentLabel = 'Dad', lastMoveId, lockedMoveId, usedIds = [], eligibleIds, allowRepeat = false, pagination, privacy, heroName, familyContext = '', tonight = '', rejectResearchLecture = false, requireSpeakers = false, speakerIds, storyMode = 'inspired' } = {}) {
  const shape = inspectAnswer(result, writerSchema(undefined, { untimed: isUntimedSourceAction(moves.find(move => move.id === result?.moveId)) }));
  result = normalizeKitText(shape.value);
  const errors = [];
  const check = run => { try { return run(); } catch (error) { if (!error.failure && !error.errors) throw error; errors.push(...(error.errors ?? [error])); } };
  check(() => requireKeys(result, 'kit', kitTextKeys, 'invalid_story_shape'));
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw validationErrors(errors);
  const fail = (code, field, measured, unit, limit, instruction, extra = {}) => { errors.push(validationFailure(code, { field, value: fieldValue(result, field), measured, unit, limit, instruction, ...extra })); };
  const move = moves.find(move => move.id === result.moveId);
  if (!move) fail('unknown_move_id', 'moveId', 0, 'matches in the move list', { exactly: 1 }, 'choose exactly 1 id from the supplied eligible move list');
  if (lockedMoveId && result.moveId !== lockedMoveId) fail('rewrite_changed_move', 'moveId', 0, 'matches to the locked move', { exactly: 1 }, `keep exactly 1 locked id ${JSON.stringify(lockedMoveId)}`);
  if (allowRepeat !== true && lastMoveId && result.moveId === lastMoveId) fail('same_move_as_last_kit', 'moveId', 1, 'repeat of the last move', { max: 0 }, 'use 0 repeats and choose an unused eligible move');
  if (allowRepeat !== true && usedIds.includes(result.moveId)) fail('used_move_requires_repeat', 'moveId', 1, 'previously used id', { max: 0 }, 'use 0 previously used ids unless repetition was requested');
  if (eligibleIds && !eligibleIds.includes(result.moveId)) fail('ineligible_move', 'moveId', 0, 'matches in the eligible list', { exactly: 1 }, 'choose exactly 1 id from the supplied eligible list');
  const basePrivacy = privacy ?? (nickname ? { nickname, heroName, parentLabel, familyContext, tonight } : null);
  const imagePrivacy = basePrivacy ? { ...basePrivacy, moveId: move?.id } : null;
  if (imagePrivacy) for (const item of writerImageFields(result)) {
    const identities = identityHits(item.value, imagePrivacy);
    const violations = picturePrivacyHits(item.value, { ...imagePrivacy, moveId: move?.id });
    for (const identity of identities) if (!violations.some(hit => hit.kind.includes(identity.kind))) violations.push({ kind: `remaining ${identity.kind}`, text: identity.alias });
    if (violations.length) fail('writer_field_privacy', item.field, violations.length, 'detected privacy violations', { max: 0 }, `allow 0 private identities or family phrases in this field and use anonymous visual words (${violations.map(hit => hit.kind + ': ' + JSON.stringify(hit.text)).join('; ')})`, { violations });
  }
  if (typeof result.story !== 'string') fail('invalid_story_type', 'story', 0, 'text strings', { exactly: 1 }, 'supply exactly 1 story string');
  if (typeof result.story === 'string') {
    // Historical saved answers may have a leading tag. New narration never labels itself.
    const narration = result.story.replace(/^MADE UP\n/, '');
    const lectures = rejectResearchLecture ? researchLecturePhrases(narration) : [];
    if (lectures.length) fail('narrativeEssay', 'story', lectures.length, 'detached research explanations', { max: 0 }, `keep the one brief honest science idea, but leave study methods and age ranges in the parent notes; replace ${JSON.stringify(lectures)} with ordinary dialogue without changing the finding or its uncertainty`);
    const labels = narration.match(/\b(?:made[ -]up|pretend)\s+(?:story|adventure|child|fox|hero|family)\b|\b(?:story|adventure|hero)\s+(?:is|was)\s+(?:made[ -]up|pretend)\b/giu) ?? [];
    if (labels.length) fail('fictionInNarration', 'story', labels.length, 'fiction labels in narration', { max: 0 }, 'leave the fiction label to the page 2 header and start with the characters acting');
  }

  for (const item of textFields(result)) {
    const clinical = [...item.value.matchAll(new RegExp(diagnosisWords.source, 'giu'))];
    if (clinical.length) fail('child_word_wall', item.field, clinical.length, 'blocked clinical words', { max: 0 }, `use 0 blocked clinical words and replace ${JSON.stringify(clinical.map(match => match[0]))} with everyday words`);
    const dashes = item.value.match(/[\u2013\u2014]|\s-\s/gu) ?? [];
    if (dashes.length) fail('no_dashes_as_punctuation', item.field, dashes.length, 'dashes used as punctuation', { max: 0 }, 'use 0 punctuation dashes and use commas or full stops instead');
    const frames = item.value.match(/When I notice\b/giu) ?? [];
    const blanks = item.value.match(/When I notice _+, I _+(?=[. "'’]|$)/giu) ?? [];
    if (frames.length !== blanks.length) fail('filled_When_I_notice', item.field, frames.length - blanks.length, 'filled or malformed blank frames', { max: 0 }, 'leave 0 filled frames and copy When I notice ______, I ______ with both blanks empty');
    if (!/^(?:panelLines|jokeIdea)/.test(item.field)) {
      const softwareWords = item.value.match(/\b(?:supplied|template|algorithm|practiceScript|tinyTryOptions|rehearse the supplied|selected move)\b/giu) ?? [];
      if (softwareWords.length) fail('child_word_wall', item.field, softwareWords.length, 'software instructions in printed copy', { max: 0 }, 'use everyday words that speak to the child or parent, without software instructions');
    }
  }
  const practice = move ? practiceFor(move, nickname, parentLabel) : undefined;
  if (storyMode !== 'factual' && (move?.library?.actionBaseMoveId ?? move?.id) === 'one-brave-step' && typeof result.story === 'string' && !result.story.includes('only after a grown-up says it is safe')) fail('missing_grown_up_safety_line', 'story', 0, 'exact safety lines', { min: 1 }, 'include at least 1 exact copy of "only after a grown-up says it is safe"');
  check(() => requireLine(result.chapterTitle, 'chapterTitle', Infinity, 'invalid_chapter_title'));
  check(() => requireLine(result.tagline, 'tagline', Infinity, 'invalid_tagline'));
  check(() => requireLine(result.jokeIdea, 'jokeIdea', Infinity, 'invalid_joke_idea'));
  check(() => requireLine(result.replayCue, 'replayCue', Infinity, 'invalid_replay_cue'));
  check(() => requireLine(result.noticedFeeling, 'noticedFeeling', Infinity, 'invalid_noticed_feeling'));
  if (!Array.isArray(result.feelFirst)) fail('invalid_feel_first', 'feelFirst', 0, 'arrays', { exactly: 1 }, 'return 1 array of validating statements; aim for 2');
  if (Array.isArray(result.feelFirst)) result.feelFirst.forEach((line, index) => check(() => requireLine(line, `feelFirst[${index}]`, Infinity, 'invalid_feel_first_line')));
  check(() => requireCount(result.panelLines, 'panelLines', 4, 'panels', 'need_four_short_panel_lines'));
  if (Array.isArray(result.panelLines)) result.panelLines.forEach((panel, index) => {
    check(() => requireKeys(panel, `panelLines[${index}]`, ['scene', 'line', ...(requireSpeakers || Object.hasOwn(panel ?? {}, 'speakerId') ? ['speakerId'] : [])], 'invalid_panel_shape'));
    if ((requireSpeakers || panel?.speakerId !== undefined) && (typeof panel?.speakerId !== 'string' || !isCastId(panel.speakerId) || speakerIds && !speakerIds.includes(panel.speakerId))) fail('invalid_panel_speaker', `panelLines[${index}].speakerId`, 0, 'supplied anonymous speaker ids', { exactly: 1 }, 'supply exactly one anonymous cast id for the person speaking this quoted line; keep this panel scene, bubble words and the story unchanged', { fields: [`panelLines[${index}]`] });
    check(() => requireLine(panel?.scene, `panelLines[${index}].scene`, Infinity, 'invalid_panel_scene'));
    check(() => requireLine(panel?.line, `panelLines[${index}].line`, Infinity, 'invalid_panel_bubble'));
  });
  if (Array.isArray(result.panelLines)) {
    const scenes = result.panelLines.map(panel => typeof panel?.scene === 'string' ? panel.scene.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') : null);
    const distinct = new Set(scenes.filter(scene => scene !== null)).size;
    scenes.forEach((scene, index) => {
      if (scene !== null && scenes.indexOf(scene) !== index) fail('four_different_panel_scenes_required', `panelLines[${index}].scene`, distinct, `distinct measured scenes across the ${scenes.length} panels`, { exactly: 4 }, `make exactly 4 different scenes by changing this duplicate of panel ${scenes.indexOf(scene) + 1}`);
    });
    if (typeof result.story === 'string') {
      pagination = check(() => pagination ? assertStoryPagination(result.story, result.panelLines, pagination) : splitStory(result.story, result.panelLines, { matchText: imagePrivacy ? text => scrubIdentityText(text, imagePrivacy) : undefined }));
    }
    if (move && needsTellingPanel(move) && !result.panelLines.some(panel => tellingScene(panel?.scene ?? ''))) fail('missing_grown_up_telling_panel', 'panelLines', 0, 'scenes showing the hero telling a grown-up', { min: 1 }, 'include at least 1 scene showing both the hero telling and the grown-up listening');
  }
  check(() => requireCount(result.tinyTryOptions, 'tinyTryOptions', 3, 'options', 'invalid_tiny_tries'));
  if (Array.isArray(result.tinyTryOptions)) result.tinyTryOptions.forEach((option, index) => {
    const field = `tinyTryOptions[${index}]`;
    check(() => requireKeys(option, field, ['text', 'seconds', 'offScreen'], 'invalid_tiny_tries'));
    check(() => requireLine(option?.text, `${field}.text`, Infinity, 'invalid_tiny_tries'));
    if (isUntimedSourceAction(move)) {
      if (option?.seconds !== null) fail('tinyTryWrong', `${field}.seconds`, 1, 'invented timers', { max: 0 }, 'use null for this untimed action; do not add a timer');
    } else if (typeof option?.seconds !== 'number' || !Number.isFinite(option.seconds)) fail('invalid_tiny_tries', `${field}.seconds`, Number.isFinite(option?.seconds) ? option.seconds : 0, 'seconds', { exactly: 1 }, 'give exactly 1 finite number of seconds; roughly 30 to 90 seconds is guidance, not a cutoff');
    if (typeof option?.offScreen !== 'boolean') fail('invalid_tiny_tries', `${field}.offScreen`, 0, 'boolean values', { exactly: 1 }, 'use exactly 1 boolean, true or false');
  });
  if (Array.isArray(result.tinyTryOptions) && !result.tinyTryOptions.some(option => option?.offScreen === true)) fail('invalid_tiny_tries', 'tinyTryOptions', 0, 'off-screen options', { min: 1 }, 'include at least 1 option that is physically off screen');
  if (Array.isArray(result.tinyTryOptions)) {
    const actions = result.tinyTryOptions.map(option => typeof option?.text === 'string' ? option.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') : '');
    if (actions.filter(Boolean).length === 3 && new Set(actions).size !== 3) fail('tinyTryWrong', 'tinyTryOptions', new Set(actions).size, 'different tiny try actions', { exactly: 3 }, 'give three genuinely different ways to practise the same move; changing only seconds is not a new action');
  }
  check(() => requireKeys(result.whereElse, 'whereElse', ['line', 'place'], 'where_else_must_be_off_screen'));
  check(() => requireLine(result.whereElse?.line, 'whereElse.line', Infinity, 'where_else_must_be_off_screen'));
  check(() => requireLine(result.whereElse?.place, 'whereElse.place', Infinity, 'where_else_must_be_off_screen'));
  const screenWords = (typeof result.whereElse?.place === 'string' ? result.whereElse.place : '').match(/\b(screen|phone|tablet|online|chat|app|computer|console)\b/gi) ?? [];
  if (screenWords.length) fail('where_else_must_be_off_screen', 'whereElse.place', screenWords.length, 'screen-place words', { max: 0 }, 'use 0 screen-place words and name a physical place away from screens');
  const reviewFlags = [...(pagination?.reviewFlags ?? [])], stops = [];
  for (const error of errors) {
    const failure = { ...error.failure, code: error.message.split(':')[0] };
    if (writerFailureStops(failure)) stops.push(error);
    else reviewFlags.push({ ...reviewNote(failure.code, error.message, [failure.field]), failure });
  }
  if (stops.length) { const error = validationErrors(stops); error.reviewFlags = reviewFlags; throw error; }
  if (!pagination && typeof result.story === 'string' && Array.isArray(result.panelLines)) pagination = splitStory(result.story, result.panelLines);
  return { ...move, pagination, reviewFlags, extraKeys: shape.extraKeys, guidance: writingGuidance(result) };
}

const kitFields = result => Object.fromEntries(kitTextKeys.map(key => [key, result[key]]));
const textValues = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(textValues) : [];
const cleanedLocks = (text, privacy) => normalizeKitText(privacy ? scrubWriterImageText(kitFields(text), privacy).text : kitFields(text));
const setField = (text, field, value) => {
  const parts = pathParts(field), key = parts.pop(), parent = parts.reduce((value, part) => value?.[part], text);
  if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) throw new Error(`invalid_correction_fields: ${field} has no existing value.`);
  parent[key] = structuredClone(value);
};
export function assertRewriteLocks(candidate, previous, fields, privacy) {
  const cleaned = cleanedLocks(candidate, privacy), locked = cleanedLocks(previous, privacy);
  for (const field of minimalFields(fields)) setField(cleaned, field, fieldValue(locked, field));
  for (const field of kitTextKeys) if (!isDeepStrictEqual(cleaned[field], locked[field])) throw new Error(`rewrite_changed_locked_field: ${field}. Keep every unlisted field exactly as supplied.`);
}
export function keepRewriteLocks(candidate, previous, fields, privacy) {
  assertRewriteLocks(candidate, previous, fields, privacy);
  const result = structuredClone(kitFields(previous));
  for (const field of minimalFields(fields)) setField(result, field, fieldValue(candidate, field));
  return result;
}
const fieldErrors = { invalid_tagline: ['tagline'], invalid_joke_idea: ['jokeIdea'], invalid_replay_cue: ['replayCue'], invalid_noticed_feeling: ['noticedFeeling'], need_two_feel_first_lines: ['feelFirst'], invalid_tiny_tries: ['tinyTryOptions'], where_else_must_be_off_screen: ['whereElse'] };

export function correctionPlan(check) {
  const fields = new Set(); let rewrite = false;
  for (const fault of splitFixedStoryFaults(check).faults) {
    const affected = check.affectedFields?.[fault];
    if (!affected?.length) throw new Error(`Checker fault ${fault} needs a named field before correction.`);
    for (const field of affected) {
      if (field.startsWith('move.') || field === 'tagline' && fault !== 'freshRhymeInvalid') continue;
      if (smallFields.includes(field) || field === 'tagline' && fault === 'freshRhymeInvalid') fields.add(field);
      else if ((storyFaults.includes(fault) || fault === 'freshRhymeInvalid') && ['story', 'panelLines', 'chapterTitle'].includes(field)) {
        rewrite = true; fields.add(field);
      } else throw new Error(`Checker fault ${fault} in ${field} has no allowed correction scope. The existing story was kept.`);
    }
  }
  if (rewrite && fields.has('story')) fields.add('panelLines'); // Bubble placement depends on the chapter.
  return { fields: [...fields], rewrite };
}

export function applyFieldCorrection(previous, patch, fields) {
  if (!fields.length || fields.some(field => !correctionPath(field))) throw new Error('invalid_correction_fields');
  const shape = inspectAnswer(patch, writerSchema(fields, { untimed: isUntimedSourceAction(moves.find(move => move.id === previous?.moveId)) }));
  if (shape.issues.length) throw new Error(`correction_changed_locked_fields: ${shape.issues.join(' ')}`);
  patch = shape.value;
  if (normalizeKitText(patch).story !== normalizeKitText(previous).story) throw new Error('correction_changed_story: copy the locked story exactly, without shortening or rewriting it.');
  const result = structuredClone(kitFields(previous));
  for (const field of fields) {
    const parts = pathParts(field), key = parts.pop();
    const parent = parts.reduce((current, part) => current?.[part], result);
    if (!parent || typeof parent !== 'object' || Array.isArray(parent) && Number(key) >= parent.length) throw new Error(`invalid_correction_fields: ${field} has no existing parent.`);
    parent[key] = structuredClone(patch[field]);
  }
  return result;
}

export async function writeStory(transport, record, tonight, { kit, correction, lockedMoveId, priorStory, allowRepeat = false, correctionFields, rewriteFields, layoutFit, attempts = 2, saveAccepted = true, topicReminders } = {}) {
  (transport.assertFamilyAllowed ?? assertFamilyAllowed)(record);
  const pick = preparePick(record, tonight, { allowRepeat, chosenMoveId: lockedMoveId });
  if (pick.status !== 'eligible') return pick;
  const reminders = structuredClone(topicReminders ?? Object.fromEntries(pick.eligible.map(({ move }) => [move.id, snapshotTopicRhyme(move)])));
  if (priorStory?.tagline) {
    const priorMove = moves.find(move => move.id === priorStory.moveId);
    if (priorMove) reminders[priorMove.id] = savedRhymeSelection(priorStory, priorMove);
  }
  for (const { move } of pick.eligible) if (reminders[move.id]) savedRhymeSelection({ tagline: reminders[move.id].tagline, rhymeSelection: reminders[move.id] }, move);
  const imagePrivacy = privacyFor(record, tonight);
  // A rejected fresh answer cannot downgrade the rest of this write to legacy mode.
  const requireSpeakers = !priorStory || priorStory.panelLines?.some(panel => Object.hasOwn(panel, 'speakerId'));
  const speakerIds = publicCast(record).map(person => person.id);
  let reason = correction, previousStory = priorStory, locked = priorStory, effort = 'medium', failure, failures;
  let previousCount = typeof priorStory?.story === 'string' ? spokenWordCount(priorStory.story) : undefined;
  const validate = candidate => {
    if (layoutFit && locked) {
      const move = moves.find(move => move.id === locked.moveId);
      const passages = ['practiceScript', 'kidScienceLine', 'positiveAction', 'bodyAction', 'whereItCameFrom'].map(field => move?.[field]?.replaceAll('[name]', record.hero.nickname).replace(/\bDad\b/g, record.parentLabel ?? 'Dad'));
      if (move) passages.push(scienceFor(move).claim, scienceFor(move).limitation);
      passages.push('only after a grown-up says it is safe');
      for (const passage of passages.filter(Boolean)) if (locked.story.includes(passage) && !candidate.story.includes(passage)) throw new Error('layout_shortening_changed_fixed_text: Copy every existing approved passage exactly. Shorten only generated prose.');
    }
    const savedPagination = locked?.pagination && candidate.story === locked.story && isDeepStrictEqual(candidate.panelLines, locked.panelLines) ? locked.pagination : layoutFit?.lockedPage !== undefined ? splitStory(candidate.story, candidate.panelLines, { matchText: text => scrubIdentityText(text, imagePrivacy), lockedPage: layoutFit.lockedPage, pageIndex: layoutFit.pageIndex }) : undefined;
    return validateStory(candidate, { storyMode: record.kitContext?.storyMode, nickname: record.hero.nickname, parentLabel: record.parentLabel, usedIds: usedMoveIds(record), eligibleIds: pick.eligible.map(item => item.move.id), allowRepeat, lockedMoveId, pagination: savedPagination, privacy: imagePrivacy, requireSpeakers, speakerIds, rejectResearchLecture: !priorStory || Boolean(rewriteFields?.includes('story') && !layoutFit) });
  };
  for (let attempt = 0; attempt < attempts; attempt++) {
    const body = buildStoryRequest(record, tonight, { reason, failure, failures, previousStory, previousCount, lockedMoveId, allowRepeat, correctionFields, rewriteFields, effort, layoutFit, requireSpeakers, topicReminders: reminders });
    const response = await callStructured(transport, { provider: 'openai', path: '/v1/responses', familyRecord: { ...record, real: record.real === true }, stage: correctionFields ? 'story-correction' : rewriteFields || correction ? 'story-rewrite' : 'story', kit, retry: attempt, body });
    let parsed, candidate, extraKeys = [];
    try {
      if (response.status === 'incomplete' && response.incomplete_details?.reason === 'max_output_tokens') {
        const retryNote = { attempt: attempt + 1, stopReason: 'max_output_tokens', maxTokens: body.max_output_tokens, previousEffort: effort, nextEffort: attempt === 0 ? 'low' : null, usage: response.usage };
        transport.recordLocalResult?.('story-thinking-retry', retryNote, attempt === 0 ? 'Retry the second story attempt with reasoning at low effort.' : 'The second story attempt reached max_tokens.');
        effort = 'low';
        throw new Error(`story_max_tokens: The answer reached its output limit. Return the complete JSON with reasoning at low effort. ${printedLengthRule(lockedMoveId ?? previousStory?.moveId, record.hero.age)}`);
      }
      const shape = inspectAnswer(extractJSON(responseText(response)), writerSchema(correctionFields, { untimed: pick.eligible.some(item => isUntimedSourceAction(item.move)) }));
      extraKeys = shape.extraKeys;
      const scrubbed = scrubWriterImageText(shape.value, { ...imagePrivacy, moveId: lockedMoveId ?? locked?.moveId });
      parsed = normalizeKitText(scrubbed.text);
      if (scrubbed.changes.length || scrubbed.violations.length || scrubbed.remainingViolations.length) transport.recordLocalResult?.('writer-field-scrub', { stage: correctionFields ? 'story-correction' : correction ? 'story-rewrite' : 'story', attempt: attempt + 1, changes: scrubbed.changes, violations: scrubbed.violations, remainingViolations: scrubbed.remainingViolations });
      candidate = correctionFields ? applyFieldCorrection(locked, parsed, correctionFields) : parsed;
      if (rewriteFields) candidate = keepRewriteLocks(candidate, locked, rewriteFields, imagePrivacy);
      if (candidate?.moveId === '' && candidate.tagline === '' && typeof candidate.story === 'string' && candidate.story.trim()) {
        transport.recordVerdict?.(response, 'NEEDS GUIDE', { reason: candidate.story });
        return { status: 'noMatch', reason: 'writer-no-fitting-guide', message: 'This moment needs a different guide. Your note is saved. Open Teaching guides to choose one or check a new topic.' };
      }
      if (!candidate || typeof candidate.tagline !== 'string' || !candidate.tagline.trim()) throw validationFailure('invalid_tagline', { field: 'tagline', value: candidate?.tagline, measured: 0, unit: 'required strings', limit: { exactly: 1 }, instruction: 'copy the supplied topic reminder exactly' });
      const selectedMove = moves.find(move => move.id === candidate.moveId);
      let rhymeSelection;
      if (selectedMove) {
        rhymeSelection = priorStory?.tagline ? savedRhymeSelection(priorStory, selectedMove) : reminders[selectedMove.id];
        if (!rhymeSelection) throw Error('The chosen topic has no saved reminder for this story.');
        savedRhymeSelection({ tagline: rhymeSelection.tagline, rhymeSelection }, selectedMove);
        const proposed = candidate.tagline;
        if (proposed !== rhymeSelection.tagline) {
          if (rhymeWords(proposed).length < 4) throw validationFailure('invalid_tagline', { field: 'tagline', value: proposed, measured: 1, unit: 'different reminders', limit: { exactly: 0 }, instruction: `copy the exact supplied topic reminder: ${rhymeSelection.tagline}` });
          // Only a complete phrase in fresh inspired prose may be rebound.
          // Saved text, supplied quotations and factual narration stay exact.
          if (!locked && !priorStory && record.kitContext?.storyMode !== 'factual' && !tonight.includes(proposed) && !record.familyContext?.includes(proposed)) {
            const escaped = proposed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const phrase = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu');
            const bind = value => typeof value === 'string' ? value.replace(phrase, () => rhymeSelection.tagline) : Array.isArray(value) ? value.map(bind) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'moveId' ? item : bind(item)])) : value;
            candidate = bind(candidate);
          }
          candidate.tagline = rhymeSelection.tagline;
          transport.recordLocalResult?.('topic-reminder-binding', { proposed, saved: rhymeSelection.tagline, moveId: selectedMove.id }, 'Use the saved topic reminder throughout this new story.');
        }
        parsed = candidate;
        if (isUntimedSourceAction(selectedMove) && Array.isArray(candidate.tinyTryOptions)) for (const option of candidate.tinyTryOptions) option.seconds = null;
      }
      const { pagination, guidance, reviewFlags: validationFlags } = validate(candidate);
      const reviewFlags = [...(pick.reviewFlags ?? []), ...validationFlags];
      transport.recordVerdict?.(response, 'PASS', { extraKeys, guidance, reviewFlags });
      const accepted = { ...candidate, pagination, guidance, reviewFlags, ...(rhymeSelection ? { rhymeSelection: structuredClone(rhymeSelection) } : {}) };
      if (saveAccepted) transport.recordKitText?.(accepted);
      return accepted;
    } catch (error) {
      transport.recordRejection(response, error.message, { failures: error.failures, extraKeys, reviewFlags: error.reviewFlags });
      const code = error.message.split(':')[0];
      if (code === 'story_max_tokens') {
        if (attempt === attempts - 1) throw new Error(`Story rejected after ${attempts} attempt(s): ${error.message}`);
        reason = error.message;
        // Truncation is not a rejected fresh rhyme. Preserve correction locks
        // and use this write's remaining attempt before any content fallback.
        previousStory = locked ?? previousStory;
        continue;
      }
      if (attempt === attempts - 1) throw new Error(`Story rejected after ${attempts} attempt(s): ${error.message}`);
      reason = error.message;
      failure = error.failure;
      failures = error.failures;
      if (typeof parsed?.story === 'string') previousCount = spokenWordCount(parsed.story);
      const repairFields = error.correctionFields ?? (!error.failures ? fieldErrors[code] : undefined);
      if (!correctionFields && !rewriteFields && repairFields && exactKeys(parsed, kitTextKeys)) {
        correctionFields = minimalFields(repairFields); locked = parsed; lockedMoveId = parsed.moveId;
      } else if (!correctionFields && !rewriteFields && error.failures?.every(item => item.field === 'story' || correctionPath(item.field) || item.field.includes(' / ')) && exactKeys(parsed, kitTextKeys)) {
        rewriteFields = minimalFields(error.errors.flatMap(item => item.correctionFields ?? [item.failure.field])); locked = parsed; lockedMoveId = parsed.moveId;
      }
      previousStory = locked ?? parsed ?? response.output?.flatMap(item => item.content ?? []).filter(block => block.type === 'output_text').map(block => block.text).join('\n') ?? '';
    }
  }
}

export async function shortenLayoutText(transport, record, tonight, previous, plan, { kit, allowRepeat = false } = {}) {
  const candidate = await writeStory(transport, record, tonight, { kit, allowRepeat, lockedMoveId: previous.moveId, priorStory: previous,
    correction: `Fit this printed page only. ${plan.page} still overflows by ${plan.overflowPoints.toFixed(2)} points. Cut about ${plan.cutWords} words from ${plan.fields.join(', ')}.`,
    ...(plan.fields.includes('story') ? { rewriteFields: plan.fields } : { correctionFields: plan.fields }), layoutFit: plan, attempts: 1, saveAccepted: false });
  if (candidate.status) throw new Error('The selected move is no longer eligible for shortening.');
  const check = await checkStory(transport, candidate, moves.find(move => move.id === candidate.moveId), { kit, record, tonight });
  if (!check.ready) throw new Error('Shortened text needs correction: ' + check.faults.join('; '));
  return { ...previous, ...candidate, ready: true, checks: [...(previous.checks ?? []), check], printedFitPages: [...new Set([...(previous.printedFitPages ?? []), plan.page])] };
}

export async function readyStory(transport, record, tonight, { kit, allowRepeat = false, lockedMoveId, draft, saveDraft, topicReminders } = {}) {
  let result = draft ? structuredClone(draft) : await writeStory(transport, record, tonight, { kit, allowRepeat, lockedMoveId, topicReminders });
  if (result.status) return result;
  if (draft) validateStory(kitFields(result), { nickname: record.hero.nickname, parentLabel: record.parentLabel, storyMode: record.kitContext?.storyMode, lockedMoveId, allowRepeat, usedIds: usedMoveIds(record), privacy: privacyFor(record, tonight, moves.find(move => move.id === result.moveId)), requireSpeakers: true, speakerIds: publicCast(record).map(person => person.id) });
  saveDraft?.(structuredClone(result));
  await transport.onLessonSelected?.(result.moveId);
  const checks = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const move = moves.find(move => move.id === result.moveId);
    const check = await checkStory(transport, result, move, { kit, retry: attempt, record, tonight });
    checks.push(check);

    if (check.verified === false || check.checkStatus === 'unverified') throw Object.assign(new Error('The story check could not establish a complete verdict. Saved work is kept.'), { code: 'content_check_unverified', canResume: true });
    const decision = savedRhymeSelection(result, move);
    const effective = splitFixedStoryFaults(check);
    if (effective.ready) {
      const candidate = { ...kitFields(result), tagline: decision.tagline };
      const { pagination } = validateStory(candidate, { storyMode: record.kitContext?.storyMode, nickname: record.hero.nickname, parentLabel: record.parentLabel, lockedMoveId: result.moveId, allowRepeat,
        usedIds: usedMoveIds(record), pagination: result.pagination, privacy: privacyFor(record, tonight, move) });
      result = { ...result, ...candidate, pagination, guidance: writingGuidance(candidate, { age: record.hero.age }), rhymeSelection: decision };
      transport.recordLocalResult?.('rhyme-selection', decision, `PASS: ${decision.source} rhyme printed. ${decision.reason}`);
      const accepted = { ...result, ...chooseWorld(record), ready: true, checks, reviewFlags: [...(result.reviewFlags ?? []), ...checks.flatMap(check => check.reviewFlags ?? [])] };
      transport.recordKitText?.(accepted);
      return accepted;
    }
    if (attempt === 1) throw new Error(`Story failed its second judge check: ${effective.faults.join(', ')}`);
    const plan = correctionPlan(effective);
    result = await writeStory(transport, record, tonight, { kit, allowRepeat,
      correction: `Correct these faults only: ${JSON.stringify(effective.faults.map(key => ({ fault: key, evidence: effective.evidence[key], fields: effective.affectedFields[key], reason: effective.reasons?.[key] ?? effective.evidence[key], ...(key === 'chapterShapeWrong' ? { findings: effective.chapterShapeFindings } : {}) })))}`,
      lockedMoveId: result.moveId, priorStory: result, ...(plan.rewrite ? { rewriteFields: plan.fields } : { correctionFields: plan.fields }) });
    saveDraft?.(structuredClone(result));
  }
}

export function adventureLine(story, nickname) {
  // A real excerpt, not another AI summary. Fact changes will invalidate it.
  const paragraphs = story.split(/\n+/).map(line => line.trim()).filter(line => line && line !== 'MADE UP');
  const line = paragraphs.find(line => line.includes(nickname)) ?? paragraphs[0];
  if (!line) throw new Error('The story has no adventure to remember.');
  return line.split(/(?<=[.!?])\s/)[0];
}
