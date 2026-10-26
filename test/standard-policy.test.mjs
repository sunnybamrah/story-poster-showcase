import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config, assertFamilyAllowed, assertPhotoAllowed, recordDataConsent } from '../server/config.js';
import { dataPolicyVersion, dataPolicyNotice, hasCurrentDataConsent } from '../app/data-policy.js';
import { setupRecord } from '../server/app-data.js';
import { createMemory, relevantMemory, summarize3 } from '../server/memory.js';
import { createApp } from '../server/app-server.mjs';
import { family, savedKit } from './fixture.mjs';
import { buildStoryRequest } from '../server/requests.js';
const directory = t => { const dir = mkdtempSync(join(tmpdir(), 'standard-policy-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };
const input = real => ({ real, nickname: 'Mika', age: 13, pronouns: 'they/them', loves: ['piano', 'space', 'football'], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] });
const accepted = () => ({ accepted: true, version: dataPolicyVersion });
test('standard policy is distinct from ZDR and requires current parent consent', () => {
  assert.equal(config.zeroRetentionApproved, false); assert.equal(config.standardDataPolicyAllowed, true);
  const real = { ...family, hero: { ...family.hero, age: 13 }, real: true };
  assert.throws(() => assertFamilyAllowed(real), /permission/);
  assert.throws(() => assertFamilyAllowed({ ...real, config: { zeroRetentionApproved: true } }), /permission/);
  real.dataPolicyConsent = recordDataConsent(accepted());
  assert.doesNotThrow(() => assertFamilyAllowed(real));
  assert.throws(() => assertFamilyAllowed(real, { zeroRetentionApproved: false, standardDataPolicyAllowed: false }), /zero retention/);
  assert.doesNotThrow(() => assertFamilyAllowed({ real: true }, { zeroRetentionApproved: true }));
  for (const consent of [{ ...real.dataPolicyConsent, version: 'old' }, { ...real.dataPolicyConsent, accepted: false }, { ...real.dataPolicyConsent, revokedAt: new Date().toISOString() }]) assert.throws(() => assertFamilyAllowed({ ...real, dataPolicyConsent: consent }), /permission/);
});
test('all photos require consent, with only actual ZDR and trusted fictional QA exceptions', () => {
  assert.throws(() => assertPhotoAllowed({ real: false }), /permission/);
  assert.throws(() => assertPhotoAllowed({ real: true }, config, { allowSyntheticPortraits: true }), /permission/);
  assert.doesNotThrow(() => assertPhotoAllowed({ real: false }, config, { allowSyntheticPortraits: true }));
  assert.doesNotThrow(() => assertPhotoAllowed({ real: false, dataPolicyConsent: recordDataConsent(accepted()) }));
});
test('parent consent never permits under-13 personal data without actual zero retention', () => {
  const consent = recordDataConsent(accepted());
  for (const age of [8, 9, 10, 11, 12, undefined, '13', NaN]) {
    const record = { ...family, real: true, hero: { ...family.hero, age }, dataPolicyConsent: consent };
    for (const check of [assertFamilyAllowed, assertPhotoAllowed]) {
      assert.throws(() => check(record), error => error.code === 'CHILD_DATA_REQUIRES_ZDR' && error.status === 403);
      assert.doesNotThrow(() => check(record, { zeroRetentionApproved: true }));
    }
  }
  assert.throws(() => setupRecord({ ...input(true), age: 12, dataPolicyConsent: accepted() }), /under 13/);
  assert.doesNotThrow(() => setupRecord({ ...input(true), age: 13, dataPolicyConsent: accepted() }));
});
test('setup stamps consent itself and memory carries it through edits and revocation', t => {
  assert.throws(() => setupRecord(input(true)), /permission/);
  const record = setupRecord({ ...input(true), dataPolicyConsent: { ...accepted(), acceptedAt: '1990-01-01T00:00:00Z' } });
  assert.notEqual(record.dataPolicyConsent.acceptedAt, '1990-01-01T00:00:00Z');
  assert.equal(hasCurrentDataConsent(record), true);
  const memory = createMemory(join(directory(t), 'family.json')); memory.store(record);
  const edited = memory.exportRecord(); delete edited.dataPolicyConsent; edited.familyContext = 'A new parent note.'; memory.store(edited);
  assert.equal(hasCurrentDataConsent(memory.exportRecord()), true);
  memory.setDataPolicyConsent({ accepted: false, version: dataPolicyVersion, revokedAt: new Date().toISOString() });
  assert.equal(hasCurrentDataConsent(memory.exportRecord()), false);
  // This made-up moment supplies a fitting action for the request check.
  assert.equal(buildStoryRequest(memory.exportRecord(), 'Mika is nervous before a recital.').store, false);
});
test('old accounts can accept or revoke through an authenticated free endpoint and get truthful config', async t => {
  let keys = 0;
  const dataDirectory = directory(t);
  const app = createApp({ dataDirectory, sample: null, sampleOnly: false, keyReader: () => { keys++; throw Error('No key permitted'); } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}/api/`; let cookie;
  async function call(path, body, authenticated = true) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated && cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    cookie ??= response.headers.get('set-cookie')?.split(';')[0]; return { status: response.status, data: await response.json() };
  }
  assert.equal((await call('family/consent', { ...accepted(), childId: 'primary' }, false)).status, 401);
  assert.equal((await call('signup', { username: 'blocked_real', password: 'fictional-password', family: input(true) })).status, 400);
  assert.equal((await call('signup', { username: 'policy_family', password: 'fictional-password', family: input(false) })).status, 200);
  // Simulate a saved older real profile with no current consent. Login and
  // reading remain available; accepting the notice needs no replacement profile.
  const account = JSON.parse(readFileSync(join(dataDirectory, 'accounts.json'), 'utf8')).accounts[0];
  const memory = createMemory(join(dataDirectory, account.id, 'family.json'));
  memory.store({ ...memory.exportRecord(), real: true });
  let settings = (await call('config')).data;
  assert.equal(settings.zeroRetentionApproved, false); assert.equal(settings.realFamiliesApproved, false); assert.equal(settings.realFamilySetupAllowed, true); assert.equal(settings.photoUploadsApproved, false);
  assert.equal((await call('family/consent', { accepted: true, version: 'old', childId: 'primary' })).status, 400);
  const consent = await call('family/consent', { ...accepted(), childId: 'primary' });
  assert.equal(consent.status, 200); assert.equal(hasCurrentDataConsent(consent.data.record), true); assert.equal(consent.data.jobs.length, 0);
  assert.equal(consent.data.record.real, true);
  settings = (await call('config')).data; assert.equal(settings.photoUploadsApproved, true);
  memory.store({ ...memory.exportRecord(), hero: { ...memory.exportRecord().hero, age: 12 } });
  settings = (await call('config')).data;
  assert.equal(settings.realFamiliesApproved, false); assert.equal(settings.photoUploadsApproved, false);
  const childUpload = await call('portraits/child', { childId: 'primary', photo: { mime: 'image/png', base64: 'AAAA' } });
  assert.equal(childUpload.status, 403); assert.match(childUpload.data.message, /under 13/); assert.equal(keys, 0);
  memory.store({ ...memory.exportRecord(), hero: { ...memory.exportRecord().hero, age: 13 } });
  assert.equal((await call('family/consent', { accepted: false, version: dataPolicyVersion, childId: 'primary' })).status, 200);
  assert.equal((await call('config')).data.photoUploadsApproved, false); assert.equal(keys, 0);
  const newFamily = await call('signup', { username: 'consented_real', password: 'fictional-password', family: { ...input(true), dataPolicyConsent: { ...accepted(), acceptedAt: '1990-01-01' } } });
  assert.equal(newFamily.status, 200); assert.equal(hasCurrentDataConsent(newFamily.data.record), true);
  assert.notEqual(newFamily.data.record.dataPolicyConsent.acceptedAt, '1990-01-01');
});
test('policy copy tells the parent about standard retention and never claims approval', () => {
  assert.match(dataPolicyNotice, /not used to train.*by default/); assert.match(dataPolicyNotice, /up to 30 days/);
  assert.match(dataPolicyNotice, /does not keep your original photos/); assert.match(dataPolicyNotice, /does not mean OpenAI keeps nothing/);
  for (const name of ['main.jsx', 'FamilyPortraits.jsx']) assert.doesNotMatch(readFileSync(new URL(`../app/${name}`, import.meta.url), 'utf8'), /privacy approval is pending|privacy approval is recorded/);
});
test('relevant memory brings an older matching topic back without changing saved facts or summarize3', () => {
  const record = { ...structuredClone(family), pastKits: ['Mika tried the piano passage slowly.', 'Mika folded a drawing.', 'Mika repaired the robot.', 'Mika found the football.'].map((adventureLine, index) => savedKit({ chapterNumber: index + 1, date: `2026-10-${10 + index}`, adventureLine })) };
  const before = structuredClone(record), recent = summarize3(record), selected = relevantMemory(record, 'Piano felt hard again.');
  assert.ok(selected.includes(record.pastKits[0].adventureLine)); assert.ok(!recent.includes(record.pastKits[0].adventureLine));
  assert.equal(selected.split('\n').length, 3); assert.deepEqual(record, before); assert.equal(summarize3(record), recent);
});
