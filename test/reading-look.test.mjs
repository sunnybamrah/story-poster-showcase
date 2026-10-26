import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { moves, saveJSON } from '../server/files.js';
import { makePages, previewPages, printedText, combinedKitHTML, copyFonts } from '../server/layout.js';
import { readingLookFor, readingPalettes, checkedReadingArt } from '../server/reading-look.js';
import { launchMeasurementBrowser, measureLayout } from '../server/layout-fit.js';
import { validateGeometryReceipt } from '../server/poster-template.js';
import { geometryAnswer } from './checker-fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { validateStory } from '../server/story.js';
import { family } from './fixture.mjs';
import { renderSavedKit } from './render-saved-kit.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const folder = t => { const path = mkdtempSync(join(tmpdir(), 'reading-look-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; };

test('Doodle poster nickname stays black on screen, print and full-size export without recoloring other looks', async t => {
  const directory = folder(t); copyFonts(directory);
  const browser = await launchMeasurementBrowser(); t.after(() => browser.close());
  const page = await browser.newPage();
  for (const colourSet of ['ink', 'warm', 'cool']) {
    const html = previewPages(moves[0], { selection: { colourSet, world: 'comic strip' } })['poster.html'];
    const file = join(directory, `${colourSet}.html`); writeFileSync(file, html);
    for (const theme of ['light', 'dark']) for (const media of ['screen', 'print']) for (const fullSize of [false, true]) {
      await page.emulateMedia({ media });
      await page.goto(pathToFileURL(file).href + `?theme=${theme}${fullSize ? '&export=1' : ''}`);
      const colour = await page.locator('.poster-footer').evaluate(node => getComputedStyle(node).color);
      assert.equal(colour, colourSet === 'ink' ? 'rgb(31, 31, 31)' : 'rgb(32, 48, 71)', `${colourSet}/${theme}/${media}/${fullSize}`);
    }
  }
});

test('research links inherit readable ink in every theme and stay monochrome in Doodle print', async t => {
  const directory = folder(t); copyFonts(directory);
  const pageHTML = previewPages(moves.find(m => m.id === 'compare-with-past-me'), { selection: { colourSet: 'ink', world: 'comic strip' } })['for-you.html'];
  const file = join(directory, 'notes.html'); writeFileSync(file, pageHTML);
  const browser = await launchMeasurementBrowser(); t.after(() => browser.close());
  const page = await browser.newPage();
  for (const theme of ['light', 'dark']) for (const media of ['screen', 'print']) {
    await page.emulateMedia({ media });
    await page.goto(pathToFileURL(file).href + '?theme=' + theme);
    const colours = await page.locator('.sources a').first().evaluate(a => ({ link: getComputedStyle(a).color, text: getComputedStyle(a.parentElement).color, decoration: getComputedStyle(a).textDecorationLine }));
    assert.equal(colours.link, colours.text, `${theme}/${media}`);
    const rgb = colours.link.match(/\d+/g).slice(0, 3).map(Number);
    assert.ok(Math.max(...rgb) - Math.min(...rgb) <= 8, `${theme}/${media}: ${colours.link}`);
    assert.ok(colours.decoration.includes('underline'));
  }
});
async function rasterFixture(directory) {
  // A blank colour raster exercises placement only. It is not generated family art.
  const file = join(directory, 'reading-art.png');
  const bytes = await sharp({ create: { width: 1536, height: 1024, channels: 4, background: '#4e7564' } }).png().toBuffer();
  writeFileSync(file, bytes);
  return { version: 'synthetic-placement-fixture', ready: true, verified: true, status: 'checked', fixture: true, file, sha256: sha(bytes), width: 1536, height: 1024, cacheKey: 'fixture-only', cells: [{ personId: 'child', role: 'child', column: 0, row: 0, rect: { x: 0, y: 0, width: 512, height: 512 } }, { personId: 'grown-up-one', role: 'grown-up', column: 1, row: 0, rect: { x: 512, y: 0, width: 512, height: 512 } }] };
}
const textFor = (move = moves[0]) => { const text = kitText(move); text.pagination = validateStory(text).pagination; return text; };
const geometry = () => validateGeometryReceipt(geometryAnswer());
const options = () => ({ posterGeometry: geometry(), posterDimensions: { width: 1024, height: 1536 }, nickname: 'Pip', parentLabel: 'Dad' });

test('reading art and shared palette preserve all fourteen records, printed words, page cuts and five-page furniture', async t => {
  const art = await rasterFixture(folder(t));
  for (const move of moves.filter(move => !move.library)) {
    const text = textFor(move), before = structuredClone(text);
    const plain = makePages(move, text, { ...options(), savedRevision: true });
    const comic = makePages(move, text, { ...options(), readingArt: art });
    assert.equal((combinedKitHTML(comic).match(/<main\b/g) ?? []).length, 5);
    for (const page of Object.keys(plain)) assert.equal(printedText(comic[page]), printedText(plain[page]), `${move.id}/${page}`);
    assert.deepEqual(text, before);
    assert.equal((comic['try.html'].match(/data-reading-art=/g) ?? []).length, 1);
    assert.equal((comic['for-you.html'].match(/data-reading-art=/g) ?? []).length, 1);
    assert.doesNotMatch(comic['for-you.html'].match(/<header[\s\S]*?<\/header>/)[0], /practice-vignette/);
    assert.match(comic['for-you.html'], /grid-template-columns:3\.5in 3\.5in/);
    assert.match(comic['try.html'], /data-writing-frame="empty"/);
    for (const name of ['story', 'story-2', 'try', 'for-you']) assert.match(comic[name + '.html'], /<main[^>]*data-reading-palette="warm"/);
    assert.doesNotMatch(comic['poster.html'].match(/<main[^>]*>/)[0], /data-reading-look/);
  }
});

test('reading rasters need exact checked bytes, safe crop bounds and a local filename', async t => {
  const art = await rasterFixture(folder(t));
  assert.equal(checkedReadingArt(art).sha256, art.sha256);
  assert.equal(checkedReadingArt({ status: 'omitted', ready: false, verified: false }), null);
  const withEmptyCell = { ...art, cells: [...art.cells, { personId: null, role: null, column: 2, row: 0, rect: { x: 1024, y: 0, width: 512, height: 512 } }] };
  assert.doesNotThrow(() => makePages(moves[0], textFor(), { ...options(), readingArt: withEmptyCell }));
  for (const patch of [{ verified: false }, { sha256: '0'.repeat(64) }, { width: 3 }, { filename: '../escape.png' }, { cells: [{ personId: 'child', rect: { x: -1, y: 0, width: 512, height: 512 } }] }]) assert.throws(() => checkedReadingArt({ ...art, ...patch }), /Reading art/);
});

test('all four reading palettes pair readable light and dark surfaces and keep a fixed saved world', () => {
  const lum = hex => hex.match(/[\da-f]{2}/g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  for (const palette of Object.values(readingPalettes)) for (const [theme, colours] of Object.entries(palette)) for (const surface of colours) {
    const values = [lum(surface), lum(theme === 'dark' ? '#eee8dc' : '#26364b')].sort((a, b) => b - a);
    assert.ok((values[0] + .05) / (values[1] + .05) >= 7);
  }
  assert.deepEqual(readingLookFor({ world: 'space mission', colourSet: 'forest' }), { version: 'comic-reading-v1', world: 'space mission', colourSet: 'forest' });
  assert.equal(readingLookFor({ world: '<script>', colourSet: 'unknown' }).colourSet, 'warm');
});

test('actual browser ink measurements shrink or omit art without moving text, boxes, writing rows or source strips', async t => {
  const directory = folder(t), art = await rasterFixture(directory); copyFonts(directory);
  const browser = await launchMeasurementBrowser(); t.after(() => browser.close());
  const text = textFor(), receipts = [];
  for (const theme of ['light', 'dark']) {
    const snapshots = [];
    for (const withArt of [false, true]) {
      const pages = makePages(moves[0], text, { ...options(), ...(withArt ? { readingArt: art } : {}) });
      const path = join(directory, `kit-${theme}-${withArt}.html`); writeFileSync(path, combinedKitHTML(pages));
      const page = await browser.newPage();
      await page.goto(pathToFileURL(path).href + '?print=1&theme=' + theme);
      await page.waitForFunction(() => document.documentElement.dataset.fitted === 'true');
      const result = await page.evaluate(() => ({ readingArt: globalThis.storyPosterLayout.readingArt, snapshots: [...document.querySelectorAll('.try,.for-you')].flatMap(sheet => [...sheet.querySelectorAll('.card,h2,p,li,.writing-row,.replay-pair')].map(node => { const r = node.getBoundingClientRect(); return { text: node.textContent, cls: node.className, x: r.x, y: r.y, w: r.width, h: r.height, font: getComputedStyle(node).fontSize }; })) }));
      snapshots.push(result.snapshots);
      if (withArt) { assert.equal(result.readingArt.ready, true); assert.equal(result.readingArt.assets.length, 2); assert.ok(result.readingArt.assets.every(asset => asset.placed && asset.clearOfText)); receipts.push(result.readingArt); }
      await page.close();
    }
    assert.deepEqual(snapshots[1], snapshots[0], theme + ' unchanged text and furniture');
  }
  const crowded = structuredClone(text); crowded.feelFirst = Array(2).fill('A much longer thought fills this entire line and leaves no clear right side for a picture.');
  const pages = makePages(moves[0], crowded, { ...options(), readingArt: art, savedRevision: true });
  // Remove the former thumbnail lane in this deliberate crowded-box probe.
  // Justified actual ink fills every line; there is no safe art rectangle.
  const path = join(directory, 'crowded.html'); writeFileSync(path, pages['try.html'].replace('</head>', '<style>.feel .with-vignette{display:block}.feel .reading-art-spacer{display:none}.feel p{text-align:justify;text-align-last:justify}</style></head>'));
  const page = await browser.newPage(); await page.goto(pathToFileURL(path).href); await page.waitForFunction(() => document.documentElement.dataset.fitted === 'true');
  const result = await page.evaluate(() => globalThis.storyPosterLayout.readingArt);
  assert.equal(result.ready, true); assert.equal(result.assets[0].placed, false); assert.match(result.assets[0].reason, /Omitted/); await page.close();
  assert.equal(receipts.length, 2);
});

test('saved visual revisions retain every original file and separately label reviewed new panel bytes', async t => {
  const directory = folder(t), source = join(directory, 'source');
  const { mkdirSync } = await import('node:fs'); mkdirSync(source);
  const text = textFor(), art = await rasterFixture(directory), poster = new URL('./fixtures/offline-art.png', import.meta.url);
  saveJSON(join(source, 'kit-text-final.json'), text); saveJSON(join(source, 'poster-fit.json'), geometry()); saveJSON(join(source, 'checkpoint.json'), { recordAtStart: family, stages: {}, chapterNumber: 1 });
  copyFileSync(poster, join(source, 'poster-art.png'));
  for (let panel = 1; panel <= 4; panel++) copyFileSync(poster, join(source, `panel-${panel}.png`));
  const exports = { measureLayout: async () => ({ measured: true, ready: true, pages: [], faults: [], fixture: true }), renderKitPDF: async () => ({ rendered: true, fixture: true }), renderPoster: async () => ({ rendered: true, fixture: true }) };
  const result = await renderSavedKit({ source, outputRoot: join(directory, 'revisions'), readingArt: art, panelOverrides: [{ panel: 2, path: join(source, 'panel-1.png'), sha256: sha(readFileSync(poster)), reviewed: true, reviewEvidence: 'Synthetic same-shape override fixture only; no model or visual approval.' }], exports });
  assert.equal(result.revision.kind, 'visual-refresh'); assert.equal(result.revision.allOriginalFilesUnchanged, true); assert.ok(result.revision.printedWords.every(row => row.unchanged));
  assert.equal(result.revision.changedAssets.find(row => row.kind === 'panel').originalCheckerApprovalReused, false);
  assert.equal(sha(readFileSync(join(result.directory, 'poster-art.png'))), result.revision.posterSHA256);
  assert.ok(result.revision.changedAssets.some(row => row.kind === 'reading-art'));
  await assert.rejects(renderSavedKit({ source, outputRoot: join(directory, 'bad'), panelOverrides: [{ panel: 5 }], exports }), /unique explicit/);
  const wider = { panel: 1, path: art.file, sha256: art.sha256, reviewed: true, reviewEvidence: 'Synthetic different-aspect fixture, testing contain-only placement.' };
  await assert.rejects(renderSavedKit({ source, outputRoot: join(directory, 'unaccepted-shape'), panelOverrides: [wider], exports }), /true shape/);
  const contained = await renderSavedKit({ source, outputRoot: join(directory, 'accepted-shape'), panelOverrides: [{ ...wider, allowAspectChange: true }], visualRefresh: false, exports });
  assert.equal(contained.revision.changedAssets[0].aspectChanged, true);
  assert.match(contained.revision.changedAssets[0].placement, /never stretched or cropped/);
  assert.ok(contained.revision.printedWords.every(row => row.unchanged));
});

test('measurement waits for the new shell raster fit instead of racing to the legacy fallback', async t => {
  const directory = folder(t), art = await rasterFixture(directory); copyFonts(directory);
  const path = join(directory, 'delayed-raster.html');
  writeFileSync(path, makePages(moves[0], textFor(), { ...options(), readingArt: art })['try.html']);
  const launch = async () => {
    const browser = await launchMeasurementBrowser(), newPage = browser.newPage.bind(browser);
    browser.newPage = async (...args) => {
      const page = await newPage(...args);
      await page.addInitScript(() => { const decode = HTMLImageElement.prototype.decode; HTMLImageElement.prototype.decode = async function () { await new Promise(resolve => setTimeout(resolve, 180)); return decode.call(this); }; });
      return page;
    };
    return browser;
  };
  const result = await measureLayout(path, { launch });
  assert.equal(result.measured, true); assert.equal(result.readingArt.ready, true);
  assert.equal(result.readingArt.assets.length, 1); assert.equal(result.readingArt.assets[0].placed, true);
});

test('saved exports recover their own palette and checked family art without a special option', async t => {
  const directory = folder(t), source = join(directory, 'source');
  const { mkdirSync } = await import('node:fs'); mkdirSync(source);
  const text = textFor(), art = await rasterFixture(source), poster = new URL('./fixtures/offline-art.png', import.meta.url);
  saveJSON(join(source, 'kit-text-final.json'), text);
  saveJSON(join(source, 'poster-fit.json'), geometry());
  saveJSON(join(source, 'checkpoint.json'), { recordAtStart: family, stages: {}, chapterNumber: 1 });
  copyFileSync(poster, join(source, 'poster-art.png'));
  for (let panel = 1; panel <= 4; panel++) copyFileSync(poster, join(source, `panel-${panel}.png`));
  // A copied kit can outlive the original absolute generation path.
  saveJSON(join(source, 'reading-art.json'), { ...art, file: '/gone/original/reading-art.png' });
  writeFileSync(join(source, 'kit_final.html'), combinedKitHTML(makePages(moves[0], text, { ...options(), readingArt: art, selection: { colourSet: 'forest', world: 'space mission' } })));
  const exports = { measureLayout: async () => ({ measured: true, ready: true, pages: [], faults: [], fixture: true }), renderKitPDF: async () => ({ rendered: true, fixture: true }), renderPoster: async () => ({ rendered: true, fixture: true }) };
  const result = await renderSavedKit({ source, outputRoot: join(directory, 'revisions'), exports });
  assert.equal(result.revision.allOriginalFilesUnchanged, true);
  assert.equal(sha(readFileSync(join(result.directory, 'reading-art.png'))), art.sha256);
  for (const page of ['try', 'for-you']) {
    const html = readFileSync(join(result.directory, `${page}.html`), 'utf8');
    assert.match(html, /<main[^>]*data-reading-palette="forest"/);
    assert.match(html, /<main[^>]*data-reading-world="space mission"/);
    assert.match(html, /data-reading-art=/);
  }
  const saved = JSON.parse(readFileSync(join(result.directory, 'reading-art.json')));
  assert.equal(saved.file, 'reading-art.png');
  assert.equal(saved.sha256, art.sha256);
  assert.equal(result.revision.changedAssets.find(row => row.kind === 'reading-art').reusedFromSource, true);
  writeFileSync(join(source, 'reading-art.png'), Buffer.from('wrong bytes'));
  await assert.rejects(renderSavedKit({ source, outputRoot: join(directory, 'bad'), exports }), /Reading art/);
});

test('all supported sibling labels can finish saved reading pages without changing raster bytes or text', async t => {
  const art = await rasterFixture(folder(t));
  const move = moves.find(move => move.id === 'make-it-right'), text = textFor(move);
  const plain = makePages(move, text, { ...options(), savedRevision: true });
  for (const personId of ['sibling-1', 'sibling-2', 'sibling-3']) {
    const cell = { personId, role: 'child', column: 2, row: 0, rect: { x: 1024, y: 0, width: 512, height: 512 } };
    for (const state of [{ status: 'checked', verified: true }, { status: 'parent-review', verified: false }]) {
      const manifest = { ...art, ...state, cells: [...art.cells, cell] };
      assert.equal(checkedReadingArt(manifest).sha256, art.sha256);
      const pages = makePages(move, text, { ...options(), readingArt: manifest });
      assert.equal((combinedKitHTML(pages).match(/<main\b/g) ?? []).length, 5);
      for (const name of Object.keys(plain)) assert.equal(printedText(pages[name]), printedText(plain[name]));
      assert.equal(sha(readFileSync(art.file)), art.sha256);
    }
  }
  for (const personId of ['sibling-0', 'sibling-4', 'sibling-1/../other', 'grown-up-five', undefined]) {
    assert.throws(() => checkedReadingArt({ ...art, cells: [{ personId, rect: { x: 0, y: 0, width: 512, height: 512 } }] }), /invalid character crop/);
  }
  assert.throws(() => checkedReadingArt({ ...art, cells: [{ personId: 'sibling-1', rect: { x: 1025, y: 0, width: 512, height: 512 } }] }), /invalid character crop/);
});
