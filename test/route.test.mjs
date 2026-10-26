import test from 'node:test';
import assert from 'node:assert/strict';
import { route, parentResponse } from '../server/route.js';
import { preparePick } from '../server/picker.js';
import { sentences } from './fixture.mjs';

for (const sentence of sentences) test(`required sentence routes to move: ${sentence}`, () => assert.equal(route(sentence), 'move'));
const cases = [
  ['He hit his sister after losing a game.', 'move'],
  ['She has ADHD and her pencil broke.', 'move'],
  ['Treat his ADHD with this story.', 'stop'],
  ['I want to die.', 'stop'], ['They do not want to live.', 'stop'],
  ["I can't breathe.", 'stop'], ['There is a gun and a funeral.', 'stop'],
  ['My child worries about weight.', 'listen'], ['Food is a fight.', 'listen'],
  ['Their dog died today.', 'grief'], ['My dad is dying.', 'grief'],
  ['They are left out on purpose.', 'grown-up job'], ['Kids keep spreading rumors.', 'grown-up job'],
  ['The group chat is about them.', 'grown-up job'], ['I yelled at my child.', 'repair'],
  ['Just listen tonight.', 'listen'], ['', 'listen'], ['They feel sad after a game.', 'move'],
];
test('route precedence and everyday boundaries', () => { for (const [sentence, expected] of cases) assert.equal(route(sentence), expected, sentence); });

test('affirmed adult harm stays a grown-up responsibility across every free practice path', () => {
  for (const sentence of [
    'An adult hit my child.',
    'A teacher slapped her.',
    'My child said a coach pushed him.',
    'My daughter was hit by an adult.',
    'I hit my child.',
    'An adult physically pushed my child on a swing and he cried.',
    "Dad hurt my child's arm.",
    'An adult shoved her to the floor.',
    "A teacher grabbed my son's arm and hit him.",
    'My child said a teacher grabbed his arm and then hit him.',
    'The child wants to sort objects by material, but an adult hit the child.',
  ]) {
    assert.equal(route(sentence), 'grown-up job', sentence);
    assert.equal(preparePick({ pastKits: [] }, sentence).status, 'parentResponse', sentence);
    assert.equal(parentResponse(sentence).guidance, undefined, 'Do not attach school bullying steps to a different adult-harm report.');
  }
});

test('adult harm checks preserve negation, recipient, harmless play and fictional attribution', () => {
  for (const sentence of [
    'An adult did not hit my child.',
    'My child pushed a toy toward an adult.',
    'A coach hit the ball to my child.',
    'I hit the ball with my child.',
    'We read a book about a teacher hitting a child.',
    'The villain in a fictional story said an adult hit the child.',
    'Dad pushed her on the swing and she laughed the whole time.',
    'The coach pushed him to run faster at practice and he was tired.',
    'Her teacher pushed them to finish the project early.',
    "I hurt my daughter's feelings when I laughed at her drawing.",
    'Mom hurt her feelings by forgetting the recital.',
    'The coach hit him a ground ball and he missed it.',
    'My son said his teacher pushed him to try the harder book.',
    'Dad pushed him to keep going on the bike.',
    'Her teacher keeps pushing her to finish a project.',
    'A teacher grabbed a ball and hit him a ground ball.',
    'My child saw a teacher and hit him.',
    'A teacher held a book and my son hit him.',
    "A teacher grabbed a bag and didn't hit him.",
    'My child never said a teacher grabbed his arm and hit him.',
  ]) assert.equal(route(sentence), 'move', sentence);
  assert.equal(route('An adult hit my child again and left bruises.'), 'stop');
});

test('calm listening practice and a request for listening only keep their different purposes', () => {
  for (const sentence of [
    'We want to practise listening and checking what someone means.',
    'My child asked to learn how to listen to a friend.',
    'My daughter asked how to listen better when her friend talks.',
    'We need to rehearse listening without interrupting.',
  ]) assert.equal(route(sentence), 'move', sentence);
  for (const sentence of [
    'My child only wants me to listen.',
    'My child wants me to sit and listen.',
    'We want to learn how to listen, but my child wants no advice.',
    'We want to practise listening. Just listen tonight.',
  ]) assert.equal(route(sentence), 'listen', sentence);
});


test('a parent listening during calm learning does not cancel the requested story', () => {
  const moments = [
    'At recess today Maya asked to join a tag game. A child said the teams were full. Maya walked away and felt left out. Now she and Mom are calm at home. Mom wants to listen and help Maya name her feeling, then think together about what she could try if this happens again.',
    'I want to listen to my child and help her name the feeling.',
    'Dad wants to listen as we read our story together.',
    'My child wants me to listen and help her think about what to try next.',
    'My daughter wants to sit and listen to the story.',
  ];
  for (const moment of moments) {
    assert.equal(route(moment), 'move', moment);
    assert.equal(preparePick({ pastKits: [] }, moment).status, 'eligible', moment);
  }
  for (const moment of [
    'Mom wants to listen and help Maya name the feeling. Maya wants no advice.',
    'Dad wants to read a story, but my child only wants me to listen.',
    'She asked Mom to stay beside her and listen.',
    'My child wants her mom to listen.',
    'My daughter needs her dad to sit beside her and listen.',
    'She wants you to listen tonight.',
    'Maya wants Sunny to sit beside her and listen.',
    'My child wants me to sit and listen tonight.',
  ]) assert.equal(route(moment), 'listen', moment);
});
