import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fitPrintedText, shorteningPlan, fitDocument, measureDocument } from '../server/layout-fit.js';
import { moves, readJSON } from '../server/files.js';
import { makePages, combinedKitHTML } from '../server/layout.js';
import { posterTypePlan } from '../server/poster-template.js';
import { buildPosterRequest } from '../server/requests.js';
import { shortenLayoutText, validateStory } from '../server/story.js';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { kitText } from './kit-text-fixture.mjs';
import { offlineTransport, offlineExports, textAnswer, run5 } from './offline-kit-fixture.mjs';
import { family, sentences } from './fixture.mjs';
import { worstCaseReport, replaySourceColumns } from './printed-capacity.mjs';

const fixture = readJSON(new URL('./fixtures/pass25-overflow.json', import.meta.url));
const temp = t => { const d = mkdtempSync(join(tmpdir(), 'pass25-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const pass = { measured: true, ready: true, fixture: true, faults: [] };
const overflow = (page, field, extra = {}) => ({ measured: true, ready: false, faults: [`${page}.${field} exceeds its card by 18.00 points`], pages: [{ page, elements: [{ generated: field, field, text: 'One two three four five six seven eight.', bounds: { h: 24 }, fontPoints: 12, linePoints: 16.32, overflowPoints: 18, ...extra }] }] });

test('all generated page classes get a measured word target and fixed poster words never go to the writer', () => {
  const text = kitText(); text.pagination = validateStory(text).pagination;
  for (const [page, field] of [['story', 'story'], ['story-2', 'story'], ['try', 'tinyTryOptions[0].text'], ['for-you', 'replayCue']]) {
    const plan = shorteningPlan(overflow(page, field), text)[0];
    assert.equal(plan.page, page); assert.deepEqual(plan.fields, [field]); assert.equal(plan.cutWords, 7);
    if (field === 'story') assert.equal(plan.lockedPage, text.pagination.pages[1 - plan.pageIndex]);
  }
  assert.deepEqual(shorteningPlan(overflow('poster', null), text), []);
  const fixed = overflow('for-you', null, { card: 'sources' }); fixed.pages[0].fixedOnlyOverflow = true;
  assert.deepEqual(shorteningPlan(fixed, text), []);
});

test('two shortening tries remeasure, preserve every receipt and only the last overflow can stop', async () => {
  const text = kitText(); let measured = 0, shortened = 0; const saved = [];
  const result = await fitPrintedText({ text, measure: async () => ++measured === 3 ? pass : overflow('for-you', 'replayCue'),
    shorten: async current => { shortened++; return { ...current, replayCue: 'My paws tense.' }; }, save: (r, n) => saved.push([r, n]) });
  assert.equal(shortened, 2); assert.equal(measured, 3); assert.equal(saved.length, 3); assert.equal(result.receipt.ready, true);
  assert.equal(result.text.story, text.story); assert.equal(result.text.tagline, text.tagline);
  measured = 0; shortened = 0;
  await assert.rejects(fitPrintedText({ text, measure: async () => { measured++; return overflow('try', 'feelFirst'); }, shorten: async current => { shortened++; return current; } }), /printed_layout_overflow:.*18.00 points/);
  assert.equal(shortened, 2); assert.equal(measured, 3);
});

test('rejected shortening answers use the remaining try and never become accepted text', async () => {
  let tries = 0; const saved = [], text = kitText();
  await assert.rejects(fitPrintedText({ text, measure: async () => overflow('for-you', 'replayCue'), shorten: async () => { tries++; throw Error('Story rejected after 1 attempt(s): locked field changed'); }, save: r => saved.push(r) }), /18.00 points/);
  assert.equal(tries, 2); assert.equal(saved.filter(r => r.shorteningRejected).length, 2);
});

test('multiple overflowing pages are remeasured between changes so the next page lock is current', async () => {
  const text = { ...kitText(), pagination: { pages: ['First page.', 'Second page.'] } }; let changes = 0;
  const result = await fitPrintedText({ text, measure: async current => changes === 2 ? pass : { measured: true, ready: false, faults: ['18.00 points'], pages: [overflow('story', 'story').pages[0], overflow('story-2', 'story').pages[0]].slice(changes) },
    shorten: async (current, plan) => {
      if (changes === 1) assert.equal(plan.lockedPage, 'Short first.');
      changes++;
      return { ...current, pagination: { pages: changes === 1 ? ['Short first.', 'Second page.'] : ['Short first.', 'Short second.'] } };
    } });
  assert.equal(changes, 2); assert.equal(result.receipt.ready, true);
});

test('browser fitting balances the available card, then compacts only overflowing sheets', t => {
  const previousDocument = globalThis.document, previousStyle = globalThis.getComputedStyle;
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; if (previousStyle === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = previousStyle; });
  const body = { style: {}, closest: () => ({ getBoundingClientRect: () => ({ height: 440 }), querySelector: () => ({ getBoundingClientRect: () => ({ height: 40 }) }) }) };
  const sheets = ['poster', 'story', 'story-2', 'try', 'for-you'].map(page => ({ dataset: { page }, querySelector: () => page === 'for-you' ? body : null }));
  globalThis.document = { querySelectorAll: () => sheets };
  globalThis.getComputedStyle = () => ({ borderTopWidth: '1' });
  const result = fitDocument(() => {
    const pages = sheets.map(sheet => ({ page: sheet.dataset.page, elements: [{ overflowPoints: sheet.dataset.page === 'story' && !sheet.dataset.fit ? 12 : 0 }] }));
    return { measured: true, ready: pages.every(page => !page.elements[0].overflowPoints), faults: [], pages };
  });
  assert.equal(body.style.height, '398px'); assert.equal(sheets[1].dataset.fit, 'compact');
  assert.ok(sheets.filter((_, i) => i !== 1).every(sheet => sheet.dataset.fit === undefined));
  assert.equal(result.ready, true); assert.equal(result.fitting.typeShrunk, false);
});

test('unmeasured geometry and large word totals alone do not buy shortening or stop', async () => {
  for (const receipt of [{ measured: false, ready: false, reason: 'Browser unavailable' }, pass]) {
    const result = await fitPrintedText({ text: kitText(moves[0], { wordCount: 2000 }), measure: async () => receipt, shorten: () => assert.fail('No measured overflow') });
    assert.equal(result.receipt, receipt);
  }
});

test('all 14 moves fit every fixed poster card within approved type and writing floors', () => {
  for (const move of moves) {
    const text = kitText(move), plan = posterTypePlan(move, text);
    for (const card of Object.values(plan.cards)) {
      for (const block of [card.heading, card.body ?? card.backup]) { assert.ok(block.fits, move.id); assert.ok(block.fontPoints >= 12); }
      if (card.handwritingHeight) assert.ok(card.handwritingHeight >= 24);
    }
    // New posters are composed by the drawing model: print limits in pixels, no fixed card plan.
    const prompt = buildPosterRequest(family, move, sentences[0], text).prompt;
    assert.match(prompt, /never below 26, so every word prints at 12 points or more/); assert.doesNotMatch(prompt, /Code-fit card plan|Target layout rectangles/);
  }
});

test('the five page shells and combined export share fitting and generated ownership, in either theme', () => {
  const text = kitText(); text.pagination = validateStory(text).pagination;
  const pages = makePages(moves[0], text), combined = combinedKitHTML(pages);
  assert.equal((combined.match(/data-page=/g) ?? []).length, 5);
  for (const html of [...Object.values(pages), combined]) {
    assert.ok(html.includes(fitDocument.toString())); assert.ok(html.includes(measureDocument.toString()));
    assert.match(html, /data-theme=dark/); assert.match(html, /sources p\{break-inside:avoid;/);
    assert.doesNotMatch(html, /font-size:\s*(?:[0-7](?:\.|pt))/);
  }
  assert.match(pages['story.html'], /data-generated="story"/);
  assert.match(pages['try.html'], /data-generated="tinyTryOptions\[0\]\.text"/);
  assert.match(pages['for-you.html'], /data-generated="replayCue"/);
});

test('saved source-overflow measurement can replay with a current-rule fixture without a writer call', async t => {
  const directory = temp(t), memory = createMemory(join(directory, 'family.json')); memory.store(family);
  const text = kitText(moves[0]);
  const transport = offlineTransport(t, directory, request => request.stage === 'story' ? textAnswer(text) : undefined);
  let receipts = 0;
  const result = await createKit(transport, memory, sentences[0], { kit: 1, directory, stopBeforePictures: true, exports: { ...offlineExports(), async measureLayout(path) {
    receipts++; assert.match(readFileSync(path, 'utf8'), /source\{[^}]*break-inside:avoid/);
    return replaySourceColumns(fixture.receipt);
  } } });
  assert.equal(result.layoutFit.ready, true); assert.equal(result.layoutFit.recordedModel, true); assert.equal(receipts, 1);
  assert.deepEqual(transport.calls.map(c => c.stage), ['story', 'story-check']);
  assert.equal(result.story, text.story); assert.equal(result.tagline, text.tagline);
});

test('page-scoped shortening has a new judge, saved answers and a resume that buys no text', async t => {
  const directory = temp(t), memory = createMemory(join(directory, 'family.json')); memory.store(family);
  const transport = offlineTransport(t, directory, request => request.stage === 'story-correction' ? textAnswer({ story: run5.story, replayCue: 'My paws tense.' }) : undefined);
  let measurements = 0;
  const exporters = { ...offlineExports(), measureLayout: async () => ++measurements === 1 ? overflow('for-you', 'replayCue') : pass };
  const result = await createKit(transport, memory, sentences[0], { kit: 1, directory, stopBeforePictures: true, exports: exporters });
  assert.equal(result.replayCue, 'My paws tense.'); assert.equal(result.story, run5.story);
  assert.deepEqual(transport.calls.map(c => c.stage), ['story', 'story-check', 'story-correction', 'story-check']);
  const correction = JSON.parse(transport.calls[2].body.input[0].content).correction;
  assert.deepEqual(correction.fields, ['replayCue']); assert.match(correction.lengthRule, /18.00 points/);
  assert.ok(existsSync(join(directory, 'story-attempt-2.json'))); assert.ok(existsSync(join(directory, 'story-check-2.json')));
  assert.equal(readJSON(join(directory, 'checkpoint.json')).stages.text.replayCue, result.replayCue);
  assert.equal(readJSON(join(directory, 'checkpoint.json')).fitAttempts['for-you'], 1);
  const calls = transport.calls.length;
  await createKit(transport, memory, sentences[0], { kit: 1, directory, stopBeforePictures: true, resume: true, exports: exporters });
  assert.equal(transport.calls.length, calls);
});

test('a resumed overflow cannot buy a third shortening and retains the final measurement', async t => {
  const directory = temp(t), memory = createMemory(join(directory, 'family.json')); memory.store(family);
  const transport = offlineTransport(t, directory, request => request.stage === 'story-correction' ? textAnswer({ story: run5.story, replayCue: 'My paws tense.' }) : undefined);
  const exporters = { ...offlineExports(), measureLayout: async () => overflow('for-you', 'replayCue') };
  await assert.rejects(createKit(transport, memory, sentences[0], { kit: 1, directory, stopBeforePictures: true, exports: exporters }), /printed_layout_review_required:/);
  assert.equal(readJSON(join(directory, 'checkpoint.json')).fitAttempts['for-you'], 2);
  const calls = transport.calls.length;
  assert.equal(readJSON(join(directory, 'checkpoint.json')).savedLayoutRevision.status, 'review');
  await assert.rejects(createKit(transport, memory, sentences[0], { kit: 1, directory, stopBeforePictures: true, resume: true, exports: exporters }), /printed_layout_review_required:/);
  assert.equal(transport.calls.length, calls);
  assert.equal(readJSON(join(directory, 'text-layout-fit.json')).faults[0], 'for-you.replayCue exceeds its card by 18.00 points');
});

test('chapter shortening locks the other saved page, every bubble, practice passage and rhyme', async t => {
  const directory = temp(t), prior = kitText(); prior.pagination = validateStory(prior).pagination; prior.printedFitPages = ['try'];
  const candidate = { ...prior, story: prior.story.replace('test test test', 'test') };
  const transport = offlineTransport(t, directory, request => request.stage === 'story-rewrite' ? textAnswer(candidate) : undefined);
  const plan = { page: 'story', pageIndex: 0, fields: ['story'], overflowPoints: 15, cutWords: 12, pageText: prior.pagination.pages[0], lockedPage: prior.pagination.pages[1] };
  const result = await shortenLayoutText(transport, family, sentences[0], prior, plan, { kit: 1 });
  assert.equal(result.pagination.pages[1], prior.pagination.pages[1]); assert.deepEqual(result.panelLines, prior.panelLines);
  assert.deepEqual(result.printedFitPages, ['try', 'story']); assert.deepEqual(prior.printedFitPages, ['try']);
  assert.equal(result.tagline, prior.tagline); assert.ok(result.story.includes(moves[0].practiceScript.replaceAll('[name]', 'Pip')));
  const bad = { ...candidate, story: candidate.story.replace('I made a start.', 'I made a start. Another ending.') };
  const badTransport = offlineTransport(t, directory, request => request.stage === 'story-rewrite' ? textAnswer(bad) : undefined);
  await assert.rejects(shortenLayoutText(badTransport, family, sentences[0], prior, plan, { kit: 1 }), /layout_shortening_changed_other_page/);
  const changedPractice = { ...candidate, story: candidate.story.replace(moves[0].practiceScript.replaceAll('[name]', 'Pip'), 'I name one word.') };
  const fixedTransport = offlineTransport(t, directory, request => request.stage === 'story-rewrite' ? textAnswer(changedPractice) : undefined);
  await assert.rejects(shortenLayoutText(fixedTransport, family, sentences[0], prior, plan, { kit: 1 }), /layout_shortening_changed_fixed_text/);
  assert.deepEqual(prior.printedFitPages, ['try']);
  assert.equal(fixedTransport.calls.filter(c => c.stage === 'story-check').length, 0);
});

test('worst fixed records and longest saved generated fields have an offline per-page receipt', () => {
  const report = worstCaseReport();
  assert.equal(report.moves, 14); assert.equal(report.measured, false);
  assert.deepEqual(report.pages.map(p => p.page), ['poster', 'story', 'story-2', 'try', 'for-you']);
  assert.ok(report.pages.every(p => p.fixedMargin >= 0), JSON.stringify(report.pages));
});
