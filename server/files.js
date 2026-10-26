import { mkdirSync, writeFileSync, renameSync, readFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySourceAudit } from './source-audit.js';

export const root = fileURLToPath(new URL('../', import.meta.url));
export function readJSON(path) { return JSON.parse(readFileSync(path, 'utf8')); }
export function saveJSON(path, value) {
  if (path instanceof URL) path = fileURLToPath(path);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}
export const sourceOwnedMoves = readJSON(new URL('../content/moves.json', import.meta.url));
export const moves = applySourceAudit(sourceOwnedMoves, readJSON(new URL('../content/source-row-audit.json', import.meta.url)));
export const words = text => text.trim().split(/\s+/u).filter(Boolean);

// Read the first complete object, respecting braces and escapes inside strings.
export function extractJSON(text) {
  if (typeof text !== 'string') throw new Error('No text to parse.');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  if (start < 0) throw new Error('No JSON object in the answer.');
  let depth = 0, quoted = false, escaped = false;
  for (let at = start; at < candidate.length; at++) {
    const char = candidate[at];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(candidate.slice(start, at + 1));
  }
  throw new Error('Incomplete JSON object in the answer.');
}
