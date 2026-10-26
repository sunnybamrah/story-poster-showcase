import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fitPrintedText, measureDocument, shorteningPlan } from '../server/layout-fit.js';
import { readJSON, saveJSON } from '../server/files.js';
import { createMemory } from '../server/memory.js';
import { createKit } from '../server/kit.js';
import { family, sentences } from './fixture.mjs';
import { offlineExports, offlineTransport, textAnswer } from './offline-kit-fixture.mjs';

const saved = readJSON(new URL('./fixtures/pass29-overflow.json', import.meta.url));
const pass = { measured: true, ready: true, faults: [], pages: [] };

test('saved failed run requests measured story and Try It cuts before any layout stop', async () => {
  const plans = shorteningPlan(saved.receipt, saved.text);
  assert.deepEqual(plans.map(plan => [plan.page, plan.cutWords]), [['story', 127], ['story-2', 137], ['try', 19]]);
  assert.ok(saved.receipt.pages.every(page => page.fixedOnlyOverflow), 'Replay the bad fixed-only flags from the saved run.');
  for (const plan of plans.slice(0, 2)) {
    assert.equal(plan.pageText, saved.text.pagination.pages[plan.pageIndex]);
    assert.equal(plan.lockedPage, saved.text.pagination.pages[1 - plan.pageIndex]);
    assert.deepEqual(plan.fields, ['story']);
  }
  assert.deepEqual(plans[2].fields, ['feelFirst', 'tinyTryOptions[0].text', 'tinyTryOptions[1].text', 'tinyTryOptions[2].text', 'whereElse.place']);
  const requested = [], measured = new Map(), receipts = [];
  const result = await fitPrintedText({ text: saved.text,
    measure: async () => {
      const pages = saved.receipt.pages.filter(page => (measured.get(page.page) ?? 0) < 2);
      return pages.length ? { ...saved.receipt, pages } : pass;
    },
    shorten: async (current, plan, attempt) => { requested.push([plan.page, plan.cutWords, attempt]); measured.set(plan.page, attempt); return current; },
    save: receipt => receipts.push(receipt),
  });
  assert.equal(result.receipt.ready, true);
  assert.deepEqual(requested, [['story', 127, 1], ['story', 127, 2], ['story-2', 137, 1], ['story-2', 137, 2], ['try', 19, 1], ['try', 19, 2]]);
  assert.equal(receipts.length, 7);
});

test('resume of the saved accepted story buys its measured shortening and judge only', async t => {
  mkdirSync(resolve('test/out'), { recursive: true });
  const directory = mkdtempSync(resolve('test/out/pass29-shortening-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const memory = createMemory(join(directory, 'family.json')); memory.store(family);
  saveJSON(join(directory, 'checkpoint.json'), { version: 1, kit: 1, tonight: sentences[0], recordAtStart: memory.exportRecord(), stages: { text: { ...saved.text, ready: true, checks: [] } } });
  const candidate = { ...saved.text, story: saved.text.story.replace('Dee stops beside the table. Pip pushes his bag under it with his foot, but the strap catches. He kicks again. The bag stays put.', 'Dee waits beside the table. Pip kicks his caught bag strap.') };
  const transport = offlineTransport(t, directory, request => request.stage === 'story-rewrite' ? textAnswer(candidate) : undefined);
  let measurements = 0;
  const result = await createKit(transport, memory, sentences[0], { kit: 1, directory, resume: true, stopBeforePictures: true,
    exports: { ...offlineExports(), measureLayout: async () => ++measurements === 1 ? { ...saved.receipt, pages: saved.receipt.pages.slice(0, 1) } : pass } });
  assert.equal(result.layoutFit.ready, true);
  assert.deepEqual(transport.calls.map(call => call.stage), ['story-rewrite', 'story-check']);
  const request = JSON.parse(transport.calls[0].body.input[0].content);
  assert.equal(request.correction.printedFit.cutWords, 127);
  assert.equal(request.correction.printedFit.overflowPoints, 284.00390625);
  assert.equal(request.correction.printedFit.lockedPage, saved.text.pagination.pages[1]);
  assert.equal(readJSON(join(directory, 'checkpoint.json')).fitAttempts.story, 1);
});

test('empty generated ranges in an offscreen probe do not become fixed overflow', t => {
  const previousDocument = globalThis.document, previousStyle = globalThis.getComputedStyle;
  t.after(() => { globalThis.document = previousDocument; globalThis.getComputedStyle = previousStyle; });
  const empty = { textContent: '', getBoundingClientRect: () => ({ x: -10000, y: 0, width: 400, height: 0 }) };
  const sheet = { dataset: { page: 'story' }, getBoundingClientRect: () => ({ x: -10000, y: 0, width: 720, height: 960 }), querySelector: () => null, querySelectorAll: selector => selector === '.card' || selector === '.source' ? [] : [empty] };
  globalThis.document = { fonts: { status: 'loaded' }, querySelectorAll: () => [sheet], createRange: () => assert.fail('There is no ink to measure.') };
  globalThis.getComputedStyle = () => assert.fail('Empty text has no typography to measure.');
  const receipt = measureDocument();
  assert.equal(receipt.ready, true); assert.equal(receipt.pages[0].overflowPoints, 0); assert.deepEqual(receipt.pages[0].elements, []);
});

test('a fixed footer alone routes shortening to generated words on every page class', () => {
  for (const [page, field] of [['story', 'story'], ['story-2', 'story'], ['try', 'feelFirst'], ['for-you', 'replayCue']]) {
    const receipt = { measured: true, ready: false, pages: [{ page, footerOverflowPoints: 18, elements: [{ generated: field, text: 'Some generated words on this page.', bounds: { h: 32 }, linePoints: 16, overflowPoints: 0 }] }] };
    const plan = shorteningPlan(receipt, saved.text)[0];
    assert.equal(plan.page, page); assert.deepEqual(plan.fields, [field]); assert.equal(plan.cutWords, 4);
  }
});

test('a resume starts with saved page attempts and never buys a third shortening', async () => {
  const pages = saved.receipt.pages.slice(0, 2), attempts = [];
  const result = await fitPrintedText({ text: saved.text, priorAttempts: { story: 2, 'story-2': 1 },
    measure: async () => attempts.length ? pass : { ...saved.receipt, pages },
    shorten: async (current, plan, attempt) => { attempts.push([plan.page, attempt]); return current; },
  });
  assert.equal(result.receipt.ready, true); assert.deepEqual(attempts, [['story-2', 2]]);
});

test('bubble passages that alone prevent a fit may shorten only on their own story page before art', async () => {
  const words = count => Array(count).fill('word').join(' ');
  for (const panelPages of [[0, 1, 0, 1], undefined]) {
    const text = { pagination: { pages: [words(100), words(100)], ...(panelPages ? { panelPages } : {}) }, panelLines: Array.from({ length: 4 }, () => ({ line: words(80) })) };
    const receipt = { measured: true, ready: false, pages: ['story', 'story-2'].map(page => ({ page, elements: [{ generated: 'story', text: words(100), bounds: { h: 100 }, linePoints: 16.8, fontPoints: 12, overflowPoints: 60 }] })) };
    const plans = shorteningPlan(receipt, text);
    const local = panelPages ? [[0, 2], [1, 3]] : [[0, 1], [2, 3]];
    plans.forEach((plan, index) => {
      assert.equal(plan.cutWords, 62);
      assert.deepEqual(plan.fields, ['story', ...local[index].map(i => `panelLines[${i}].line`)]);
      assert.equal(plan.lockedPage, text.pagination.pages[1 - index]);
    });
    assert.ok(shorteningPlan(receipt, text, { allowBubbleShortening: false }).every(plan => plan.fields.length === 1 && plan.fields[0] === 'story'));
    let shortened = false;
    const result = await fitPrintedText({ text, allowBubbleShortening: false, measure: async () => shortened ? pass : receipt,
      shorten: async (current, plan) => { assert.deepEqual(plan.fields, ['story']); shortened = true; return current; } });
    assert.equal(result.receipt.ready, true);
  }
});
