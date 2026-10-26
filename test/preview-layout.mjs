import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { root, moves, saveJSON } from '../server/files.js';
import { previewPages, renderPoster, combinedKitHTML, renderKitPDF, copyFonts } from '../server/layout.js';

import { posterWordReport } from '../server/format.js';

const directory = join(root, 'test/out/pass6-layout-preview');
mkdirSync(directory, { recursive: true });
// This is fixed content only. It is not a kit or a model response.
copyFonts(directory);
const pages = previewPages(moves[0], { parentLabel: 'Dee' });
for (const [name, html] of Object.entries(pages)) writeFileSync(join(directory, name), html);
writeFileSync(join(directory, 'kit_final.html'), combinedKitHTML(pages, { preview: true }));
for (const move of moves) {
  const folder = join(directory, move.id);
  mkdirSync(folder, { recursive: true });
  copyFonts(folder);
  for (const [name, html] of Object.entries(previewPages(move))) writeFileSync(join(folder, name), html);
}
saveJSON(join(directory, 'word-counts.json'), moves.map(move => posterWordReport(move)));
if (process.argv.includes('--html-only')) {
  console.log('HTML and local fonts refreshed. No browser or renderer started. Earlier render receipts retained.');
  process.exit(0);
}
const results = [];
for (const theme of ['light', 'dark']) {
  const result = await renderPoster(join(directory, 'poster.html'), join(directory, `poster-${theme}.png`), { theme });
  results.push({ theme, ...result });
}
saveJSON(join(directory, 'render-results.json'), results);
const pdf = await renderKitPDF(join(directory, 'kit_final.html'), join(directory, 'kit_final.pdf'));
saveJSON(join(directory, 'pdf-result.json'), pdf);
console.log(JSON.stringify(results));
console.log(JSON.stringify({ kind: 'preview-pdf', ...pdf }));
