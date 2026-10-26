import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleMoves, preparePick } from '../server/picker.js';
import { moves } from '../server/files.js';

const concern = 'My child is nervous about a maths test tomorrow.';
const ids = (record, options = {}) => eligibleMoves(record, concern, options).map(item => item.move.id);
const feedback = (moveId, didItHelp, triedMove = 'yes') => ({ moveId, didItHelp, triedMove });

test('returning to the same concern changes the next fitting choice after not-for-us feedback', () => {
  const before = ids({ pastKits: [] });
  assert.equal(before[0], 'long-breath-out');
  const record = { pastKits: [feedback('long-breath-out', 'not for us')] };
  const after = ids(record, { allowRepeat: true });
  assert.ok(after.length);
  assert.ok(!after.includes('long-breath-out'));
  assert.notEqual(after[0], before[0]);
});

test('tried without help ranks below an untried fitting choice, while helpful fitting repeats rank first', () => {
  assert.notEqual(ids({ pastKits: [feedback('long-breath-out', 'no')] }, { allowRepeat: true })[0], 'long-breath-out');
  assert.equal(ids({ pastKits: [feedback('long-breath-out', 'yes')] }, { allowRepeat: true })[0], 'long-breath-out');
  assert.equal(ids({ pastKits: [feedback('long-breath-out', 'no', 'no')] }, { allowRepeat: true })[0], 'long-breath-out');
});

test('unknown concerns never revive rejected moves and feedback does not invent a fit', () => {
  const record = { pastKits: [feedback('name-it-exactly', 'not for us'), feedback('bring-in-my-person', 'not for us'), feedback('long-breath-out', 'yes')] };
  const none = preparePick(record, 'A purple comet.');
  assert.equal(none.status, 'eligible');
  assert.ok(!none.eligible.some(item => ['name-it-exactly', 'bring-in-my-person'].includes(item.move.id)));
  assert.ok(!eligibleMoves(record, 'Someone broke a pencil.', { allowRepeat: true }).some(item => item.move.id === 'long-breath-out'));
  record.pastKits.push(feedback('name-it-exactly', 'a little'));
  assert.ok(preparePick(record, 'A purple comet.').eligible.some(item => item.move.id === 'name-it-exactly'));
});

test('a new topic id cannot revive the same rejected action, in either direction', t => {
  const base = moves.find(move => move.id === 'name-it-exactly'), id = 'lib-feedback-test';
  moves.push({ ...base, id, library: { status: 'reusable', actionBaseMoveId: base.id } });
  t.after(() => moves.splice(moves.findIndex(move => move.id === id), 1));
  const tonight = 'A purple comet.', libraryMatch = { moveId: id, tonight };
  const rejectedSeed = { pastKits: [feedback(base.id, 'not for us')], libraryMatch };
  assert.ok(!eligibleMoves(rejectedSeed, tonight, { allowRepeat: true }).some(item => item.move.id === id));
  const rejectedTopic = { pastKits: [feedback(id, 'not for us')], libraryMatch };
  assert.ok(!preparePick(rejectedTopic, tonight, { allowRepeat: true }).eligible.some(item => [id, base.id].includes(item.move.id)));
  rejectedTopic.pastKits.push(feedback(base.id, 'a little'));
  assert.equal(eligibleMoves(rejectedTopic, tonight, { allowRepeat: true })[0].move.id, id);
});
