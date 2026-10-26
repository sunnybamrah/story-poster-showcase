import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { measureDocument, fitDocument } from '../server/layout-fit.js';
import { pdfTextMargins } from '../server/check-pdf.js';
import { moves, saveJSON } from '../server/files.js';
import { posterBoxes } from '../server/format.js';
import { parseWordCheck } from '../server/check-words.js';
import { validateStory } from '../server/story.js';
import { wordCheckAnswer } from './checker-fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { family } from './fixture.mjs';
import { renderSavedKit } from './render-saved-kit.mjs';

test('fixed footer box overflow reaches fitting on every page, even when its text fits', t => {
  const oldDocument = globalThis.document, oldStyle = globalThis.getComputedStyle;
  t.after(() => { globalThis.document = oldDocument; globalThis.getComputedStyle = oldStyle; });
  const px = n => n * 96 / 72;
  const box = (x, y, w, h) => ({ x: px(x), y: px(y), width: px(w), height: px(h) });
  for (const page of ['story', 'story-2', 'try', 'for-you']) {
    // Real failure class: the footer box crosses by .97pt, but its text does not.
    const sheet = { dataset: { page }, getBoundingClientRect: () => box(0, 0, 540, 720) };
    const footer = { getBoundingClientRect: () => box(0, sheet.dataset.fit ? 700 : 700.97, 540, 20) };
    const span = { dataset: {}, className: '', textContent: 'Pip guide', getBoundingClientRect: () => box(200, 704, 100, 12), closest: selector => selector.includes('footer') ? footer : null };
    sheet.querySelector = selector => selector === '.page-footer' ? footer : null;
    sheet.querySelectorAll = selector => selector === '.card' ? [] : [span];
    globalThis.document = { fonts: { status: 'loaded' }, querySelectorAll: () => [sheet], createRange: () => ({ selectNodeContents() {}, getBoundingClientRect: span.getBoundingClientRect }) };
    globalThis.getComputedStyle = () => ({ fontSize: '12px', lineHeight: '16px', overflowY: 'visible', overflowX: 'visible' });
    const before = measureDocument();
    assert.equal(before.ready, false);
    assert.ok(Math.abs(before.pages[0].footerOverflowPoints - .97) < .001);
    assert.ok(before.pages[0].elements.every(row => row.overflowPoints === 0));
    const after = fitDocument(measureDocument);
    assert.equal(after.ready, true, page);
    assert.equal(sheet.dataset.fit, 'compact');
    assert.equal(after.pages[0].overflowPoints, 0);
    assert.equal(after.fitting.typeShrunk, false);
    assert.equal(after.fitting.textHidden, false);
    assert.ok(after.fitting.initialFaults.some(fault => fault.includes('footer')));
  }
});

test('saved render accepts a run or kit, keeps saved page cuts and art, and captures both themes without calls', async t => {
  mkdirSync(resolve('test/out'), { recursive: true });
  const root = mkdtempSync(resolve('test/out/pass27-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  t.mock.method(globalThis, 'fetch', () => assert.fail('Saved rendering must not make model calls.'));
  const source = join(root, 'kit-1'); mkdirSync(source);
  const text = kitText(); text.pagination = validateStory(text).pagination;
  const geometry = parseWordCheck(JSON.stringify(wordCheckAnswer(posterBoxes(moves[0], text))), posterBoxes(moves[0], text)).geometry;
  saveJSON(join(source, 'kit-text-final.json'), text);
  saveJSON(join(source, 'checkpoint.json'), { recordAtStart: family, stages: { poster: { path: '/former-location/poster-attempt-7.png', checks: [{ geometry }] } } });
  const art = readFileSync(new URL('./fixtures/offline-art.png', import.meta.url));
  writeFileSync(join(source, 'poster-attempt-7.png'), art);
  writeFileSync(join(source, 'poster-attempt-8.png'), Buffer.concat([art, Buffer.from('REJECTED ART')]));
  const original = readFileSync(join(source, 'kit-text-final.json'));
  const images = [], themes = [];
  const exporters = {
    async measureLayout(_, { theme }) { themes.push(theme); return { measured: true, ready: true, faults: [], fixture: true }; },
    async renderKitPDF() { return { rendered: true, fixture: true }; },
    async renderPoster(_, path, { theme }) { images.push({ path, theme }); return { rendered: true, fixture: true }; },
  };
  const a = await renderSavedKit({ source: root, outputRoot: join(root, 'renders'), exports: exporters });
  const b = await renderSavedKit({ source, outputRoot: join(root, 'renders'), exports: exporters });
  assert.equal(a.ready, true); assert.equal(b.ready, true); assert.notEqual(a.directory, b.directory);
  assert.deepEqual(themes, ['light', 'dark', 'light', 'dark']);
  assert.equal(images.length, 20);
  assert.equal(images.filter(image => image.theme === 'dark').length, 10);
  assert.equal(new Set(images.map(image => image.path)).size, 20);
  assert.deepEqual(readFileSync(join(a.directory, 'poster-art.png')), art);
  assert.deepEqual(readFileSync(join(source, 'kit-text-final.json')), original);
  assert.deepEqual(a.missingPanels, [1, 2, 3, 4]);
  const story = readFileSync(join(a.directory, 'story.html'), 'utf8');
  assert.ok(story.includes('Panel 1: art was not reached'));
  assert.ok(story.includes(text.pagination.pages[0].split('\n').filter(Boolean).at(-1)));
});

test('PDF margins come from each printed page rather than CSS projections', () => {
  const bbox = '<page width="612" height="792"><word xMin="36" yMin="37.053234" xMax="576" yMax="754.649969">Title</word></page><page width="612" height="792"><word xMin="40" yMin="36.545495" xMax="560" yMax="750">TRY</word></page>';
  const rows = pdfTextMargins(bbox);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].textMargins.top, 37.053234);
  assert.ok(Math.abs(rows[0].textMargins.bottom - 37.350031) < .000001);
  assert.equal(rows[1].textMargins.top, 36.545495);
  assert.equal(rows[1].textMargins.right, 52);
});
