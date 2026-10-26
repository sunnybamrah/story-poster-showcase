import test from 'node:test';
import assert from 'node:assert/strict';
import { moves } from '../server/files.js';
import { selectedRhymeFor } from '../server/rhyme.js';
import { backupFor, backupNameFor, backupPlanLineFor, backupPracticeLineFor, backupActionFor, isUntimedSourceAction, posterBoxes, tinyTryOptionsFor } from '../server/format.js';
import { inspectAnswer } from '../server/answer-shape.js';
import { writerSchema, writerRequestSchema } from '../server/answer-schemas.js';
import { validateStory, applyFieldCorrection } from '../server/story.js';
import { buildStoryRequest, buildStoryCheckRequest } from '../server/requests.js';
import { makePages, verifyOwnedWords, visibleText } from '../server/layout.js';
import { posterTypePlan } from '../server/poster-template.js';
import { buildInteractiveContent } from '../server/interactive-assets.js';
import { kitEditorial } from '../server/kit-editorial.js';
import { kitText } from './kit-text-fixture.mjs';
import { family, sentences } from './fixture.mjs';

// Synthetic consumer fixture only. This is not a fetched or approved teaching guide.
function withUntimedMove(t) {
  const move = structuredClone(moves[0]);
  move.id = 'lib-000000000000000000000009';
  const rhyme = selectedRhymeFor(moves[0]);
  move.rhymeRecord = { moveId: move.id, lines: rhyme.lines, author: 'Synthetic test fixture', approval: { status: 'pending', by: null }, selection: { by: 'Synthetic test fixture', authority: 'Consumer tests only', ownerApproval: false } };
  move.library = { schemaVersion: 2, actionKind: 'source-derived', practiceMode: 'untimed', actionBaseMoveId: null, status: 'reusable', printSourceIds: kitEditorial.printSources[moves[0].id] };
  move.approvedBackup = null;
  move.tryItDraft.options = move.tryItDraft.options.map(option => ({ ...option, seconds: null }));
  moves.push(move);
  t.after(() => moves.splice(moves.indexOf(move), 1));
  const text = kitText(move);
  text.tinyTryOptions = tinyTryOptionsFor(move);
  return { move, text };
}

test('only the complete v2 untimed source-action stamp permits no older backup', t => {
  const { move } = withUntimedMove(t);
  assert.equal(backupFor(move), null);
  assert.equal(backupNameFor(move), 'Leave this for later');
  assert.equal(backupPlanLineFor(move), 'Leave this for later');
  assert.equal(backupPracticeLineFor(move), 'Leave this for later');
  for (const field of ['schemaVersion', 'actionKind', 'practiceMode']) {
    const incomplete = structuredClone(move);
    delete incomplete.library[field];
    assert.equal(isUntimedSourceAction(incomplete), false);
    assert.throws(() => backupFor(incomplete), /backup from the fixed move list/);
  }
  assert.throws(() => backupFor({ ...move, approvedBackup: 'missing' }), /backup from the fixed move list/);
});

test('every original keeps its existing backup wording and numeric writer schema', () => {
  for (const move of moves.filter(move => !move.library)) {
    const backup = moves.find(item => item.id === move.approvedBackup);
    assert.equal(backupFor(move), backup);
    assert.equal(backupPlanLineFor(move), `Backup: ${backup.name}`);
    assert.equal(backupPracticeLineFor(move), `Another way to try: ${backupActionFor(move)}`);
    assert.ok(tinyTryOptionsFor(move).every(option => typeof option.seconds === 'number'));
  }
  assert.deepEqual(writerRequestSchema().properties.tinyTryOptions.items.properties.seconds, { type: 'number' });
  const original = kitText();
  original.tinyTryOptions[0].seconds = null;
  assert.throws(() => validateStory(original), /finite number of seconds/);
});

test('nullable writer schemas preserve numeric typing and do not admit other values', t => {
  const { text } = withUntimedMove(t);
  assert.deepEqual(writerSchema(['tinyTryOptions[0].seconds'], { untimed: true }).properties['tinyTryOptions[0].seconds'], { type: ['number', 'null'] });
  assert.equal(inspectAnswer(text, writerRequestSchema(undefined, { untimed: true })).issues.length, 0);
  assert.ok(inspectAnswer(text, writerRequestSchema()).issues.some(issue => issue.includes('seconds')));
  for (const value of [false, '', {}, [], NaN, Infinity]) {
    assert.ok(inspectAnswer(value, { type: ['number', 'null'] }).issues.length);
  }
  assert.equal(inspectAnswer(null, { type: 'null' }).issues.length, 0);
});

test('untimed story validation and narrow corrections reject invented timers', t => {
  const { move, text } = withUntimedMove(t);
  const result = validateStory(text);
  assert.equal(result.id, move.id);
  assert.equal(result.guidance.some(row => row.unit === 'seconds'), false);
  const corrected = applyFieldCorrection(text, { story: text.story, 'tinyTryOptions[0].seconds': null }, ['tinyTryOptions[0].seconds']);
  assert.equal(validateStory(corrected).id, move.id);
  for (const value of [0, 30, '30', undefined]) {
    const changed = structuredClone(text);
    changed.tinyTryOptions[0].seconds = value;
    assert.throws(() => validateStory(changed), /use null for this untimed action/);
  }
});

test('writers and judges receive the untimed rule only when applicable', t => {
  const { move } = withUntimedMove(t);
  const tonight = 'Please help with a new practical learning goal.';
  const record = { ...structuredClone(family), libraryMatch: { moveId: move.id, tonight } };
  const request = buildStoryRequest(record, tonight, { lockedMoveId: move.id });
  assert.match(request.instructions, /UNTIMED ACTION OVERRIDE/);
  assert.deepEqual(request.text.format.schema.properties.tinyTryOptions.items.properties.seconds, { type: ['number', 'null'] });
  assert.equal(JSON.parse(request.input[0].content).moves[0].approvedBackup, null);
  const original = buildStoryRequest(family, sentences[0]);
  assert.doesNotMatch(original.instructions, /UNTIMED ACTION OVERRIDE/);
  assert.deepEqual(original.text.format.schema.properties.tinyTryOptions.items.properties.seconds, { type: 'number' });
  assert.match(buildStoryCheckRequest(kitText(move), move).instructions, /Null is correct for that move/);
});

test('the five pages, poster and tap content use permission to stop without inventing a backup action', t => {
  const { move, text } = withUntimedMove(t);
  text.pagination = validateStory(text).pagination;
  const pages = makePages(move, text);
  assert.deepEqual(Object.keys(pages).filter(name => name.endsWith('.html')).sort(), ['for-you.html', 'poster.html', 'story-2.html', 'story.html', 'try.html']);
  assert.equal(verifyOwnedWords(pages, move), true);
  assert.match(visibleText(pages['try.html']), /Leave this for later/);
  assert.doesNotMatch(visibleText(pages['try.html']), /Another way to try:/);
  assert.match(pages['try.html'], /data-writing-frame="empty"/);
  assert.doesNotMatch(pages['try.html'], /data-backup=/);
  const plan = posterBoxes(move, text).find(box => box.id === 'move').text;
  assert.equal(plan, 'When I notice ______,\nI ______.\nLeave this for later');
  assert.ok(posterTypePlan(move, text).cards.plan.handwritingHeight >= 24);
  const content = buildInteractiveContent({ move, kit: text, version: 'synthetic-consumer-test' });
  assert.equal(content.sections.plan.backup, 'Leave this for later');
  assert.ok(content.sections.tinyTry.choices.every(line => typeof line === 'string'));
});
