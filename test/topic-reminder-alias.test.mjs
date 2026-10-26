import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { moves, root, readJSON } from '../server/files.js';
import { resolveTopicReminderAlias, selectedRhymeFor, snapshotTopicRhyme, savedRhymeSelection, rhymeForKit } from '../server/rhyme.js';

const fixtureRecord = (moveId, lines) => ({ moveId, lines, author: 'Fixture writer', approval: { status: 'pending', by: null }, selection: { by: 'Fixture checker', authority: 'Test only', ownerApproval: false } });

test('public topic reminders point only to guides in the 14-guide edition', () => {
  const reminders = readJSON(new URL('../content/topic-reminders.json', import.meta.url));
  const ids = new Set(moves.map(move => move.id));
  assert.ok(moves.length === 14);
  for (const row of reminders) {
    assert.ok(ids.has(row.moveId), `No reminder for omitted library entry: ${row.moveId}`);
    if (row.canonicalMoveId) assert.ok(ids.has(row.canonicalMoveId));
  }
  for (const move of moves) assert.ok(selectedRhymeFor(move).tagline.trim());
});

test('base guide topic rhymes retain their exact saved wording on resume', () => {
  const move = moves.find(row => row.id === 'compare-with-past-me');
  const selected = selectedRhymeFor(move);
  const saved = snapshotTopicRhyme(move, selected);
  const text = { tagline: saved.tagline, rhymeSelection: saved };
  assert.deepEqual(savedRhymeSelection(text, move), saved);
  assert.equal(rhymeForKit(text, move).tagline, saved.tagline);
});

test('attached approvals and actionBaseMoveId cannot create trusted reminder aliases', () => {
  const canonical = moves.find(move => move.id === 'name-it-exactly');
  const forged = structuredClone(canonical);
  forged.rhymeRecord = fixtureRecord(forged.id, ['Pick a word.', 'Let it be heard.']);
  forged.rhymeRecord.approval = { status: 'approved', by: 'Sunny', text: forged.rhymeRecord.lines.join(' ') };
  assert.throws(() => selectedRhymeFor(forged), /attached record cannot grant/);
  const other = { id: 'unmapped-runtime-guide', library: { actionBaseMoveId: canonical.id }, rhymeRecord: fixtureRecord('unmapped-runtime-guide', ['Pick a word.', 'Let it be heard.']) };
  assert.equal(selectedRhymeFor(other).tagline, 'Pick a word. Let it be heard.');
  assert.equal(selectedRhymeFor(other).approved, false);
  assert.equal(selectedRhymeFor(other).canonicalMoveId, undefined);
});

test('trusted alias mappings reject loops, unknown targets, duplicates and mixed records', () => {
  const row = (moveId, canonicalMoveId) => ({ moveId, canonicalMoveId, revision: 'test' });
  const known = [{ id: 'first' }, { id: 'second' }];
  for (const records of [
    [row('first', 'first')],
    [row('first', 'second'), row('second', 'first')],
    [row('first', 'unknown')],
    [row('first', 'second'), row('first', 'second')],
    [{ ...row('first', 'second'), lines: ['New', 'words'] }],
    [row('first', 'second'), fixtureRecord('first', ['Pick a word.', 'Let it be heard.'])],
  ]) assert.throws(() => resolveTopicReminderAlias('first', records, known), /approved_rhyme_invalid/);
  assert.throws(() => resolveTopicReminderAlias('first', [row('first', 'second')], [...known, { id: 'second' }]), /one known canonical/);
  assert.equal(resolveTopicReminderAlias('first', [], known), null);
});
