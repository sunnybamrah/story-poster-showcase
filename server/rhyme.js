import { createHash } from 'node:crypto';
import { readJSON, moves } from './files.js';
import { essentialContentFault } from './stop-policy.js';

// Sunny's editorial rule, not a finding about memory. Sound and meaning still need a human read.
export const rhymeEditorialRule = 'Two short beats, 4 to 7 words TOTAL, plain words, a true spoken rhyme, a clear move action, and no promised feeling outcome. Sunny’s editorial choice, not a memory-study threshold.';
export const rhymeWords = text => typeof text === 'string' ? text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:[-‑][\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*)*/gu) ?? [] : [];
export function chooseRhyme(fresh, move, check, { freshForKit = false } = {}) {
  if (freshForKit) {
    const issues = rhymeRuleFaults(fresh);
    if (check?.verified === false || check?.rhyme?.rhymes !== true) issues.push('The two named words must rhyme when spoken.');
    const normalize = text => String(text ?? '').toLowerCase().replace(/[“”‘’]/g, "'").replace(/\s+/g, ' ').trim();
    for (const flag of check?.reviewFlags ?? []) if (flag.fields?.includes('tagline') && (essentialContentFault(flag.key) || ['rhymeUsesStoryWords', 'rhymeDoesNotStateMove', 'wordAChildMustTranslate'].includes(flag.key))
      && normalize(flag.evidence) && normalize(fresh).includes(normalize(flag.evidence).replace(/^["']|["']$/g, ''))) issues.push(flag.key + ': ' + flag.evidence);
    return { source: 'kit', mode: 'fresh-v1', tagline: fresh, moveId: move.id, approved: false, ownerApproved: false,
      sha256: createHash('sha256').update(fresh).digest('hex'), ready: issues.length === 0, issues,
      reason: 'Written for this kit and checked once with its story. Keep these exact words throughout this kit.' };
  }
  const selected = selectedRhymeFor(move);
  return { source: selected.approved ? 'approved' : 'draft', tagline: selected.tagline, selected,
    ...(selected.approved ? { approved: selected } : {}),
    reviewLabel: selected.reviewLabel,
    reason: selected.approved ? 'Print Sunny’s approved wording verbatim.' : 'Print Codex’s delegated selection verbatim. Keep FOR SUNNY’S READ in the parent notes and saved evidence. A model verdict cannot grant owner approval.' };
}
export function rhymeRuleFaults(tagline) {
  if (typeof tagline !== 'string' || !tagline.trim()) return ['invalid_tagline: supply the saved rhyme.'];
  const count = rhymeWords(tagline).length;
  return count >= 4 && count <= 7 ? [] : [`rhyme_word_count: ${count} words; use 4 to 7 words TOTAL.`];
}

export function resolveTopicReminderAlias(moveId, topicRecords, knownMoves = moves) {
  const path = [], seen = new Set([moveId]);
  let id = moveId;
  for (;;) {
    const matches = topicRecords.filter(record => record.moveId === id);
    if (matches.length > 1) throw Error(`approved_rhyme_invalid: ${id} has ambiguous topic reminders.`);
    const alias = matches[0];
    if (!alias || !Object.hasOwn(alias, 'canonicalMoveId')) return path.length ? { move: knownMoves.find(move => move.id === id), path } : null;
    if (Object.keys(alias).sort().join() !== ['canonicalMoveId', 'moveId', 'revision'].sort().join() || typeof alias.canonicalMoveId !== 'string' || !alias.canonicalMoveId || typeof alias.revision !== 'string' || !alias.revision) throw Error(`approved_rhyme_invalid: ${id} has an invalid reminder alias.`);
    if (seen.has(alias.canonicalMoveId)) throw Error(`approved_rhyme_invalid: ${id} has a reminder alias loop.`);
    if (knownMoves.filter(move => move.id === alias.canonicalMoveId).length !== 1) throw Error(`approved_rhyme_invalid: ${id} needs one known canonical reminder topic.`);
    path.push(structuredClone(alias)); seen.add(alias.canonicalMoveId); id = alias.canonicalMoveId;
  }
}

export function selectedRhymeFor(move, records) {
  const topicRecords = readJSON(new URL('../content/topic-reminders.json', import.meta.url));
  const alias = resolveTopicReminderAlias(move.id, topicRecords);
  if (alias) {
    if (move.rhymeRecord && (move.rhymeRecord.approval?.status !== 'pending' || move.rhymeRecord.approval.by !== null)) throw Error(`approved_rhyme_invalid: ${move.id}: An attached record cannot grant Sunny’s approval.`);
    const canonical = selectedRhymeFor(alias.move, records);
    return { ...canonical, moveId: move.id, source: 'content/topic-reminders.json', canonicalMoveId: canonical.moveId, aliasPath: alias.path,
      sha256: createHash('sha256').update(JSON.stringify({ alias: alias.path, canonical })).digest('hex') };
  }
  const overrides = records === undefined ? topicRecords.filter(record => record.moveId === move.id) : [];
  const attached = records === undefined && !overrides.length && Object.hasOwn(move, 'rhymeRecord');
  const matches = overrides.length ? overrides : attached ? [move.rhymeRecord] : (records ?? readJSON(new URL('../content/rhymes-draft.json', import.meta.url))).filter(record => record.moveId === move.id);
  if (matches.length !== 1) throw new Error(`approved_rhyme_missing: ${move.id} needs one saved rhyme.`);
  const record = matches[0];
  if (!record || record.moveId !== move.id || !Array.isArray(record.lines) || record.lines.length !== 2 || record.lines.some(line => typeof line !== 'string' || !line.trim() || !rhymeWords(line).length || /[\r\n]/.test(line))) throw new Error(`approved_rhyme_invalid: ${move.id} needs two saved halves for this move.`);
  const tagline = record.lines.map(line => line.trim()).join(' ');
  const faults = [];
  if (typeof record.author !== 'string' || !record.author.trim() || !['approved', 'pending'].includes(record.approval?.status)) faults.push('Record the author and explicit approval status.');
  const approved = record.approval?.status === 'approved' && record.approval?.by === 'Sunny';
  if (!approved) faults.push(...rhymeRuleFaults(tagline));
  if (record.approval?.status === 'approved' && !approved) faults.push('Only Sunny can approve the wording.');
  if (approved && record.approval.text !== tagline) faults.push('Sunny’s approval must name these exact words.');
  if (!record.selection || typeof record.selection.by !== 'string' || !record.selection.by.trim() || typeof record.selection.authority !== 'string' || !record.selection.authority.trim() || record.selection.ownerApproval !== false) faults.push('Record who selected the wording, their delegated authority, and ownerApproval false.');
  if (attached && (record.approval?.status !== 'pending' || record.approval.by !== null)) faults.push('Runtime wording stays pending. An attached record cannot grant Sunny’s approval.');
  if (faults.length) throw new Error(`approved_rhyme_invalid: ${move.id}: ${faults.join('; ')}`);
  return { moveId: move.id, tagline, lines: [...record.lines], source: overrides.length ? 'content/topic-reminders.json' : attached ? 'move.rhymeRecord' : 'content/rhymes-draft.json', revision: record.revision ?? null,
    sha256: createHash('sha256').update(JSON.stringify(record)).digest('hex'), author: record.author,
    approval: structuredClone(record.approval), selection: structuredClone(record.selection ?? null), approved, reviewLabel: approved ? '' : "FOR SUNNY'S READ",
  };
}

const hashText = value => createHash('sha256').update(value).digest('hex');
const hashSelection = value => hashText(JSON.stringify(value));

export function snapshotTopicRhyme(move, selected = selectedRhymeFor(move)) {
  if (selected.moveId !== move.id || !selected.tagline?.trim()) throw Error('The saved reminder belongs to a different topic.');
  return { source: 'topic', mode: 'topic-v1', moveId: move.id, tagline: selected.tagline,
    sha256: hashText(selected.tagline), selected: structuredClone(selected), selectionHash: hashSelection(selected),
    approved: selected.approved, ownerApproved: selected.approved, reviewLabel: selected.reviewLabel, ready: true,
    reason: 'Keep this topic reminder verbatim across new moments. This kit keeps its saved wording.' };
}

export function savedRhymeSelection(text, move) {
  const selection = text?.rhymeSelection;
  if (typeof text?.tagline !== 'string' || !text.tagline.trim()) throw Error('The saved story needs its original reminder.');
  if (selection?.source === 'kit' || ['topic-v1', 'historical-v1'].includes(selection?.mode)) {
    if (selection.tagline !== text.tagline || selection.moveId !== move.id || selection.sha256 !== hashText(text.tagline)) throw Error('Saved kit rhyme changed. Keep the original wording with this kit.');
    if (selection.mode === 'topic-v1' && (selection.selected?.tagline !== text.tagline || selection.selected?.moveId !== move.id || selection.selectionHash !== hashSelection(selection.selected) || selection.approved !== selection.selected.approved || selection.ownerApproved !== selection.selected.approved)) throw Error('Saved topic reminder record changed. Keep the original selection with this kit.');
    return { ...structuredClone(selection), ready: true };
  }
  return { source: 'historical', mode: 'historical-v1', moveId: move.id, tagline: text.tagline,
    sha256: hashText(text.tagline), approved: false, ownerApproved: false, ready: true,
    ...(selection?.selected?.tagline === text.tagline && selection.selected.moveId === move.id ? { selected: structuredClone(selection.selected), approved: selection.selected.approved === true, ownerApproved: selection.selected.approved === true } : {}),
    reason: 'Preserve the wording already saved with this story.' };
}

export function rhymeForKit(text, move) {
  if (!text?.tagline) return selectedRhymeFor(move);
  const saved = savedRhymeSelection(text, move);
  return { ...saved.selected, ...saved, reviewLabel: saved.reviewLabel ?? saved.selected?.reviewLabel ?? '' };
}

// Resume preserves the story's wording, including older unversioned partial kits.
export const rhymeNeedsRefresh = (text, move) => {
  savedRhymeSelection(text, move);
  return false;
};

export function approvedRhymeFor(move, records) {
  const record = selectedRhymeFor(move, records);
  if (!record.approved) throw new Error(`approved_rhyme_unapproved: ${move.id} remains FOR SUNNY'S READ.`);
  return record;
}
