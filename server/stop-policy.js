// Saved checker assessments retain their original meaning. New generation uses assessGenerationCheck below.
import { narrativeFaultKeys } from './story-rules.js';
export const hardStoryFaults = new Set(['secondMoveTaught', 'feelingGoesAwayPromise', 'scienceClaimsTeachingHelped', 'tinyTryWrong', 'child_word_wall', 'writer_field_privacy', 'no_dashes_as_punctuation', ...narrativeFaultKeys]);
export const measuredFault = code => /^(?:text_crosses_boundary|text_lines_overlap|text_clipped_at_safe_area|text_icon_collision|insufficient_handwriting_space|printed_layout_overflow|text_under_footer_banner|footer_banner_too_small|missing_core_part|textCrossesBoundary|keyWordUnreadable)(?::|$)/.test(code);
export const reviewNote = (key, evidence, fields = [], reason = 'Pass 24: saved for review; this is not a measured page break or hard rule.') => ({ key, evidence, fields, reason, label: "FOR SUNNY'S READ", reportOnly: true });
export const isHardFault = code => code === 'missing_cast_appearance_basis' || hardStoryFaults.has(code.split(':')[0]) || /^(?:confirmed_selected_picture_style_mismatch|confirmed_graphic_novel_style_mismatch|confirmed_species_mismatch|confirmed_identity_mismatch|confirmed_cast_clothing_mismatch|confirmed_cast_appearance_mismatch|confirmed_duplicate_character|confirmed_bubble_speaker_mismatch|confirmed_missing_character|confirmed_unexpected_character)(?::|$)/.test(code) || measuredFault(code);
export function assessCheck(check, { final = false } = {}) {
  const reviewFlags = [...(check.reviewFlags ?? []).map(flag => ({ ...flag, fields: flag.fields ?? [], label: "FOR SUNNY'S READ", reportOnly: true })), ...(check.observations ?? []).filter(row => row.reportOnly).map(row => reviewNote(row.key, row.evidence, row.fields, row.message))], faults = [], formatFaults = [];
  for (const key of check.faults ?? []) {
    if (isHardFault(key)) faults.push(key);
    else if (check.needsRecheck) formatFaults.push(key);
    else reviewFlags.push(reviewNote(key, check.evidence?.[key] ?? key, check.affectedFields?.[key] ?? []));
  }
  if (final && check.needsRecheck) for (const reason of [...formatFaults, ...(check.measurementFaults ?? [])]) reviewFlags.push(reviewNote('checker_unverified', reason, [], 'One format recheck was used. Keep the available evidence; no missing verdict is invented.'));
  const needsRecheck = Boolean(check.needsRecheck && !final);
  return { ...check, faults: [...faults, ...(needsRecheck ? formatFaults : [])], reviewFlags: [...new Map(reviewFlags.map(flag => [JSON.stringify([flag.key, flag.evidence, flag.fields]), flag])).values()], needsRecheck,
    ready: !needsRecheck && faults.length === 0, verified: !check.needsRecheck && check.verified !== false,
    ...(final && check.needsRecheck ? { unresolvedMeasurements: check.measurementFaults ?? [], measurementFaults: [] } : {}) };
}
export function writerFailureStops(failure) {
  if (failure.unit === 'invented timers') return true;
  if (essentialStoryFaults.has(failure.code) || ['invalid_panel_speaker', 'rewrite_changed_move', 'ineligible_move'].includes(failure.code)) return true;
  if (failure.unit === 'words' && failure.measured === 0 && failure.limit?.min === 1) return true;
  // Types, required keys and an unknown move are malformed payloads, not writing opinions.
  if (['need_four_short_panel_lines', 'invalid_tiny_tries'].includes(failure.code) && ['panels', 'options'].includes(failure.unit) && !Array.isArray(failure.value)) return true;
  return failure.code === 'unknown_move_id' || /keys|arrays|boolean|text strings|finite number/.test(failure.unit + ' ' + failure.instruction) && !/words|panels|options/.test(failure.unit);
}

// New generation separates meaning, private data and usable files from presentation.
export const essentialStoryFaults = new Set([
  'secondMoveTaught', 'feelingGoesAwayPromise', 'scienceClaimsTeachingHelped',
  'scienceRecordMissingOrChanged', 'adviceOutsideRecord', 'tinyTryWrong',
  'filledWhenINotice', 'filled_When_I_notice', 'writer_field_privacy',
  'concernDrift', 'storyContinuity', 'jokeAtPerson',
]);
export const essentialContentFault = key => essentialStoryFaults.has(key.split(':')[0]) ||
  /^(?:printed_layout_overflow|words_differ_in_[^:]+|extra_words_outside_boxes|missing_extra_or_reordered_boxes|confirmed_bubble_speaker_mismatch|filledBlank|lettersPresent)(?::|$)/.test(key);
export function assessGenerationCheck(check, { final = false } = {}) {
  final ||= check.checkStatus === 'unverified' && check.canRedraw === false;
  const hard = (check.faults ?? []).filter(essentialContentFault);
  const unknown = Boolean(check.contentNeedsRecheck ?? (check.needsRecheck && !check.appearanceNeedsReview && !check.measurementFaults?.length));
  const appearanceUnknown = Boolean(check.appearanceNeedsReview || !unknown && check.needsRecheck || check.measurementFaults?.length);
  const notes = (check.faults ?? []).filter(key => !hard.includes(key)).map(key => reviewNote(key, check.evidence?.[key] ?? key, check.affectedFields?.[key] ?? []));
  const reviewFlags = [...(check.reviewFlags ?? []), ...notes];
  if (unknown) reviewFlags.push(reviewNote('checker_unverified', 'The content check did not establish a complete verdict. The saved work is kept.'));
  else if (appearanceUnknown) reviewFlags.push(reviewNote('checker_unverified', (check.measurementFaults ?? []).join('; ') || 'Picture measurements are parent notes.'));
  const faults = [...hard, ...(unknown && final ? ['content_check_unverified'] : [])];
  return { ...check, ready: !unknown && faults.length === 0, faults, needsRecheck: unknown && !final,
    contentNeedsRecheck: unknown, contentVerified: !unknown && check.contentVerified !== false, verified: !unknown && !appearanceUnknown && check.verified !== false, reviewFlags,
    ...(final && unknown ? { checkStatus: 'unverified', canRedraw: false } : {}),
    ...(check.measurementFaults?.length ? { unresolvedMeasurements: check.measurementFaults, measurementFaults: [] } : {}) };
}
