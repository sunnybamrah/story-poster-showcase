import { readJSON } from '../server/files.js';
// Fictional rates for offline math only. Never written to the real catalog.
export const offlinePrices = structuredClone(readJSON(new URL('../content/prices.json', import.meta.url)));
for (const role of ['story', 'storyCheck']) offlinePrices.models[offlinePrices.selected[role]] = { provider: 'openai', input: 2, cachedInput: .2, output: 10, contextWindow: 1050000 };
