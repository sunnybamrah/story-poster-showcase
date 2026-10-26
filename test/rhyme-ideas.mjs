// Offline review packets. This tool never buys a call or edits approved move text.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { moves, readJSON, saveJSON, root } from '../server/files.js';
import { selectedRhymeFor, rhymeRuleFaults, rhymeEditorialRule } from '../server/rhyme.js';
const files = directory => existsSync(directory) ? readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]) : [];
export function rhymeIdeas(moveId) {
  const move = moves.find(move => move.id === moveId);
  if (!move) throw new Error(`Choose one move id: ${moves.map(move => move.id).join(', ')}`);
  const selected = selectedRhymeFor(move), candidates = new Map();
  for (const path of [...files(join(root, 'test/fixtures')), ...files(join(root, 'test/out'))].filter(path => /(?:story(?:-attempt)?(?:-\d+)?|rewrite)\.json$/.test(path))) {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (value.moveId !== moveId || typeof value.tagline !== 'string' || value.tagline === selected.tagline) continue;
    if (!candidates.has(value.tagline)) candidates.set(value.tagline, { text: value.tagline, status: "FOR SUNNY'S READ", source: relative(root, path), approved: false, historical: true, freshRuleFaults: rhymeRuleFaults(value.tagline) });
  }
  const examples = ['name-it-exactly', 'one-brave-step'].map(id => selectedRhymeFor(moves.find(move => move.id === id)));
  return { moveId, selected, approved: selected.approved ? selected : null, candidates: [...candidates.values()], examples,
    prompt: `Draft alternatives for a separate human review. These must never enter a production kit automatically. The saved wording remains ${JSON.stringify(selected.tagline)}. Use the supplied move only, everyday spoken words, natural sound, the same action as the title, and no unsupported promise. Familiar idioms are allowed. ${rhymeEditorialRule} Literal title-word overlap is not required. Keep source-owned wording unchanged. Return candidates marked FOR SUNNY'S READ with two lines and a short reason. Strong examples: ${examples.map(row => JSON.stringify(row.tagline)).join('; ')}. Move: ${JSON.stringify(move)}`,
    note: 'Offline: reuses saved alternatives and prepares the prompt for new drafts. No new model answer, sound judgment or approval is claimed. New drafts require human review; this tool cannot change the production rhyme.' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const packet = rhymeIdeas(process.argv[2]);
  const directory = join(root, 'test/out/rhyme-ideas', packet.moveId);
  saveJSON(join(directory, 'review-packet.json'), packet);
  console.log(JSON.stringify(packet, null, 2));
}
