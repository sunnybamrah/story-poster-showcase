import { comicFaceCheckNote } from './graphic-style.js';
import { colourOnlyDifference } from './checker-contract.js';
import { createHash } from 'node:crypto';

// Chosen people keep their saved clothes. Only older unchosen presets may vary by kit.
export function withStoryOutfits(record, seed) {
  const next = structuredClone(record);
  const palette = ['teal', 'blue', 'coral', 'purple', 'gold'];
  next.cast = lockedCast(record).map(person => {
    if (hasChosenAppearance(person) || (person.id === 'child' && record.hero.outfitChoice === 'custom')) return { ...person, outfit: [...person.outfit] };
    const offset = createHash('sha256').update(`${seed}:${person.id}`).digest()[0];
    let changed = false;
    const outfit = person.outfit.map(item => {
      if (changed || !/\b(?:t-shirt|shirt|hoodie|sweater|sweatshirt|cardigan|blouse|jacket|dress|kurta|kameez|coat)\b/i.test(item) || /\b(?:turban|hijab|headscarf|patka|kufi|glasses)\b/i.test(item)) return item;
      const colour = item.match(/\b(?:(?:light|dark|pale|bright|soft)\s+)?(?:red|orange|yellow|green|blue|purple|pink|brown|black|white|grey|gray|navy|teal|coral|gold)\b/i);
      if (!colour) return item;
      const choices = palette.filter(value => !colour[0].toLowerCase().includes(value));
      changed = true;
      return item.slice(0, colour.index) + choices[offset % choices.length] + item.slice(colour.index + colour[0].length);
    });
    return { ...person, outfit };
  });
  next.hero.lockedOutfit = [...next.cast.find(person => person.id === 'child').outfit];
  return next;
}
// Stable anonymous roles keep family names out of every picture request.
export const hasChosenAppearance = person => ['photo', 'description'].includes(person.referenceSource);
export const castIds = ['child', 'grown-up-one', 'grown-up-two', 'grown-up-three', 'grown-up-four', 'sibling-1', 'sibling-2', 'sibling-3'];
export const isCastId = id => castIds.includes(id);
export const hasChosenLook = record => {
  const person = lockedCast(record).find(person => person.id === 'child');
  return Boolean(hasChosenAppearance(person) && person.referencePath && person.referenceHash && person.portraitCandidateId);
};
export function learningActor(record) {
  const id = record.kitContext?.focusPersonId ?? 'child';
  const person = lockedCast(record).find(person => person.id === id);
  if (!person || id.startsWith('sibling-')) throw new Error('Choose the child or a saved grown-up for this kit.');
  return { id, role: person.role, pronouns: person.pronouns, age: id === 'child' ? record.hero.age : null,
    storyName: id === 'child' ? record.hero.nickname : record.storyPeople?.find(item => item.castId === id)?.storyName ?? record.parentLabel ?? person.label };
}
export const castEvaluationVersion = 'chosen-reference-appearance-v3';
export function lockedCast(record) {
  const supplied = record.cast;
  const cast = supplied?.length ? supplied : [{
    id: 'child', label: 'the child', role: 'child', species: 'human',
    description: record.hero.lookChips, outfit: record.hero.lockedOutfit,
    referencePath: record.hero.heroPicturePath || '',
  }, {
    id: 'grown-up-one', label: 'the grown-up', role: 'grown-up', species: 'human',
    pronouns: 'he/him', description: ['human adult man', 'short dark hair'], outfit: ['blue sweater', 'dark trousers', 'brown shoes'], referencePath: '',
  }];
  if (new Set(cast.map(person => person.id)).size !== cast.length || cast.filter(person => person.id === 'child' && person.role === 'child').length !== 1) throw new Error('Each recurring character needs a unique anonymous role, with one primary child.');
  for (const person of cast) {
    if (!isCastId(person.id) || person.role !== (person.id.startsWith('grown-up-') ? 'grown-up' : 'child') || person.species !== 'human' ||
      !Array.isArray(person.description) || !Array.isArray(person.outfit) || [...person.description, ...person.outfit].some(value => typeof value !== 'string' || !value.trim()) ||
      person.pronouns !== undefined && (typeof person.pronouns !== 'string' || !person.pronouns.trim())) throw new Error('Recurring characters need locked human descriptions, pronouns and clothes.');
    if (person.id.startsWith('sibling-') && (!Number.isInteger(person.age) || person.age < 0 || person.age > 17 || !['he/him', 'she/her', 'they/them'].includes(person.pronouns))) throw new Error('A sibling needs their own saved age and pronouns.');
  }
  for (const person of cast) {
    const pronouns = person.id === 'child' ? record.hero.pronouns : person.pronouns;
    if (person.id === 'child' && person.pronouns && person.pronouns !== pronouns ||
      !hasChosenAppearance(person) && pronouns === 'she/her' && /\bhuman (?:boy|man|adult man)\b/i.test(person.description.join(' ')) ||
      !hasChosenAppearance(person) && pronouns === 'he/him' && /\bhuman (?:girl|woman|adult woman)\b/i.test(person.description.join(' '))) throw new Error('The character look conflicts with the saved pronouns. Edit the people before making a kit.');
  }
  return structuredClone(cast).map(person => ({ ...person, pronouns: person.pronouns ?? (person.id === 'child' ? record.hero.pronouns : /\b(?:woman|female|mother)\b/i.test(person.description.join(' ')) ? 'she/her' : 'he/him') }));
}
export const publicCast = record => lockedCast(record).map(({ id, label, role, species, pronouns, description, outfit, referenceSource }) => ({
  id, label, role, species, pronouns, description: hasChosenAppearance({ referenceSource }) ? ['human ' + role] : description, outfit,
  ...(hasChosenAppearance({ referenceSource }) ? { referenceSource, appearanceAuthority: referenceSource === 'photo' ? 'chosen photo reference' : 'chosen description drawing' } : {}),
}));
export function visibleCast(record, { scene, count } = {}) {
  const cast = publicCast(record);
  if (count !== undefined) {
    const focus = record.kitContext?.focusPersonId ?? 'child';
    return [...cast.filter(person => person.id === focus), ...cast.filter(person => person.id !== focus)].slice(0, count);
  }
  const named = cast.filter(person => new RegExp(`\\b${person.id.replaceAll('-', '[- ]')}\\b`, 'i').test(scene ?? ''));
  const selected = named.length ? named : cast.filter(person => person.id === (record.kitContext?.focusPersonId ?? 'child'));
  if (!selected.some(person => person.role === 'grown-up') && /\b(?:grown.up|adult|parent)\b/i.test(scene ?? '')) {
    const adult = cast.find(person => person.role === 'grown-up');
    if (adult) selected.push(adult);
  }
  return selected;
}
export const castDirection = record => `LOCKED HUMAN CAST, identified by anonymous name: ${JSON.stringify(publicCast(record))}. Match each named face and body to that person's own identity reference. Use the supplied outfit for this kit even when the reference shows older clothes. Draw each character at most ONCE in this single scene. References supply identity, never extra people, inset portraits or repeated poses. Never transfer one character's clothes to another. Every character is human, with human skin and no animal ears, muzzle, fur or tail. Keep the same face, hair and age in every picture. Keep this kit’s supplied clothes the same throughout its pictures. All supplied family references are identity references, not extra characters to add to the scene. Separately labelled style and layout guides are not identity references. For a chosen photo reference preserve its character style and maximum likeness. For a chosen description drawing preserve that same recognizable character in every later scene. The world changes the setting, never the chosen face or character style.`;
export const castCheckInstruction = 'Identify each visible character FIRST by anonymous characterId and their own face, age and hair. Compare visible hair, skin, glasses and the written human description against the LOCKED RECORD independently of the reference. A reference can itself be wrong. For referenceSource photo or description, the parent-chosen drawing owns physical appearance; the generic human role is not a preset hair or face description. Compare actual likeness against that chosen reference, while locked clothes still apply. Do not infer gender from hair, clothing, skin or glasses; pronouns are drawing directions, never visually provable facts. Return appearance observations with basis chosen-reference when comparing physical traits to the selected reference, locked-description when comparing a supplied written description or generic preset, and uncertain when that basis cannot be established. For photo or description sources, only chosen-reference owns appearance; a generic preset disagreement cannot override it. Quote each exact description item as expected and describing what is actually visible; a confirmed visible contradiction needs evidence even when the reference shares it. Then judge species and only that identified character\'s clothes against their own supplied outfit for this kit, not the older clothes in the identity reference. Never compare the grown-up\'s sweater with the child\'s hoodie. Return castObservations, one row per visible BODY, not one per cast identity. If the same grown-up appears twice in one drawing, return TWO rows with the SAME characterId and describe both positions in identityEvidence. Do not merge duplicate bodies into one observation. Count only the drawing being checked, never the reference images. For clothing, expected must quote that SAME character\'s exact supplied outfit item. Hidden garments and optional props are not mismatches. identityMatches is false only for an actual changed identity, not a pose, an expression or a simplified comic face. certainty is confirmed only for a directly visible contradiction supported by identityEvidence or clothing evidence; uncertain impressions remain review flags. ' + comicFaceCheckNote;;
const str = { type: 'string' }, bool = { type: 'boolean' };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const castObservationsSchema = { type: 'array', items: object({ characterId: str, observedSpecies: str, identityMatches: bool,
  certainty: { type: 'string', enum: ['confirmed', 'uncertain'] }, identityEvidence: str,
  appearance: { type: 'array', items: object({ basis: { type: 'string', enum: ['chosen-reference', 'locked-description', 'uncertain'] }, expected: str, observed: str, visible: bool, matches: bool, evidence: str }) },
  clothing: { type: 'array', items: object({ expected: str, observed: str, visible: bool, matches: bool, evidence: str }) },
}) };
export const castObservationsParserSchema = structuredClone(castObservationsSchema);
castObservationsParserSchema.items.properties.appearance.items.required = castObservationsParserSchema.items.properties.appearance.items.required.filter(key => key !== 'basis');
export function requireAppearanceBasisResult(check) {
  return check;
}
export function appearanceBasisMissing(observations, expected = true) {
  if (!Array.isArray(observations) || expected && !observations.length) return true;
  return observations.some(row => (row.appearance ?? []).some(item => !['chosen-reference', 'locked-description', 'uncertain'].includes(item.basis)));
}
export function assessCastObservations(observations, cast, picture = 'picture', expectedVisibleCast, { monochrome = false } = {}) {
  const faults = [], reviewFlags = [];
  if (!Array.isArray(observations) || !observations.length) return { faults, reviewFlags: [{ key: 'cast_unverified', evidence: 'This checker answer has no character-by-character identity observations.', fields: [picture] }] };
  for (const person of cast) {
    const instances = observations.filter(row => row.characterId === person.id);
    if (instances.length < 2) continue;
    const evidence = instances.map(row => row.identityEvidence?.trim()).filter(Boolean).join(' ');
    if (instances.every(row => row.certainty === 'confirmed') && evidence) faults.push(`confirmed_duplicate_character: ${picture}, ${person.id}: ${instances.length} visible bodies. ${evidence}`);
    else reviewFlags.push({ key: 'cast_duplicate_uncertain', evidence: evidence || `${person.id} has ${instances.length} observations without confirmed body evidence.`, fields: [picture] });
  }
  for (const row of observations) {
    const required = expectedVisibleCast?.some(person => person.id === row.characterId);
    const absent = /^(?:absent|not visible|missing|none)$/i.test(row.observedSpecies) || /\b(?:no (?:separate |visible )?.{0,65}body is visible|(?:character|person|body) (?:is )?(?:not visible|not shown|absent)|(?:is |are )?(?:absent|missing) from (?:the )?(?:picture|scene))\b/i.test(row.identityEvidence) && !/\b(?:instead|changed into|wearing|has a|has an)\b/i.test(row.identityEvidence);
    if (expectedVisibleCast && absent) {
      if (required && row.certainty === 'confirmed' && row.identityEvidence.trim()) faults.push(`confirmed_missing_character: ${picture}, ${row.characterId}: ${row.identityEvidence}`);
      else if (required) reviewFlags.push({ key: 'cast_presence_uncertain', evidence: row.identityEvidence || 'Required character could not be seen.', fields: [picture] });
      continue;
    }
    if (expectedVisibleCast && !required && row.certainty === 'confirmed' && row.identityEvidence.trim() && /^human\b|^person$/i.test(row.observedSpecies)) faults.push(`confirmed_unexpected_character: ${picture}, ${row.characterId}: ${row.identityEvidence}`);
    const person = cast.find(person => person.id === row.characterId);
    if (!person) { reviewFlags.push({ key: 'cast_unidentified', evidence: row.identityEvidence || 'Visible character was not identified against the locked cast.', fields: [picture] }); continue; }
    const species = /^human\b|^person$/i.test(row.observedSpecies) ? 'human' : row.observedSpecies.toLowerCase();
    const contradicted = species !== person.species || !row.identityMatches;
    if (contradicted && row.identityEvidence.trim()) {
      const key = species !== person.species ? 'confirmed_species_mismatch' : 'confirmed_identity_mismatch';
      if (row.certainty === 'confirmed' && !['unknown', 'unclear', 'uncertain'].includes(species)) faults.push(`${key}: ${picture}, ${person.id}: ${row.identityEvidence}`);
      else reviewFlags.push({ key: 'cast_identity_uncertain', evidence: row.identityEvidence, fields: [picture] });
    }
    if (row.certainty === 'uncertain' && !contradicted) reviewFlags.push({ key: 'cast_identity_uncertain', evidence: row.identityEvidence || 'Character identity is uncertain in this view.', fields: [picture] });
    for (const item of row.appearance ?? []) if (item.visible && !item.matches && item.evidence.trim()) {
      const owned = !hasChosenAppearance(person) && person.description.some(expected => expected.toLowerCase() === item.expected.toLowerCase());
      // Fresh checks name the comparison source. Legacy answers can bind to
      // their exact supplied generic role, whose appearance is reference-owned.
      // Unsupplied preset traits never gain authority from free-text keywords.
      const supplied = person.description.some(expected => expected.toLowerCase() === item.expected.toLowerCase());
      const reference = hasChosenAppearance(person) && (item.basis === 'chosen-reference' || item.basis === undefined && supplied);
      // A black-ink look shows skin, hair and clothes without colour; colour alone is only a note.
      const inkColour = monochrome && colourOnlyDifference(item.expected, item.observed);
      if ((owned || reference) && row.certainty === 'confirmed' && item.observed.trim() && item.observed.toLowerCase() !== item.expected.toLowerCase() && !inkColour) faults.push(`confirmed_cast_appearance_mismatch: ${picture}, ${person.id}: ${item.evidence}`);
      else reviewFlags.push({ key: inkColour ? 'cast_colour_in_ink_look' : hasChosenAppearance(person) && item.basis === undefined && !supplied ? 'cast_appearance_basis_unverified' : 'cast_appearance_uncertain', evidence: item.evidence, fields: [picture] });
    }
    for (const item of row.clothing) if (item.visible && !item.matches && item.evidence.trim()) {
      // A checker cannot borrow an expected garment from a different character.
      const owned = person.outfit.some(expected => expected.toLowerCase() === item.expected.toLowerCase());
      const garment = /\b(?:hoodie|shirt|sweater|jacket|coat|pants|trousers|shorts|dress|skirt|sneakers?|shoes?|boots?|hat|patch|socks?|gloves?|scarf|vest|overalls|uniform)\b/i.test(item.expected) && !/\b(?:sketchbook|backpack|book|pencil|prop)\b/i.test(item.expected);
      const inkColour = monochrome && colourOnlyDifference(item.expected, item.observed);
      if (owned && garment && row.certainty === 'confirmed' && item.observed.trim() && item.observed.toLowerCase() !== item.expected.toLowerCase() && !inkColour) faults.push(`confirmed_cast_clothing_mismatch: ${picture}, ${person.id}: ${item.evidence}`);
      else reviewFlags.push({ key: inkColour ? 'cast_colour_in_ink_look' : owned ? 'cast_clothing_uncertain' : 'cast_clothing_wrong_owner', evidence: item.evidence, fields: [picture] });
    }
  }
  return { faults, reviewFlags };
}
