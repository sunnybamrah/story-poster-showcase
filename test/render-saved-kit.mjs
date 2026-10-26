import { mkdirSync, mkdtempSync, writeFileSync, copyFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { moves, sourceOwnedMoves, readJSON, saveJSON } from '../server/files.js';
import { withSavedSourceRows } from '../server/source-audit.js';
import { makePages, copyFonts, combinedKitHTML, renderKitPDF, renderPoster } from '../server/layout.js';
import { measureLayout } from '../server/layout-fit.js';
import { parseWordCheck } from '../server/check-words.js';
import { posterBoxes, parentLabelFor } from '../server/format.js';
import { pngDimensions } from '../server/picture.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { checkedReadingArt, readingLookVersion } from '../server/reading-look.js';
import { printedText } from '../server/layout.js';
const digest = value => createHash('sha256').update(value).digest('hex');

export function findSavedKit(root = resolve('test/out')) {
  if (!existsSync(root)) throw new Error('No saved kit found. Pass a saved kit or run folder to render-saved-kit.mjs.');
  const runs = readdirSync(root).filter(name => /^pass9-/.test(name)).sort().reverse();
  for (const run of runs) for (const name of ['kit-1', 'kit-2']) {
    const candidate = join(root, run, name);
    if (existsSync(join(candidate, 'kit-text-final.json')) && existsSync(join(candidate, 'poster-fit.json'))) return candidate;
  }
  throw new Error('No saved kit found. Pass a saved kit or run folder to render-saved-kit.mjs.');
}

const sourceFiles = directory => Object.fromEntries(readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? Object.entries(sourceFiles(path)).map(([name, hash]) => [entry.name + '/' + name, hash]) : entry.isFile() ? [[entry.name, digest(readFileSync(path))]] : [];
}));
export async function renderSavedKit({ source, outputRoot = resolve('test/out/render-check'), readingArt, panelOverrides = [], visualRefresh = Boolean(readingArt || panelOverrides.length), refreshResearchNotes = false, exports: exporters = { measureLayout, renderKitPDF, renderPoster } } = {}) {
  if (typeof refreshResearchNotes !== 'boolean') throw Error('Research-note refresh needs an explicit true or false.');
  source ??= findSavedKit();
  source = resolve(source);
  if (!existsSync(join(source, 'kit-text-final.json'))) source = join(source, 'kit-1');
  outputRoot = resolve(outputRoot);
  if (outputRoot === source || outputRoot.startsWith(source + '/')) throw Error('A saved visual revision must be outside the original kit.');
  const originalFiles = sourceFiles(source);
  const savedHTML = existsSync(join(source, 'kit_final.html')) ? readFileSync(join(source, 'kit_final.html'), 'utf8') : '';
  const savedLook = savedHTML.match(/<main\b[^>]*data-reading-look="[^"]+"[^>]*>/)?.[0];
  const savedSelection = savedLook ? {
    colourSet: savedLook.match(/data-reading-palette="([^"]+)"/)?.[1],
    world: savedLook.match(/data-reading-world="([^"]+)"/)?.[1],
  } : null;
  const reuseReadingArt = readingArt === undefined && existsSync(join(source, 'reading-art.json'));
  if (reuseReadingArt) readingArt = join(source, 'reading-art.json');
  if (typeof readingArt === 'string') {
    const path = resolve(readingArt); readingArt = readJSON(path);
    // A copied kit is self-contained. Prefer its own saved bytes over an
    // absolute path left in a receipt from the original generation folder.
    const localArt = resolve(path, '..', readingArt.filename ?? 'reading-art.png');
    if (reuseReadingArt && existsSync(localArt)) readingArt.file = localArt;
    else if (readingArt.file && !readingArt.file.startsWith('/')) readingArt.file = resolve(path, '..', readingArt.file);
  }
  readingArt = checkedReadingArt(readingArt);
  if (!Array.isArray(panelOverrides) || panelOverrides.length > 4 || panelOverrides.some(row => !Number.isInteger(row.panel) || row.panel < 1 || row.panel > 4) || new Set(panelOverrides.map(row => row.panel)).size !== panelOverrides.length) throw Error('Panel revisions need unique explicit panel numbers.');
  mkdirSync(outputRoot, { recursive: true });
  const directory = mkdtempSync(join(outputRoot, new Date().toISOString().replace(/[:.]/g, '-') + '-'));
  copyFonts(directory);
  const checkpoint = existsSync(join(source, 'checkpoint.json')) ? readJSON(join(source, 'checkpoint.json')) : null;
  const family = checkpoint?.recordAtStart ?? readJSON(join(source, '../family.json'));
  const sourceBytes = readFileSync(join(source, 'kit-text-final.json'));
  const text = JSON.parse(sourceBytes);
  const savedEditorial = existsSync(join(source, 'kit-editorial.json')) ? readJSON(join(source, 'kit-editorial.json')) : null;
  const snapshot = savedEditorial?.moveSnapshot;
  if (snapshot && (snapshot.id !== text.moveId || digest(JSON.stringify(snapshot)) !== savedEditorial.moveSnapshotHash)) throw Error('The saved move no longer matches its kit record. Keep the original files for review.');
  const currentMove = snapshot ?? moves.find(move => move.id === text.moveId);
  const originalMove = sourceOwnedMoves.find(item => item.id === text.moveId);
  const move = withSavedSourceRows(currentMove, savedEditorial, originalMove ?? currentMove);
  const savedNotesVersion = savedHTML.match(/data-short-notes="(exact-v[12])"/)?.[1];
  const options = { nickname: family.hero.nickname, parentLabel: parentLabelFor(family), kitCount: (checkpoint?.chapterNumber ?? family.pastKits.length + 1) - 1, pagination: text.pagination, savedRevision: true, ...(!refreshResearchNotes && savedNotesVersion ? { printedNotesVersion: savedNotesVersion } : {}) };
  if (!text.pagination) throw new Error('Saved page cuts are missing. A saved export cannot silently replace them.');
  const checks = readdirSync(source).filter(name => /^picture-check-poster-\d+\.json$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const check = checks.length ? readJSON(join(source, checks.at(-1))) : null;
  const savedPoster = checkpoint?.stages.poster;
  const geometry = existsSync(join(source, 'poster-fit.json')) ? readJSON(join(source, 'poster-fit.json'))
    : savedPoster?.checks.at(-1)?.geometry ?? parseWordCheck(JSON.stringify(check?.answer), posterBoxes(move, text), { subBoxesRechecked: true }).geometry;
  if (!geometry?.placement) throw new Error('Saved poster has no measured placement.');
  const attempts = readdirSync(source).filter(name => /^poster-attempt-\d+\.png$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const posterPath = join(source, existsSync(join(source, 'poster-art.png')) ? 'poster-art.png' : savedPoster?.path ? basename(savedPoster.path) : attempts.at(-1));
  const baseOptions = { ...options, posterDimensions: pngDimensions(posterPath), posterGeometry: geometry };
  const originalPages = makePages(move, text, baseOptions);
  const pages = makePages(move, text, { ...baseOptions, readingArt, visualRefresh: visualRefresh || Boolean(savedLook), selection: savedSelection ?? text });
  const printedWords = Object.keys(pages).map(page => ({ page, unchanged: printedText(pages[page]) === printedText(originalPages[page]), sha256: digest(printedText(pages[page])) }));
  if (printedWords.some(row => !row.unchanged)) throw Error('A visual revision changed the original printed words.');
  copyFileSync(posterPath, join(directory, 'poster-art.png'));
  if (readingArt) {
    copyFileSync(readingArt.file, join(directory, readingArt.filename));
    if (digest(readFileSync(join(directory, readingArt.filename))) !== readingArt.sha256) throw Error('Copied reading art differs from its checked bytes.');
    saveJSON(join(directory, 'reading-art.json'), { ...readingArt, file: readingArt.filename });
  }
  const changedAssets = readingArt ? [{ kind: 'reading-art', file: readingArt.filename, sha256: readingArt.sha256, cacheKey: readingArt.cacheKey, checked: true, reusedFromSource: reuseReadingArt }] : [];
  const missingPanels = [];
  for (let i = 1; i <= 4; i++) {
    const path = join(source, `panel-${i}.png`);
    const override = panelOverrides.find(row => row.panel === i);
    if (override) {
      if (override.reviewed !== true || typeof override.reviewEvidence !== 'string' || !override.reviewEvidence.trim() || !existsSync(override.path ?? '') || digest(readFileSync(override.path)) !== override.sha256) throw Error(`Panel ${i} needs an explicit reviewed unchanged raster receipt.`);
      const dimensions = pngDimensions(override.path), originalDimensions = existsSync(path) ? pngDimensions(path) : { width: 3, height: 2 };
      const aspectChanged = Math.abs(dimensions.width / dimensions.height - originalDimensions.width / originalDimensions.height) > .000001;
      if (aspectChanged && override.allowAspectChange !== true) throw Error(`Panel ${i} revision changed its true shape.`);
      copyFileSync(override.path, join(directory, `panel-${i}.png`));
      changedAssets.push({ kind: 'panel', panel: i, originalSHA256: existsSync(path) ? digest(readFileSync(path)) : null, sha256: override.sha256, reviewEvidence: override.reviewEvidence, explicitlyReviewed: true, originalCheckerApprovalReused: false, dimensions, originalDimensions, aspectChanged, placement: 'Full image contained in the existing panel box, never stretched or cropped.', expectedBubble: text.panelLines[i - 1].line, rasterWordCheck: 'Separate review evidence; original word-check approval does not apply to these new bytes.' });
    } else if (existsSync(path)) copyFileSync(path, join(directory, `panel-${i}.png`)); else missingPanels.push(i);
  }
  for (const [name, html] of Object.entries(pages)) {
    pages[name] = html.replace(/<img src="panel-(\d).png" alt="">/g, (original, number) => missingPanels.includes(Number(number)) ? `<div class="missing-art">Panel ${number}: art was not reached in this saved run.</div>` : original);
    writeFileSync(join(directory, name), pages[name], { mode: 0o600 });
  }
  writeFileSync(join(directory, 'kit_final.html'), combinedKitHTML(pages), { mode: 0o600 });
  const measurements = [];
  for (const theme of ['light', 'dark']) measurements.push({ theme, ...await exporters.measureLayout(join(directory, 'kit_final.html'), { theme }) });
  const failure = measurements.find(row => !row.measured || !row.ready);
  const readability = measurements.map(row => ({ theme: row.theme, pages: (row.pages ?? []).map(page => ({ page: page.page, storyTypography: page.storyTypography, parentBodyPoints: page.parentBodyPoints, textMargins: page.textMargins, artMargins: page.artMargins, sourceBlocks: page.sourceBlocks })) }));
  const result = { source, directory, revision: { kind: visualRefresh || readingArt || panelOverrides.length ? 'visual-refresh' : 'saved-export-layout-revision', ...(visualRefresh ? { lookVersion: readingLookVersion } : {}), sourceTextSHA256: digest(sourceBytes), sourceFiles: originalFiles, printedWords, changedAssets, posterSHA256: digest(readFileSync(posterPath)), posterChanged: false, textChanged: refreshResearchNotes && savedNotesVersion !== 'exact-v2', sourceTextChanged: false, printedNotesVersion: options.printedNotesVersion ?? 'exact-v2', researchNotesRefreshRequested: refreshResearchNotes, sourceOverwritten: false, pageCutsChanged: false, typeShrunk: false, readingArtPlacement: measurements.map(row => ({ theme: row.theme, ...row.readingArt })), reflow: measurements.map(row => ({ theme: row.theme, changes: row.fitting?.changes ?? [] })) }, missingPanels, measurements, readability, pdf: { rendered: false }, images: [], ready: false };
  result.revision.sourceNotes = { basis: savedEditorial ? 'saved-kit-editorial' : originalMove ? 'unchanged-original-source-file' : 'immutable-general-guide', sha256: digest(JSON.stringify(move.sources)), metadataRevision: move.sourceMetadataRevision };
  if (failure) result.reason = `Fit ${failure.measured ? 'failed' : 'unverified'} (${failure.theme}): ${failure.faults?.join('; ') || failure.reason} PDF and screenshots were not attempted.`;
  else {
    result.pdf = await exporters.renderKitPDF(join(directory, 'kit_final.html'), join(directory, 'kit_final.pdf'));
    for (const theme of ['light', 'dark']) for (const name of ['poster', 'story', 'story-2', 'try', 'for-you']) result.images.push({ page: name, theme, ...await exporters.renderPoster(join(directory, `${name}.html`), join(directory, `${name}-${theme}.png`), { theme }) });
    result.ready = result.pdf.rendered && result.images.every(image => image.rendered);
  }
  saveJSON(join(directory, 'render-results.json'), result);
  if (digest(readFileSync(join(source, 'kit-text-final.json'))) !== result.revision.sourceTextSHA256) throw new Error('Saved source text changed while rendering.');
  if (JSON.stringify(sourceFiles(source)) !== JSON.stringify(originalFiles)) throw Error('An original saved-kit file changed while rendering.');
  result.revision.allOriginalFilesUnchanged = true;
  saveJSON(join(directory, 'render-results.json'), result);
  saveJSON(join(directory, 'render-measured-summary.json'), readability);
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let source = process.argv[2];
  if (source === '--offline-fixture') {
    mkdirSync(resolve('test/out'), { recursive: true });
    source = mkdtempSync(resolve('test/out/pass28-offline-source-'));
    const { createReadableOfflineKit } = await import('./readable-kit-fixture.mjs');
    await createReadableOfflineKit(source);
  }
  const revisionOptions = process.argv[4] ? readJSON(resolve(process.argv[4])) : {};
  const result = await renderSavedKit({ ...revisionOptions, ...(source ? { source: resolve(source) } : {}), ...(process.argv[3] ? { outputRoot: resolve(process.argv[3]) } : {}) });
  console.log(JSON.stringify({ directory: result.directory, ready: result.ready, reason: result.reason, measurements: result.measurements.map(row => ({ theme: row.theme, measured: row.measured, ready: row.ready, faults: row.faults, reason: row.reason })), readability: result.readability, pdf: result.pdf }, null, 2));
  process.exitCode = result.ready ? 0 : 1;
}
