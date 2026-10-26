import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryRequest, buildStoryCheckRequest } from '../server/requests.js';
import { printedCapacity, printedLengthRule } from '../server/printed-capacity.js';
import { validateStory } from '../server/story.js';
import { writerFailureStops, hardStoryFaults } from '../server/stop-policy.js';
import { writingGuidance } from '../server/writing-guidance.js';
import { words, moves } from '../server/files.js';
import { family, sentences } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { makePages } from '../server/layout.js';

test('class 2: writer receives the editorial chapter target, ceiling and two page capacities', () => {
  const request = buildStoryRequest(family, sentences[0]);
  const payload = JSON.parse(request.input[0].content), capacity = printedCapacity(undefined, family.hero.age);
  assert.deepEqual(payload.printedCapacity, capacity);
  assert.equal(capacity.story.pages.length, 2);
  assert.ok(capacity.story.pages.every(value => Number.isInteger(value) && value > 0));
  assert.ok(capacity.story.targetWords > 0 && capacity.story.targetWords <= capacity.story.ceilingWords);
  assert.ok(request.instructions.includes(printedLengthRule(undefined, family.hero.age)));
  assert.match(request.instructions, /printedCapacity.story.targetWords/);
  assert.match(request.instructions, /printedCapacity.story.ceilingWords/);
  assert.doesNotMatch(request.instructions, /write 550 to 750|aim near 600|keep the chapter within 550/i);
});

test('class 2: chapter shortening has no minimum word count and preserves fixed passages', () => {
  const previousStory = kitText(moves[0], { wordCount: 499 });
  const layoutFit = { page: 'story', fields: ['story'], overflowPoints: 80.07, cutWords: 74, pageIndex: 0, lockedPage: 'Saved second page.' };
  const request = buildStoryRequest(family, sentences[0], { reason: 'Measured overflow', previousStory, lockedMoveId: previousStory.moveId, rewriteFields: ['story'], layoutFit });
  const correction = JSON.parse(request.input[0].content).correction;
  assert.match(correction.lengthRule, /Cut about 74 words/);
  assert.match(correction.lengthRule, /no minimum chapter word count/);
  assert.match(request.instructions, /Keep every fixed passage and the other saved chapter page exactly/);
  assert.match(request.instructions, /Keep every bubble passage exactly/);
  assert.match(request.instructions, /Keep the other saved page exactly even if the total remains above the chapter ceiling/);
  assert.doesNotThrow(() => validateStory(previousStory));
  assert.equal(hardStoryFaults.has('story_length_outside_format'), false);
  assert.equal(writerFailureStops({ code: 'story_length_outside_format', unit: 'words', measured: 499, limit: { min: 550, max: 750 }, instruction: 'Word guidance only.' }), false);
  const judge = buildStoryCheckRequest(previousStory, moves[0]);
  assert.match(judge.instructions, /Word counts are reports only/);
});

test('class 3: Try It and card capacities reach the writer and remain word count reports', () => {
  const text = kitText(), capacity = printedCapacity(text.moveId), request = buildStoryRequest(family, sentences[0]);
  assert.match(request.instructions, /printedCapacity.try/);
  assert.match(request.instructions, /Stay within each named field's writing allowance and the page total/);
  for (const page of ['try', 'for-you']) {
    assert.ok(capacity[page].totalWords > 0);
    assert.ok(Object.values(capacity[page].fields).every(value => Number.isInteger(value) && value > 0));
  }
  text.feelFirst = ['That felt hard. ' + 'moment '.repeat(capacity.try.totalWords + 1)];
  text.replayCue = 'moment '.repeat(capacity['for-you'].totalWords + 1).trim();
  assert.doesNotThrow(() => validateStory(text));
  const guidance = writingGuidance(text);
  assert.equal(guidance.find(row => row.field === 'feelFirst').measured, words(text.feelFirst.join(' ')).length);
  for (const page of ['try', 'for-you']) {
    const row = guidance.find(item => item.field === `${page}.generated`);
    assert.equal(row.range[1], capacity[page].totalWords);
    assert.equal(row.outsideRange, true);
    assert.equal(row.reportOnly, true);
  }
});

test('classes 2 and 3: chosen move capacities reach corrections and their count reports', () => {
  for (const move of moves) {
    const text = kitText(move), capacity = printedCapacity(move.id, family.hero.age);
    const request = buildStoryRequest(family, sentences[0], { lockedMoveId: move.id });
    assert.deepEqual(JSON.parse(request.input[0].content).printedCapacity, capacity);
    assert.match(request.instructions, /printedCapacity.byMove\[selected moveId\]/);
    assert.ok(request.instructions.includes(printedLengthRule(move.id, family.hero.age)));
    const guidance = writingGuidance(text);
    assert.equal(guidance.find(row => row.field === 'story').range[1], printedCapacity(move.id).story.ceilingWords, 'A historical report without an age keeps its old capacity.');
    for (const page of ['try', 'for-you']) assert.equal(guidance.find(row => row.field === `${page}.generated`).range[1], capacity[page].totalWords);
  }
});

test('oversized page bubbles may shorten only when named, and spacing floors survive export', () => {
  const text = kitText(), layoutFit = { page: 'story', fields: ['story', 'panelLines[0].line', 'panelLines[1].line'], overflowPoints: 80, cutWords: 74 };
  const request = buildStoryRequest(family, sentences[0], { reason: 'Measured overflow', previousStory: text, lockedMoveId: text.moveId, rewriteFields: layoutFit.fields, layoutFit });
  assert.match(request.instructions, /Only the explicitly named bubble lines may become shorter/);
  assert.match(request.instructions, /Keep every unlisted bubble passage exactly/);
  assert.doesNotMatch(request.instructions, /Keep every bubble passage exactly/);
  assert.match(JSON.parse(request.input[0].content).correction.fixedWords, /Remove optional whole beats or paragraphs/);
  text.printedFitPages = ['try', 'for-you', 'story', 'story-2'];
  text.pagination = validateStory(text).pagination;
  const pages = makePages(moves.find(move => move.id === text.moveId), text);
  for (const name of ['try', 'for-you']) assert.match(pages[`${name}.html`], new RegExp(`data-page="${name}" data-fit="compact"`));
  for (const name of ['story', 'story-2']) assert.doesNotMatch(pages[`${name}.html`], new RegExp(`data-page="${name}" data-fit="compact"`));
});
