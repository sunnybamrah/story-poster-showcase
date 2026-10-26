import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStory } from '../server/story.js';
import { STORY_RULES } from '../server/requests.js';
import { kitText } from './kit-text-fixture.mjs';

test('a paraphrased bubble is flagged with its exact words without buying a rewrite', () => {
  for (const line of ['This feels difficult.', 'Hard feels this.', 'hard I can']) {
    const text = kitText(); text.panelLines[0].line = line;
    const result = validateStory(text);
    assert.ok(result.reviewFlags.some(row => row.evidence.includes(JSON.stringify(line))));
    assert.ok(result.pagination.pages.length === 2);
  }
});

test('a quoted bubble inside a longer sentence passes with normalized words', () => {
  assert.match(STORY_RULES, /copies a short spoken passage in the chapter/); assert.match(STORY_RULES, /names that actual speaker/);
  for (const line of ['This feels hard.', '“THIS feels hard!”', 'This hard']) {
    const text = kitText();
    text.story = text.story.replace('This feels hard.', 'The fox whispers, “This feels hard.” while looking at the puzzle.');
    text.panelLines[0].line = line;
    assert.doesNotThrow(() => validateStory(text));
  }
});
