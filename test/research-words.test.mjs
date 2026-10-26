import test from 'node:test';
import assert from 'node:assert/strict';
import { researchWordHelp } from '../app/research-words.js';
import { moves } from '../server/files.js';
import { makePages, verifyOwnedWords } from '../server/layout.js';
import { validateStory } from '../server/story.js';
import { kitText } from './kit-text-fixture.mjs';

test('plain explanations do not change the saved finding, source, population or original words', () => {
  const move = structuredClone(moves[0]);
  const source = move.sources.find(source => source.doi);
  source.limitation = 'A test of mental rotation training with 143 people aged 6 to 7 used an active literacy control group. It did not test this home activity.';
  const original = structuredClone(move);
  const text = kitText(move); text.pagination = validateStory(text).pagination;
  const pages = makePages(move, text);
  assert.equal(verifyOwnedWords(pages, move), true);
  assert.deepEqual(move, original);
  const help = researchWordHelp(source.limitation);
  assert.ok(help.includes('Mental rotation means picturing how a shape looks after a turn.'));
  assert.ok(help.some(line => line.includes('reading practice')));
  assert.equal(help.filter(line => line.includes('compare')).length, 1);
});

test('everyday source wording gains no extra explanation or promised benefit', () => {
  assert.deepEqual(researchWordHelp('The study did not test this home practice with children.'), []);
  assert.deepEqual(researchWordHelp('Immediate relief is not established.'), ['Immediate relief means feeling better right away.']);
});

test('negated study methods get word meanings, never invented facts about the study', () => {
  const source = 'This was an observational study, not a randomized trial. There was no control group.';
  assert.deepEqual(researchWordHelp(source), [
    'A control group is a group used to compare results.',
    'Randomized means chance picks the groups.',
  ]);
  assert.deepEqual(researchWordHelp('The download transfer failed.'), []);
});

test('school research words gain meanings without adding an age range or a study result', () => {
  const help = researchWordHelp('Adolescents used collaboration, feedback and strategy questions. Classroom motivation was measured. Mixed problem practice was compared with practice grouped by problem type.');
  assert.equal(help.length, 7);
  assert.ok(help.every(line => !/\d|better|improv|prove/.test(line)));
  assert.ok(help.includes('Motivation means what makes someone want to do something.'));
  assert.deepEqual(researchWordHelp('Strongly supported in school settings.'), ['This research rating is about support from school studies. It does not mean this home activity was tested.']);
});
