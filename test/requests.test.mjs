import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoFamilyText, privacyFor, buildStoryRequest, buildStoryCheckRequest, buildPictureRequest, buildPictureCheckRequest } from '../server/requests.js';
import { moves, readJSON } from '../server/files.js';
import { practiceFor } from '../server/format.js';
import { family, sentences } from './fixture.mjs';
const privacy = privacyFor(family, sentences[0]);

test('OpenAI assertion rejects nickname, nested keys, case, apostrophes and full tonight sentence', () => {
  for (const body of [{ prompt: 'Pip' }, { prompt: 'PIP’s fur' }, { deep: [{ Biscuit: 'orange' }] }, { prompt: 'SEPTEMBER' }, { prompt: sentences[0] }]) assert.throws(() => assertNoFamilyText(body, privacy));
});
test('OpenAI assertion checks tonight even when nickname and context are absent from it', () => {
  assert.throws(() => assertNoFamilyText({ prompt: 'Rain falls.' }, { nickname: 'Zed', familyContext: '', tonight: 'Rain falls.' }), /tonight/);
});
test('common single words let the supplied outfit pass, while distinctive facts fail', () => {
  assert.equal(assertNoFamilyText({ prompt: 'green hoodie with a yellow lightning patch' }, privacy), true);
  assert.ok(buildPictureRequest(family, moves[0], sentences[0], { hero: true }));
  assert.ok(buildPictureCheckRequest(family, moves[0], sentences[0], 'data:image/png;base64,AA=='));
  for (const word of ['room', 'soccer', 'with', 'brother', 'tryouts', 'grandad']) assert.equal(assertNoFamilyText({ prompt: word }, privacy), true);
  for (const word of ['Biscuit', 'September']) assert.throws(() => assertNoFamilyText({ prompt: word }, privacy), /familyContext name/);
});
test('chosen fixed record text is exempt while private family facts stay blocked', () => {
  const move = moves.find(item => item.id === 'one-brave-step');
  const record = { ...family, familyContext: 'Soccer tryouts are next week' };
  const context = privacyFor(record, sentences[0], move);
  assert.equal(assertNoFamilyText({ prompt: move.actionLine }, context), true);
  assert.ok(buildPictureRequest(record, move, sentences[0]));
  assert.ok(buildPictureCheckRequest(record, move, sentences[0], 'data:image/png;base64,AA=='));
  for (const word of ['Biscuit', 'September']) {
    assert.throws(() => assertNoFamilyText({ prompt: `${move.actionLine} ${word}` }, privacyFor(family, sentences[0], move)), /familyContext name/);
  }
  for (const field of ['actionLine', 'name', 'childPhrase', 'practiceScript']) {
    assert.equal(assertNoFamilyText({ prompt: move[field] }, { ...context, familyContext: move[field] }), true);
  }
  assert.equal(assertNoFamilyText({ prompt: 'soccer' }, privacyFor(record, '', moves[0])), true);
  assert.equal(assertNoFamilyText({ prompt: 'our home' }, { ...context, familyContext: 'Our home.' }), true);
  assert.throws(() => assertNoFamilyText({ prompt: 'soccer' }, { ...context, nickname: 'Soccer' }), /nickname/);
  assert.throws(() => assertNoFamilyText({ prompt: move.actionLine }, { ...context, tonight: move.actionLine }), /tonight/);
});
test('generic pairs pass while copied content phrases stay private', () => {
  const common = readJSON(new URL('../content/common-words.json', import.meta.url));
  assert.ok(common.commonEnglish.length >= 5000);
  assert.equal(new Set(common.commonEnglish).size, common.commonEnglish.length);
  for (const text of ['our home', 'OUR   HOME', 'our-home', 'in blue']) {
    assert.equal(assertNoFamilyText({ prompt: text }, { nickname: 'Zed', familyContext: 'Our home is in blue.', tonight: '' }), true);
  }
  assert.throws(() => assertNoFamilyText({ prompt: 'soccer tryouts' }, privacy));
  assert.equal(assertNoFamilyText({ prompt: 'home green hoodie' }, { nickname: 'Zed', familyContext: 'Our home.', tonight: '' }), true);
  assert.equal(assertNoFamilyText({ prompt: 'weekend grandads' }, privacy), true);
});
test('safe text and actual image bytes pass; disguised text URLs do not bypass the guard', () => {
  assert.equal(assertNoFamilyText({ prompt: 'orange fur', image: 'data:image/png;base64,UElQ' }, privacy), true);
  assert.throws(() => assertNoFamilyText({ image: 'data:image/png;base64,brother!' }, privacy));
  assert.throws(() => assertNoFamilyText({ prompt: 'orange' }));
});
test('story request gets the original source bank or one chosen guide and only specified family fields', () => {
  const body = buildStoryRequest(family, sentences[0]);
  const data = JSON.parse(body.input[0].content);
  const originals = moves.filter(move => !move.library);
  assert.equal(data.familyContext, family.familyContext);
  assert.deepEqual(new Set(data.moves.map(move => move.id)), new Set(originals.map(move => move.id)));
  assert.equal(data.moves.length, originals.length);
  for (const move of data.moves) assert.equal(move.practiceScript, practiceFor(originals.find(original => original.id === move.id)));
  const chosen = JSON.parse(buildStoryRequest(family, sentences[0], { lockedMoveId: originals[0].id }).input[0].content);
  assert.deepEqual(chosen.moves.map(move => move.id), [originals[0].id]);
  assert.equal(chosen.moves[0].practiceScript, practiceFor(originals[0]));
  assert.equal(data.memory.split('\n').length, 3); assert.equal(data.hero.heroPicturePath, undefined);
  assert.equal(body.model, readJSON(new URL('../content/prices.json', import.meta.url)).selected.story);
  assert.match(body.instructions, /honest imperfect ending/);
});
test('judge request contains story, concern, canonical move and selected rhyme', () => {
  const body = buildStoryCheckRequest('MADE UP\nAn example input for a parser test.', moves[0]);
  assert.deepEqual(Object.keys(JSON.parse(body.input[0].content)).sort(), ['cast', 'childAge', 'concern', 'familyContext', 'kitContext', 'learningActor', 'move', 'parentLabel', 'selectedRhyme', 'story']);
  assert.equal(body.model, readJSON(new URL('../content/prices.json', import.meta.url)).selected.storyCheck); assert.ok(!JSON.stringify(body).includes(family.familyContext));
});
test('picture builders whitelist text and never carry name, loves, memory, or sentences', () => {
  const safe = { ...family, familyContext: 'Zebras gallop.', hero: { ...family.hero, nickname: 'Zed' } };
  const body = buildPictureRequest(safe, moves[0], 'A sudden rainstorm.', { hero: true });
  // Encoded image bytes can contain short letter sequences by chance.
  // Check all request text, excluding the explicitly separate binary image field.
  const { image, ...requestText } = body;
  for (const text of ['Pip', 'Biscuit', 'Zebras', 'rainstorm', 'familyContext', 'memory']) assert.ok(!JSON.stringify(requestText).includes(text));
  const check = buildPictureCheckRequest(safe, moves[0], 'A sudden rainstorm.', 'data:image/png;base64,AA==');
  const payload = JSON.parse(check.input[0].content[0].text);
  assert.deepEqual(Object.keys(payload).sort(), ['actionLine', 'cast', 'expectedPeopleCount', 'instruction', 'lookChips', 'outfitList']);
});
