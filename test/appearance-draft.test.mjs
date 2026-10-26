import test from 'node:test';
import assert from 'node:assert/strict';
import { appearanceDraftData, appearanceDraftBase } from '../app/appearance.js';

test('appearance draft writes keep observed identity and revision, including bulk saves', () => {
  const person = { personIdentity: 'current', draft: { revision: 2 } };
  assert.deepEqual(appearanceDraftData(person, 'A blue turban.', { personIdentity: 'current', revision: 2 }), { description: 'A blue turban.', personIdentity: 'current', revision: 2 });
  assert.throws(() => appearanceDraftData(person, 'Old text.', { personIdentity: 'current', revision: 1 }), /changed/);
  assert.throws(() => appearanceDraftData(person, 'Old person.', { personIdentity: 'old', revision: 2 }), /changed/);
  assert.throws(() => appearanceDraftData(person, 'New stale text.', { isNew: true }), /changed/);
  assert.throws(() => appearanceDraftData(person, 'Unknown.', undefined), /changed/);
  assert.deepEqual(appearanceDraftData({ personIdentity: 'created' }, 'Round glasses.', { isNew: true }), { description: 'Round glasses.', personIdentity: 'created', revision: 0 });
});

import { resolveRoute } from '../app/navigation.js';
test('saved unified setup reloads on the same people page', () => {
  assert.equal(resolveRoute('#setup', { accountId: 'fictional', childId: 'primary', record: {}, jobs: [] }).screen, 'setup');
});

test('continued typing retains the first edit base after background rename or save', () => {
  const base = appearanceDraftBase(undefined, { personIdentity: 'original', draft: { revision: 1 } });
  const continued = appearanceDraftBase(base, { personIdentity: 'renamed', draft: { revision: 2 } });
  assert.equal(continued, base);
  assert.throws(() => appearanceDraftData({ personIdentity: 'renamed', draft: { revision: 2 } }, 'Words still being typed.', continued), /changed/);
});
