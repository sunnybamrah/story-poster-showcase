import { readJSON } from './files.js';
import { pictureStyleOptionFor } from '../app/picture-styles.js';
export const worldChoices = readJSON(new URL('../content/worlds.json', import.meta.url));
const legacyWorlds = { 'lab notebook': 'science lab notebook', 'trading card': 'superhero trading card' };

export function chooseWorld(record) {
  const recent = record.pastKits.slice(-2).map(kit => ({ ...kit, world: legacyWorlds[kit.world] ?? kit.world }));
  const next = (list, field) => {
    const start = (list.indexOf(recent.at(-1)?.[field]) + 1) % list.length;
    return Array.from({ length: list.length }, (_, i) => list[(start + i) % list.length]).find(value => !recent.some(kit => kit[field] === value));
  };
  const world = next(worldChoices.worlds, 'world');
  // A black-ink family look has one colour set: ink on off-white paper. Worlds still rotate.
  const colourSet = pictureStyleOptionFor(record).monochrome ? inkColourSet : next(worldChoices.colourSets, 'colourSet');
  return { world, colourSet };
}
export const inkColourSet = 'ink';
export const inkPalette = 'black ink on off-white paper only; no colour anywhere';
export const colourSetPalette = colourSet => colourSet === inkColourSet ? inkPalette : worldChoices.palettes[colourSet];

export function assertWorld(selection) {
  if (!worldChoices.worlds.includes(selection?.world) || ![...worldChoices.colourSets, inkColourSet].includes(selection?.colourSet)) throw new Error('World and colour set must come from the fixed list.');
  return selection;
}

// Retain earlier saved history while new art uses only STYLE's current choices.
export function assertSavedWorld(selection) {
  const world = legacyWorlds[selection?.world] ?? selection?.world;
  if (!worldChoices.worlds.includes(world) || ![...worldChoices.colourSets, inkColourSet, 'sunset', 'seaside', 'orchard', 'lavender'].includes(selection?.colourSet)) throw new Error('Saved world and colour set must come from the fixed lists.');
  return selection;
}
