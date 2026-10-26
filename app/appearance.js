// Fixed fictional choices shared by setup and the local server.
export const childLooks = {
  hair: ['short dark hair', 'long dark hair', 'curly brown hair', 'straight black hair', 'short blond hair'],
  skin: ['light skin', 'warm tan skin', 'brown skin', 'dark brown skin'],
  glasses: ['no glasses', 'round glasses', 'rectangular glasses'],
};
export const defaultAppearance = { hair: 'short dark hair', skin: 'warm tan skin', glasses: 'no glasses' };
export function appearanceFrom(record) {
  const chips = record.hero.lookChips.join(' ');
  return Object.fromEntries(Object.entries(childLooks).map(([key, choices]) => [key, [...choices].sort((a, b) => b.length - a.length).find(value => chips.includes(value)) ?? defaultAppearance[key]]));
}

// Keep the identity and revision seen when typing, not tokens from a later read.
export function appearanceDraftData(person, description, base) {
  const revision = person.draft?.revision ?? 0;
  if (!base || (base.isNew ? revision !== 0 : base.personIdentity !== person.personIdentity || base.revision !== revision)) throw new Error('This person or description changed. Reload this page to see the saved version.');
  return { description, personIdentity: base.isNew ? person.personIdentity : base.personIdentity, revision: base.isNew ? 0 : base.revision };
}

export function appearanceDraftBase(previous, person) {
  return previous ?? { personIdentity: person.personIdentity, revision: person.draft?.revision ?? 0, isNew: !person.personIdentity };
}
