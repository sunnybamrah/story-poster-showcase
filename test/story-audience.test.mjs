import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryRequest, buildStoryCheckRequest, buildPanelRequest, buildPosterRequest } from '../server/requests.js';
import { printedCapacity } from '../server/printed-capacity.js';
import { STORY_LANGUAGE_RULES } from '../server/story-rules.js';
import { chapterShapeRules } from '../server/story-review.js';
import { family } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { moves } from '../server/files.js';

test('actual child age and feeling survive writing, correction and source checking without an older-reader quota', () => {
  for (const age of [8, 10, 13]) for (const feeling of ['comfortable', 'uncomfortable']) {
    const record = { ...structuredClone(family), hero: { ...family.hero, age } };
    const note = `She had her class today and feels ${feeling}.`;
    const previous = kitText(moves[0]);
    for (const options of [{}, { reason: 'Keep the actual concern', previousStory: previous, lockedMoveId: moves[0].id }]) {
      const request = buildStoryRequest(record, note, options), payload = JSON.parse(request.input[0].content);
      assert.equal(payload.tonight, note); assert.equal(payload.hero.age, age);
      assert.equal(payload.printedCapacity.story.targetWords, age <= 10 ? 350 : 600);
      for (const capacity of Object.values(payload.printedCapacity.byMove)) assert.equal(capacity.story.targetWords, age <= 10 ? 350 : 600);
      assert.ok(request.instructions.includes(STORY_LANGUAGE_RULES));
      assert.doesNotMatch(request.instructions, /Aim for two or three distinct bigger words|including ages 11 to 13|Set the kit in the supplied world/);
    }
    const check = buildStoryCheckRequest(previous, moves[0], { record, tonight: note });
    assert.equal(JSON.parse(check.input[0].content).childAge, age);
    assert.equal(JSON.parse(check.input[0].content).concern, note);
    assert.ok(check.instructions.includes(STORY_LANGUAGE_RULES));
  }
  assert.equal(chapterShapeRules.explainedWords.min, 0);
  assert.equal(chapterShapeRules.explainedWords.max, null);
  assert.equal(printedCapacity().story.targetWords, 600, 'Historical layout evidence remains unchanged.');
});

test('poster decoration reaches art without being sent as a story plot or changing panel events', () => {
  const record = structuredClone(family), before = structuredClone(record);
  const note = 'He could not borrow another library book because his old one was still at home.';
  const payload = JSON.parse(buildStoryRequest(record, note).input[0].content);
  assert.equal(payload.world, undefined); assert.equal(payload.colourSet, undefined);
  const text = kitText(moves[0]), selection = { world: 'treasure map', colourSet: 'warm' };
  const poster = buildPosterRequest(record, moves[0], note, text, { selection });
  const panel = buildPanelRequest(record, moves[0], note, { scene: 'The child and grown-up-one sit by the front door. A book rests on the table.', line: 'The book is here.' }, { selection });
  assert.match(poster.prompt, /Poster decoration: treasure map/);
  assert.doesNotMatch(panel.prompt, /treasure map|World:/);
  assert.match(panel.prompt, /A book rests on the table/);
  assert.deepEqual(record, before, 'Prompt building must not rewrite family history.');
});
