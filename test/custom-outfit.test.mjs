import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRecord, buildKitRecord } from '../server/app-data.js';
import { withStoryOutfits } from '../server/cast.js';
const family = { real: false, nickname: 'Pip', age: 10, pronouns: 'they/them', loves: [], presetId: 'custom', customOutfit: 'blue jacket; black trousers; white shoes', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] };
test('custom clothes survive setup, kit snapshots and story outfit choice without rewriting saved records', () => {
  const record = setupRecord(family), before = structuredClone(record), kit = buildKitRecord(record);
  assert.deepEqual(record.hero.lockedOutfit, ['blue jacket','black trousers','white shoes']);
  for (const seed of ['first','another']) assert.deepEqual(withStoryOutfits(kit, seed).hero.lockedOutfit, record.hero.lockedOutfit);
  const edited = setupRecord({ ...family, customOutfit: 'green shirt; navy shorts' });
  assert.notDeepEqual(edited.hero.lockedOutfit, kit.hero.lockedOutfit);
  assert.deepEqual(record, before);
});
test('custom outfit notes are required, bounded and do not replace preset defaults', () => {
  for (const customOutfit of ['', ' '.repeat(5), 'a'.repeat(401), Array(9).fill('shirt').join(';')]) assert.throws(() => setupRecord({ ...family, customOutfit }));
  const preset = setupRecord({ ...family, presetId: 'fern' });
  assert.equal(preset.hero.outfitChoice, 'preset'); assert.deepEqual(preset.hero.lockedOutfit, ['purple sweater','blue trousers','yellow sneakers']);
});
