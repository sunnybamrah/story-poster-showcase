import test from 'node:test';
import assert from 'node:assert/strict';
import { jobDisplayPeople } from '../server/job-people.js';
const record = { hero: { nickname: 'Alex' }, storyPeople: [{ castId: 'grown-up-one', storyName: 'Dad' }, { castId: 'grown-up-two', storyName: 'Mum' }], cast: [{ id: 'child', portraitCandidateId: 'new-look' }, { id: 'grown-up-one' }, { id: 'grown-up-two' }] };
test('restored job shows every frozen person and its saved drawing rather than a later family selection', () => {
  const job = { accountId: 'owner', referenceSnapshot: { cast: [{ id: 'child', portraitCandidateId: 'old-child', referencePath: '/private/child' }, { id: 'grown-up-one', portraitCandidateId: 'old-dad', referenceHash: 'secret' }, { id: 'sibling-1', portraitCandidateId: 'sibling' }] } };
  const portraits = [{ id: 'other-family', accountId: 'other', candidates: [{ id: 'old-dad' }] }, { id: 'child-job', accountId: 'owner', candidates: [{ id: 'old-child' }] }, { id: 'dad-job', accountId: 'owner', candidates: [{ id: 'old-dad' }] }];
  const people = jobDisplayPeople(job, record, portraits, ['Sam']);
  assert.deepEqual(people.map(p => p.label), ['Alex', 'Dad', 'Sam']);
  assert.equal(people[0].selectedUrl, '/api/portrait-assets/child-job/old-child/preview.webp');
  assert.equal(people[1].selectedUrl, '/api/portrait-assets/dad-job/old-dad/preview.webp');
  assert.equal(people[2].selectedUrl, null);
  assert.equal(JSON.stringify(people).includes('/private'), false);
  assert.equal(JSON.stringify(people).includes('referenceHash'), false);
});
test('legacy jobs keep only selected grown-ups and show names without missing-picture omissions', () => {
  const people = jobDisplayPeople({ accountId: 'owner', kitContext: { selectedGrownUpIds: ['grown-up-two'] } }, record);
  assert.deepEqual(people.map(p => p.label), ['Alex', 'Mum']);
  assert.ok(people.every(p => p.selectedUrl === null));
});
