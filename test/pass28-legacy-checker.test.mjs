import test from 'node:test';
import assert from 'node:assert/strict';
import { judgeAnswerSchema, judgeParserSchema } from '../server/answer-schemas.js';
import { inspectAnswer } from '../server/answer-shape.js';
import { parseStoryCheck } from '../server/check-story.js';
import { narrativeFaultKeys } from '../server/story-rules.js';
import { storyCheckAnswer, markFault } from './checker-fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { moves } from '../server/files.js';

function olderAnswer() {
  const answer = storyCheckAnswer();
  for (const key of narrativeFaultKeys) {
    delete answer[key]; delete answer.evidence[key]; delete answer.affectedFields[key];
  }
  return answer;
}

test('saved boolean verdicts retain known findings while new assessments remain explicitly unverified', () => {
  const answer = olderAnswer(), before = structuredClone(answer), story = kitText();
  const result = parseStoryCheck(JSON.stringify(answer), { story, move: moves[0] });
  assert.equal(result.ready, true); assert.equal(result.needsRecheck, false); assert.equal(result.verified, false);
  assert.deepEqual(result.answers, before); assert.deepEqual(result.omittedNarrativeAssessments, narrativeFaultKeys);
  assert.ok(result.reviewFlags.some(row => row.key === 'narrative_checks_unverified' && row.label === "FOR SUNNY'S READ"));
  for (const key of narrativeFaultKeys) assert.equal(Object.hasOwn(result.answers, key), false);
  markFault(answer, 'secondMoveTaught', 'The puzzle waits.', ['story']);
  const knownFault = parseStoryCheck(JSON.stringify(answer), { story, move: moves[0] });
  assert.equal(knownFault.ready, false); assert.deepEqual(knownFault.faults, ['secondMoveTaught']);
  assert.equal(knownFault.verified, false);
});

test('production judge schema stays strict and incomplete current narrative answers still recheck', () => {
  const historical = olderAnswer();
  assert.ok(inspectAnswer(historical, judgeAnswerSchema).issues.some(issue => issue.startsWith(narrativeFaultKeys[0])));
  assert.deepEqual(inspectAnswer(historical, judgeParserSchema).issues, []);
  for (const key of narrativeFaultKeys) {
    const incomplete = storyCheckAnswer(); delete incomplete[key];
    const result = parseStoryCheck(JSON.stringify(incomplete));
    assert.equal(result.ready, false); assert.equal(result.needsRecheck, true);
    assert.ok(result.faults[0].includes(key));
  }
  const wrongType = olderAnswer(); wrongType.secondMoveTaught = 'false';
  assert.equal(parseStoryCheck(JSON.stringify(wrongType)).needsRecheck, true);
});
