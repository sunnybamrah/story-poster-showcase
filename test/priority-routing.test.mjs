import test from 'node:test';
import assert from 'node:assert/strict';
import { explainRoute, parentResponse } from '../server/route.js';
import { preparePick } from '../server/picker.js';
import { family } from './fixture.mjs';

const groups = {
  danger: [
    'Older children on the bus punched his arm again today and told him they would hurt him worse if he told. He has a bruise and is frightened to go to school tomorrow.',
    'An older kid kicked her twice on the bus.',
    'My daughter was punched again at school.',
    'Classmates shoved my child and left bruises.',
    'They hit him every day.',
    'He keeps getting kicked at school.',
    'They got beaten again on the bus.',
    'We read a book about abuse and she said it happened to her.',
    'Older children punched him. He has a bruise.',
    'If she tells a teacher, they will hurt her.',
    'They said they would beat him if he told.',
    'He has been abused.',
    'There are threats every day at school.',
    'My child says she does not want to live.',
  ],
  'parent-repair': [
    'I am exhausted and snapped that she was being a baby.',
    'I was worn out and shouted at him.',
    'I felt tired and lost it at bedtime.',
    'I yelled at my child.',
    'This one is for me.',
  ],
  'listening-request': [
    'She wants me to sit and listen tonight.',
    'He asked me to stay beside him and listen.',
    'My child does not want advice.',
    'Just listen tonight.',
  ],
  'body-and-food': ['She worries about her body.', 'Eating is a fight.', 'She worries about calories.'],
  'treatment-request': ['I want a story for treating ADHD.', 'Can this cure depression?', 'I want therapy for anxiety disorder.'],
  loss: ['Their dog passed away.', 'My dad is dying.', 'They are grieving their pet.'],
  'adult-responsibility': ['They are being bullied.', 'Kids are picking on her.', 'They left him out on purpose.', 'The group chat is about her.'],
  'everyday-moment': [
    'My child keeps kicking a football every day.',
    'She punched the air again after scoring.',
    'She keeps hitting a ball every day at tennis.',
    'He hit his sister after losing a game.',
    'My child snapped a pencil after I said no.',
    'I was there when my child snapped at her sister.',
    'I am exhausted and she snapped a pencil.',
    'I snapped a picture of my child.',
    'I snapped my fingers to the music.',
    'He was not bullied. His maths test was hard.',
    'We read a story about a funeral.',
    'She has ADHD and her pencil broke.',
    'I am not treating ADHD with a story.',
    'She is not hungry and wants to play.',
  ],
};
for (const [reason, sentences] of Object.entries(groups)) test(`shared routing context: ${reason}`, () => {
  for (const sentence of sentences) assert.equal(explainRoute(sentence).reason, reason, sentence);
});
test('a serious description wins over a request to listen, and blocks the kit picker', () => {
  const sentence = groups.danger[0] + ' She wants me to sit and listen.';
  assert.equal(explainRoute(sentence).reason, 'danger');
  assert.equal(preparePick(family, sentence).status, 'parentResponse');
  const response = parentResponse(sentence);
  assert.equal(response.guidance.reviewLabel, "FOR SUNNY'S READ");
  assert.ok(response.guidance.resources.every(item => new URL(item.url).hostname === 'www.stopbullying.gov'));
});
