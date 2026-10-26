import test from 'node:test';
import assert from 'node:assert/strict';
import { withStoryOutfits, lockedCast } from '../server/cast.js';
import { family } from './fixture.mjs';

test('new-kit clothes may vary without changing faces, chosen references or the family record', () => {
  const record = { ...structuredClone(family), cast: lockedCast(family) };
  record.cast[0].referencePath = '/private/chosen-child.png';
  record.cast[0].referenceHash = 'saved-reference';
  record.cast[0].outfit.push('blue turban', 'black glasses');
  const original = structuredClone(record);
  const versions = Array.from({ length: 12 }, (_, i) => withStoryOutfits(record, `kit-${i}`));
  assert.deepEqual(record, original);
  assert.ok(new Set(versions.map(r => r.hero.lockedOutfit[0])).size > 1);
  for (const version of versions) for (const [i, person] of version.cast.entries()) {
    const before = original.cast[i];
    assert.deepEqual({ ...person, outfit: before.outfit }, before);
    if (person.id === 'child') {
      assert.ok(person.outfit.includes('blue turban'));
      assert.ok(person.outfit.includes('black glasses'));
      assert.deepEqual(version.hero.lockedOutfit, person.outfit);
    }
  }
  assert.deepEqual(withStoryOutfits(record, 'same-kit'), withStoryOutfits(record, 'same-kit'));
});


test('chosen photo and description clothes stay fixed for children and grown-ups across new kits', () => {
  for (const source of ['photo', 'description']) {
    const record = { ...structuredClone(family), cast: lockedCast(family) };
    record.hero.outfitChoice = 'preset';
    for (const person of record.cast) {
      person.referenceSource = source;
      person.referencePath = `/private/${person.id}.png`;
      person.referenceHash = 'unchanged-reference';
      person.portraitCandidateId = 'chosen-candidate';
      person.outfit = person.id === 'child' ? ['red hoodie', 'blue jeans'] : ['black sweater', 'dark trousers'];
    }
    record.hero.lockedOutfit = [...record.cast[0].outfit];
    const before = structuredClone(record);
    for (const seed of ['morning', 'next-evening', 'another-kit']) {
      const next = withStoryOutfits(record, seed);
      assert.deepEqual(next, before);
      assert.notEqual(next, record);
      assert.notEqual(next.cast[0].outfit, record.cast[0].outfit);
    }
    assert.deepEqual(record, before);
  }
});

test('chosen adult clothes stay fixed while only the unchosen legacy child preset rotates', () => {
  const record = { ...structuredClone(family), cast: lockedCast(family) };
  record.cast[1].referenceSource = 'photo';
  record.cast[1].outfit = ['black sweater', 'navy trousers'];
  const before = structuredClone(record);
  const versions = Array.from({length:12}, (_, i) => withStoryOutfits(record, `legacy-${i}`));
  assert.ok(new Set(versions.map(r => r.cast[0].outfit[0])).size > 1);
  assert.ok(versions.every(r => JSON.stringify(r.cast[1]) === JSON.stringify(before.cast[1])));
  assert.deepEqual(record, before);
});
