import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moves } from '../server/files.js';
import { checkMoves } from '../content/check-moves.mjs';
import { previewPages, visibleText, verifyOwnedWords } from '../server/layout.js';
import { parentChoice, parentAcceptance, parentGuidance, talkOffer, replayTransfer, replayQuestions, replayRule, visibleWords, posterBoxes } from '../server/format.js';
import { createLocalKitRecord, kitStorageKey, wallQuestion, wallChoices, wallInstructions } from '../web/interactive.js';
import { renderInteractiveHTML } from '../server/interactive-view.js';
import { createMemory } from '../server/memory.js';
import { buildStoryRequest, buildPictureRequest, buildPictureCheckRequest, buildPosterRequest, buildPanelRequest, buildWordCheckRequest, STORY_RULES } from '../server/requests.js';
import { buildInteractiveContent } from '../server/interactive-assets.js';
import { makePosterMap } from '../server/poster-template.js';
import { family, sentences, savedKit } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';

const storageFixture = () => { const data = new Map(); return { data, getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }; };
const identity = { profileId: 'parent-one', kitId: 'kit-one', version: 'v1' };

test('FORMAT v6 parent choice, optional talk, replay transfer and guidance appear verbatim', () => {
  for (const move of moves) {
    const pages = previewPages(move);
    assert.ok(visibleText(pages['for-you.html']).includes(talkOffer));
    const parent = visibleText(pages['for-you.html']);
    for (const text of [parentChoice, parentAcceptance, parentGuidance, replayTransfer, replayRule, ...replayQuestions]) assert.ok(parent.includes(text), text);
    assert.doesNotMatch(parent, /Want this one turned into a story|Where else could this move work\?/);
    assert.ok(parent.indexOf('That makes sense.') < parent.indexOf(parentChoice));
    assert.throws(() => verifyOwnedWords({ ...pages, 'for-you.html': pages['for-you.html'].replace(parentGuidance, '') }, move), /guidance missing/);
  }
});

test('factual mode uses supplied facts and code owns the REAL or MADE UP label', () => {
  for (const rule of ['use only the supplied or confirmed events and exact quotations', 'no invented dialogue, thoughts, actions, outcome', 'Code labels it REAL', 'Code labels it MADE UP', 'Do not add either label inside the story itself']) assert.ok(STORY_RULES.includes(rule), rule);
});

test('the public 14-guide edition keeps science claims and source limits without edit-history fields', () => {
  assert.equal(checkMoves().status, 'PASS');
  assert.equal(moves.length, 14);
  for (const move of moves) {
    assert.equal(move.kidScienceLine.match(/[.!?]/g)?.length, 2);
    assert.match(move.kidScienceLine, /^In .+ (?:helped|was linked with) .+\. (?:This |We need stronger tests)|^We do not yet have a test of this move with children\./);
    assert.doesNotMatch(move.kidScienceLine, /BEST GUESS|DIRECT|ADJACENT|MECHANISM|ADULT ONLY/);
    assert.doesNotMatch(move.whereItCameFromShort, /research:|review:|No single inventor/);
    assert.ok(move.sources.length > 0 && move.sources.every(source => source.doi || source.pubmed));
    assert.ok(move.source.limitation.trim());
    const history = Object.keys(move).filter(key => /Original$|BeforePass|Review$|WrittenByCodex$|ChosenByCodex$|^draftStatus$/.test(key) && !['kidScienceLineReview', 'actionLineWrittenByCodex', 'bodyActionWrittenByCodex', 'shortLineWrittenByCodex', 'searchPhraseWrittenByCodex'].includes(key));
    assert.deepEqual(history, []);
    assert.equal(posterBoxes(move).find(box => box.id === 'source').text, `${move.whereItCameFromShort} Search: ${move.searchPhrase}`);
  }
  assert.ok(moves.every(move => /\b\d{4}\.$/.test(move.whereItCameFromShort)));
});

test('writer rules 14 to 18 stay out of generated child and parent pages', () => {
  for (const html of Object.values(previewPages(moves[0]))) assert.doesNotMatch(visibleText(html), /Before searching, name the age group|Verify each citation against|Record the size and uncertainty|Judge DIRECT against/);
});

test('child wall choice is explicit, stored in a kit record, and isolated by profile, kit and version', () => {
  const storage = storageFixture();
  const state = createLocalKitRecord(identity, storage);
  assert.equal(state.record.wallChoice, null);
  assert.equal(storage.data.size, 0);
  for (const choice of wallChoices) {
    assert.equal(state.choose(choice), true);
    assert.deepEqual(JSON.parse(storage.getItem(kitStorageKey(identity))), { ...identity, wallChoice: choice });
    assert.equal(createLocalKitRecord(identity, storage).record.wallChoice, choice);
  }
  for (const key of ['profileId', 'kitId', 'version']) assert.equal(createLocalKitRecord({ ...identity, [key]: 'other' }, storage).record.wallChoice, null);
  assert.throws(() => state.choose('maybe'), /Unknown wall choice/);
  const unavailable = createLocalKitRecord(identity);
  assert.equal(unavailable.choose('Yes'), false);
  assert.match(unavailable.message, /could not save/);
  storage.setItem(kitStorageKey(identity), '{broken');
  assert.equal(createLocalKitRecord(identity, storage).record.wallChoice, null);
});

test('hero sheet and kit screen each have the exact wall-choice line, outside printed art', () => {
  const text = kitText();
  const content = buildInteractiveContent({ move: moves[0], kit: text, version: 'v1' });
  const bundle = { ...identity, content, map: makePosterMap('v1', 'a'.repeat(64)), image: { url: 'poster.png', width: 612, height: 792 }, pdf: { url: 'poster.pdf' } };
  const html = renderInteractiveHTML(bundle);
  const line = `${wallQuestion} ${wallChoices.join(' / ')}`;
  const main = html.slice(html.indexOf('<body>'), html.indexOf('</main>'));
  const hero = html.match(/<template id="section-hero">([^]*?)<\/template>/)[1];
  for (const area of [main, hero]) {
    assert.ok(visibleText(area).includes(line));
    assert.ok(visibleText(area).includes(wallInstructions));
    for (const choice of wallChoices) assert.ok(area.includes(`data-wall-choice="${choice}"`));
  }
  assert.ok(!JSON.stringify(content.printed).includes(wallQuestion));
});

test('saved family kit wall choices never change any model request', t => {
  const directory = mkdtempSync(join(tmpdir(), 'pass10-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const memory = createMemory(join(directory, 'family.json'));
  memory.store({ ...family, familyContext: '', pastKits: [savedKit()] });
  const move = { ...moves[0], positiveAction: 'Name it.', kidScienceLine: 'A test claim.', whereItCameFromShort: 'Nook research, 2018.', searchPhrase: 'Nook research' };
  const text = kitText(move);
  const requests = record => [
    buildStoryRequest(record, sentences[0], { allowRepeat: true }),
    buildPictureRequest(record, move, '', { hero: true }),
    buildPictureCheckRequest(record, move, '', 'data:image/png;base64,AA=='),
    buildPosterRequest(record, move, '', text),
    buildPanelRequest(record, move, '', text.panelLines[0]),
    buildWordCheckRequest(record, move, '', 'data:image/png;base64,AA=='),
  ];
  const before = requests(memory.exportRecord());
  for (const choice of wallChoices) {
    memory.setWallChoice(1, choice);
    assert.equal(createMemory(join(directory, 'family.json')).exportRecord().pastKits[0].wallChoice, choice);
    assert.deepEqual(requests(memory.exportRecord()), before);
    assert.doesNotMatch(JSON.stringify(before), /wallChoice|Happy for a friend|Keep it off the wall/);
  }
  assert.throws(() => memory.setWallChoice(1, 'maybe'), /Invalid wall choice/);
});
