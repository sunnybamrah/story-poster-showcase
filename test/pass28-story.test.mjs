import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryRequest, buildStoryCheckRequest } from '../server/requests.js';
import { narrativeFaultKeys, STORY_RULES, STORY_PURPOSE_RULES } from '../server/story-rules.js';
import { validateStory, spokenWordCount, correctionPlan } from '../server/story.js';
import { parseStoryCheck } from '../server/check-story.js';
import { scienceFor, practiceFor } from '../server/format.js';
import { family, sentences } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { readableKitText } from './readable-kit-fixture.mjs';
import { storyCheckAnswer, markFault } from './checker-fixture.mjs';
import { moves } from '../server/files.js';
import { expectReview } from './review-assertions.mjs';

test('class 2: writer and judge share named action-led rules, concern and canonical science', () => {
  const writer = buildStoryRequest(family, sentences[0]), payload = JSON.parse(writer.input[0].content);
  assert.match(STORY_RULES, /hook in three short lines/); assert.match(STORY_RULES, /printedCapacity.story.targetWords/);
  assert.match(STORY_RULES, /Appearance belongs only in picture directions/);
  assert.match(STORY_RULES, /You may paraphrase the selected practice faithfully/);
  assert.match(STORY_RULES, /do not make a parent read the whole prepared script aloud/);
  assert.equal(payload.hero.lookChips, undefined); assert.equal(payload.hero.lockedOutfit, undefined);
  for (const move of payload.moves) {
    const sourceMove = moves.find(item => item.id === move.id), science = scienceFor(sourceMove);
    assert.deepEqual(move.science, science); assert.equal(move.kidScienceLine, science.claim);
    assert.equal(move.practiceScript, practiceFor(sourceMove));
    assert.equal(move.source, undefined, 'The writing request keeps the science limit without the repeated audit record.');
  }
  const judge = buildStoryCheckRequest(kitText(), moves[0], { record: family, tonight: sentences[0] });
  const data = JSON.parse(judge.input[0].content);
  assert.equal(data.concern, sentences[0]); assert.equal(data.familyContext, family.familyContext);
  for (const key of narrativeFaultKeys) assert.ok(judge.instructions.includes(key));
  assert.equal(judge.store, false); assert.equal(writer.store, false);
});

test('calm practical learning reaches both models without a forced worry or different concern', () => {
  const tonight = 'My child is calm and wants to remember to bring a library book.';
  const record = { ...family, pastKits: [] }, move = moves.find(move => move.id === 'snag-plan');
  const writer = buildStoryRequest(record, tonight);
  const judge = buildStoryCheckRequest(kitText(move), move, { record, tonight });
  assert.ok(writer.instructions.includes(STORY_PURPOSE_RULES));
  assert.ok(judge.instructions.includes(STORY_PURPOSE_RULES));
  assert.equal(JSON.parse(judge.input[0].content).concern, tonight);
  assert.match(judge.instructions, /invents distress to turn a calm learning request into a problem/);
  assert.doesNotMatch(STORY_RULES, /The move works imperfectly; some difficulty remains\./);
});

for (const key of narrativeFaultKeys) test(`class 2: ${key} needs a quoted real line and repairs the chapter with its panels`, () => {
  const text = kitText(), quote = 'The puzzle waits.';
  const answer = markFault(storyCheckAnswer(text.tagline), key, quote, ['story']);
  const checked = parseStoryCheck(JSON.stringify(answer), { story: text, move: moves[0] });
  assert.equal(checked.ready, false); assert.equal(checked.evidence[key], quote);
  assert.deepEqual(correctionPlan(checked), { fields: ['story', 'panelLines'], rewrite: true });
  answer.evidence[key] = 'A line that is absent.';
  assert.equal(parseStoryCheck(JSON.stringify(answer), { story: text, move: moves[0] }).ready, true);
});

test('classes 2 and 3: chapter length guides fitting and narration leaves the fiction label to code', () => {
  const text = readableKitText();
  assert.ok(spokenWordCount(text.story) >= 450 && spokenWordCount(text.story) <= 550); assert.equal(validateStory(text).id, text.moveId);
  assert.doesNotMatch(text.story, /made.up|pretend|fox|their glasses/i);
  assert.equal(text.pagination.wordCounts.reduce((a, b) => a + b), spokenWordCount(text.story));
  for (const count of [499, 549, 550, 750, 751, 801]) assert.doesNotThrow(() => validateStory(kitText(moves[0], { wordCount: count })));
  expectReview(() => validateStory({ ...text, story: 'Pip is a made up child.\n' + text.story }), /fictionInNarration/);
  assert.equal(family.hero.species, 'human'); assert.equal(family.hero.pronouns, 'he/him');
});

test('class 7: duplicate practice choices stop while software wording remains a named prose note', () => {
  const duplicate = kitText(); duplicate.tinyTryOptions[1].text = duplicate.tinyTryOptions[0].text;
  assert.throws(() => validateStory(duplicate), /tinyTryWrong/);
  const software = kitText(); software.tinyTryOptions[0].text = 'Rehearse the supplied naming practice.';
  expectReview(() => validateStory(software), /child_word_wall/);
});
