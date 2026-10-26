import test from 'node:test';
import assert from 'node:assert/strict';
import { explainRoute, parentResponse } from '../server/route.js';
import { preparePick } from '../server/picker.js';
import { family } from './fixture.mjs';

const concerning = [
  'My daughter said she wanted to die.',
  "My son told me he didn't want to live anymore.",
  'She says she wants to hurt herself.',
  'My child said this morning that they wanted to die. They are calm beside me now.',
  'I wanted to die earlier today. I feel calmer now.',
  'My daughter said, "I want to die."',
  '"I wanted to kill myself," my son told me tonight.',
  'She wished she were dead.',
  'He wishes he was not alive.',
  'They hoped they would die.',
  'My child hoped to die.',
  'She said she wished she could die.',
  'He was wishing he had never been born.',
  'They are hoping to die.',
  'She does not want to live.',
  "He doesn't really want to live anymore.",
  'She did not want to be alive.',
  'They said they never wanted to exist.',
  'She is not wanting to live anymore.',
  'I want to harm myself.',
  'He wanted to cut himself.',
  'They planned to hurt themself.',
  'They intend to injure themselves.',
  'My daughter decided to end her own life.',
  'My child was thinking about killing themself.',
  'She thought of hurting herself.',
  'I was playing a game when my son said he wanted to die.',
  'She wanted to die earlier, but says she does not now.',
  'My child said he did not want to live in this world.',
  'My son was playing as his avatar in a game and said he wanted to die.',
  'In the book a character wanted to die, but my daughter said she wanted to die in real life too.',
  'The character in the story wanted to die and my daughter told me she wanted to die too.',
  'A character in a book wanted to die, my son said he wanted to hurt himself.',
  'We read a story and my child said she wanted to hurt herself for real.',
];
const benign = [
  "My daughter doesn't want to die.",
  "My son told me he didn't want to die.",
  'She does not really want to die.',
  'They never wanted to die.',
  'He said he did not ever want to die.',
  "I don't want to kill myself.",
  'She did not want to hurt herself.',
  'They do not want to harm themselves.',
  'She hoped she would not die.',
  'He wished he could live forever.',
  'She wanted to live.',
  'He wants to keep living.',
  'I never said I wanted to die.',
  'She never told me she wanted to die.',
  'My child said it was not true that he wanted to die.',
  'She denied that she wanted to die.',
  'In the story, a character said she wanted to die.',
  'My daughter said the character in the book wanted to die.',
  'In a video game, his avatar said "I wanted to die."',
  'His avatar in the game did not want to live.',
  'We read a story about a character who wanted to die.',
  'My daughter wants to sit and listen to the story.',
  'My son said he did not want to live in that town.',
  'My son said he did not want to live stream the game.',
  'She never wanted live music at her party.',
];
for (const sentence of concerning) test(`reported intent takes the protective route: ${sentence}`, () => {
  assert.equal(explainRoute(sentence).reason, 'danger');
  assert.equal(preparePick(family, sentence).status, 'parentResponse');
});
for (const sentence of benign) test(`negation and fictional context keep their meaning: ${sentence}`, () => {
  assert.notEqual(explainRoute(sentence).reason, 'danger');
});
test('reported intent uses the same existing protective response as direct intent', () => {
  assert.deepEqual(parentResponse(concerning[0]), parentResponse('I want to die.'));
});
