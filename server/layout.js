import { createHash } from 'node:crypto';
import { assessGenerationCheck as assessCheck, reviewNote } from './stop-policy.js';
import { chromeExecutable } from './chrome-path.js';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { words, moves, saveJSON, readJSON } from './files.js';
import { diagnosisWords, validateStory } from './story.js';
import { positiveActionFor, emptyMove, talkQuestions, talkOffer, parentAcceptance, parentSpokenLines, evidenceLabelFor, parentGuidance, replayTransfer, replayQuestions, replayRule, printedReplayRule, replayQuietNight, cardPurpose, whereElsePrompt, backupFor, backupPracticeLineFor, scienceFor, posterBoxes, posterWordReport, approvedPosterWords, posterFooter, assertPosterWordCap } from './format.js';
import { rhymeForKit } from './rhyme.js';
import { researchWordHelp } from '../app/research-words.js';
import { sourceReaderLimitation, sourceNoteGroups, guideReaderLimitation, guideReaderClaim } from '../app/reader-notes.js';
import { learningActor } from './cast.js';
import { guidanceFor } from './format.js';
import { kitEditorial, printedSourcesFor } from './kit-editorial.js';
import { posterTemplate, legacyPosterTemplate, drawingCanvas, posterImageTransform, posterTemplateFor, measuredFooter } from './poster-template.js';
import { imageHash, pngDimensions } from './picture.js';
import { inspectKitPDF, inspectPosterPDF } from './check-pdf.js';
import { parseWordCheck } from './check-words.js';
import { isDeepStrictEqual } from 'node:util';
import { fitDocument, measureDocument, launchMeasurementBrowser } from './layout-fit.js';
import { exportAttempt } from './export-attempt.js';
import { assertStoryPagination } from './format.js';
import { readingLookFor, readingLookCSS, checkedReadingArt, fitReadingArt } from './reading-look.js';
export { splitStory, posterWordCount, posterSlotWordCounts, assertPosterWordCap } from './format.js';

export const escapeHTML = text => String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const decode = text => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[entity]));
export const visibleText = html => decode(html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
export const printedText = html => visibleText([...html.matchAll(/<main\b[^>]*>[\s\S]*?<\/main>/g)].map(match => match[0]).join(' '));
const fixed = (field, text, tag = 'p') => `<${tag} data-owned="${field}">${escapeHTML(text)}</${tag}>`;
const para = (text, field) => `<p${typeof field === 'string' ? ` data-generated="${field}"` : ''}>${escapeHTML(text)}</p>`;
export const blankFrame = `<div class="writing-frame" data-writing-frame="empty" aria-label="${emptyMove}"><div class="writing-row">When I notice <span class="writing-blank" aria-hidden="true">______</span>,</div><div class="writing-row">I <span class="writing-blank" aria-hidden="true">______</span>.</div></div>`;
const footer = (nickname, page) => `<footer class="page-footer"><span>${escapeHTML(nickname)}'s Confidence Guide</span><span>${page}/5</span></footer>`;
const card = (title, body, tone = 'green', cls = '') => `<section class="card ${tone} ${cls}" data-card="${cls}"><h2>${escapeHTML(title)}</h2><div class="card-body">${body}</div></section>`;
// Fixed weights embed as named TrueType fonts in both Linux Chromium and Chrome.
// Retain the variable sources for existing saved pages and font provenance.
export const fontFiles = ['Baloo2-Variable.ttf', 'Nunito-Variable.ttf', 'Baloo2-OFL.txt', 'Nunito-OFL.txt', ...['Baloo2', 'Nunito'].flatMap(family => [400, 700, 800].map(weight => `${family}-${weight}.ttf`))];
export function copyFonts(directory) {
  mkdirSync(join(directory, 'fonts'), { recursive: true });
  for (const name of fontFiles) copyFileSync(new URL(`../content/fonts/${name}`, import.meta.url), join(directory, 'fonts', name));
}

const css = `
@font-face{font-family:'Baloo 2';font-style:normal;font-weight:400;font-display:block;src:url('fonts/Baloo2-400.ttf') format('truetype')}
@font-face{font-family:'Baloo 2';font-style:normal;font-weight:700;font-display:block;src:url('fonts/Baloo2-700.ttf') format('truetype')}
@font-face{font-family:'Baloo 2';font-style:normal;font-weight:800;font-display:block;src:url('fonts/Baloo2-800.ttf') format('truetype')}
@font-face{font-family:Nunito;font-style:normal;font-weight:400;font-display:block;src:url('fonts/Nunito-400.ttf') format('truetype')}
@font-face{font-family:Nunito;font-style:normal;font-weight:700;font-display:block;src:url('fonts/Nunito-700.ttf') format('truetype')}
@font-face{font-family:Nunito;font-style:normal;font-weight:800;font-display:block;src:url('fonts/Nunito-800.ttf') format('truetype')}
:root{color-scheme:light;--bg:#eee9df;--paper:#fff9ed;--card:#fffefa;--ink:#26364b;--border:#8b8272;--rule:#756d60;--green:#286349;--green-tint:#e7efe7;--coral-tint:#f8e6dc;--orange-tint:#f5ecd9;--badge:#ecdbb5}
html[data-theme=dark]{color-scheme:dark;--bg:#1e1a17;--paper:#26221f;--card:#302b26;--ink:#eee8dc;--border:#a69985;--rule:#b8aa94;--green:#a2d9a9;--green-tint:#35483b;--coral-tint:#513b32;--orange-tint:#4b4230;--badge:#504831}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:12pt/1.36 Nunito,sans-serif}h1,h2,h3{font-family:'Baloo 2',sans-serif;line-height:1.08;margin:0}p{margin:0 0 8pt}p:last-child{margin-bottom:0}h1{font-size:25pt}h2{font-size:13pt;font-weight:800}h3{font-size:13pt}ol{margin:0;padding-left:19pt}li{padding-left:2pt;margin:0 0 9pt}li:last-child{margin:0}
.sheet{width:7.5in;height:10in;margin:24px auto;padding:0;background:var(--paper);color:var(--ink);display:flex;flex-direction:column;position:relative}.page-heading{display:flex;justify-content:space-between;align-items:baseline;gap:16pt;margin:0 0 18pt;flex:none}.page-heading .identity{font-size:11pt;white-space:nowrap}.page-heading h1{font-size:22pt}.try .page-heading h1{color:var(--green);font-size:30pt}.page-footer{display:flex;justify-content:center;align-items:end;position:relative;font-size:9pt;min-height:20pt;margin-top:auto;flex:none}.page-footer span:last-child{position:absolute;right:0}
.card{border:1pt solid var(--border);border-radius:8pt;background:var(--card);overflow:hidden;flex:none}.card h2{padding:7pt 12pt;background:var(--green-tint);color:var(--ink);font-weight:700}.card.coral h2{background:var(--coral-tint)}.card.orange h2{background:var(--orange-tint)}.card-body{padding:12pt}.writing-frame{font-size:13pt}.ruled{height:22pt;border-bottom:1pt solid var(--rule)}.backup{font-size:11pt;margin-top:10pt}.key-word{display:inline-block;padding:3pt 14pt;background:var(--badge);border:1pt solid var(--green);border-radius:6pt;font-size:12pt;font-weight:800;margin:4pt 0 8pt}
.poster{justify-content:center;align-items:center;background:var(--paper)}.poster-art{position:relative;width:auto;height:100%;max-width:100%;aspect-ratio:2/3}.poster-art img{display:block;width:100%;height:100%;object-fit:contain}.poster-footer{position:absolute;left:10%;right:10%;top:92%;height:6%;display:flex;align-items:center;justify-content:center;font:800 17pt/1.05 'Baloo 2',sans-serif;color:#203047;text-align:center}.missing-art{width:100%;height:100%;display:grid;place-items:center;color:var(--ink);font-size:12pt}
/* Pass 31 editorial choices, not research thresholds. Landscape drawings keep
   their true 3:2 shape. Full-width prose uses larger type and breathing room. */
.panels{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:minmax(0,1fr);gap:5pt;height:2.5in;margin-bottom:14pt;flex:none}.panels img{display:block;width:100%;height:100%;min-width:0;min-height:0;object-fit:contain}.panels .missing-art{height:2.5in;font-size:10pt}.chapter-text{font-size:13pt;line-height:1.4;width:100%}.chapter-text p{margin-bottom:6.5pt}.chapter-text p:last-child{margin-bottom:0}.review-label{font-size:10pt;font-weight:800;display:block;margin-top:2pt}
.page-heading{margin-bottom:12pt}.page-heading h1{padding-top:.5em;min-width:0;overflow-wrap:anywhere}.page-heading .identity{font-size:10pt;white-space:normal;overflow-wrap:anywhere;max-width:35%;text-align:right;flex:none}.page-heading h1{flex:1;max-width:100%}.page-footer{padding-bottom:1pt}.page-footer span:first-child{max-width:90%;overflow-wrap:anywhere}.poster-footer{overflow-wrap:anywhere}
.sheet[data-gap-fit=small] .page-heading h1{padding-top:.5em}.sheet[data-gap-fit=small] .page-heading{margin-bottom:5pt}.sheet[data-gap-fit=small] .panels{margin-bottom:8pt}
.try,.for-you{--paper:var(--card)}
.writing-row{display:flex;align-items:baseline;gap:5pt;min-height:24pt}.writing-blank{flex:1;min-width:72pt;color:transparent;border-bottom:1pt solid var(--rule)}
/* The photographed practice sheets use full-width ink outlines and plain
   headings. Their spacing fills the page; body type and writing room stay put. */
.try .card,.for-you .card{border-radius:12pt;background:transparent}
.try .card h2,.for-you .card h2{background:transparent;padding:8pt 12pt 2pt;font-weight:800}
.try{font-size:12.5pt;line-height:1.4}.try-cards{display:flex;flex-direction:column;justify-content:space-between;flex:1;gap:8pt}.try .card-body{padding:6pt 12pt 10pt}.try .feel .card-body{min-height:52pt;display:flex;flex-direction:column;justify-content:center}.try .one-move .card-body{min-height:72pt}.try .tiny .card-body{display:flex;align-items:center}.try .tiny li{margin-bottom:5pt}.try .tiny li:last-child{margin-bottom:0}.try .card-body p{margin-bottom:5pt}.try .card-body p:last-child{margin-bottom:0}.parent-direction{font-size:10pt;line-height:1.3;margin-top:6pt}.with-vignette{display:grid;grid-template-columns:minmax(0,1fr) 64pt;gap:12pt;align-items:center}.practice-vignette{display:block;flex:none;width:64pt;height:40pt;overflow:hidden;border-radius:6pt}.weekly{display:flex;gap:6pt;margin:0;padding:10pt 12pt;border:1pt solid var(--border);border-radius:12pt;font-weight:800;flex:none}.weekly::after{content:'';flex:1;border-bottom:1pt solid var(--rule)}
.for-you .page-heading{margin-bottom:8pt;align-items:center}.parent-card .card-body{font-size:12pt;line-height:1.35;padding:6pt 12pt 10pt}.parent-card li{margin-bottom:4pt}.parent-card li:last-child{margin-bottom:0}.cut-line{border:0;border-top:1pt dashed var(--rule);margin:6pt 0;flex:none}.card-purpose{font-size:11pt;line-height:1.25;margin:0 18pt 6pt;flex:none}.replay-pair{display:grid;grid-template-columns:3.5in 3.5in;justify-content:center;align-self:center;gap:0;position:relative;flex:none;outline:1pt dashed var(--rule)}.replay-pair::after{content:'';position:absolute;left:50%;height:100%;border-left:1pt dashed var(--rule)}.for-you .replay{width:3.5in;height:2.75in;border:0;border-radius:0}.for-you .replay h2{font-size:11pt;padding:7pt 10pt 3pt}.replay .card-body{font-size:11pt;line-height:1.25;padding:8pt 10pt}.replay p{margin-bottom:6pt}.replay .handwrite{min-height:28pt;padding-bottom:3pt;border-bottom:1pt solid var(--rule)}.replay h3{font-size:12pt}.checks{list-style:none;padding:0;margin:5pt 0 0}.checks li{display:inline-block;margin:0 8pt 3pt 0;padding:0}.checkbox{display:inline-block;width:10pt;height:10pt;border:1pt solid currentColor;vertical-align:baseline;margin-right:5pt}
.sources a,.sources a:visited{color:inherit;text-decoration:underline}
.sources{flex:1;min-height:0;display:flex;flex-direction:column}.sources h2{flex:none}.sources .card-body{font-size:11pt;line-height:1.3;padding:6pt 12pt;min-height:0}.sources p{break-inside:avoid;margin-bottom:3pt;widows:2;orphans:2}.source{overflow-wrap:anywhere;break-inside:avoid;margin-bottom:5pt}.source + .source{border-top:1pt solid var(--rule);padding-top:5pt}.source-fit{font-weight:700}.source p:last-child{margin-bottom:0}.replay-rule{margin-top:3pt}
/* Spacing may compact after a targeted text cut. Type and handwriting do not. */
.sheet[data-fit=compact] .card-body p:not(:last-child){margin-bottom:4pt}.sheet[data-fit=compact] li:not(:last-child){margin-bottom:3pt}.sheet[data-fit=compact] .page-heading{margin-bottom:8pt}.sheet[data-fit=compact] .identity{white-space:normal;overflow-wrap:anywhere;max-width:35%;text-align:right;flex:none}.try[data-fit=compact] .try-cards{gap:8pt}.try[data-fit=compact] .card-body{padding:8pt 10pt}.try[data-fit=compact] .feel .card-body,.try[data-fit=compact] .one-move .card-body,.try[data-fit=compact] .tiny .card-body,.try[data-fit=compact] .paired .card-body{min-height:0}.for-you[data-fit=compact] .parent-card .card-body{padding:8pt 10pt}.for-you[data-fit=compact] .cut-line{margin:6pt 0}
/* Measured recovery for overflowing parent pages. Preserve type and card size. */
.for-you[data-notes-fit=spacing] .parent-card h2{padding-top:5pt}.for-you[data-notes-fit=spacing] .parent-card .card-body{padding:4pt 12pt 6pt}.for-you[data-notes-fit=spacing] .parent-card li:not(:last-child){margin-bottom:2pt}.for-you[data-notes-fit=spacing] .cut-line{margin:2pt 0}.for-you[data-notes-fit=spacing] .card-purpose{margin-bottom:3pt}.for-you[data-notes-fit=spacing] .page-heading{margin-bottom:3pt}.for-you[data-notes-fit=spacing] .sources h2{padding-top:4pt}.for-you[data-notes-fit=spacing] .sources .card-body{padding:4pt 12pt}.for-you[data-notes-fit=spacing] .sources .card-body p:not(:last-child){margin-bottom:1.5pt}.for-you[data-notes-fit=spacing] .source{margin-bottom:3pt}.for-you[data-notes-fit=spacing] .source+.source{padding-top:3pt}
.parent-notes{max-width:7.5in;margin:24px auto;padding:18pt;background:var(--paper);font-size:12pt}.parent-notes summary{cursor:pointer;font-weight:800}.parent-notes h2{margin:14pt 0 8pt}.parent-notes p{margin-bottom:10pt}
.preview-note{max-width:7.5in;margin:12px auto;padding:12px;color:var(--ink)}
.card{position:relative}.reading-art{display:block;position:absolute;overflow:hidden;visibility:hidden;pointer-events:none}.reading-art[hidden]{display:none}.reading-art img{position:absolute;max-width:none;display:block}.reading-art-spacer{display:block;width:64pt;height:40pt}
.sheet[data-reading-look] .card{border-color:var(--ink);box-shadow:inset 0 0 0 .35pt var(--ink)}
.sheet[data-reading-look] .card.green{background:var(--green-tint)}.sheet[data-reading-look] .card.coral{background:var(--coral-tint)}.sheet[data-reading-look] .card.orange{background:var(--orange-tint)}
.sheet[data-reading-look] .card h2{background:transparent}.sheet[data-reading-look] .panels img{outline:1.2pt solid var(--ink);outline-offset:-1.2pt;border-radius:4pt}
${readingLookCSS}
@page{size:letter;margin:36pt}
@page:first{margin:0}
.sheet.poster{width:8.5in;height:11in;background:#fff9ed}
.poster .poster-art{width:100%;height:100%;max-width:none;overflow:hidden;aspect-ratio:612/792}
.poster-art img{position:absolute;width:100%;height:auto;left:0;top:0;display:block;object-fit:initial}
.poster-art[data-footer-mode="outside"] img{left:0;top:0;width:100%;height:88%;object-fit:contain}.poster-art[data-footer-mode="outside"] .poster-footer{left:3%;right:3%;top:88%;height:6%;background:var(--paper)}
.poster-footer{left:5.8823529412%;right:5.8823529412%;top:90.9090909091%;height:4.5454545455%;font-size:14pt}
.poster[data-poster-palette="ink"] .poster-footer{color:#1f1f1f}
html[data-export] .sheet.poster{width:2550px;height:3300px;margin:0}
html[data-export] .poster-footer{font-size:58.333333px}
html[data-print] nav,html[data-print] button,html[data-print] input,html[data-print] select,html[data-print] textarea,html[data-print] .preview-note,html[data-print] .parent-notes{display:none!important}
html[data-print] .sheet{margin:0 auto}
@media print{
nav,button,input,select,textarea,.preview-note,.parent-notes{display:none!important}
html[data-theme],:root{color-scheme:light;--bg:#fff9ed;--paper:#fff9ed;--card:#fffefa;--ink:#26364b;--border:#8b8272;--rule:#756d60;--green:#286349;--green-tint:#e7efe7;--coral-tint:#f8e6dc;--orange-tint:#f5ecd9;--badge:#ecdbb5}
body{background:var(--paper);print-color-adjust:exact;-webkit-print-color-adjust:exact}.sheet{margin:0;width:7.5in;height:10in;break-after:page;break-inside:avoid}.sheet:last-child{break-after:auto}p,li{orphans:2;widows:2}
}`;
function shell(title, sheets, { preview = false, parentFocus = false } = {}) {
  return `<!doctype html><html lang="en" data-theme="light" data-reader-notes="exact-v1" data-learning-role="${parentFocus ? 'grown-up' : 'child'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><style>${css}</style><script>if(new URLSearchParams(location.search).get('print')==='1')document.documentElement.dataset.print='true';if(new URLSearchParams(location.search).get('export')==='1')document.documentElement.dataset.export='true';if(new URLSearchParams(location.search).get('theme')==='dark')document.documentElement.dataset.theme='dark';</script></head><body>${preview ? '<aside class="preview-note">Layout preview only. Story and artwork have not been generated.</aside>' : ''}${sheets}<script>globalThis.storyPosterLayoutPending=true;document.fonts.ready.then(async()=>{await Promise.all([...document.images].map(image=>image.decode().catch(()=>{})));const layout=(${fitDocument.toString()})(${measureDocument.toString()});const readingArt=(${fitReadingArt.toString()})();globalThis.storyPosterLayout={...layout,readingArt,ready:layout.ready&&readingArt.ready,faults:[...layout.faults,...readingArt.faults]};globalThis.storyPosterLayoutPending=false;document.documentElement.dataset.fitted='true';});</script></body></html>`;
}
function sheet(page, body, printedFitPages = [], readingLook) {
  const compact = ['try', 'for-you'].includes(page) && printedFitPages.includes(page);
  const look = page !== 'poster' && readingLook ? ` data-reading-look="${readingLook.version}" data-reading-palette="${readingLook.colourSet}" data-reading-world="${readingLook.world}"` : '';
  const posterInk = page === 'poster' && readingLook?.colourSet === 'ink' ? ' data-poster-palette="ink"' : '';
  return `<main class="sheet ${page}" data-page="${page}"${compact ? ' data-fit="compact"' : ''}${look}${posterInk}>${body}</main>`;
}
export function assertFriendTitle(title, move) {
  const original = moves.find(item => item.id === move.id);
  if (!original || move.name !== original.name || title !== original.name || diagnosisWords.test(title)) throw new Error('Friend test: title and move name must be the fixed move name.');
  return true;
}
export function posterContent(move, { nickname = 'Pip', preview = false, posterDimensions = drawingCanvas, posterGeometry } = {}) {
  assertFriendTitle(move.name, move);
  if (typeof nickname !== 'string' || !nickname.trim()) throw new Error('The footer needs the hero nickname.');
  // Page 1 contains one drawing and the code-set footer, never code-made poster cards.

  // Use a measured banner when present; otherwise keep the footer below the art.
  const footerOutside = !measuredFooter(posterGeometry);
  const transform = posterGeometry && !footerOutside ? posterImageTransform(posterGeometry, posterDimensions) : null;
  const imageStyle = transform ? ` style="left:${100 * transform.offset.x / 612}%;top:${100 * transform.offset.y / 792}%;width:${100 * posterDimensions.width * transform.scale / 612}%;height:auto"` : '';
  const f = footerOutside ? null : posterGeometry?.exported?.footer;
  const footerStyle = f ? ` style="left:${100 * f.x / 612}%;right:auto;top:${100 * f.y / 792}%;width:${100 * f.w / 612}%;height:${100 * f.h / 792}%"` : '';
  const artBounds = posterGeometry?.placement?.bounds;
  const templateVersion = posterGeometry ? posterGeometry.templateVersion ?? legacyPosterTemplate.version : posterTemplate.version;
  return `<div class="poster-art" data-footer-mode="${footerOutside ? 'outside' : 'banner'}" data-template="${templateVersion}"${artBounds ? ` data-art-bounds="${escapeHTML(JSON.stringify(artBounds))}"` : ''}>${preview ? '<div class="missing-art">Poster drawing not generated</div>' : `<img src="poster-art.png" alt=""${imageStyle}>`}<div class="poster-footer"${footerStyle}>${escapeHTML(nickname)}'s Confidence Guide</div></div>`;
}
// Reuse the checked drawing at its true shape. No extra image call or family
// reference is needed for the small illustrations on the two practice pages.
export function practiceVignette({ preview, posterGeometry, posterDimensions = drawingCanvas } = {}) {
  const r = posterGeometry?.exported?.hero;
  if (preview || !posterGeometry?.ready || posterGeometry.verified === false || !r) return '';
  const fit = posterImageTransform(posterGeometry, posterDimensions);
  return `<svg class="practice-vignette" aria-hidden="true" viewBox="${r.x} ${r.y} ${r.w} ${r.h}" preserveAspectRatio="xMidYMid slice"><image href="poster-art.png" x="${fit.offset.x}" y="${fit.offset.y}" width="${posterDimensions.width * fit.scale}" height="${posterDimensions.height * fit.scale}"/></svg>`;
}
function readingCharacter(manifest, role, personId) {
  const cell = manifest?.cells.find(cell => personId ? cell.personId === personId : role === 'child' ? cell.personId === 'child' : cell.personId?.startsWith('grown-up-'));
  if (!cell) return '';
  const r = cell.rect, adult = role !== 'child';
  return `<span class="reading-art" data-reading-art="${escapeHTML(manifest.version)}" data-person-id="${escapeHTML(cell.personId)}" data-asset-hash="${manifest.sha256}" data-aspect="${r.width / r.height}" data-max-width="${adult ? 120 : 130}" data-max-height="${adult ? 85 : 65}" aria-hidden="true"><img src="${manifest.filename}" alt="" style="left:${-100 * r.x / r.width}%;top:${-100 * r.y / r.height}%;width:${100 * manifest.width / r.width}%;height:${100 * manifest.height / r.height}%"></span>`;
}
export function storyContent(story, { preview = false, kitCount = 0, nickname = 'Pip', chapterTitle = 'Chapter title pending', pageIndex = 0, pagination, savedRevision = false, storyMode = 'inspired', storyNames = nickname } = {}) {
  if (!Number.isInteger(kitCount) || kitCount < 0) throw new Error('The chapter needs the saved kit count.');

  if (!preview && (!pagination?.pages || !Array.isArray(pagination.panelPages))) throw new Error('Saved chapter pages and panel placement are required.');
  const panelNumbers = preview ? [pageIndex * 2 + 1, pageIndex * 2 + 2] : pagination.panelPages.flatMap((page, index) => page === pageIndex ? [index + 1] : []);
  const panels = panelNumbers.map(number => preview ? `<div class="missing-art">Panel ${number} not generated</div>` : `<img src="panel-${number}.png" alt="">`).join('');
  const text = preview ? 'Chapter text not generated.' : pagination.pages[pageIndex];
  return `<header class="page-heading"><h1 data-generated="chapterTitle">Chapter ${kitCount + 1}: ${escapeHTML(chapterTitle)}</h1><span class="identity">${escapeHTML(storyNames)}${pageIndex === 0 ? storyMode === 'factual' ? ' | REAL: facts you shared' : ' | MADE UP: inspired story' : ''}</span></header><div class="panels">${panels}</div><div class="chapter-text"${savedRevision ? ' data-saved-revision="true"' : ''}>${text.split(/\n+/).filter(Boolean).map(line => para(line, 'story')).join('')}</div>${footer(nickname, pageIndex + 2)}`;
}
const previewText = move => ({ chapterTitle: 'Chapter title pending', tagline: '', story: '', feelFirst: ['First validating line pending.', 'Second validating line pending.'], tinyTryOptions: [30, 60, 90].map(seconds => ({ text: 'Tiny try pending.', seconds, offScreen: true })), whereElse: { line: 'Where else could this same move work?', place: 'Place pending.' }, noticedFeeling: '<feeling>', replayCue: 'When to try it pending.', moveId: move.id });
function tryContent(move, text, options) {
  const { parentLabel, nickname } = options, character = readingCharacter(options.readingArt, options.parentFocus ? 'grown-up' : 'child', options.actorId);
  const guidance = guidanceFor(options);
  const vignette = character ? '<span class="reading-art-spacer" aria-hidden="true"></span>' : practiceVignette(options);
  const backup = backupFor(move);
  return `<header class="page-heading"><h1>TRY IT</h1><span>The page that matters</span></header><div class="try-cards">` +
    card(`FEEL FIRST, FOR ${parentLabel.toUpperCase()}`, `<div class="${vignette ? 'with-vignette' : 'feel-lines'}"><div>${text.feelFirst.map(line => para(line, 'feelFirst')).join('')}</div>${vignette}</div>${character}`, 'coral', 'feel') +
    card('MY ONE MOVE', blankFrame + `<p class="backup"${backup ? ` data-backup="${backup.id}"` : ''}>${escapeHTML(backupPracticeLineFor(move))}</p>`, 'green', 'one-move') +
    card('TINY TRY, PICK ONE', `<ol>${text.tinyTryOptions.map((option, index) => `<li data-generated="tinyTryOptions[${index}].text">${escapeHTML(option.text)}</li>`).join('')}</ol>`, 'orange', 'tiny') +
    card('TALK', talkQuestions.map(para).join('') + `<p class="parent-direction">${escapeHTML(guidance.talkOffer)}</p>`, 'coral', 'talk') +
    card('WHERE ELSE', para(whereElsePrompt) + para(text.whereElse.place, 'whereElse.place'), 'green', 'where-else') +
    '<p class="weekly">This week I tried: ______</p></div>' + footer(nickname, 4);
}
function cardsContent(move, text, options) {
  const { parentLabel, nickname } = options;
  const label = parentLabel.toUpperCase();
  const lines = parentSpokenLines(move, text.noticedFeeling, options);
  const front = fixed('name', move.name, 'h3') + `<div class="key-word" data-owned="keyWord">${escapeHTML(move.keyWord)}</div>` + replayQuestions.map(para).join('');
  const back = para(`When to try it: ${text.replayCue}`, 'replayCue') + fixed('positiveAction', positiveActionFor(move), 'p') + '<p class="handwrite">My move: ______</p>' + `<p data-kit-tagline>${escapeHTML(text.tagline)}</p>` + `<ul class="checks">${['Remembered it', 'Practised it', 'Used it for real'].map(line => `<li><span class="checkbox" aria-hidden="true"></span>${line}</li>`).join('')}</ul>`;
  const notes = printedShortNotes(move, text, options.printedNotesVersion);
  const character = readingCharacter(options.readingArt, 'grown-up', options.parentFocus ? options.actorId : undefined);
  return `<header class="page-heading"><h1>CARDS + GROWN-UP GUIDE</h1>${character ? '<span class="reading-art-spacer" aria-hidden="true"></span>' : practiceVignette(options)}</header>` +
    card(`${label} CARD`, `<ol>${lines.map((line, index) => `<li${index === 0 && !options.parentFocus ? ' data-generated="noticedFeeling" data-fixed-text="I noticed you looked . That makes sense."' : ''}>${escapeHTML(line)}</li>`).join('')}</ol>${character}`, 'coral', 'parent-card') + '<hr class="cut-line">' +
    `<p class="card-purpose">${escapeHTML(cardPurpose)}</p>` +
    `<div class="replay-pair">${card('REMEMBER CARD, FRONT', front, 'green', 'replay')}${card('REMEMBER CARD, BACK', back, 'green', 'replay')}</div><hr class="cut-line">` +
    card(`GROWN-UP NOTES, FOR ${label}`, notes, 'orange', 'sources') + footer(nickname, 5);
}
const namingEvidence = Object.freeze({
  id: 'name-it-exactly',
  claim: 'In adult studies, naming feelings helped people feel less upset. We need stronger tests with children aged 8 to 13.',
  limitation: 'Adult findings do not show that this home practice helps children aged 8 to 13 or that naming brings quick relief.',
  source: { doi: '10.1177/1754073917742706', people: 'Jared B. Torre and Matthew D. Lieberman', year: 2018, fitLabel: 'ADULT ONLY', limitation: 'The relevant benefit evidence comes from adult studies. Results vary across feelings, body responses, brain activity and behavior; immediate relief and benefits for children aged 8 to 13 are not established.' },
});
function hasNamingEvidence(move) {
  const science = scienceFor(move);
  const sources = printedSourcesFor(move);
  return move.id === namingEvidence.id && science.evidenceLabel === 'ADULT ONLY' && science.claim === namingEvidence.claim && science.limitation === namingEvidence.limitation &&
    sources.some(source => Object.entries(namingEvidence.source).every(([key, value]) => source[key] === value));
}
function shortNoteLines(move, text, version = 'exact-v2') {
  if (hasNamingEvidence(move)) return [
    'When you are both calm, ask: “What feeling fits?” Listen. Then choose one small thing to try together.',
    'Use your familiar reminder when a new hard moment comes along.',
    'In some studies with adults, naming feelings helped people feel less upset. That does not tell us whether this story helps children.',
    'Sources and study details are in the app. Torre and Lieberman, 2018.',
  ];
  if (version === 'exact-v1') {
    const first = printedSourcesFor(move)[0];
    const citation = [citationPeople(first), first.year ?? first.dateLabel].filter(Boolean).join(', ');
    return [
      `When you are both calm, try this together: ${positiveActionFor(move)}`,
      `When a new hard moment comes along, use your familiar reminder: “${text.tagline || rhymeForKit(text, move).tagline}”.`,
      `Evidence type: ${evidenceLabelFor(first.fitLabel)}. These sources do not tell us whether this story helps your child.`,
      `Sources and study details are in the app. ${citation}.`,
    ];
  }
  const science = scienceFor(move);
  const finding = typeof science.result === 'string' && science.result.trim() ? science.result : guideReaderClaim(move.id, science.claim);
  const limitation = guideReaderLimitation(move.id, science.limitation);
  const citations = printedSourcesFor(move).map(source => [citationPeople(source), source.year ?? source.dateLabel].filter(Boolean).join(', ')).join('; ');
  const reminder = text.tagline || rhymeForKit(text, move).tagline;
  return [
    `When you are both calm, try this together: ${positiveActionFor(move)}`,
    `When a new hard moment comes along, use your familiar reminder: “${reminder}”${/[.!?]$/.test(reminder.trim()) ? '' : '.'}`,
    [...new Set([finding, limitation].filter(Boolean))].join(' '),
    `Sources and study details are in the app. ${citations}.`,
  ];
}
function printedSourceLinks(move) {
  return printedSourcesFor(move).map(source => {
    const url = source.pubmed ? `https://pubmed.ncbi.nlm.nih.gov/${source.pubmed}/` : source.doi ? `https://doi.org/${source.doi}` : source.url;
    let parsed; try { parsed = new URL(url); } catch { return ''; }
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    const label = source.pubmed ? `PubMed ${source.pubmed}` : source.doi ? `DOI ${source.doi}` : `${parsed.hostname}${parsed.pathname}`;
    return `<a href="${escapeHTML(parsed.href)}">${escapeHTML(label)}</a>`;
  }).filter(Boolean).join('; ');
}
function printedShortNotes(move, text, version = 'exact-v2') {
  if (!['exact-v1', 'exact-v2'].includes(version)) throw Error('Unknown printed research-note version.');
  const labels = ['Try together', hasNamingEvidence(move) ? 'Name it to tame it' : 'Reminder', 'What research says', 'Read more'];
  return `<section data-short-notes="${version}">${shortNoteLines(move, text, version).map((line, index) => `<p data-short-note="${index}"><strong>${labels[index]}:</strong> ${escapeHTML(line)}${version === 'exact-v2' && index === 3 && printedSourceLinks(move) ? ' ' + printedSourceLinks(move) : ''}</p>`).join('')}</section>`;
}
const citationPeople = source => {
  const first = source.people.split(/,| and /u)[0];
  return first === source.people ? first : `${first} and others`;
};
function sourceNotesSection(sources, section, citation, definitionText = '') {
  const { groups, definitions } = sourceNoteGroups(sources, { definitionText });
  const notes = groups.map(group => {
    const fields = group.sources.map(({ source, index }) => `sources.${source.recordIndex ?? index}.limitation`);
    const citations = group.sources.map(({ source, index }) => `<p data-source="${source.recordIndex ?? index}" data-source-id="${escapeHTML(source.sourceId ?? source.pubmed ?? source.doi ?? source.id ?? '')}" data-evidence-fit="${escapeHTML(source.fitLabel)}">${citation(source)}</p>`).join('');
    return `<div class="source" data-source-group="${fields.join(' ')}">${citations}<p><span data-owned="${fields[0]}"${fields.length > 1 ? ` data-owned-shared="${fields.slice(1).join(' ')}"` : ''}>${escapeHTML(group.limitation ?? '')}</span></p></div>`;
  }).join('');
  return `<section data-source-notes="exact-groups-v1" data-source-section="${section}">${notes}${definitions.map(para).join('')}</section>`;
}
function scienceContent(move, { includeClaim = true, includeDefinitions = true } = {}) {
  const science = scienceFor(move);
  const claim = guideReaderClaim(move.id, science.claim);
  return `<div class="science-record" data-reader-claims="exact-v1">${includeClaim ? fixed('science.claim', claim) : ''}${fixed('science.limitation', guideReaderLimitation(move.id, science.limitation))}${includeDefinitions ? researchWordHelp(claim + ' ' + guideReaderLimitation(move.id, science.limitation)).map(para).join('') : ''}${science.reviewLabel ? `<p class="review-label">${escapeHTML(science.reviewLabel)}</p>` : ''}</div>`;
}
function parentNotes(move, text, options) {
  const rhyme = rhymeForKit(text, move);
  const science = scienceFor(move);
  const sources = sourceNotesSection(move.sources, 'parent', source => escapeHTML([source.fitLabel, source.people, source.year ?? source.dateLabel, source.title, source.journal, source.doi ? `DOI ${source.doi}` : '', source.pubmed ? `PubMed ${source.pubmed}` : ''].filter(Boolean).join('. ')), guideReaderClaim(move.id, science.claim) + ' ' + guideReaderLimitation(move.id, science.limitation));
  return `<aside class="parent-notes"><details><summary>Notes for grown-ups: sources, practice and words</summary><h2>${escapeHTML(kitEditorial.reviewLabel)}</h2>${para(kitEditorial.chosenBy)}${para(options.storyMode === 'factual' ? 'This story uses only facts you shared. The drawings show the story. They do not show exactly what happened.' : kitEditorial.story.basis)}${para(`Rhyme: ${rhyme.tagline}. ${rhyme.approved ? 'Approved by Sunny.' : rhyme.source === 'topic' ? 'These words still need Sunny to check them.' : 'Wording kept with this story.'} It helps you remember what to try. It is not a study result.`)}${scienceContent(move, { includeDefinitions: false })}${sources}${Object.values(guidanceFor(options)).map(para).join('')}</details></aside>`;
}
function layPages(move, text, { preview = false, nickname = 'Pip', parentLabel = 'Dad', kitCount = 0, posterDimensions, posterGeometry, savedRevision = false, savedParagraphReflow = false, readingArt, visualRefresh = false, selection, record, printedNotesVersion = 'exact-v2' } = {}) {
  if (!Number.isInteger(kitCount) || kitCount < 0) throw new Error('The chapter needs the saved kit count.');
  const actor = record ? learningActor(record) : { id: 'child', role: 'child', storyName: nickname };
  const storyMode = record?.kitContext?.storyMode ?? (/^REAL\n/.test(text.story) ? 'factual' : 'inspired');
  const storyNames = record ? [actor.storyName, ...(record.storyPeople ?? []).filter(person => person.castId.startsWith('sibling-')).map(person => person.storyName)].join(' & ') : nickname;
  const options = { preview, nickname, parentLabel: actor.role === 'grown-up' ? actor.storyName : parentLabel, parentFocus: actor.role === 'grown-up', actorId: actor.id, storyMode, storyNames, kitCount, chapterTitle: text.chapterTitle, posterDimensions, posterGeometry, pagination: text.pagination, savedRevision: savedRevision || savedParagraphReflow, readingArt: checkedReadingArt(readingArt), printedNotesVersion };
  const look = !savedRevision || visualRefresh || readingArt ? readingLookFor(selection ?? text) : null;
  const pageSheet = (page, body) => sheet(page, body, text.printedFitPages, look);
  const pages = {
    'poster.html': shell(move.name, pageSheet('poster', posterContent(move, options)), options),
    'story.html': shell(`Chapter ${kitCount + 1}`, pageSheet('story', storyContent(text.story, options)), options),
    'story-2.html': shell(`Chapter ${kitCount + 1}`, pageSheet('story-2', storyContent(text.story, { ...options, pageIndex: 1 })), options),
    'try.html': shell('TRY IT', pageSheet('try', tryContent(move, text, options)), options),
    'for-you.html': shell('CARDS + GROWN-UP GUIDE', pageSheet('for-you', cardsContent(move, text, options)) + parentNotes(move, text, options), options),
  };
  verifyOwnedWords(pages, move, { ...options, noteText: text });
  return pages;
}
export function previewPages(move, options = {}) { return layPages(move, previewText(move), { ...options, preview: true }); }
export function makePages(move, text, options = {}) {
  if (text?.moveId !== move.id) throw new Error('Page text and selected move differ.');
  const fields = Object.fromEntries(['moveId', 'chapterTitle', 'tagline', 'story', 'panelLines', 'jokeIdea', 'feelFirst', 'tinyTryOptions', 'whereElse', 'noticedFeeling', 'replayCue'].map(key => [key, text[key]]));
  if (!text.pagination) throw new Error('Saved chapter pages are required before layout.');
  // A saved export revision preserves reviewed prose. Current writer rules
  // cannot silently rewrite or invalidate an older accepted chapter.
  const validated = options.savedRevision ? { pagination: assertStoryPagination(text.story, text.panelLines, text.pagination) } : validateStory(fields, { ...options, storyMode: options.record?.kitContext?.storyMode ?? options.storyMode, pagination: text.pagination });
  return layPages(move, { ...text, pagination: validated.pagination }, options);
}
export function assertBlankFrames(pages) {
  for (const [page, html] of Object.entries(pages)) {
    const expected = ['try.html', 'kit_final.html'].includes(page) ? 1 : 0;
    if (html.split(blankFrame).length - 1 !== expected) throw new Error(`Writing frame must stay empty: ${page}`);
    const remainder = html.replaceAll(blankFrame, '');
    if (/<(?:input|textarea)\b|contenteditable|data-writing-frame/iu.test(remainder)) throw new Error(`Unexpected writing frame: ${page}`);
    const prose = visibleText(remainder);
    // Generated prose may discuss a plan; the actual code-owned writing spaces above remain empty.
    if (['for-you.html', 'kit_final.html'].includes(page) && !prose.includes('My move: ______')) throw new Error('Replay writing frame must stay empty.');
  }
  return true;
}
export function verifyOwnedWords(pages, move, options = {}) {
  options = { ...options, parentFocus: options.parentFocus ?? pages['try.html']?.includes('data-learning-role="grown-up"') };
  const guidance = guidanceFor(options);
  const poster = pages['poster.html'];
  assertFriendTitle(decode(poster?.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''), move);
  assertBlankFrames(pages);
  const main = poster.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? '';
  if (!main.includes('class="poster-art"') || !main.includes('class="poster-footer"') || !main.includes("'s Confidence Guide")) throw new Error('Poster drawing or footer missing.');
  if (/<(?:h1|h2|svg|canvas|section)\b/.test(main)) throw new Error('Page 1 must be one drawn image and footer only.');
  for (const [name, html] of Object.entries(pages)) {
    for (const match of html.matchAll(/<(p|h1|h2|h3|li|div|span)[^>]*data-owned="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
      let expected = match[2].startsWith('science.') ? scienceFor(move)[match[2].slice(8)] : match[2].split('.').reduce((value, key) => value?.[key], move);
      if (match[2] === 'science.claim' && html.includes('data-reader-claims="exact-v1"')) expected = guideReaderClaim(move.id, expected);
      if (html.includes('data-reader-notes="exact-v1"')) {
        if (match[2] === 'science.limitation') expected = guideReaderLimitation(move.id, expected);
        const sourceField = match[2].match(/^sources\.(\d+)\.limitation$/);
        if (sourceField) expected = sourceReaderLimitation(move.sources[Number(sourceField[1])]);
      }
      const actual = decode(match[3]);
      if (actual !== expected && !(match[2] === 'positiveAction' && actual === positiveActionFor(move))) throw new Error(`Record words changed: ${name}/${match[2]}`);
    }
  }
  const parent = pages['for-you.html'];
  const printedNotesVersion = parent.match(/<section data-short-notes="(exact-v[12])">/)?.[1];
  const compact = Boolean(printedNotesVersion);
  if (compact) {
    const tagline = parent.match(/<p data-kit-tagline>([\s\S]*?)<\/p>/)?.[1];
    if (tagline == null) throw new Error('Printed short notes missing saved reminder.');
    const expected = printedShortNotes(move, { tagline: options.noteText?.tagline ?? decode(tagline) }, printedNotesVersion);
    const found = parent.match(/<section data-short-notes="exact-v[12]">[\s\S]*?<\/section>/g) ?? [];
    if (found.length !== 1 || found[0] !== expected) throw new Error('Printed short notes changed or missing.');
  }
  const groupedSources = verifySourceNoteGroups(parent, move);
  for (const field of ['name', 'keyWord', ...printedSourcesFor(move).map(source => `sources.${source.recordIndex}.limitation`)]) if (!parent.includes(`data-owned="${field}"`) && !groupedSources?.has(field)) throw new Error(`Record words missing: ${field}`);
  for (const field of ['science.claim', 'science.limitation']) if (!parent.includes(`data-owned="${field}"`)) throw new Error('Science record missing from parent notes.');
  for (const title of ['TRY IT', 'The page that matters', 'FEEL FIRST, FOR ', 'MY ONE MOVE', 'TINY TRY, PICK ONE', 'TALK', 'WHERE ELSE', whereElsePrompt, 'This week I tried: ______', ...talkQuestions]) if (!printedText(pages['try.html']).includes(title)) throw new Error(`Page 4 slot missing: ${title}`);
  for (const title of ['CARDS + GROWN-UP GUIDE', 'REMEMBER CARD, FRONT', 'REMEMBER CARD, BACK', 'GROWN-UP NOTES, FOR ', cardPurpose, ...parentSpokenLines(move, '<feeling>', options).slice(1), ...replayQuestions, ...(compact ? [] : [printedReplayRule])]) if (!printedText(parent).includes(title)) throw new Error(`Page 5 slot missing: ${title}`);
  for (const line of Object.values(guidance)) if (!visibleText(parent).includes(line)) throw new Error(`Parent guidance missing: ${line}`);
  if (!compact) for (const line of [guidance.parentGuidance, replayQuietNight]) if (!printedText(parent).includes(line)) throw new Error(`Printed parent guidance missing: ${line}`);
  if (!printedText(pages['try.html']).includes(guidance.talkOffer)) throw new Error('Printed choice to skip TALK missing.');
  if (!pages['try.html'].includes(escapeHTML(backupPracticeLineFor(move)))) throw new Error('Backup changed or missing.');
  for (const source of printedSourcesFor(move)) {
    if (!visibleText(parent).includes(compact ? source.people : citationPeople(source))) throw new Error('Source author changed or missing.');
    if (!parent.includes(`data-evidence-fit="${escapeHTML(source.fitLabel)}"`)) throw new Error('Source evidence classification changed or missing.');
    const full = compact ? visibleText(parent) : printedText(parent);
    if (!compact && !full.includes(evidenceLabelFor(source.fitLabel))) throw new Error('Source evidence classification changed or missing.');
    for (const field of ['year', source.doi ? 'doi' : 'pubmed', 'limitation']) if (source[field] && !full.includes(String(field === 'limitation' && parent.includes('data-reader-notes="exact-v1"') ? sourceReaderLimitation(source) : source[field]))) throw new Error(`Source ${field} changed or missing.`);
  }
  for (const [page, number] of [['story.html', 2], ['story-2.html', 3], ['try.html', 4], ['for-you.html', 5]]) if (!pages[page]?.includes(`${number}/5`)) throw new Error(`Page footer missing: ${page}`);
  return true;
}

// A shared note proves every member separately. Versioned sections also prove
// completeness, so a note cannot disappear or borrow a different source's words.
// Historical ungrouped exports retain the original owned-word verification.
function verifySourceNoteGroups(html, move) {
  if (!html.includes('data-source-notes=') && !html.includes('data-owned-shared=')) return null;
  const fail = detail => { throw new Error(`Source note group changed or missing: ${detail}`); };
  const sections = [...html.matchAll(/<section\b([^>]*data-source-notes="exact-groups-v1"[^>]*)>([\s\S]*?)<\/section>/g)];
  const compact = /data-short-notes="exact-v[12]"/.test(html);
  if (sections.length !== (compact ? 1 : 2)) fail('sections');
  const verifiedPrinted = new Set();
  for (const [sectionName, sources] of compact ? [['parent', move.sources]] : [['printed', printedSourcesFor(move)], ['parent', move.sources]]) {
    const matches = sections.filter(section => section[1].includes(`data-source-section="${sectionName}"`));
    if (matches.length !== 1) fail(sectionName);
    const groups = [...matches[0][2].matchAll(/<div\b[^>]*data-source-group="([^"]*)"[^>]*>([\s\S]*?)<\/div>/g)];
    const expected = sourceNoteGroups(sources).groups;
    if (groups.length !== expected.length) fail(`${sectionName} count`);
    expected.forEach((group, index) => {
      const fields = group.sources.map(({ source, index }) => `sources.${source.recordIndex ?? index}.limitation`);
      const rendered = groups[index], note = rendered[2].match(/<span\b([^>]*data-owned="([^"]+)"[^>]*)>([\s\S]*?)<\/span>/);
      const shared = note?.[1].match(/data-owned-shared="([^"]*)"/)?.[1] ?? '';
      if (rendered[1] !== fields.join(' ') || note?.[2] !== fields[0] || shared !== fields.slice(1).join(' ')) fail(`${sectionName} membership`);
      const actual = decode(note[3]);
      for (const { source } of group.sources) if (actual !== sourceReaderLimitation(source)) fail(`${sectionName} exact limitation`);
      const citations = [...rendered[2].matchAll(/<p\b([^>]*data-source="(\d+)"[^>]*)>([\s\S]*?)<\/p>/g)];
      if (citations.length !== group.sources.length) fail(`${sectionName} citations`);
      group.sources.forEach(({ source, index }, citationIndex) => {
        const citation = citations[citationIndex], sourceIndex = source.recordIndex ?? index;
        const sourceId = source.sourceId ?? source.pubmed ?? source.doi ?? source.id ?? '';
        if (citation[2] !== String(sourceIndex) || !citation[1].includes(`data-source-id="${escapeHTML(sourceId)}"`) || !citation[1].includes(`data-evidence-fit="${escapeHTML(source.fitLabel)}"`)) fail(`${sectionName} source identity`);
        const text = visibleText(citation[3]);
        for (const value of [sectionName === 'printed' ? citationPeople(source) : source.people, source.year ?? source.dateLabel, source.doi || source.pubmed || source.title]) if (value && !text.includes(String(value))) fail(`${sectionName} citation words`);
      });
      if (sectionName === 'printed' || compact) fields.forEach(field => verifiedPrinted.add(field));
    });
  }
  return verifiedPrinted;
}
export function writePages(directory, move, text, art, options = {}) {
  const wordReport = posterWordReport(move, text, options);
  if (wordReport.count >= 110) console.warn(`Poster ${move.id}: ${wordReport.count} words. Report only; the owner decides whether to shorten it.`);
  if (!art?.ready || !art.poster?.ready || !Array.isArray(art.panels)) throw new Error('One checked poster and four different checked panels are required.');
  for (const picture of [art.poster, ...art.panels]) if (!picture.ready || !picture.checks?.at(-1)?.ready || !existsSync(picture.path) || imageHash(picture.path) !== picture.hash) throw new Error('Only checked unchanged art can reach a kit.');
  const expected = [posterBoxes(move, text), ...text.panelLines.map(panel => [{ id: 'bubble', text: panel.line }])];
  [art.poster, ...art.panels].forEach((picture, index) => {
    const rechecked = assessCheck(parseWordCheck(JSON.stringify(picture.checks.at(-1).answers), expected[index], { generation: true, footerText: posterFooter(options.nickname), subBoxesRechecked: picture.checks.at(-1).checkerAttempt > 1 }), { final: picture.checks.at(-1).checkerAttempt > 1 });
    if (picture.referenceHash !== art.poster.referenceHash || !rechecked.ready) throw new Error('Artwork approval no longer matches the current words or hero.');

  });

  const pages = makePages(move, text, { ...options, posterDimensions: pngDimensions(art.poster.path), posterGeometry: art.poster.checks.at(-1).geometry });
  mkdirSync(directory, { recursive: true });
  saveJSON(join(directory, 'poster-fit.json'), art.poster.checks.at(-1).geometry);
  saveJSON(join(directory, 'poster-word-count.json'), posterWordReport(move, text, options));
  saveJSON(join(directory, 'approved-printed-words.json'), approvedPosterWords(move, text, options));
  saveJSON(join(directory, 'kit-editorial.json'), { ...(existsSync(join(directory, 'kit-editorial.json')) ? readJSON(join(directory, 'kit-editorial.json')) : kitEditorial), moveSnapshot: structuredClone(move), moveSnapshotHash: createHash('sha256').update(JSON.stringify(move)).digest('hex'), rhyme: { ...rhymeForKit(text, move), basis: 'Exact rhyme saved with this kit.' }, science: scienceFor(move), sources: move.sources, printedSources: printedSourcesFor(move) });
  copyFonts(directory);
  copyFileSync(art.poster.path, join(directory, 'poster-art.png'));
  art.panels.forEach((panel, index) => copyFileSync(panel.path, join(directory, `panel-${index + 1}.png`)));
  const readingArt = checkedReadingArt(options.readingArt);
  if (readingArt) {
    const destination = join(directory, readingArt.filename);
    if (destination !== readingArt.file) copyFileSync(readingArt.file, destination);
    if (imageHash(destination) !== readingArt.sha256) throw Error('Copied reading art no longer matches its checked bytes.');
  }
  for (const [name, html] of Object.entries(pages)) writeFileSync(join(directory, name), html, { mode: 0o600 });
  writeFileSync(join(directory, 'kit_final.html'), combinedKitHTML(pages), { mode: 0o600 });
  return pages;
}
export function combinedKitHTML(pages, { preview = false } = {}) {
  assertBlankFrames(pages);
  const body = ['poster', 'story', 'story-2', 'try', 'for-you'].map(page => {
    const main = pages[`${page}.html`]?.match(/<main[^>]*>[\s\S]*?<\/main>/)?.[0];
    if (!main) throw new Error(`Missing PDF page: ${page}`);
    return main;
  }).join('');
  const notes = pages['for-you.html'].match(/<aside class="parent-notes">[\s\S]*?<\/aside>/)?.[0] ?? '';
  const html = shell('Confidence Guide', body + notes, { preview });
  assertBlankFrames({ 'kit_final.html': html });
  return html;
}
export function pdfCommand(htmlPath, pdfPath) {
  const chrome = chromeExecutable();
  const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files', '--no-pdf-header-footer',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    `--user-data-dir=${new URL('./chrome-pdf-profile/', pathToFileURL(pdfPath)).pathname}`, `--print-to-pdf=${pdfPath}`, `${pathToFileURL(htmlPath).href}?print=1`];
  return { chrome, args, command: [chrome, ...args].map(value => `'${value.replaceAll("'", "'\"'\"'")}'`).join(' ') };
}

export async function renderKitPDF(htmlPath, pdfPath, { posterOnly = false, replaceUnaccepted = false, inspectPage } = {}) {
  const { chrome, command } = pdfCommand(htmlPath, pdfPath);
  if (!existsSync(chrome)) return { rendered: false, command, reason: 'Chrome is not installed; HTML retained.' };
  return exportAttempt(pdfPath, { replaceUnaccepted }, async candidate => {
    let browser;
    try {
      browser = await launchMeasurementBrowser();
      const page = await browser.newPage();
      await page.emulateMedia({ media: 'print' });
      await loadFittedPage(page, htmlPath, '?print=1');
      const layoutFit = await page.evaluate(() => globalThis.storyPosterLayout);
      if (!layoutFit.ready) throw new Error('printed_layout_overflow: ' + layoutFit.faults.join('; '));
      const displayInspection = inspectPage ? await inspectPage(page) : undefined;
      await page.pdf({ path: candidate, preferCSSPageSize: true, printBackground: true });
      return { rendered: true, ...(displayInspection ? { displayInspection } : {}), inspection: posterOnly ? inspectPosterPDF(candidate) : inspectKitPDF(candidate), layoutFit, method: 'Chrome after fonts, images and page fitting.' };
    } catch (error) { return { rendered: false, reason: error.message, command }; }
    finally { if (browser) await browser.close(); }
  });
}

async function loadFittedPage(page, htmlPath, query) {
  await page.goto(`${pathToFileURL(htmlPath)}${query}`, { waitUntil: 'load', timeout: 180000 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
  });
  await page.waitForFunction(() => document.documentElement.dataset.fitted === 'true');
}

export async function renderPoster(htmlPath, pngPath, { theme = 'light', finalMaster = false, replaceUnaccepted = false } = {}) {
  const chrome = chromeExecutable();
  if (!existsSync(chrome)) return { rendered: false, reason: 'Chrome is not installed; HTML retained.' };
  return exportAttempt(pngPath, { replaceUnaccepted }, async candidate => {
    let browser;
    try {
      browser = await launchMeasurementBrowser();
      const page = await browser.newPage({ viewport: finalMaster ? { width: 2550, height: 3300 } : { width: 816, height: 1056 }, deviceScaleFactor: 1 });
      await loadFittedPage(page, htmlPath, `?print=1&theme=${theme}${finalMaster ? '&export=1' : ''}`);
      if (!finalMaster) await page.evaluate(() => { if (!document.querySelector('.sheet.poster')) document.body.style.padding = '48px'; });
      await page.screenshot({ path: candidate });
      return { rendered: true, method: 'Chrome after fonts, images and page fitting.' };
    } catch (error) { return { rendered: false, reason: error.message }; }
    finally { if (browser) await browser.close(); }
  });
}
