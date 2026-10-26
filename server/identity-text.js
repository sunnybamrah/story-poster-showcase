// Identity substitutions apply only to image-bound fields, never to the chapter.
const speciesNames = new Set(['fox', 'cat', 'dog', 'bear', 'rabbit', 'bunny', 'owl', 'wolf', 'tiger', 'lion', 'panda', 'mouse', 'otter', 'raccoon', 'deer', 'dragon', 'dinosaur', 'penguin', 'squirrel', 'hedgehog', 'robot', 'unicorn']);
const clean = value => String(value ?? '').normalize('NFKC').replace(/[’‘]/g, "'").trim();
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
const wordBoundary = ['(?<![\\p{L}\\p{N}_])', '(?![\\p{L}\\p{N}_])'];

function identities(context) {
  const name = clean(context.heroName), nickname = clean(context.nickname), parent = clean(context.parentLabel);
  const namedSpecies = name.match(/\b(?:the|a|an)\s+(\p{L}+)$/iu)?.[1]?.toLowerCase();
  const suppliedSpecies = clean(context.species).toLowerCase();
  const species = speciesNames.has(suppliedSpecies) ? suppliedSpecies : speciesNames.has(namedSpecies) ? namedSpecies : null;
  const heroCore = species ? name.replace(new RegExp(`\\s+(?:the|a|an)\\s+${escape(species)}$`, 'iu'), '') : name;
  const parentCore = parent.replace(/^(?:(?:my|our|the|aunt|auntie|uncle|grandma|grandpa|grandmother|grandfather|mr\.?|mrs\.?|ms\.?|dr\.?)\s+)+/iu, '');
  const entries = [[nickname, 'nickname'], [name, 'hero name'], [heroCore, 'hero name'], [parent, 'parent label'], [parentCore, 'parent label']]
    .filter(([text]) => text).sort((a, b) => b[0].length - a[0].length);
  const seen = new Set();
  const aliases = entries.filter(([text]) => { const key = text.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
  // If a private name is also the species word, choose a neutral public label.
  const privateWords = new Set([nickname, heroCore, parentCore].flatMap(text => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []));
  const hero = species && !privateWords.has(species) ? `the ${species}` : ['hero', 'character', 'figure'].map(noun => `the ${noun}`).find(label => !privateWords.has(label.slice(4))) ?? 'the character';
  return { aliases, species, hero, parent: 'a grown-up' };
}
export function anonymousLabels(context) { const { hero, parent } = identities(context); return { hero, parent }; }
function aliasPattern(alias, kind, species) {
  const prefix = kind === 'parent label' ? '(?:(?:my|your|our|their|his|her|the)\\s+)?' : '(?:the\\s+)?';
  const description = kind !== 'parent label' && species ? `(?:\\s*,\\s*the\\s+${escape(species)}\\s*,?|\\s+the\\s+${escape(species)})?` : '';
  return new RegExp(wordBoundary[0] + prefix + escape(alias) + description + "('s)?" + wordBoundary[1], 'giu');
}
export function identityHits(text, context) {
  const { aliases, species } = identities(context);
  return aliases.filter(([alias, kind]) => aliasPattern(alias, kind, species).test(clean(text))).map(([alias, kind]) => ({ alias, kind }));
}
export function scrubIdentityNames(text, context) {
  if (typeof text !== 'string') return text;
  const { aliases, species, hero, parent } = identities(context);
  let result = text.normalize('NFKC').replace(/[’‘]/g, "'");
  for (const [alias, kind] of aliases) {
    result = result.replace(aliasPattern(alias, kind, species), (_, possessive) => (kind === 'parent label' ? parent : hero) + (possessive ?? ''));
  }
  const labels = [hero, parent].map(escape).join('|');
  return result.replace(new RegExp(`(^\\s*|[.!?]\\s+|\\n\\s*)(["'“‘(]*)(${labels})`, 'gu'), (_, prefix, quote, label) => prefix + quote + label[0].toUpperCase() + label.slice(1));
}
