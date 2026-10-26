import { expectReview } from './review-assertions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { moves, readJSON, words } from '../server/files.js';
import { STORY_RULES, POSTER_QUALITY_RULES, POSTER_SCENE_RULES, buildPosterRequest, buildWordCheckRequest, buildStoryCheckRequest, buildStoryRequest, buildPictureCheckRequest, assertNoFamilyText, privacyFor } from '../server/requests.js';
import { storyCheckKeys, posterQualityKeys, pictureCheckKeys, wordCheckBooleans, geometryBooleanKeys } from '../server/checker-contract.js';
import { selectedRhymeFor, rhymeRuleFaults } from '../server/rhyme.js';
import { parseStoryCheck } from '../server/check-story.js';
import { parsePictureCheck } from '../server/check-picture.js';
import { parseWordCheck } from '../server/check-words.js';
import { readyStory, writeStory, validateStory, correctionPlan } from '../server/story.js';
import { withKitEvidence } from '../server/kit-evidence.js';
import { readyDrawnPage } from '../server/picture.js';
import { createMemory } from '../server/memory.js';
import { createKit } from '../server/kit.js';
import { posterBoxes, boxText } from '../server/format.js';
import { family, sentences } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { syntheticCastEvidence, storyCheckAnswer, pictureCheckAnswer, wordCheckAnswer, markFault } from './checker-fixture.mjs';
import { offlineTransport, textAnswer, openaiAnswer, run5, offlineExports } from './offline-kit-fixture.mjs';

const temp = t => { const directory = mkdtempSync(join(tmpdir(), 'pass15-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; };
const safe = { ...family, familyContext: '' };
const move = moves[0];
const original = () => kitText(move);
const rhymeFault = (text, key = 'rhymeUsesStoryWords') => markFault(storyCheckAnswer(text.tagline), key, text.tagline, ['tagline']);

test('poster asks for a warm quieter scene, clear acting paw, integrated joke and scenic footer', () => {
  const text = original(), request = buildPosterRequest(safe, move, '', text);
  for (const phrase of ['complete, warm scene', 'few broad shapes', 'soft light', 'gentle depth', 'only furnishings needed for the action', 'thoughtful expression', 'whole acting hand or paw', 'never a separate inset', 'title banner and rhyme pill belong', 'around the footer banner', 'cards light and readable', 'Add no unapproved words', 'Do not make the whole scene blank or bland', 'Nothing floats against a body']) assert.ok(request.prompt.includes(phrase), phrase);
  assert.ok(request.prompt.includes(move.bodyAction));
  assert.ok(!request.prompt.includes(`event: ${move.actionLine}`));
  for (const box of posterBoxes(move, text).filter(box => box.id !== 'footer')) for (const line of boxText(box).split('\n')) assert.ok(request.prompt.includes(JSON.stringify(line)), line);
  assert.doesNotMatch(request.prompt, /Leave the banner undecorated/);
  assert.ok(POSTER_SCENE_RULES.includes('chosen world'));
  const check = JSON.parse(buildWordCheckRequest(safe, move, '', 'data:image/png;base64,AA==').input[0].content[0].text);
  assert.equal(check.actionLine, move.bodyAction);
  assert.match(check.geometryInstruction, /ONLY the small area right around the acting hand/);
});

test('full scenery away from the hand is allowed by both picture and poster checks', () => {
  const picture = markFault(pictureCheckAnswer(), 'clutteredActionBackground', 'A window, lamp and furniture fill the room.');
  picture.actionBackgroundArea = 'elsewhere';
  let checked = parsePictureCheck(JSON.stringify(picture));
  assert.equal(checked.ready, true); assert.ok(checked.ignoredFaults.some(row => row.key === 'clutteredActionBackground'));
  picture.actionBackgroundArea = 'acting-hand'; picture.evidence.clutteredActionBackground = 'Lines around the acting paw obscure its action.';
  expectReview(() => parsePictureCheck(JSON.stringify(picture)), /clutteredActionBackground/);
  const boxes = posterBoxes(move, original()), answer = wordCheckAnswer(boxes);
  markFault(answer.geometry, 'clutteredActionBackground', 'Full room scenery away from the paw.');
  answer.geometry.actionBackgroundArea = 'elsewhere';
  assert.equal(parseWordCheck(JSON.stringify(answer), boxes).ready, true);
  answer.geometry.actionBackgroundArea = 'acting-hand';
  expectReview(() => parseWordCheck(JSON.stringify(answer), boxes), /clutteredActionBackground/);
});

test('sceneTooEmpty reports without failing or buying a redraw and is saved in the kit log', async t => {
  const picture = pictureCheckAnswer(); picture.sceneTooEmpty = true; picture.evidence.sceneTooEmpty = 'Flat yellow behind the hero, with no place shown.';
  const check = parsePictureCheck(JSON.stringify(picture));
  assert.equal(check.ready, true); assert.equal(check.observations[0].key, 'sceneTooEmpty'); assert.equal(check.observations[0].reportOnly, true);
  const directory = temp(t), record = structuredClone(safe);
  record.hero.heroPicturePath = new URL('./fixtures/offline-art.png', import.meta.url).pathname;
  const transport = offlineTransport(t, directory, request => {
    if (request.stage === 'poster-word-check') return openaiAnswer({ ...syntheticCastEvidence(request), ...wordCheckAnswer(posterBoxes(move, run5)), sceneTooEmpty: true, evidence: { ...wordCheckAnswer(posterBoxes(move, run5)).evidence, sceneTooEmpty: 'Flat yellow, no setting.' } });
  });
  const art = await readyDrawnPage(withKitEvidence(transport, directory), record, move, '', run5, { directory });
  assert.equal(art.ready, true); assert.equal(transport.calls.length, 2);
  assert.equal(readJSON(join(directory, 'picture-check-poster-1.json')).check.observations[0].key, 'sceneTooEmpty');
  assert.match(readFileSync(join(directory, 'kit-log.md'), 'utf8'), /observations: sceneTooEmpty/);
  const schema = buildPictureCheckRequest(safe, move, '', 'data:image/png;base64,AA==').text.format.schema;
  assert.ok(schema.required.includes('sceneTooEmpty')); assert.ok(schema.required.includes('actionBackgroundArea'));
});

test('writer and checker share the plain-word rules and all four requested quality keys', () => {
  const request = buildStoryCheckRequest(original(), move);
  for (const key of ['rhymeUsesStoryWords', 'rhymeDoesNotStateMove', 'wordAChildMustTranslate', 'scienceClaimsTeachingHelped']) assert.ok(storyCheckKeys.includes(key) && request.instructions.includes(key));
  assert.ok(buildStoryRequest(family, sentences[0]).instructions.includes(POSTER_QUALITY_RULES)); assert.ok(request.instructions.includes(POSTER_QUALITY_RULES.split('\n')[0])); assert.doesNotMatch(request.instructions, /Check the complete drawn word list and geometry/);
  for (const rule of ['4 to 7 words TOTAL', 'meaning, natural spoken sound', 'observed link', 'fear, anger or shame', '109 is not a stop', 'explain the move, show it', 'later recall']) assert.ok(POSTER_QUALITY_RULES.includes(rule), rule);
  assert.match(request.instructions, /This key names a fault/);
});

test('historical rhyme text remains readable while fresh rhyme counts are enforced', () => {
  const text = original(); text.tagline = 'Name one feeling with these simple words and keep it near.';
  assert.doesNotThrow(() => validateStory(text));
  assert.match(rhymeRuleFaults('The moon is bright, the stars shine tonight.', move).join(' '), /rhyme_word_count/);
  assert.deepEqual(rhymeRuleFaults('Name it clear, keep it near.', move), []);
});

test('approved-wording quality concerns retain their evidence as review flags', () => {
  const text = { ...original(), tagline: 'Name the fizz, see what it is.' };
  for (const key of posterQualityKeys.slice(0, 3)) {
    const evidence = key === 'wordAChildMustTranslate' ? 'fizz' : text.tagline;
    const checked = parseStoryCheck(JSON.stringify(markFault(storyCheckAnswer(text.tagline), key, evidence, ['tagline'])), { story: text, move });
    assert.equal(checked.ready, true); assert.ok(checked.reviewFlags.some(row => row.key === key && row.evidence === evidence));
    assert.deepEqual(correctionPlan(checked), { fields: [], rewrite: false });
    if (key === 'wordAChildMustTranslate') assert.equal(checked.translationWord, 'fizz');
  }
  const unsupported = rhymeFault(text); unsupported.evidence.rhymeUsesStoryWords = '';
  assert.equal(parseStoryCheck(JSON.stringify(unsupported), { story: text, move }).ready, true);
});

test('science evidence in a fixed move record needs review and never rewrites the chapter', () => {
  const supplied = { ...move, kidScienceLine: 'Teaching this move helped everyone.' };
  const text = original();
  const answer = markFault(storyCheckAnswer(text.tagline), 'scienceClaimsTeachingHelped', supplied.kidScienceLine, ['move.kidScienceLine']);
  const check = parseStoryCheck(JSON.stringify(answer), { story: text, move: supplied });
  assert.deepEqual(check.reviewFlags[0].fields, ['move.kidScienceLine']);
  assert.equal(check.ready, true); assert.deepEqual(correctionPlan(check), { fields: [], rewrite: false });
  assert.deepEqual(text.story, original().story);
});

test('new stories use the saved topic reminder and keep the raw writer proposal', async t => {
  const directory = temp(t), text = { ...original(), tagline: 'Name it clear, keep it near.' };
  const transport = offlineTransport(t, directory, request => request.stage === 'story' ? textAnswer(text) : undefined);
  const result = await readyStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.ready, true); assert.equal(result.story, text.story);
  assert.equal(result.tagline, selectedRhymeFor(move).tagline); assert.equal(result.rhymeSelection.source, 'topic');
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-check']);
  assert.equal(readJSON(join(directory, 'story-attempt-1.json')).tagline, text.tagline);
  const receipt = readJSON(join(directory, 'rhyme-selection-1.json'));
  assert.equal(receipt.tagline, result.tagline); assert.equal(receipt.ownerApproved, true);
  assert.equal(statSync(join(directory, 'rhyme-selection-1.json')).mode & 0o777, 0o600);
});

test('an unwanted new rhyme is bound to the saved reminder without an extra model call', async t => {
  const directory = temp(t), text = { ...original(), tagline: 'Name one feeling with these simple words and keep it near.' };
  const transport = offlineTransport(t, directory, () => textAnswer(text));
  const result = await writeStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.tagline, selectedRhymeFor(move).tagline);
  assert.equal(transport.calls.length, 1);
  assert.equal(readJSON(join(directory, 'story-attempt-1.json')).tagline, text.tagline);
});

test('a sound concern stays advisory for the saved topic reminder', async t => {
  const directory = temp(t), text = original();
  const transport = offlineTransport(t, directory, request => {
    if (request.stage === 'story') return textAnswer(text);
    if (request.stage === 'story-check') {
      const current = JSON.parse(request.body.input[0].content).story, answer = storyCheckAnswer(current.tagline);
      answer.taglineRhymes = false;
      return textAnswer(answer);
    }
  });
  const result = await readyStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.story, text.story); assert.equal(result.tagline, text.tagline);
  assert.ok(result.reviewFlags.some(flag => flag.key === 'taglineRhymes'));
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-check']);
});

test('rhyme fallback never clears a different surviving fault', async t => {
  const directory = temp(t), text = original();
  const transport = offlineTransport(t, directory, request => {
    if (request.stage === 'story') return textAnswer(text);
    if (request.stage === 'story-rewrite') return textAnswer(text);
    if (request.stage === 'story-check') {
      const current = JSON.parse(request.body.input[0].content).story;
      const answer = rhymeFault(current);
      markFault(answer, 'secondMoveTaught', 'This feels hard.', ['story']);
      return textAnswer(answer);
    }
  });
  await assert.rejects(readyStory(withKitEvidence(transport, directory), family, sentences[0]), /second judge check: secondMoveTaught/);
});

test('an absent or invalid saved rhyme is never invented', () => {
  assert.throws(() => selectedRhymeFor(move, []), /approved_rhyme_missing/);
  assert.throws(() => selectedRhymeFor(move, [{ moveId: move.id, lines: ['A moon above.', 'A star I love.'] }]), /author and explicit approval/);
  assert.throws(() => selectedRhymeFor(move, [{ moveId: move.id, lines: ['Name'] }]), /two saved halves/);
});

test('full offline kit uses its saved topic reminder in every drawing word list', async t => {
  const directory = temp(t), text = { ...original(), tagline: 'Name it clear, keep it near.' };
  const memory = createMemory(join(directory, 'family.json')); memory.store(family);
  const transport = offlineTransport(t, directory, request => request.stage === 'story' ? textAnswer(text) : undefined);
  const kit = await createKit(transport, memory, sentences[0], { directory, kit: 1, exports: offlineExports() });
  assert.equal(kit.complete, true); assert.equal(kit.tagline, selectedRhymeFor(move).tagline); assert.equal(kit.story, text.story);
  assert.equal(kit.pdf.fixture, true); assert.equal(kit.art.poster.expectedBoxes.find(box => box.id === 'tagline').text, kit.tagline);
  assert.equal(kit.tagline, selectedRhymeFor(move).tagline);
  assert.match(transport.calls.find(call => call.stage === 'poster').body.prompt, /complete, warm scene/);
});

test('observation schemas never mutate shared fault keys across repeated requests', () => {
  const before = [storyCheckKeys, pictureCheckKeys, wordCheckBooleans, geometryBooleanKeys].map(keys => [...keys]);
  for (let count = 0; count < 3; count++) {
    const requests = [buildPictureCheckRequest(safe, move, '', 'data:image/png;base64,AA=='), buildWordCheckRequest(safe, move, '', 'data:image/png;base64,AA==')];
    for (const request of requests) {
      const schema = request.text.format.schema;
      assert.equal(new Set(schema.required).size, schema.required.length);
      assert.equal(new Set(schema.properties.evidence.required).size, schema.properties.evidence.required.length);
    }
  }
  assert.deepEqual([storyCheckKeys, pictureCheckKeys, wordCheckBooleans, geometryBooleanKeys], before);
});

test('only the exact fixed scene instruction is exempt from family-word matching', () => {
  const privacy = privacyFor(family, sentences[0], move);
  assert.doesNotThrow(() => assertNoFamilyText({ prompt: POSTER_SCENE_RULES }, privacy));
  assert.throws(() => assertNoFamilyText({ prompt: POSTER_SCENE_RULES + '\nlittle brother' }, privacy), /familyContext/);
  assert.throws(() => assertNoFamilyText({ prompt: POSTER_SCENE_RULES + '\n' + family.familyContext }, privacy));
  assert.doesNotThrow(() => buildPosterRequest(family, move, sentences[0], original()));
});

test('binding the topic reminder updates repeated generated copies before their check', async t => {
  const directory = temp(t), text = original();
  text.tagline = 'Say "clear," keep it near.';
  text.tinyTryOptions[0].text += ' ' + text.tagline;
  const transport = offlineTransport(t, directory, request => request.stage === 'story' ? textAnswer(text) : undefined);
  const result = await readyStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.tagline, selectedRhymeFor(move).tagline);
  assert.ok(result.tinyTryOptions[0].text.includes(result.tagline));
  assert.ok(!result.tinyTryOptions[0].text.includes(text.tagline));
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-check']);
});
