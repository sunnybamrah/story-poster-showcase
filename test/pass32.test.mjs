import { sourceReaderLimitation, guideReaderLimitation } from '../app/reader-notes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { moves } from '../server/files.js';
import { makePages, combinedKitHTML, printedText, visibleText, verifyOwnedWords } from '../server/layout.js';
import { parentSpokenLines, parentAcceptance, evidenceLabelFor, scienceFor } from '../server/format.js';
import { printedSourcesFor } from '../server/kit-editorial.js';
import { validateStory } from '../server/story.js';
import { STORY_SCIENCE_RULES } from '../server/story-rules.js';
import { buildStoryRequest, buildStoryCheckRequest } from '../server/requests.js';
import { kitText } from './kit-text-fixture.mjs';
import { family, sentences } from './fixture.mjs';

const pagesFor = move => {
  const text = kitText(move); text.pagination = validateStory(text).pagination;
  return makePages(move, text);
};
const luminance = hex => hex.match(/[0-9a-f]{2}/gi).map(value => parseInt(value, 16) / 255)
  .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  .reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
const contrast = (a, b) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
};

test('pass 32: light, dark and print palettes keep text readable when heading colors change', () => {
  const html = pagesFor(moves[0])['for-you.html'];
  const selectors = [':root', 'html[data-theme=dark]', 'html[data-theme],:root'];
  for (const selector of selectors) {
    const start = html.indexOf(`${selector}{`);
    assert.ok(start >= 0, selector);
    const declaration = html.slice(start, html.indexOf('}', start));
    const tokens = Object.fromEntries([...declaration.matchAll(/--([\w-]+):(#\w{6})/g)].map(match => [match[1], match[2]]));
    for (const surface of ['paper', 'card', 'green-tint', 'coral-tint', 'orange-tint', 'badge']) {
      assert.ok(contrast(tokens.ink, tokens[surface]) >= 7, `${selector}: ink on ${surface}`);
    }
    for (const surface of ['card', 'paper']) for (const rule of ['border', 'rule']) {
      assert.ok(contrast(tokens[rule], tokens[surface]) >= 3, `${selector}: ${rule} on ${surface}`);
    }
    assert.ok(contrast(tokens.green, tokens.paper) >= 4.5, `${selector}: Try It heading`);
  }
});

test('pass 32: every parent card has four spoken lines and keeps directions in its notes', () => {
  for (const move of moves) {
    const pages = pagesFor(move), page = pages['for-you.html'];
    const card = page.match(/data-card="parent-card">([\s\S]*?)<\/section>/)?.[1];
    const lines = [...card.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(match => visibleText(match[1]));
    assert.deepEqual(lines, parentSpokenLines(move, kitText(move).noticedFeeling), move.id);
    assert.equal(lines.length, 4);
    assert.ok(lines[2].startsWith('Want to try '));
    assert.doesNotMatch(visibleText(card), /Accept no|The child may|Offer a clue|Afterwards:/);
    assert.ok(!printedText(page).includes(parentAcceptance));
    assert.ok(visibleText(page.split('<aside class="parent-notes">')[1]).includes(parentAcceptance));
    assert.equal((combinedKitHTML(pages).match(/<main\b/g) ?? []).length, 5);
    assert.equal(verifyOwnedWords(pages, move), true);
  }
  assert.equal(parentSpokenLines(moves[0], 'Left out')[0], 'I noticed you looked left out. That makes sense.');
});

test('pass 32: plain fit labels preserve all four classifications and source limitations', () => {
  const labels = { DIRECT: 'Children, same skill', ADJACENT: 'Related child research', MECHANISM: 'How it may work', 'ADULT ONLY': 'Studied in adults' };
  for (const [label, words] of Object.entries(labels)) assert.equal(evidenceLabelFor(label), words);
  assert.throws(() => evidenceLabelFor('UNREVIEWED'), /Unknown evidence/);
  for (const move of moves) {
    const before = structuredClone(move), page = pagesFor(move)['for-you.html'];
    for (const source of printedSourcesFor(move)) {
      const block = page.match(new RegExp(`<p data-source="${source.recordIndex}"([^>]*)>([\\s\\S]*?)<\\/p>`));
      assert.ok(block[1].includes(`data-evidence-fit="${source.fitLabel}"`));
      const prose = visibleText(block[2]);
      assert.ok(prose.includes(source.fitLabel));
      for (const value of [source.year, source.doi ?? source.pubmed]) assert.ok(prose.includes(String(value)));
      const group = page.match(new RegExp(`<div class="source" data-source-group="[^"]*sources\\.${source.recordIndex}\\.limitation[^"]*">([\\s\\S]*?)<\\/div>`))?.[1];
      assert.ok(group && visibleText(group).includes(sourceReaderLimitation(source)));
    }
    const notes = visibleText(page.split('<aside class="parent-notes">')[1]);
    for (const source of move.sources) assert.ok(notes.includes(source.fitLabel));
    assert.deepEqual(move, before);
  }
});

test('pass 32: writer and judge share the plain science rule and the complete unchanged record', () => {
  for (const move of moves) {
    const writer = buildStoryRequest(family, sentences[0], { lockedMoveId: move.id });
    const judge = buildStoryCheckRequest(kitText(move), move, { record: family });
    for (const request of [writer, judge]) {
      assert.ok(request.instructions.includes(STORY_SCIENCE_RULES));
      assert.equal(request.store, false);
      const payload = JSON.parse(request.input[0].content);
      const selected = payload.move ?? payload.moves?.find(record => record.id === move.id);
      assert.ok(selected, move.id);
      assert.deepEqual(selected.science, scienceFor(move));
    }
  }
});
