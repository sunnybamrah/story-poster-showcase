import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moves } from '../server/files.js';
import { snapshotTopicRhyme, selectedRhymeFor, savedRhymeSelection, rhymeForKit, rhymeNeedsRefresh } from '../server/rhyme.js';
import { writeStory, readyStory, validateStory } from '../server/story.js';
import { buildStoryRequest, buildPosterRequest } from '../server/requests.js';
import { makePages, printedText } from '../server/layout.js';
import { family, sentences } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { offlineTransport, textAnswer } from './offline-kit-fixture.mjs';

const move = moves[0];
const temp = t => { const p = mkdtempSync(join(tmpdir(), 'topic-reminder-')); t.after(() => rmSync(p, { recursive: true, force: true })); return p; };
const pending = lines => ({ moveId: move.id, lines, author: 'Fixture writer', approval: { status: 'pending', by: null }, selection: { by: 'Fixture reviewer', authority: 'Test only', ownerApproval: false } });

test('two moments keep the same topic reminder while their stories and scene directions differ', async t => {
  const results = [];
  for (const [index, concern] of [sentences[0], sentences[0] + ' Later, a painting went wrong.'].entries()) {
    const directory = temp(t);
    const answer = JSON.parse(JSON.stringify(kitText(move)).replaceAll('puzzle', index ? 'painting' : 'puzzle'));
    answer.tagline = index ? 'Find the clue. What is true.' : 'Name it clear, keep it near.';
    const transport = offlineTransport(t, directory, request => request.stage === 'story' ? textAnswer(answer) : undefined);
    const result = await readyStory(transport, family, concern, { kit: index + 1, lockedMoveId: move.id, allowRepeat: true });
    results.push(result);
    assert.equal(result.tagline, 'Name it to tame it');
    assert.equal(result.rhymeSelection.mode, 'topic-v1');
    assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-check']);
    const request = JSON.parse(transport.calls[0].body.input[0].content);
    assert.equal(request.topicReminders[0].tagline, result.tagline);
  }
  assert.notEqual(results[0].story, results[1].story);
  assert.notDeepEqual(results[0].panelLines, results[1].panelLines);
  assert.equal(results[0].rhymeSelection.selected.sha256, results[1].rhymeSelection.selected.sha256);
});

test('a topic default changing between write attempts does not change the pinned reminder', async t => {
  const original = move.rhymeRecord;
  t.after(() => { if (original === undefined) delete move.rhymeRecord; else move.rhymeRecord = original; });
  let calls = 0;
  const transport = offlineTransport(t, temp(t), request => {
    if (request.stage !== 'story') return;
    assert.equal(JSON.parse(request.body.input[0].content).topicReminders.find(row => row.moveId === move.id).tagline, 'Name it to tame it');
    if (++calls === 1) { move.rhymeRecord = pending(['Find the clue.', 'What is true.']); return textAnswer({ story: 'Incomplete answer.' }); }
    return textAnswer(kitText(move));
  });
  const result = await writeStory(transport, family, sentences[0], { lockedMoveId: move.id });
  assert.equal(calls, 2); assert.equal(result.tagline, 'Name it to tame it');
  assert.equal(result.rhymeSelection.approved, true);
});

test('saved reminder and its approval survive a later default change in requests and exports', () => {
  const selection = snapshotTopicRhyme(move);
  const text = { ...kitText(move), rhymeSelection: selection };
  const changedMove = { ...move, rhymeRecord: pending(['Find the clue.', 'What is true.']) };
  assert.notEqual(selectedRhymeFor(changedMove).tagline, text.tagline);
  assert.equal(rhymeForKit(text, changedMove).approved, true);
  assert.equal(rhymeNeedsRefresh(text, changedMove), false);
  const request = buildStoryRequest(family, sentences[0], { lockedMoveId: move.id, previousStory: text });
  assert.equal(JSON.parse(request.input[0].content).topicReminders[0].tagline, text.tagline);
  text.pagination = validateStory(text).pagination;
  const pages = makePages(changedMove, text);
  assert.ok(printedText(pages['for-you.html']).includes(text.tagline));
  assert.match(pages['for-you.html'], /Approved by Sunny/);
  assert.ok(!pages['for-you.html'].includes('Find the clue. What is true.'));
  assert.doesNotThrow(() => buildPosterRequest(family, changedMove, '', text));
});

test('approved long reminders are accepted and attached guide records cannot grant approval', () => {
  const record = pending(['Pause for a clue.', 'Check what is true.']);
  record.approval = { status: 'approved', by: 'Sunny', text: record.lines.join(' ') };
  const selected = selectedRhymeFor(move, [record]);
  const selection = snapshotTopicRhyme(move, selected);
  const text = { ...kitText(move), tagline: selected.tagline, rhymeSelection: selection };
  assert.equal(rhymeForKit(text, move).approved, true);
  assert.doesNotThrow(() => buildPosterRequest(family, move, '', text));
  assert.throws(() => selectedRhymeFor({ ...move, rhymeRecord: record }), /attached record cannot grant/);
});

test('changed snapshot words or approval cannot silently pass Resume', () => {
  const original = { ...kitText(move), rhymeSelection: snapshotTopicRhyme(move) };
  for (const mutate of [text => { text.tagline += ' now'; }, text => { text.rhymeSelection.selected.approved = false; }, text => { text.rhymeSelection.ownerApproved = false; }, text => { text.rhymeSelection.moveId = 'another-topic'; }]) {
    const changed = structuredClone(original); mutate(changed);
    assert.throws(() => savedRhymeSelection(changed, move), /Saved .* changed/);
  }
  assert.equal(savedRhymeSelection(original, move).tagline, original.tagline);
});

test('unversioned historical text never gains approval just by matching today’s default', () => {
  const text = kitText(move);
  text.pagination = validateStory(text).pagination;
  assert.equal(rhymeForKit(text, move).approved, false);
  assert.equal(rhymeForKit(text, move).source, 'historical');
  assert.doesNotMatch(makePages(move, text)['for-you.html'], /Approved by Sunny/);
});

test('a malformed one-word proposal cannot replace ordinary words or bubbles', async t => {
  const directory = temp(t), original = kitText(move); let attempt = 0;
  const transport = offlineTransport(t, directory, request => {
    const payload = JSON.parse(request.body.input[0].content);
    assert.equal(payload.topicReminders[0].tagline, original.tagline);
    return ++attempt === 1 ? textAnswer({ ...original, tagline: 'I' }) : textAnswer({ story: original.story, tagline: 'I can try this.' });
  });
  const result = await writeStory(transport, family, sentences[0], { lockedMoveId: move.id });
  assert.equal(result.tagline, original.tagline);
  assert.equal(result.story, original.story);
  assert.deepEqual(result.panelLines, original.panelLines);
  assert.equal(transport.calls.length, 2);
});

test('binding a new reminder never rewrites a supplied quotation', async t => {
  const text = kitText(move), quote = 'Name it clear, keep it near.';
  text.tagline = quote;
  text.story += '\nThe teacher said, "' + quote + '"';
  const transport = offlineTransport(t, temp(t), () => textAnswer(text));
  const result = await writeStory(transport, family, sentences[0] + ' The teacher said, "' + quote + '"', { lockedMoveId: move.id });
  assert.equal(result.tagline, 'Name it to tame it');
  assert.equal(result.story, text.story);
});

test('the current base-guide owner choices overlay reminders without changing source move records', () => {
  const expected = {
    'compare-with-past-me': 'Not their race. Grow at your pace.',
    'good-enough-is-done': 'Meet the line. Then stop on time.',
    'make-it-right': 'Own the sting. Repair one thing.',
    'check-my-battery': 'Before I decide, I check inside.',
  };
  for (const [id, tagline] of Object.entries(expected)) {
    const source = moves.find(move => move.id === id) ?? { id, rhymeRecord: { ...pending(['Keep it near.', 'Your choice here.']), moveId: id } };
    const before = structuredClone(source), selected = selectedRhymeFor(source);
    assert.equal(selected.tagline, tagline); assert.equal(selected.approved, true);
    assert.deepEqual(source, before);
  }
});
