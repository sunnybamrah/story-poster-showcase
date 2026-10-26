import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemory, summarize3 } from '../server/memory.js';
import { family, oldFact, newFact, deletedFact, savedKit } from './fixture.mjs';

function setup(t) {
  const folder = mkdtempSync(join(tmpdir(), 'slice0-memory-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, 'family.json');
  const memory = createMemory(file); memory.store(family); return { memory, file };
}
test('optional interests survive saving and reopening with zero, one, two or three choices', t => {
  const { memory, file } = setup(t);
  for (let count = 0; count <= 3; count++) {
    const record = structuredClone(family); record.hero.loves = ['books', 'music', 'stars'].slice(0, count);
    memory.store(record);
    assert.deepEqual(createMemory(file).exportRecord().hero.loves, record.hero.loves);
  }
  const extra = structuredClone(family); extra.hero.loves = ['books', 'music', 'stars', 'trains'];
  assert.throws(() => memory.store(extra), /up to three/);
});
test('store survives a fresh memory instance and exports an isolated copy', t => {
  const { memory, file } = setup(t);
  const copy = memory.exportRecord(); copy.hero.nickname = 'Changed';
  assert.equal(createMemory(file).exportRecord().hero.nickname, 'Pip');
  assert.equal(memory.exportRecord().familyContext, family.familyContext);
});
test('edit keeps the corrected date and clears stale derived prose and cached requests', t => {
  const { memory } = setup(t);
  memory.addKit(savedKit({ adventureLine: 'The tryout is next week in the old story.' }));
  const handle = memory.cacheRequest({ old: oldFact });
  memory.editFact(oldFact, newFact);
  assert.match(memory.exportRecord().familyContext, /November/);
  assert.doesNotMatch(JSON.stringify(memory.exportRecord()), /next week/);
  assert.throws(() => memory.getCachedRequest(handle), /cleared/);
  assert.match(memory.summarize3(), /didItHelp=yes/);
});
test('delete removes the fact, summary derivatives, file content and request cache', t => {
  const { memory, file } = setup(t);
  memory.addKit(savedKit({ adventureLine: 'A brother sleeps in the same room.' }));
  const handle = memory.cacheRequest({ messages: [{ content: family.familyContext }] });
  memory.deleteFact(deletedFact);
  assert.doesNotMatch(readFileSync(file, 'utf8'), /\b(brother|room)\b/i);
  assert.doesNotMatch(memory.summarize3(), /\b(brother|room)\b/i);
  assert.deepEqual(memory.exportRecord().cachedRequests, []);
  assert.throws(() => memory.getCachedRequest(handle));
});
test('a fresh store cannot revive an old cache handle', t => {
  const { memory } = setup(t); const old = memory.cacheRequest({ secret: 'old' });
  memory.store(family); memory.cacheRequest({ fresh: true });
  assert.throws(() => memory.getCachedRequest(old));
});
test('missing facts and out-of-band ages fail without changing storage', t => {
  const { memory, file } = setup(t); const before = readFileSync(file, 'utf8');
  assert.throws(() => memory.deleteFact('not present'));
  assert.throws(() => memory.editFact('', 'new'));
  assert.throws(() => memory.store({ ...family, hero: { ...family.hero, age: 7 } }));
  assert.equal(readFileSync(file, 'utf8'), before);
});
test('summarize3 uses only the last three kits and always emits three lines', () => {
  assert.equal(summarize3({ pastKits: [] }).split('\n').length, 3);
  const pastKits = [1, 2, 3, 4].map(n => ({ date: `day${n}`, moveId: `move${n}`, didItHelp: 'yes', adventureLine: `Adventure ${n}\ncontinued` }));
  const summary = summarize3({ pastKits });
  assert.equal(summary.split('\n').length, 3); assert.doesNotMatch(summary, /day1/); assert.match(summary, /day4/);
});
