import { createMemory } from './memory.js';
import { config, assertFamilyAllowed, recordDataConsent } from './config.js';
import { childLooks, defaultAppearance } from '../app/appearance.js';
import { lockedCast, learningActor, hasChosenLook } from './cast.js';
import { pictureStyleIdFor } from '../app/picture-styles.js';
import { optionalSchoolGrade } from './library-grade.js';

export const heroPresets = [
  { id: 'comet', title: 'The comic maker', look: ['human child', 'short dark hair', 'warm tan skin', 'no glasses'], outfit: ['green hoodie with a yellow lightning patch', 'red high top sneakers', 'blue sketchbook under one arm'] },
  { id: 'fern', title: 'The explorer', look: ['human child', 'curly brown hair', 'brown skin', 'no glasses'], outfit: ['purple sweater', 'blue trousers', 'yellow sneakers'] },
  { id: 'sun', title: 'The inventor', look: ['human child', 'straight black hair', 'warm tan skin', 'no glasses'], outfit: ['orange shirt', 'navy overalls', 'green sneakers'] },
];
const text = (value, max, label, optional = false) => {
  if (typeof value !== 'string' || value.length > max || !optional && !value.trim()) throw new Error(`Please check ${label}.`);
  return value.trim();
};
const clothingItems = value => {
  const items = text(value, 400, 'outfit notes').split(';').map(item => item.trim()).filter(Boolean);
  if (!items.length || items.length > 8) throw new Error('Add one to eight clothing items.');
  return items;
};
export const canLeadKit = record => Number.isInteger(record?.hero?.age) && record.hero.age >= 8 && record.hero.age <= 13 && record.hero.supportingOnly !== true;
export function setupRecord(input, settings = config, { allowSupportingChild = false } = {}) {
  if (typeof input?.real !== 'boolean') throw new Error('Choose a made-up family or a real family.');
  const consent = input.dataPolicyConsent?.accepted === true ? recordDataConsent(input.dataPolicyConsent, () => new Date(), settings.dataPolicyVersion) : undefined;
  assertFamilyAllowed({ real: input.real, hero: { age: input.age }, ...(consent ? { dataPolicyConsent: consent } : {}) }, settings);
  const preset = heroPresets.find(item => item.id === input.presetId);
  if (!preset && input.presetId !== 'custom') throw new Error('Choose a hero look.');
  const outfit = input.presetId === 'custom' ? clothingItems(input.customOutfit) : preset.outfit;
  if (!outfit.length || outfit.length > 8) throw new Error('Add one to eight clothing items.');
  if (!Number.isInteger(input.age) || input.age < (allowSupportingChild ? 0 : 8) || input.age > (allowSupportingChild ? 17 : 13)) throw new Error(allowSupportingChild ? 'Choose an age from 0 to 17.' : 'Choose an age from 8 to 13.');
  const schoolGrade = optionalSchoolGrade(input.schoolGrade);
  if (!['he/him', 'she/her', 'they/them'].includes(input.pronouns)) throw new Error('Choose pronouns.');
  if (!Array.isArray(input.loves) || input.loves.length > 3) throw new Error('Add up to three things the child loves, or leave this empty.');
  const suppliedAppearance = input.appearanceMode === 'photo-or-description';
  const appearance = input.appearance ?? defaultAppearance;
  for (const [key, choices] of Object.entries(childLooks)) if (!suppliedAppearance && !choices.includes(appearance[key])) throw new Error('Choose the hero hair, skin and glasses.');
  const look = [input.pronouns === 'she/her' ? 'human girl' : input.pronouns === 'he/him' ? 'human boy' : 'human child', ...(suppliedAppearance ? [] : [appearance.hair, appearance.skin, appearance.glasses])];
  const parents = input.parents;
  if (!Array.isArray(parents) || parents.length < 1 || parents.length > 2) throw new Error('Add one or two grown-ups.');
  const cast = [{ id: 'child', label: 'the child', role: 'child', species: 'human', description: look, outfit, pronouns: input.pronouns, referencePath: '' }, ...parents.map((parent, index) => {
    if (!['he/him', 'she/her', 'they/them'].includes(parent.pronouns)) throw new Error('Choose grown-up pronouns.');
    if (!suppliedAppearance && !['short dark hair', 'long dark hair', 'curly brown hair', 'short grey hair'].includes(parent.hair)) throw new Error('Choose a grown-up look.');
    return { id: index ? 'grown-up-two' : 'grown-up-one', label: index ? 'the second grown-up' : 'the grown-up', role: 'grown-up', species: 'human', pronouns: parent.pronouns, description: [parent.pronouns === 'she/her' ? 'human adult woman' : parent.pronouns === 'he/him' ? 'human adult man' : 'human adult', ...(suppliedAppearance ? [] : [parent.hair])], outfit: parent.customOutfit !== undefined ? clothingItems(parent.customOutfit) : index ? ['coral sweater', 'dark trousers', 'brown shoes'] : ['blue sweater', 'dark trousers', 'brown shoes'], referencePath: '' };
  })];
  const parentLabel = parents.map(parent => text(parent.label, 40, 'your story name')).join(' and ');
  const nickname = text(input.nickname, 30, 'the hero nickname');
  const record = { real: input.real, pictureStyleId: pictureStyleIdFor(input, { newFamily: true }), parentLabel, storyPeople: parents.map((parent, index) => ({ castId: index ? 'grown-up-two' : 'grown-up-one', storyName: text(parent.label, 40, 'the grown-up story name') })), familyContext: text(input.familyContext ?? '', 4000, 'family notes', true), hero: { nickname, name: nickname, outfitChoice: input.presetId === 'custom' ? 'custom' : 'preset', age: input.age, pronouns: input.pronouns, loves: input.loves.map(item => text(item, 80, 'things the child loves')), lookChips: look, lockedOutfit: outfit, heroPicturePath: '' }, cast, pastKits: [] };
  if (consent) record.dataPolicyConsent = consent;
  if (schoolGrade) record.hero.schoolGrade = schoolGrade;
  if (input.age < 8 || input.age > 13) record.hero.supportingOnly = true;
  record.cast.find(person => person.id === 'child').age = input.age;
  lockedCast(record); return record;
}
export function storeSetup(file, input) { const memory = createMemory(file); memory.store(setupRecord(input)); return memory; }

// The caller resolves profiles inside the signed-in account before calling this.
// A job owns a snapshot; selecting a sibling never changes either saved profile.
export function buildKitRecord(record, { kitContext = {}, siblings = [] } = {}) {
  if (!kitContext || typeof kitContext !== 'object' || Array.isArray(kitContext)) throw new Error('Please check tonight’s story choices.');
  const context = { focusPersonId: kitContext.focusPersonId ?? 'child', storyMode: kitContext.storyMode ?? 'inspired', siblingChildIds: kitContext.siblingChildIds ?? [], remembranceChildLed: kitContext.remembranceChildLed === true };
  if (!['inspired', 'factual'].includes(context.storyMode)) throw new Error('Choose an inspired story or only the facts you share.');
  if (!Array.isArray(context.siblingChildIds) || context.siblingChildIds.length > 3 || context.siblingChildIds.some(id => typeof id !== 'string' || !id) || new Set(context.siblingChildIds).size !== context.siblingChildIds.length) throw new Error('Choose up to three saved siblings who were part of this moment.');
  const next = structuredClone(record);
  next.cast = lockedCast(record).filter(person => !person.id.startsWith('sibling-'));
  next.storyPeople = (next.storyPeople ?? []).filter(person => !person.castId.startsWith('sibling-'));
  // Omission preserves historical contexts; an explicit choice belongs only to this job.
  if (Object.hasOwn(kitContext, 'selectedGrownUpIds')) {
    const selected = kitContext.selectedGrownUpIds;
    const adults = next.cast.filter(person => person.role === 'grown-up');
    if (!Array.isArray(selected) || !selected.length || selected.length > adults.length || new Set(selected).size !== selected.length || selected.some(id => !adults.some(person => person.id === id))) throw new Error('Choose the saved grown-ups joining this story.');
    if (context.focusPersonId !== 'child' && !selected.includes(context.focusPersonId)) throw new Error('The grown-up learning tonight must join this story.');
    context.selectedGrownUpIds = [...selected];
    next.cast = next.cast.filter(person => person.role !== 'grown-up' || selected.includes(person.id));
    next.storyPeople = next.storyPeople.filter(person => !person.castId.startsWith('grown-up-') || selected.includes(person.castId));
    next.parentLabel = next.cast.filter(person => person.role === 'grown-up').map(person => next.storyPeople.find(named => named.castId === person.id)?.storyName ?? person.label).join(' and ');
  }
  if (kitContext.pictureStyleId !== undefined) { context.pictureStyleId = pictureStyleIdFor(kitContext.pictureStyleId); next.pictureStyleId = context.pictureStyleId; }
  next.kitContext = context;
  learningActor(next);
  context.siblingChildIds.forEach((id, index) => {
    const sibling = siblings.find(item => item.id === id)?.record;
    if (!sibling) throw new Error('That sibling is not in this family. Choose a saved family profile.');
    if (!hasChosenLook(sibling)) throw new Error('Choose the sibling’s story drawing in Family first.');
    if (pictureStyleIdFor(sibling) !== pictureStyleIdFor(next)) throw new Error('The sibling needs the same saved family look.');
    const person = lockedCast(sibling).find(person => person.id === 'child'), castId = `sibling-${index + 1}`;
    next.cast.push({ ...person, id: castId, label: `the sibling ${index + 1}`, age: sibling.hero.age, pronouns: sibling.hero.pronouns });
    next.storyPeople.push({ castId, storyName: sibling.hero.nickname });
  });
  lockedCast(next);
  return next;
}

// Older setup hid a gendered preset behind an outfit label. Repair only that
// contradiction; completed kits remain evidence, but the next kit needs a new
// child reference checked against the corrected record.
export function repairPresetConflict(record) {
  const pronouns = record.hero.pronouns;
  const wrong = pronouns === 'she/her' ? /\bhuman boy\b/gi : pronouns === 'he/him' ? /\bhuman girl\b/gi : /\bhuman (?:boy|girl)\b/gi;
  const replacement = pronouns === 'she/her' ? 'human girl' : pronouns === 'he/him' ? 'human boy' : 'human child';
  const child = record.cast?.find(person => person.role === 'child');
  const corrected = record.hero.lookChips.map(value => value.replace(wrong, replacement));
  const description = child?.description.map(value => value.replace(wrong, replacement));
  if (JSON.stringify(corrected) === JSON.stringify(record.hero.lookChips) && (!child || child.pronouns === pronouns && JSON.stringify(description) === JSON.stringify(child.description))) return false;
  record.hero.lookChips = corrected; record.hero.heroPicturePath = '';
  if (child) { child.description = description; child.pronouns = pronouns; child.referencePath = ''; delete child.referenceHash; }
  return true;
}
