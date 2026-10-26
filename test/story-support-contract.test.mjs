import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryRequest, buildStoryCheckRequest } from '../server/requests.js';
import { STORY_SUPPORT_RULES } from '../server/story-rules.js';
import { parseStoryCheck } from '../server/check-story.js';
import { moves } from '../server/files.js';
import { practiceFor } from '../server/format.js';
import { family } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { markFault, storyCheckAnswer } from './checker-fixture.mjs';

const move = moves.find(item => item.id === 'name-it-exactly');

test('writer, corrections and judge share the support boundary and the actual moment', () => {
  const moments = [
    'Pip felt left out at recess. He wants to practise saying "Can I join the next game?" with Dad. If being left out keeps happening, he can ask a teacher he trusts for help.',
    'Pip felt confused about a class project. Dad wants to name the feeling together, then rehearse asking the teacher which part to start with.',
  ];
  const record = { ...family, parentLabel: 'Dad', familyContext: 'Pip and Dad read together when calm.' };
  const originalMove = structuredClone(move);
  for (const tonight of moments) {
    const story = kitText(move);
    const requests = [
      buildStoryRequest(record, tonight, { lockedMoveId: move.id }),
      buildStoryRequest(record, tonight, { lockedMoveId: move.id, previousStory: story, reason: 'Review the story.', rewriteFields: ['story'] }),
      buildStoryCheckRequest(story, move, { record, tonight }),
    ];
    for (const request of requests) {
      assert.ok(request.instructions.includes(STORY_SUPPORT_RULES), 'Both models, including corrections, must see the same lesson boundary.');
      const input = JSON.parse(request.input[0].content);
      assert.equal(input.tonight ?? input.concern, tonight);
      assert.equal(input.familyContext, record.familyContext);
      const selectedMove = input.moves?.find(item => item.id === move.id) ?? input.move;
      assert.equal(selectedMove.practiceScript, practiceFor(move));
      assert.equal(selectedMove.whenNotToUse, move.whenNotToUse);
      assert.match(request.instructions, /All three tinyTryOptions must still practise the selected move/);
      assert.match(request.instructions, /not research evidence or permission to override safety/);
      assert.doesNotMatch(request.instructions, /adviceOutsideRecord: the text supplies advice beyond the selected record\./);
    }
    const correction = JSON.parse(requests[1].input[0].content).correction;
    assert.deepEqual(correction.fields, ['story']);
    assert.match(correction.instruction, /Keep all other fields byte for byte/);
  }
  assert.deepEqual(move, originalMove, 'Prompt clarification must not change the saved guide.');
});

test('support permission does not bypass quoted technique, promise, science or safety faults', () => {
  // Synthetic model verdicts test the unchanged parser, not model comprehension.
  const cases = [
    ['secondMoveTaught', 'Now learn box breathing: breathe in, hold, breathe out, and hold for four counts each.'],
    ['adviceOutsideRecord', 'Try this climb even if a grown-up says it is unsafe.'],
    ['feelingGoesAwayPromise', 'Once you name it, the sad feeling will disappear.'],
    ['scienceClaimsTeachingHelped', 'Researchers proved this exact home activity makes children feel better.'],
    ['scienceRecordMissingOrChanged', 'The study tested this home game with eight-year-olds and proved it works.'],
    ['storyContinuity', 'The teacher agreed to change the rules that afternoon.'],
  ];
  for (const [key, quote] of cases) {
    const story = kitText(move);
    story.story += '\n' + quote;
    const answer = markFault(storyCheckAnswer(story.tagline), key, quote, ['story']);
    const result = parseStoryCheck(JSON.stringify(answer), { story, move, record: family, generation: true });
    assert.equal(result.ready, false, key);
    assert.ok(result.faults.includes(key), key);
    assert.equal(result.evidence[key], quote);
  }
});
