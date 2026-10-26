import { expectReview } from './review-assertions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { moves, readJSON, words } from '../server/files.js';
import { anonymousLabels, scrubIdentityText, scrubWriterImageText, writerImageFields } from '../server/writer-image-text.js';
import { privacyFor, assertNoFamilyText, buildPosterRequest, buildPanelRequest } from '../server/requests.js';
import { validateStory, writeStory, readyStory } from '../server/story.js';
import { checkStory, parseStoryCheck } from '../server/check-story.js';
import { selectedRhymeFor } from '../server/rhyme.js';
import { withKitEvidence } from '../server/kit-evidence.js';
import { bubbleInStory, posterBoxes } from '../server/format.js';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { family, sentences } from './fixture.mjs';
import { kitText, withSyntheticSpeakers } from './kit-text-fixture.mjs';
import { syntheticCastEvidence, storyCheckAnswer, wordCheckAnswer, markFault } from './checker-fixture.mjs';
import { offlineTransport, textAnswer, openaiAnswer, offlineExports } from './offline-kit-fixture.mjs';

const raw = withSyntheticSpeakers(readJSON(new URL('./fixtures/run8-story-1.json', import.meta.url)));
const patch = readJSON(new URL('./fixtures/run8-story-2.json', import.meta.url));
const rawCheck = readJSON(new URL('./fixtures/run8-story-check.json', import.meta.url));
const temp = t => { const path = mkdtempSync(join(tmpdir(), 'pass16-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; };
// Archived run 8 used a fox; keep that saved identity scoped to its privacy regression.
const privacy = { ...privacyFor(family, sentences[0]), heroName: 'Pip the Fox', species: 'fox' };
const cleanedRun8 = () => ({ ...scrubWriterImageText(raw, privacy).text, ...patch });
// Explicit synthetic current provider input. Historical run 8 and its long rhyme stay untouched.
const currentRun8 = () => ({ ...structuredClone(raw), tagline: 'Name it clear, keep it near.' });

test('the exact run 8 strings become natural anonymous directions before picture builders', () => {
  const { text, changes } = scrubWriterImageText(raw, privacy);
  assert.equal(text.chapterTitle, 'The fox and the Sharper Word');
  assert.equal(text.panelLines[0].scene, 'The fox lies on a floor in a comic panel, fur puffed, glasses crooked, looking up at the ceiling.');
  assert.equal(text.panelLines[1].scene, 'The fox sits cross legged over an open sketchbook, squinting at a blank page with the pencil raised.');
  assert.equal(text.jokeIdea, "The fox's pencil paw wears a big oven mitten, and the pencil makes a blobby scribble on the page.");
  assert.equal(text.story, raw.story); assert.equal(patch.story, raw.story);
  assert.equal(changes.length, 6);
  assert.deepEqual(scrubWriterImageText(text, privacy), { text, changes: [], violations: [], remainingViolations: [] }, 'Scrub is idempotent');
  const merged = { ...text, ...patch };
  const move = moves.find(move => move.id === merged.moveId);
  assert.doesNotThrow(() => validateStory(merged, { nickname: family.hero.nickname, parentLabel: family.parentLabel, privacy }));
  // Saved privacy evidence stays intact; a fresh poster uses the current short rhyme.
  assert.doesNotThrow(() => buildPosterRequest(family, move, sentences[0], { ...merged, tagline: selectedRhymeFor(move).tagline }));
  for (const panel of merged.panelLines) assert.doesNotThrow(() => buildPanelRequest(family, move, sentences[0], panel));
});

test('scrub covers names, parent labels, possessives, case, existing articles and all outbound fields', () => {
  for (const [before, after] of [
    ['PIP THE FOX waits.', 'The fox waits.'],
    ["Pip’s pencil drops.", "The fox's pencil drops."],
    ['The Pip the Fox waits.', 'The fox waits.'],
    ['Pip, the fox, waits.', 'The fox waits.'],
    ['Pip asks Dee for help.', 'The fox asks a grown-up for help.'],
    ["Dee's hand is open.", "A grown-up's hand is open."],
    ['I ask my Dee.', 'I ask a grown-up.'],
    ['Pippin has a pipe.', 'Pippin has a pipe.'],
  ]) assert.equal(scrubIdentityText(before, privacy), after, before);
  const text = { ...kitText(), chapterTitle: 'Pip and Dee', tagline: 'Pip names it clear, Dee stays near.', jokeIdea: "Pip's hat hides Dee's cup." };
  text.panelLines.forEach(panel => { panel.scene = 'Pip the Fox turns to Dee.'; panel.line = 'Dee, Pip can try.'; });
  const clean = scrubWriterImageText(text, privacy).text;
  for (const item of writerImageFields(clean)) assert.doesNotMatch(item.value, /\bPip\b|\bDee\b/i, item.field);
  assert.equal(clean.story, text.story);
});

test('species comes from the saved hero label and unusual names stay bounded', () => {
  const context = { nickname: 'Pip+', heroName: 'Pip+ the Cat', parentLabel: 'Aunt Dee' };
  assert.deepEqual(anonymousLabels(context), { hero: 'the cat', parent: 'a grown-up' });
  assert.equal(scrubIdentityText("Pip+'s cup sits near Aunt Dee.", context), "The cat's cup sits near a grown-up.");
  assert.equal(scrubIdentityText('Dee helps Pip+.', context), 'A grown-up helps the cat.');
  assert.equal(anonymousLabels({ nickname: 'Fox', heroName: 'Fox the Fox', parentLabel: 'Dad' }).hero, 'the hero');
  assert.equal(anonymousLabels({ nickname: 'Ada', heroName: 'Ada', parentLabel: 'Mom' }).hero, 'the hero');
});

test('validation names the exact writer field for remaining identity or family data', () => {
  const cases = [
    ['chapterTitle', value => { value.chapterTitle = 'Pip tries the puzzle'; }],
    ['tagline', value => { value.tagline = 'Pip names it clear, keep it near.'; }],
    ['jokeIdea', value => { value.jokeIdea = 'A little brother points at the table.'; }],
    ['panelLines[1].scene', value => { value.panelLines[1].scene = 'Dee watches the fox.'; }],
    ['panelLines[2].line', value => { value.panelLines[2].line = 'Soccer tryouts are next week.'; }],
  ];
  for (const [field, change] of cases) {
    const value = kitText(); change(value);
    assert.throws(() => validateStory(value, { privacy }), error => error.message.startsWith(`writer_field_privacy: ${field}`) && error.failure.measured >= 1 && error.failure.limit.max === 0);
  }
  const alternate = { ...privacy, nickname: 'Pip', heroName: 'Aurora the Fox' };
  assert.throws(() => assertNoFamilyText('Aurora draws.', alternate), /hero name/);
  const parent = { ...privacy, parentLabel: 'Dad' }, value = kitText(); value.jokeIdea = 'Dad wears a hat.';
  assert.throws(() => validateStory(value, { privacy: parent }), /jokeIdea.*remaining parent label/);
});

test('scrubbed bubbles match an anonymous story view while original chapter words and cut stay intact', () => {
  const text = kitText();
  text.story = text.story.replace('This feels hard.', 'Pip, this feels hard.').replace('I can try this.', 'Dee, I can try this.');
  text.panelLines[0].line = 'Pip, this feels hard.'; text.panelLines[1].line = 'Dee, I can try this.';
  const clean = scrubWriterImageText(text, privacy).text;
  const { pagination } = validateStory(clean, { privacy });
  assert.equal(clean.story, text.story);
  assert.deepEqual(pagination.pages.flatMap(words), words(text.story.replace(/^MADE UP\n/, '')));
  for (const [index, panel] of clean.panelLines.entries()) assert.ok(bubbleInStory(pagination.pages[pagination.panelPages[index]], panel.line, { matchText: value => scrubIdentityText(value, privacy) }));
  assert.equal(clean.panelLines[0].line, 'The fox, this feels hard.');
});

test('family phrases are scrubbed before the writer answer reaches any picture request', async t => {
  const directory = temp(t), original = kitText(); original.jokeIdea = 'A toy points at soccer tryouts.';
  const transport = offlineTransport(t, directory, request => request.stage === 'story' ? textAnswer(original) : undefined);
  const result = await readyStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.ready, true); assert.equal(result.jokeIdea, 'A toy points at a game.');
  assert.ok(!transport.calls.some(call => call.stage === 'story-correction'));
  assert.equal(readFileSync(join(directory, 'story-attempt-1.reason.txt'), 'utf8').trim(), 'PASS');
  assert.ok(readJSON(join(directory, 'writer-field-scrub-1.json')).violations.some(hit => hit.field === 'jokeIdea'));
});

test('synthetic current run 8 replay keeps its long feeling field and saved answer without a count repair', async t => {
  const synthetic = currentRun8();
  const directory = temp(t), transport = offlineTransport(t, directory, request => {
    if (request.stage === 'story') return textAnswer(synthetic);
    if (request.stage === 'story-correction') return textAnswer(patch);
    if (request.stage === 'story-check' && request.retry === 0) return structuredClone(rawCheck.response);
  });
  const result = await readyStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.ready, true); assert.equal(result.tagline, selectedRhymeFor(moves[0]).tagline);
  assert.equal(transport.calls.filter(call => call.stage === 'story-check').length, 2); assert.equal(result.noticedFeeling, raw.noticedFeeling);
  assert.deepEqual(readJSON(join(directory, 'story-attempt-1.json')), synthetic);
  assert.ok(!transport.calls.some(call => call.stage === 'story-correction'));
  assert.deepEqual(readJSON(join(directory, 'kit-text-final.json')), result);
  assert.equal(result.chapterTitle, 'The hero and the Sharper Word'); assert.equal(result.story, raw.story);
  for (const name of ['kit-text-final.json', 'writer-field-scrub-1.json']) assert.equal(statSync(join(directory, name)).mode & 0o777, 0o600);
});

test('named rhyme words can occur before identical tails without code deriving halves', () => {
  for (const [tagline, pair] of [['Name it to tame it', ['Name', 'tame']], ["Check it, don't wreck it", ['Check', 'wreck']]]) {
    const text = { ...kitText(), tagline }, answer = storyCheckAnswer(tagline); answer.taglineEndWords = pair;
    const result = parseStoryCheck(JSON.stringify(answer), { story: text, move: moves[0] });
    assert.equal(result.ready, true); assert.equal(result.rhyme.rhymes, true); assert.deepEqual(result.rhyme.namedWords, pair);
  }
});

for (const faulty of [['imaginary', 'words'], [], null, ['clear'], [12, 34], undefined]) test(`two bad named-pair answers stop unverified after one recheck without a code sound verdict: ${JSON.stringify(faulty)}`, async t => {
  const directory = temp(t), text = kitText();
  const transport = offlineTransport(t, directory, request => {
    if (request.stage === 'story') return textAnswer(text);
    const answer = storyCheckAnswer(text.tagline); answer.taglineEndWords = faulty; return textAnswer(answer);
  });
  await assert.rejects(readyStory(withKitEvidence(transport, directory), family, sentences[0]), error => error.code === 'content_check_unverified' && error.canResume === true);
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-check', 'story-check']);
  for (const attempt of [1, 2]) {
    const saved = readJSON(join(directory, `story-check-${attempt}.json`));
    if (faulty !== undefined) assert.deepEqual(saved.answer.taglineEndWords, faulty);
    else assert.equal(Object.hasOwn(saved.answer, 'taglineEndWords'), false);
    assert.equal(saved.check.ready, false); assert.equal(saved.check.verified, false); assert.equal(saved.check.rhyme, undefined);
    assert.equal(saved.check.needsRecheck, attempt === 1);
  }
});

test('a corrected judge pair preserves genuine generated-field faults', async t => {
  const directory = temp(t), text = kitText();
  const transport = offlineTransport(t, directory, request => {
    const answer = markFault(storyCheckAnswer(text.tagline), 'secondMoveTaught', 'This feels hard.', ['story']);
    if (request.retry === 0) answer.taglineEndWords = ['fake', 'words'];
    return textAnswer(answer);
  });
  const checked = await checkStory(withKitEvidence(transport, directory), text, moves[0]);
  assert.equal(checked.needsRecheck, false); assert.equal(checked.ready, false);
  assert.ok(checked.faults.includes('secondMoveTaught')); assert.deepEqual(checked.rhyme.namedWords, ['Name', 'tame']); assert.equal(checked.verified, true); assert.equal(transport.calls.length, 2);
  assert.equal(readJSON(join(directory, 'story-check-2.json')).answer.secondMoveTaught, true);
  const saved = readJSON(join(directory, 'story-check-1.json')); assert.equal(saved.answer.secondMoveTaught, true); assert.deepEqual(saved.answer.taglineEndWords, ['fake', 'words']);
});

test('a bad end-word answer followed by an incomplete verdict still fails without inventing checks', async t => {
  const directory = temp(t), text = kitText();
  const transport = offlineTransport(t, directory, request => {
    const answer = storyCheckAnswer(text.tagline); answer.taglineEndWords = ['fake', 'words'];
    if (request.retry === 1) delete answer.secondMoveTaught;
    return textAnswer(answer);
  });
  const checked = await checkStory(transport, text, moves[0]);
  assert.equal(checked.ready, false); assert.equal(checked.needsRecheck, false); assert.equal(checked.verified, false); assert.equal(checked.rhyme, undefined);
  assert.equal(transport.calls.length, 2); assert.equal(checked.checkStatus, 'unverified');
  assert.equal(Object.hasOwn(checked.answers, 'secondMoveTaught'), false, 'Missing content assessments are never invented.');
});

test('saved rhymes retain their current lines and approval records without edit history', () => {
  const records = readJSON(new URL('../content/rhymes-draft.json', import.meta.url));
  const expected = {
    'coach-voice': ['Talk kind inside,', 'be your own guide.'],
    'dont-feed-the-fire': ['In private, say,', '"Are you okay?"'],
    'check-my-battery': ['Sleep, stretch, or thirst?', 'Body check first.'],
  };
  for (const move of moves) assert.doesNotThrow(() => selectedRhymeFor(move, records), move.id);
  for (const [id, lines] of Object.entries(expected)) {
    const record = records.find(row => row.moveId === id);
    assert.deepEqual(record.lines, lines); assert.equal(record.lines.length, 2);
    assert.equal(record.approval.status, 'pending'); assert.equal(record.selection.ownerApproval, false);
    assert.ok(!Object.keys(record).some(key => /Original|Before|WrittenByCodex|draftStatus/.test(key)));
    assert.equal(selectedRhymeFor(moves.find(move => move.id === id), records).tagline, lines.join(' '));
  }
});

test('a synthetic current run 8 kit passes privacy and uses its saved topic reminder downstream', async t => {
  const directory = temp(t), synthetic = currentRun8();
  const memory = createMemory(join(directory, 'family.json')); memory.store(family);
  const transport = offlineTransport(t, directory, request => {
    if (request.stage === 'story') return textAnswer(synthetic);
    if (request.stage === 'story-check' && request.retry === 0) return structuredClone(rawCheck.response);
    // Current default OCR follows the actual checked story, including all four comic panels.
  });
  const result = await createKit(transport, memory, sentences[0], { directory, kit: 1, exports: offlineExports() });
  assert.equal(result.complete, true); assert.equal(result.pdf.fixture, true); assert.equal(result.tagline, selectedRhymeFor(moves[0]).tagline);
  assert.equal(result.rhymeSelection.source, 'topic');
  assert.ok(transport.calls.some(call => call.stage === 'poster'));
  assert.equal(result.art.poster.expectedBoxes.find(box => box.id === 'tagline').text, result.tagline);
  const final = readJSON(join(directory, 'kit-text-final.json'));
  for (const key of ['chapterTitle', 'tagline', 'jokeIdea', 'panelLines', 'noticedFeeling', 'story']) assert.deepEqual(final[key], result[key], key);
  for (const request of transport.calls.filter(call => call.provider === 'openai' && !['story', 'story-rewrite', 'story-correction', 'story-check'].includes(call.stage))) assert.doesNotThrow(() => assertNoFamilyText(request.body, request.privacy));
});
