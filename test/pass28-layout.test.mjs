import { sourceReaderLimitation, guideReaderLimitation, guideReaderClaim } from '../app/reader-notes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { moves } from '../server/files.js';
import { makePages, visibleText, verifyOwnedWords } from '../server/layout.js';
import { fitDocument, fitPrintedText, shorteningPlan } from '../server/layout-fit.js';
import { validateStory } from '../server/story.js';
import { scienceFor, backupActionFor, evidenceLabelFor } from '../server/format.js';
import { printedSourcesFor } from '../server/kit-editorial.js';
import { kitText } from './kit-text-fixture.mjs';

function pagesFor(move) {
  const text = kitText(move); text.pagination = validateStory(text).pagination;
  return makePages(move, text);
}

test('every inspired kit has one MADE UP label, in its first chapter header', () => {
  for (const move of moves) {
    const pages = pagesFor(move);
    assert.equal((Object.values(pages).map(visibleText).join(' ').match(/MADE UP/g) ?? []).length, 1, move.id);
    assert.match(pages['story.html'], /class="identity">Pip \| MADE UP: inspired story<\/span>/);
    assert.doesNotMatch(visibleText(pages['story-2.html']), /MADE UP/);
  }
});

test('story readability floors survive both themes and compact spacing', () => {
  const html = pagesFor(moves[0])['story.html'];
  assert.match(html, /\.chapter-text\{font-size:13pt;line-height:1\.4;width:100%/);
  assert.match(html, /\.chapter-text p\{margin-bottom:6\.5pt\}/);
  assert.doesNotMatch(html, /\.chapter-text[^{}]*\{[^}]*font-size:(?:[0-9](?:\.\d+)?|11(?:\.\d+)?)pt/);
  assert.doesNotMatch(html, /\[data-fit=compact\][^{}]*\.chapter-text[^{}]*\{[^}]*margin-bottom:[0-5]pt/);
  assert.match(html, /height:2\.5in/);
  assert.match(html, /html\[data-theme=dark\]/);
  assert.match(html, /sources \.card-body\{font-size:11pt/);
});

test('generated page overflow requests targeted shortening before compacting its spacing', async t => {
  const previous = globalThis.document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const probe = { style: {}, querySelector: () => null, querySelectorAll: () => [], remove() {} };
  const sheet = { dataset: { page: 'story' }, querySelector: () => null, cloneNode: () => probe };
  globalThis.document = { querySelectorAll: () => [sheet], body: { append() {} } };
  let shortened = false;
  const overflow = { measured: true, ready: false, faults: ['story exceeds by 18 points'], pages: [{ page: 'story', elements: [{ generated: 'story', text: 'A long paragraph.', bounds: { h: 30 }, linePoints: 16.8, fontPoints: 12, overflowPoints: 18 }] }] };
  const receipt = fitDocument(() => shortened ? { measured: true, ready: true, faults: [], pages: [] } : structuredClone(overflow));
  assert.equal(sheet.dataset.fit, undefined);
  assert.equal(receipt.fitting.typeShrunk, false);
  // A fixed-only probe is distinct from the generated page in the real browser.
  receipt.pages[0].fixedOnlyOverflow = false;
  const text = { pagination: { pages: ['A long paragraph.', 'The second page.'] } };
  const result = await fitPrintedText({ text, measure: async () => shortened ? { measured: true, ready: true, faults: [], pages: [] } : receipt,
    shorten: async (current, plan) => { assert.equal(plan.page, 'story'); assert.equal(plan.lockedPage, 'The second page.'); shortened = true; return current; } });
  assert.equal(result.receipt.ready, true);
  assert.equal(sheet.dataset.fit, undefined);
});

test('parent furniture recovery runs only for overflow and still rejects an overfull fixed guide', async t => {
  const previous = globalThis.document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  for (const scenario of ['fits', 'recovers', 'still-full']) {
    const probe = { style: {}, querySelector: () => null, querySelectorAll: () => [], remove() {} };
    const sheet = { dataset: { page: 'for-you' }, querySelector: selector => selector === '.sources' ? {} : null, cloneNode: () => probe };
    globalThis.document = { querySelectorAll: () => [sheet], body: { append() {} } };
    const receipt = fitDocument(() => {
      const ready = scenario === 'fits' || scenario === 'recovers' && sheet.dataset.notesFit === 'spacing';
      return { measured: true, ready, faults: ready ? [] : ['Fixed source notes overflow'], pages: [{ page: 'for-you', overflowPoints: ready ? 0 : 60, elements: [
        { generated: 'noticedFeeling', text: 'upset', card: 'parent-card', cardIndex: 0, overflowPoints: 0 },
        { generated: null, text: 'Complete fixed source notes', card: 'sources', cardIndex: 3, overflowPoints: ready ? 0 : 60 },
      ] }] };
    });
    assert.equal(sheet.dataset.notesFit, scenario === 'fits' ? undefined : 'spacing', scenario);
    assert.equal(sheet.dataset.fit, undefined, 'Spacing recovery precedes generated shortening and generic compacting.');
    assert.equal(receipt.fitting.typeShrunk, false);
    assert.equal(receipt.fitting.textHidden, false);
    assert.equal(receipt.ready, scenario !== 'still-full');
    if (scenario === 'still-full') {
      assert.deepEqual(shorteningPlan(receipt, {}), []);
      await assert.rejects(fitPrintedText({ text: {}, measure: async () => receipt, shorten() { assert.fail('Fixed notes cannot be rewritten.'); } }), /printed_layout_overflow/);
    }
  }
});

test('every parent page groups complete citations, leaves handwriting space, and shares science limits', () => {
  for (const move of moves) {
    const pages = pagesFor(move), page = pages['for-you.html'], science = scienceFor(move);
    assert.match(page, /\.source\{[^}]*break-inside:avoid/);
    assert.match(page, /\.replay \.handwrite\{min-height:28pt/);
    assert.match(page, /<p class="handwrite">My move: ______<\/p>/);
    for (const source of printedSourcesFor(move)) {
      const block = page.match(new RegExp(`<div class="source" data-source-group="[^"]*sources\\.${source.recordIndex}\\.limitation[^"]*">([\\s\\S]*?)<\\/div>`))?.[1];
      assert.ok(block, `${move.id} source ${source.recordIndex}`);
      for (const part of [source.fitLabel, sourceReaderLimitation(source), source.doi ? `DOI ${source.doi}` : `PubMed ${source.pubmed}`]) assert.ok(visibleText(block).includes(part), part);
    }
    assert.ok(visibleText(page).includes(guideReaderClaim(move.id, science.claim)), move.id);
    const printed = page.split('<aside')[0];
    assert.equal((printed.match(/data-short-notes="exact-v2"/g) ?? []).length, 1, move.id);
    assert.doesNotMatch(printed, /What we do not know:|Want a paper card\?|space, comfort/);
    assert.ok(printed.includes('What research says:') && printed.includes('Read more:'), move.id);
    assert.ok(visibleText(page).includes(guideReaderLimitation(move.id, science.limitation)), move.id);
    assert.ok(visibleText(pages['try.html']).includes(`Another way to try: ${backupActionFor(move)}`));
    assert.equal(verifyOwnedWords(pages, move), true);
  }
});

test('a replay checkbox overflow shortens its own generated cue', () => {
  const receipt = { measured: true, ready: false, pages: [{ page: 'for-you', elements: [
    { generated: 'noticedFeeling', text: 'frustrated', bounds: { h: 12 }, fontPoints: 10, linePoints: 12, cardIndex: 0, overflowPoints: 0 },
    { generated: 'replayCue', text: 'A long cue fills the back of the replay card.', bounds: { h: 24 }, fontPoints: 10, linePoints: 12, cardIndex: 2, overflowPoints: 0 },
    { generated: null, text: 'Used it for real', bounds: { h: 12 }, fontPoints: 10, linePoints: 12, cardIndex: 2, overflowPoints: 8 },
  ] }] };
  assert.deepEqual(shorteningPlan(receipt, {})[0].fields, ['replayCue']);
});
