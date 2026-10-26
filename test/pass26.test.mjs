import test from 'node:test';
import assert from 'node:assert/strict';
import { moves } from '../server/files.js';
import { makePages, combinedKitHTML } from '../server/layout.js';
import { validateStory } from '../server/story.js';
import { printedLines } from '../server/printed-type.js';
import { fitPrintedText } from '../server/layout-fit.js';
import { kitText } from './kit-text-fixture.mjs';

// Run 15 pdftotext -bbox measurements, in Letter points. No family text.
// Replaying an inset is an offline estimate, never a new PDF measurement.
const measured = [
  { page: 'poster', top: 708.562068, bottom: 733.450776, inset: 0 },
  { page: 'story', top: 34.803234, bottom: 756.149969, inset: 9 },
  { page: 'story-2', top: 34.803234, bottom: 756.149969, inset: 9 },
  { page: 'try', top: 30.545495, bottom: 756.149969, inset: 9 },
  { page: 'for-you', top: 31.803234, bottom: 756.149969, inset: 6 },
];
function points(html, property, selectors, em = 0) {
  let value = 0;
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selector.split(',').some(part => selectors.includes(part.trim()))) continue;
    const found = body.match(new RegExp(`(?:^|;)${property}:([\\d.]+)(pt|em)(?:;|$)`));
    if (found) value = Number(found[1]) * (found[2] === 'em' ? em : 1);
  }
  return value;
}
function inset(html, page, compact, theme) {
  const selectors = ['.page-heading', `.${page} .page-heading`, ...(compact ? ['.sheet[data-fit=compact] .page-heading', `.${page}[data-fit=compact] .page-heading`] : [])];
  const headings = ['.page-heading h1', `.${page} .page-heading h1`];
  const size = points(html, 'font-size', ['h1', ...headings]);
  return points(html, 'padding-top', [...selectors, ...selectors.map(s => `html[data-theme=${theme}] ${s}`)])
    + points(html, 'padding-top', [...headings, ...headings.map(s => `html[data-theme=${theme}] ${s}`)], size);
}
function pagesFor(move, chapterTitle = 'The fox names a feeling') {
  const text = { ...kitText(move), chapterTitle };
  text.pagination = validateStory(text).pagination;
  return makePages(move, text);
}

test('run 15 title and footer font boxes move fully inside 36 points in every sheet and theme', () => {
  const pages = pagesFor(moves[0]), combined = combinedKitHTML(pages);
  for (const theme of ['light', 'dark']) for (const compact of [false, true]) for (const row of measured) {
    const html = pages[`${row.page}.html`];
    for (const document of [html, combined]) {
      const top = row.top + (row.page === 'poster' ? 0 : inset(document, row.page, compact, theme) - row.inset);
      const bottom = 792 - row.bottom + (row.page === 'poster' ? 0 : points(document, 'padding-bottom', ['.page-footer']));
      if (row.page !== 'poster') { assert.ok(row.top < 35.5); assert.ok(792 - row.bottom < 36); }
      assert.ok(top >= 36, `${row.page} ${theme} compact=${compact}: top ${top}`);
      assert.ok(bottom >= 36, `${row.page} ${theme} compact=${compact}: bottom ${bottom}`);
    }
  }
});

test('all moves allow long wrapped chapter titles without moving the first font box above the margin', () => {
  // Twelve wide words cover the writer's long-title guidance. There is no cap.
  const chapterTitle = Array(12).fill('Tomorrow').join(' ');
  assert.ok(printedLines(`Chapter 1: ${chapterTitle}`, 350, 22, 'Baloo2').length > 1);
  for (const move of moves) {
    const pages = pagesFor(move, chapterTitle);
    for (const page of ['story', 'story-2']) {
      const html = pages[`${page}.html`];
      assert.ok(html.includes(chapterTitle));
      assert.match(html, /\.page-heading h1\{[^}]*min-width:0;[^}]*overflow-wrap:anywhere/);
      for (const theme of ['light', 'dark']) for (const compact of [false, true]) {
        assert.ok(34.803234 + inset(html, page, compact, theme) - 9 >= 36);
      }
    }
  }
});

test('the extra title space still uses page-scoped shortening when a page becomes tighter', async () => {
  const pages = pagesFor(moves[0]);
  for (const row of measured.slice(1)) {
    const extra = inset(pages[`${row.page}.html`], row.page, true, 'light') - row.inset;
    assert.ok(extra > 0);
    const field = row.page.startsWith('story') ? 'story' : row.page === 'try' ? 'feelFirst' : 'replayCue';
    const text = { ...kitText(), pagination: { pages: ['First page.', 'Second page.'] } };
    let shortened = 0;
    const result = await fitPrintedText({ text, measure: async () => shortened
      ? { measured: true, ready: true, faults: [], pages: [] }
      : { measured: true, ready: false, faults: [`${extra} points beyond content`], pages: [{ page: row.page, elements: [{ generated: field, field, text: 'A few words need less room.', bounds: { h: 16 }, fontPoints: 12, linePoints: 16, overflowPoints: extra }] }] },
    shorten: async (current, plan) => { assert.equal(plan.page, row.page); assert.ok(plan.cutWords > 0); shortened++; return current; } });
    assert.equal(shortened, 1); assert.equal(result.receipt.ready, true);
  }
});
