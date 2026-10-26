import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchMeasurementBrowser } from '../server/layout-fit.js';

// Layout only. The three supplied PNGs are already generated art.
const args = process.argv.slice(2);
if (args.length < 2 || args.length > 3) throw Error('Use: node test/render-style-comparison.mjs <private PNG folder> <output folder> [labels JSON]');
const [inputDirectory, outputDirectory] = args.slice(0, 2).map(path => resolve(path));
const labels = args[2] ? JSON.parse(readFileSync(resolve(args[2]), 'utf8')) : {};
const escape = text => String(text).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
mkdirSync(outputDirectory, { recursive: true });
const styles = labels.styles ?? [
  ['classic-comic', '1. Playful comic', 'Earlier storybook trial', 'Clean outlines, rounded faces and soft cartoon shading.'],
  ['animated-film', '2. Animated film', 'Soft 3D cartoon characters', 'Rounded shapes and depth, like an animated movie.'],
  ['detailed-comic', '3. Detailed comic', 'The more lifelike option', 'Fine face and beard detail with drawn outlines.'],
];
if (styles.length !== 3 || styles.some(row => !Array.isArray(row) || row.length !== 4 || row.some(value => typeof value !== 'string') || !/^[a-z0-9-]+$/.test(row[0]))) throw Error('Supply three picture ids with their label and two short captions.');
const cards = styles.map(([id, label, short, description]) => `<article><img src="data:image/png;base64,${readFileSync(join(inputDirectory, `sunny-${id}.png`)).toString('base64')}" alt="${escape(label)}"><div><h2>${escape(label)}</h2><strong>${escape(short)}</strong><p>${escape(description)}</p></div></article>`).join('');
const html = join(outputDirectory, 'sunny-three-looks.html'), png = join(outputDirectory, 'sunny-three-looks.png');
writeFileSync(html, `<!doctype html><html lang="en"><meta charset="utf-8"><title>Three family art styles</title><style>*{box-sizing:border-box}body{margin:0;padding:40px;background:#faf6ee;color:#24251f;font-family:Arial,sans-serif}h1{margin:0 0 10px;font:700 36px Georgia,serif}.intro{margin:0 0 28px;font-size:21px;color:#55574d}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}article{overflow:hidden;border:1px solid #d7d2c5;border-radius:16px;background:#fffdfa}img{display:block;width:100%;height:568px;object-fit:cover;object-position:center 25%}article div{padding:21px}h2{font-size:25px;margin:0 0 12px}strong{font-size:17px}p{font-size:18px;line-height:1.4;margin:12px 0 0}.note{margin:25px 0 0;font-size:18px;color:#55574d}</style><h1>${escape(labels.title ?? 'Earlier style comparison')}</h1><p class="intro">${escape(labels.intro ?? 'These earlier samples were rejected. The saved target is the graphic-novel direction.')}</p><main>${cards}</main><p class="note">${escape(labels.note ?? 'All three use your supplied photo. Facial likeness comes first.')}</p></html>`);
const browser = await launchMeasurementBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(html).href);
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
  await page.screenshot({ path: png, fullPage: true });
  console.log(JSON.stringify({ html, png, pictures: styles.length, method: 'Existing browser renderer; layout only, no artwork edits.' }));
} finally { await browser.close(); }
