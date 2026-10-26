import { expectReview } from './review-assertions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { readJSON, moves } from '../server/files.js';
import { parseStoryCheck, checkStory } from '../server/check-story.js';
import { readyStory, correctionPlan, validateStory } from '../server/story.js';
import { buildStoryCheckRequest, buildStoryRequest } from '../server/requests.js';
import { chapterShapeRules, judgeFaultFields, formatReviewFlags } from '../server/story-review.js';
import { storyCheckKeys } from '../server/checker-contract.js';
import { withKitEvidence, readRunReviewFlags } from '../server/kit-evidence.js';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { storyCheckAnswer, markFault } from './checker-fixture.mjs';
import { kitText, withSyntheticSpeakers } from './kit-text-fixture.mjs';
import { family, sentences } from './fixture.mjs';
import { offlineTransport, offlineExports, textAnswer } from './offline-kit-fixture.mjs';
import { replaySaved } from './replay-saved.mjs';
const temp = t => { const d = mkdtempSync(join(tmpdir(), 'pass23-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const original = readJSON(new URL('./fixtures/run14-story-1.json', import.meta.url));
const rawChecks = [1, 2].map(n => readJSON(new URL(`./fixtures/run14-story-check-${n}.json`, import.meta.url)));
const parse = (answer, story = original, move = moves[0]) => parseStoryCheck(JSON.stringify(answer), { story, move, record: family });

for (const [tagline, pair] of [['Name it to tame it', ['Name', 'tame']], ["Check it, don't wreck it", ['Check', 'wreck']], ['NAME IT TO TAME IT!', ['“name,”', 'TAME!']]]) test(`judge pair is accepted anywhere, without a sound shortcut: ${tagline}`, () => {
  const answer = storyCheckAnswer(tagline); answer.taglineEndWords = pair;
  const result = parse(answer, { ...original, tagline });
  assert.equal(result.needsRecheck, false); assert.equal(result.ready, true); assert.equal(result.rhyme.rhymes, true);
  assert.deepEqual(result.rhyme.namedWords, pair); assert.deepEqual(result.faults, []);
});

for (const [index, saved] of rawChecks.entries()) test(`raw run 14 judge ${index + 1} has no format fault and retains only the chapter content finding`, async t => {
  const result = parse(saved.answer);
  assert.equal(result.needsRecheck, false); assert.equal(result.formatFault, undefined);
  assert.deepEqual(result.rhyme.namedWords, ['Name', 'tame']); assert.equal(result.rhyme.rhymes, true);
  assert.deepEqual(result.faults, []); assert.ok(result.reviewFlags.some(row => row.key === 'chapterShapeWrong'));
  assert.ok(result.ignoredFaults.some(row => row.key === 'filledWhenINotice' && /parent script/.test(row.reason)));
  assert.match(result.reasons.chapterShapeWrong, /review only/);
  assert.deepEqual(result.answers, saved.answer);
  const directory = temp(t), transport = offlineTransport(t, directory, () => structuredClone(saved.response));
  const checked = await checkStory(withKitEvidence(transport, directory), original, moves[0], { record: family });
  assert.equal(checked.ready, false); assert.equal(checked.verified, false); assert.ok(checked.faults.includes('content_check_unverified')); assert.equal(transport.calls.length, 2);
  assert.deepEqual(checked.answers, saved.answer, 'Historical omitted content fields are not invented in a current check.');
  assert.equal(transport.calls[0].body.reasoning.effort, 'medium');
});

test('absent named words retain one unverified answer without a derived sound opinion', async t => {
  const directory = temp(t), answer = storyCheckAnswer(original.tagline); answer.taglineEndWords = ['absent', 'invented'];
  const transport = offlineTransport(t, directory, () => textAnswer(answer));
  const result = await checkStory(withKitEvidence(transport, directory), original, moves[0], { record: family });
  assert.equal(result.needsRecheck, false); assert.equal(result.verified, false); assert.ok(result.reviewFlags.length); assert.equal(result.rhyme, undefined);
  assert.equal(result.ready, false); assert.ok(result.faults.includes('content_check_unverified')); assert.equal(transport.calls.length, 2); assert.deepEqual(transport.calls.map(row => row.body.reasoning.effort), ['medium', 'high']);
});

test('every fixed-field fault is review only, including arbitrary move paths and mixed fields', () => {
  for (const key of storyCheckKeys) for (const field of ['tagline', 'move.kidScienceLine', 'move.practiceScript', 'move.sources.0.limitation']) {
    const answer = markFault(storyCheckAnswer(original.tagline), key, 'An exact supplied fixed-wording excerpt', [field]);
    const result = parse(answer);
    assert.equal(result.ready, true, `${key} / ${field}`);
    assert.ok(result.reviewFlags.some(row => row.key === key && row.fields.includes(field) && row.label === "FOR SUNNY'S READ"));
    assert.deepEqual(correctionPlan(result), { fields: [], rewrite: false });
  }
  const answer = markFault(storyCheckAnswer(original.tagline), 'adviceOutsideRecord', 'frustrated', ['noticedFeeling', 'move.keyWord']);
  const result = parse(answer);
  assert.deepEqual(result.affectedFields.adviceOutsideRecord, ['noticedFeeling']);
  assert.deepEqual(correctionPlan(result), { fields: [], rewrite: false });
  assert.deepEqual(result.reviewFlags[0].fields, ['move.keyWord']);
  assert.deepEqual(correctionPlan({ faults: ['adviceOutsideRecord'], affectedFields: { adviceOutsideRecord: ['tagline', 'move.anything'] } }), { fields: [], rewrite: false });
});

test('a sound concern stays recorded without replacing the familiar reminder', async t => {
  const currentVoice = withSyntheticSpeakers({ ...original, story: original.story.replace('children aged eight to thirteen', 'children') });
  const directory = temp(t), kitDirectory = join(directory, 'kit-1'), memory = createMemory(join(directory, 'family.json')); memory.store(family);
  const fresh = 'Name it clear, keep it near.';
  const transport = offlineTransport(t, directory, request => {
    if (request.stage === 'story') return textAnswer(currentVoice);
    if (request.stage === 'story-correction') return textAnswer({ story: currentVoice.story, tagline: fresh });
    if (request.stage === 'story-check') {
      const text = JSON.parse(request.body.input[0].content).story, answer = storyCheckAnswer(text.tagline);
      answer.taglineRhymes = text.tagline === fresh;
      if (answer.taglineRhymes) { answer.taglineEndWords = ['clear', 'near']; answer.evidence.taglineRhymes = 'clear / near'; }
      return textAnswer(answer);
    }
  });
  const result = await createKit(transport, memory, sentences[0], { directory: kitDirectory, kit: 1, stopBeforePictures: true, exports: offlineExports() });
  assert.equal(result.stoppedBeforePictures, true); assert.equal(result.story, currentVoice.story); assert.equal(result.tagline, 'Name it to tame it');
  assert.equal(readJSON(join(kitDirectory, 'story-check-1.json')).answer.taglineRhymes, false);
  assert.equal(readJSON(join(kitDirectory, 'rhyme-selection-1.json')).tagline, result.tagline);
  assert.equal(transport.calls.filter(row => row.stage === 'story-correction').length, 0);
  assert.ok(!transport.calls.some(row => row.stage === 'poster'));
});

test('only actual When I notice frames can cause filledWhenINotice', () => {
  for (const [field, quote] of [['noticedFeeling', 'frustrated'], ['story', 'Everything feels bad.'], ['feelFirst', original.feelFirst[0]], ['tinyTryOptions', original.tinyTryOptions[0].text]]) {
    const result = parse(markFault(storyCheckAnswer(original.tagline), 'filledWhenINotice', quote, [field]));
    assert.equal(result.ready, true, field); assert.ok(result.ignoredFaults.some(row => row.key === 'filledWhenINotice'));
  }
  const story = { ...original, replayCue: 'When I notice sad, I dance.' };
  const result = parse(markFault(storyCheckAnswer(story.tagline), 'filledWhenINotice', story.replayCue, ['replayCue']), story);
  assert.deepEqual(result.faults, []); assert.ok(result.reviewFlags.some(row => row.key === 'filledWhenINotice')); assert.deepEqual(correctionPlan(result), { fields: [], rewrite: false });
  assert.throws(() => validateStory(story), /filled_When_I_notice/);
});

test('screen-only faults respect at least one off-screen choice and only the permitted fields', () => {
  const answer = markFault(storyCheckAnswer(original.tagline), 'screenOnlyPlace', original.tinyTryOptions[0].text, ['tinyTryOptions']);
  assert.equal(parse(answer).ready, true);
  const allScreens = { ...original, tinyTryOptions: original.tinyTryOptions.map(row => ({ ...row, offScreen: false })) };
  assert.ok(parse(answer, allScreens).reviewFlags.some(row => row.key === 'screenOnlyPlace'));
  const misplaced = markFault(storyCheckAnswer(original.tagline), 'screenOnlyPlace', 'frustrated', ['noticedFeeling']);
  assert.equal(parse(misplaced).ready, true); assert.ok(parse(misplaced).ignoredFaults.length);
});

test('required approved practice quoted in the chapter becomes a fixed-wording review note', () => {
  const answer = markFault(storyCheckAnswer(original.tagline), 'adviceOutsideRecord', moves[0].practiceScript, ['story']);
  const result = parse(answer);
  assert.equal(result.ready, true); assert.deepEqual(result.reviewFlags[0].fields, ['move.practiceScript']);
  const other = { ...original, story: original.story + '\n' + moves[0].practiceScript.split('.')[0] + '.' };
  answer.evidence.adviceOutsideRecord = moves[0].practiceScript.split('.')[0];
  assert.ok(parse(answer, other).reviewFlags.some(row => row.key === 'adviceOutsideRecord'));
});

test('all judge keys have an explicit scope and the brief resolves required-field conflicts', () => {
  assert.deepEqual(Object.keys(judgeFaultFields).sort(), [...storyCheckKeys].sort());
  const request = buildStoryCheckRequest(original, moves[0]);
  for (const text of ['never the child', 'Exactly THREE', 'One off-screen option', 'taglineRhymes', 'current kit rhyme', 'taglineEndWords']) assert.ok(request.instructions.includes(text), text);
  for (const key of storyCheckKeys) assert.ok(request.instructions.includes(JSON.stringify(key)), key);
  assert.equal(request.reasoning.effort, 'medium');
  assert.deepEqual(JSON.parse(buildStoryRequest(family, sentences[0]).input[0].content).chapterShapeRules, chapterShapeRules);
});

for (const [rule, spec] of Object.entries(chapterShapeRules)) test(`chapter finding ${rule} carries its part, count and FORMAT limit`, () => {
  const text = kitText(moves.find(move => move.id === 'one-brave-step'));
  const quote = spec.field === 'story' ? 'This feels hard.' : text.panelLines[0].line;
  const answer = markFault(storyCheckAnswer(text.tagline), 'chapterShapeWrong', quote, [spec.field]);
  answer.chapterShapeFindings = [{ rule, observedCount: spec.max === 0 ? 1 : 0, evidence: quote }];
  const result = parse(answer, text, moves.find(move => move.id === text.moveId));
  assert.deepEqual(result.faults, []); assert.ok(result.reviewFlags.some(row => row.key === 'chapterShapeWrong'));
  const row = result.chapterShapeFindings[0]; assert.equal(row.rule, rule); assert.deepEqual(row.limit, { min: spec.min, max: spec.max });
  assert.equal(row.reportOnly, true); assert.equal(row.observedCount, spec.max === 0 ? 1 : 0);
});

test('a synthetic complete vocabulary-count verdict is saved without buying a rewrite', async t => {
  // New offline provider verdict, not fabricated assessments attached to raw run 14.
  const currentVoice = withSyntheticSpeakers({ ...original, story: original.story.replace('children aged eight to thirteen', 'children') });
  const directory = temp(t);
  const transport = offlineTransport(t, directory, request => {
    if (request.stage === 'story') return textAnswer(currentVoice);
    if (request.stage === 'story-check') {
      const answer = markFault(storyCheckAnswer(currentVoice.tagline), 'chapterShapeWrong', rawChecks[0].answer.evidence.chapterShapeWrong, ['story']);
      answer.chapterShapeFindings = [{ rule: 'explainedWords', observedCount: 4, evidence: answer.evidence.chapterShapeWrong }];
      return textAnswer(answer);
    }
    assert.fail('A vocabulary count must not buy a story rewrite.');
  });
  const result = await readyStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.ready, true); assert.equal(result.story, currentVoice.story);
  assert.ok(result.reviewFlags.some(row => row.key === 'chapterShapeWrong'));
  assert.deepEqual(transport.calls.map(row => row.stage), ['story', 'story-check']);
});

test('counted chapter findings must name valid rules and evidence and cannot fault a count inside its limits', () => {
  const answer = markFault(storyCheckAnswer(original.tagline), 'chapterShapeWrong', 'frustrated', ['story']);
  for (const finding of [{ rule: 'invented', observedCount: 4, evidence: 'frustrated' }, { rule: 'explainedWords', observedCount: '4', evidence: 'frustrated' }]) {
    answer.chapterShapeFindings = [finding]; assert.equal(parse(answer).needsRecheck, false); assert.ok(parse(answer).reviewFlags.length);
  }
  answer.chapterShapeFindings = [{ rule: 'explainedWords', observedCount: 3, evidence: 'frustrated' }];
  assert.equal(parse(answer).ready, true); assert.ok(parse(answer).reviewFlags.some(row => row.key === 'chapterShapeWrong'));
});

test('run 14 public fixture revisions match recorded checksums and all five enter the replay', () => {
  const mappings = [['kit-log.md', 'run14-kit-log.md'], ['story-attempt-1.json', 'run14-story-1.json'], ['story-check-1.json', 'run14-story-check-1.json'], ['story-check-2.json', 'run14-story-check-2.json'], ['tagline-end-words-1.json', 'run14-tagline-end-words-1.json']];
  const rows = replaySaved({ directories: [new URL('./fixtures/', import.meta.url).pathname] });
  const checksums = readJSON(new URL('./fixtures/run14-checksums.json', import.meta.url));
  for (const [source, fixture] of mappings) {
    const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
    assert.equal(sha(new URL(`./fixtures/${fixture}`, import.meta.url)), checksums.files[fixture]);
    assert.ok(rows.some(row => row.id.startsWith(`test/fixtures/${fixture}`)), fixture);
  }
  assert.equal(rows.find(row => row.id === 'test/fixtures/run14-story-1.json').verdict, 'PASS');
  for (const n of [1, 2]) {
    const verdict = rows.find(row => row.id === `test/fixtures/run14-story-check-${n}.json#/answer`);
    assert.equal(verdict.verdict, 'REVIEW');
    assert.match(verdict.reasons.join(' '), /no assessments for.*narrativeEssay/);
  }
});


test('correct empty frames and explicitly off-screen places cannot become correction loops', () => {
  const story = { ...original, replayCue: 'When I notice ______, I ______.' };
  const frame = markFault(storyCheckAnswer(story.tagline), 'filledWhenINotice', story.replayCue, ['replayCue']);
  assert.equal(parse(frame, story).ready, true);
  const place = markFault(storyCheckAnswer(story.tagline), 'screenOnlyPlace', story.whereElse.place, ['whereElse']);
  assert.equal(parse(place, story).ready, true);
  assert.ok(parse(place, story).ignoredFaults.some(row => /away from screens/.test(row.reason)));
});

test('an unsupported generated chapter count never discards a simultaneous fixed-wording review flag', () => {
  const answer = markFault(storyCheckAnswer(original.tagline), 'chapterShapeWrong', 'frustrated', ['story', 'move.name']);
  answer.chapterShapeFindings = [{ rule: 'explainedWords', observedCount: 3, evidence: 'frustrated' }];
  const result = parse(answer);
  assert.equal(result.ready, true); assert.deepEqual(result.reviewFlags[0].fields, ['move.name']);
});

test('a new chapter finding cannot reject with an empty list of subrules', () => {
  const answer = markFault(storyCheckAnswer(original.tagline), 'chapterShapeWrong', 'frustrated', ['story']);
  answer.chapterShapeFindings = [];
  const result = parse(answer);
  assert.equal(result.needsRecheck, false); assert.ok(result.reviewFlags.some(row => row.key === 'chapterShapeWrong'));
});
