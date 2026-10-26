import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { root, readJSON, saveJSON, moves } from './files.js';
import { assertSavedWorld } from './worlds.js';
import { wallChoices } from '../web/interactive.js';
import { lockedCast } from './cast.js';
import { pictureStyleIdFor } from '../app/picture-styles.js';
import { canonicalActionId } from './library-action.js';
import { optionalSchoolGrade } from './library-grade.js';

const kitFields = ['date', 'chapterNumber', 'moveId', 'triedMove', 'didItHelp', 'adventureLine', 'world', 'colourSet'];
const exactKitFields = ['keyWord', 'keyWordMeaning', 'tagline', 'storyMode', 'focusPersonId'];
const kitRecord = kit => ({ ...Object.fromEntries([...kitFields, ...exactKitFields.filter(key => kit[key] !== undefined)].map(key => [key, kit[key]])), wallChoice: kit.wallChoice ?? null });
export function keywordHistory(record) {
  return (record.pastKits ?? []).map(kit => {
    const legacy = moves.find(move => move.id === kit.moveId);
    return { chapterNumber: kit.chapterNumber, moveId: kit.moveId, keyWord: kit.keyWord ?? legacy?.keyWord ?? '', keyWordMeaning: kit.keyWordMeaning ?? legacy?.positiveAction ?? '', tagline: kit.tagline ?? '', exact: typeof kit.keyWord === 'string' && typeof kit.keyWordMeaning === 'string' };
  });
}
export const actorHistory = record => (record.pastKits ?? []).filter(kit => (kit.focusPersonId ?? 'child') === (record.kitContext?.focusPersonId ?? 'child'));
export const usedMoveIds = record => {
  const ids = new Set([...((record.kitContext?.focusPersonId ?? 'child') === 'child' ? record.usedMoveIds ?? [] : []), ...actorHistory(record).map(kit => kit.moveId)]);
  const usedActions = new Set([...ids].map(id => canonicalActionId(moves.find(move => move.id === id)) ?? id));
  return [...new Set([...ids, ...moves.filter(move => usedActions.has(canonicalActionId(move))).map(move => move.id)])];
};
export function latestMoveFeedback(record, moveId, availableMoves = moves) {
  const action = id => canonicalActionId(availableMoves.find(move => move.id === id)) ?? id;
  const explicit = new Set(['yes', 'a little', 'no', 'not for us']);
  return actorHistory(record).findLast(kit => explicit.has(kit.didItHelp) && action(kit.moveId) === action(moveId));
}

function validate(record) {
  pictureStyleIdFor(record);
  if (typeof record.familyContext !== 'string') throw new Error('Family context must be text.');
  if (record.parentLabel !== undefined && (typeof record.parentLabel !== 'string' || !record.parentLabel.trim() || record.parentLabel.length > 85 || /[\r\n]/.test(record.parentLabel))) throw new Error('Parent label must be a short name.');
  const hero = record.hero;
  optionalSchoolGrade(hero?.schoolGrade);
  if (!hero || !Number.isInteger(hero.age) || hero.age < (hero.supportingOnly === true ? 0 : 8) || hero.age > (hero.supportingOnly === true ? 17 : 13)) throw new Error('Learning-kit ages are 8 to 13. Other saved child profiles may join a sibling’s story.');
  for (const key of ['nickname', 'pronouns', 'heroPicturePath']) if (typeof hero[key] !== 'string') throw new Error(`Missing hero ${key}.`);
  if (!Array.isArray(hero.loves) || hero.loves.length > 3 || hero.loves.some(x => typeof x !== 'string')) throw new Error('Add up to three things the child loves, or leave this empty.');
  for (const key of ['lookChips', 'lockedOutfit']) if (!Array.isArray(hero[key]) || hero[key].some(x => typeof x !== 'string')) throw new Error(`Invalid ${key}.`);
  if (record.cast) lockedCast(record);
  if (!Array.isArray(record.pastKits)) throw new Error('Past kits must be a list.');
  for (const kit of record.pastKits) {
    for (const key of exactKitFields) if (kit[key] !== undefined && typeof kit[key] !== 'string') throw new Error(`Invalid saved ${key}.`);
    if (kit.storyMode !== undefined && !['inspired', 'factual'].includes(kit.storyMode)) throw new Error('Invalid saved story mode.');
    if (kit.wallChoice != null && !wallChoices.includes(kit.wallChoice)) throw new Error('Invalid wall choice.');
    for (const key of kitFields.filter(key => key !== 'chapterNumber')) if (typeof kit[key] !== 'string') throw new Error(`Missing past kit ${key}.`);
    if (!Number.isInteger(kit.chapterNumber) || kit.chapterNumber < 1) throw new Error('Missing past kit chapterNumber.');
    if (!moves.some(move => move.id === kit.moveId)) throw new Error('Unknown saved move.');
    if (!['yes', 'no', 'unanswered'].includes(kit.triedMove) || !['yes', 'a little', 'no', 'not for us', 'unanswered'].includes(kit.didItHelp)) throw new Error('Invalid kit feedback.');
    assertSavedWorld(kit);
  }
  if (new Set(record.pastKits.map(kit => kit.chapterNumber)).size !== record.pastKits.length) throw new Error('Repeated chapter number.');
  if (record.usedMoveIds && (!Array.isArray(record.usedMoveIds) || record.usedMoveIds.some(id => !moves.some(move => move.id === id)))) throw new Error('Invalid used move history.');
}

export function summarize3(record = memory.exportRecord()) {
  const recent = actorHistory(record).slice(-3);
  const oneLine = value => value.replace(/\s+/g, ' ').trim();
  const lines = recent.map(kit => `${oneLine(kit.date)}: ${oneLine(kit.moveId)}; didItHelp=${oneLine(kit.didItHelp)}; ${kit.storyMode === 'factual' ? 'parentSuppliedRetelling' : 'fictionalStoryExcerpt'}=${oneLine(kit.adventureLine) || 'not retained'}${kit.keyWord ? `; keyWord=${oneLine(kit.keyWord)}; meaning=${oneLine(kit.keyWordMeaning ?? '')}` : ''}${kit.tagline ? `; rhyme=${oneLine(kit.tagline)}` : ''}. This saved story excerpt is not a new confirmed family fact.`);
  while (lines.length < 3) lines.unshift('No earlier kit.');
  return lines.join('\n');
}

// Rank only words already in saved kit records. This selects existing excerpts;
// it does not invent an event or turn old feedback into a new family fact.
export function relevantMemory(record, tonight = '') {
  const stop = new Set('a an the and or but i me my our we you your he she they his her their it is was were be been am are to of for in on at with from this that then today tonight again said says child parent'.split(' '));
  const tokens = value => new Set((String(value).toLowerCase().match(/[a-z]+/g) ?? []).map(word => word.replace(/(?:ing|ed|s)$/u, '')).filter(word => word.length > 2 && !stop.has(word)));
  const query = tokens(tonight);
  const selected = actorHistory(record).map((kit, index) => {
    const move = moves.find(move => move.id === kit.moveId);
    const saved = tokens(`${kit.adventureLine} ${kit.moveId} ${move?.name ?? ''} ${kit.keyWord ?? ''} ${kit.keyWordMeaning ?? ''}`);
    return { kit, index, score: [...query].filter(word => saved.has(word)).length };
  }).sort((a, b) => b.score - a.score || b.index - a.index).slice(0, 3).sort((a, b) => a.index - b.index).map(row => row.kit);
  return summarize3({ ...record, pastKits: selected });
}

// Fact changes clear derived prose. A paraphrase cannot be safely edited by search and replace.
export function createMemory(file = join(root, 'test/state/family.json')) {
  const read = () => {
    if (!existsSync(file)) throw new Error('Store a family record first.');
    return readJSON(file);
  };
  const write = record => { validate(record); record.usedMoveIds = usedMoveIds(record); saveJSON(file, record); return structuredClone(record); };
  function change(oldText, newText, deleting) {
    if (typeof oldText !== 'string' || !oldText.trim() || typeof newText !== 'string') throw new Error('A nonempty fact is required.');
    const record = read();
    if (!record.familyContext.includes(oldText)) throw new Error('The exact fact is not in familyContext.');
    record.familyContext = record.familyContext.split(oldText).join(newText).replace(/\s{2,}/g, ' ').trim();
    // No old body, digest or generated adventure is allowed to survive a fact change.
    record.cachedRequests = [];
    record.pastKits = record.pastKits.map(kit => ({ ...kit, adventureLine: '' }));
    record.revision += 1;
    record.derivedTextCleared = true;
    // Exact duplicates in parent-supplied hero fields are removed too.
    const clean = value => typeof value === 'string' ? value.split(oldText).join(newText) :
      Array.isArray(value) ? value.map(clean) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k, clean(v)])) : value;
    record.hero = clean(record.hero);
    if (record.cast) record.cast = clean(record.cast);
    if (record.storyPeople) record.storyPeople = clean(record.storyPeople);
    if (deleting && JSON.stringify(record).includes(oldText)) throw new Error('Deleted text remains in the record.');
    return write(record);
  }
  return {
    store(record) {
      // An allowlist keeps raw story bodies and stale summaries out of storage.
      validate(record);
      const hero = Object.fromEntries(['nickname', 'name', 'age', 'schoolGrade', 'supportingOnly', 'pronouns', 'loves', 'lookChips', 'lockedOutfit', 'heroPicturePath'].filter(key => record.hero[key] !== undefined).map(key => [key, structuredClone(record.hero[key])]));
      const pastKits = record.pastKits.map(kitRecord);
      const consent = record.dataPolicyConsent ?? (existsSync(file) ? read().dataPolicyConsent : undefined);
      const pictureStyleId = pictureStyleIdFor(record.pictureStyleId ?? (existsSync(file) ? read().pictureStyleId : undefined));
      return write({ real: record.real === true, pictureStyleId, ...(consent ? { dataPolicyConsent: structuredClone(consent) } : {}), familyContext: record.familyContext, parentLabel: record.parentLabel ?? 'Dad', hero, ...(record.cast ? { cast: lockedCast(record) } : {}), ...(record.storyPeople ? { storyPeople: structuredClone(record.storyPeople) } : {}),
        pastKits, usedMoveIds: usedMoveIds(record), cachedRequests: [], revision: existsSync(file) ? read().revision + 1 : 0, derivedTextCleared: false });
    },
    editFact: (oldText, newText) => change(oldText, newText, false),
    deleteFact: text => change(text, '', true),
    exportRecord: () => structuredClone(read()),
    summarize3: () => summarize3(read()),
    setDataPolicyConsent(consent) { const record = read(); record.dataPolicyConsent = structuredClone(consent); return write(record); },
    setPictureStyle(id) {
      const record = read(), previous = pictureStyleIdFor(record); record.pictureStyleId = pictureStyleIdFor(id);
      if (previous !== record.pictureStyleId) { record.revision = (record.revision ?? 0) + 1; record.cachedRequests = []; }
      return write(record);
    },
    addKit(kit) { const record = read(); record.pastKits.push(kitRecord(kit)); return write(record); },
    setWallChoice(chapterNumber, wallChoice) {
      if (!wallChoices.includes(wallChoice)) throw new Error('Invalid wall choice.');
      const record = read();
      const kit = record.pastKits.find(kit => kit.chapterNumber === chapterNumber);
      if (!kit) throw new Error('No saved kit has that chapter number.');
      kit.wallChoice = wallChoice;
      return write(record);
    },
    setFeedback(chapterNumber, { triedMove, didItHelp }) {
      const record = read();
      const kit = record.pastKits.find(kit => kit.chapterNumber === chapterNumber);
      if (!kit) throw new Error('No saved kit has that chapter number.');
      Object.assign(kit, { triedMove, didItHelp });
      record.cachedRequests = []; record.revision += 1;
      return write(record);
    },
    setHeroPicture(path) { const record = read(); record.hero.heroPicturePath = path; return write(record); },
    setCast(cast) { const record = read(); record.cast = structuredClone(cast); lockedCast(record); record.hero.heroPicturePath = cast.find(person => person.role === 'child').referencePath; return write(record); },
    cacheRequest(body) {
      const record = read();
      const handle = { revision: record.revision, index: record.cachedRequests.length };
      record.cachedRequests.push(structuredClone(body)); write(record); return handle;
    },
    getCachedRequest(handle) {
      const record = read();
      if (handle.revision !== record.revision || !record.cachedRequests[handle.index]) throw new Error('This request was cleared by a memory change.');
      return structuredClone(record.cachedRequests[handle.index]);
    },
  };
}

const memory = createMemory();
export const store = record => memory.store(record);
export const editFact = (oldText, newText) => memory.editFact(oldText, newText);
export const deleteFact = text => memory.deleteFact(text);
export const exportRecord = () => memory.exportRecord();
