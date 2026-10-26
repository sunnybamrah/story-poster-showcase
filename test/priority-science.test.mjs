import test from 'node:test';
import assert from 'node:assert/strict';
import { researchLecturePhrases, STORY_SCIENCE_RULES } from '../server/story-rules.js';
import { validateStory } from '../server/story.js';
import { buildStoryRequest, buildStoryCheckRequest } from '../server/requests.js';
import { moves } from '../server/files.js';
import { kitText } from './kit-text-fixture.mjs';
import { family, sentences } from './fixture.mjs';
import { expectReview } from './review-assertions.mjs';
for (const passage of [
  'In 9 and 10 year olds, a lab test found a change.',
  'Among nine to eleven year olds, the result was different.',
  'Children aged seven through twelve took part.',
  'This lab test did not test the home practice.',
  'Researchers found a change in the task.',
  'The study found that the scores changed.',
]) test(`new prose flags the research-recital class: ${passage}`, () => {
  const text = kitText(moves[0]); text.story += '\n' + passage;
  assert.ok(researchLecturePhrases(passage).length);
  expectReview(() => validateStory(text, { rejectResearchLecture: true }), /narrativeEssay/);
  assert.doesNotThrow(() => validateStory(text));
});
test('plain modest dialogue and an ordinary personal age stay allowed; both models share the rule', () => {
  for (const passage of ['For some adults, naming feelings eased the upset. We do not know if it will help here.', 'I was nine and ten years old when I kept that notebook.', 'The child found a pencil beside the laboratory model.']) assert.deepEqual(researchLecturePhrases(passage), []);
  const text = kitText(moves[0]);
  for (const request of [buildStoryRequest(family, sentences[0]), buildStoryCheckRequest(text, moves[0], { record: family })]) {
    assert.ok(request.instructions.includes(STORY_SCIENCE_RULES));
    assert.match(request.instructions, /absence of a research recital or limitation sentence is not scienceRecordMissingOrChanged/);
  }
});
