import { readJSON } from './files.js';

export const kitEditorial = readJSON(new URL('../content/kit-editorial.json', import.meta.url));
export function printedSourcesFor(move) {
  const ids = move.library?.printSourceIds ?? kitEditorial.printSources[move.id];
  if (!Array.isArray(ids) || !ids.length || ids.length > 2 || ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) throw new Error(`print_sources_invalid: ${move.id}`);
  return ids.map(id => {
    const source = move.sources.find(source => source.doi === id || source.pubmed === id || [2, 3, 4].includes(move.library?.schemaVersion) && source.sourceId === id);
    if (!source) throw new Error(`print_source_missing: ${move.id}/${id}`);
    return { ...source, recordIndex: move.sources.indexOf(source) };
  });
}
