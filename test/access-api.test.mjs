import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app-server.mjs';
import { passwordFields } from '../server/accounts.js';
import { readJSON, saveJSON } from '../server/files.js';

async function harness(t, { count = 1, directory, autoDeliverAccess = true } = {}) {
  directory ??= mkdtempSync(join(tmpdir(), 'invitation-api-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const password = passwordFields('fixture-password');
  const ownerId = randomUUID();
  saveJSON(join(directory, 'accounts.json'), { accounts: Array.from({ length: count }, (_, index) => ({ id: index ? randomUUID() : ownerId, username: index ? `seed${index}@example.test` : 'owner@example.test', email: index ? `seed${index}@example.test` : 'owner@example.test', emailVerified: true, needsSetup: true, childIds: [], activeChildId: null, ...password })), jobs: [], sessions: [] });
  const mails = [], sender = Object.assign(async message => { mails.push(message); return { accepted: true, providerId: 'fixture-mail' }; }, { available: true });
  const settings = { dataDirectory: directory, sample: null, generationRoute: 'subscription', publicOrigin: 'https://storybook.example.test', sendMail: sender, ownerAccountIds: [ownerId], inviteOnly: true, workerSecret: 'worker-fixture-secret'.repeat(3), autoDeliverAccess };
  let app = createApp(settings); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const request = async (path, body, cookie, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const owner = await request('login', { email: 'owner@example.test', password: 'fixture-password' }); assert.equal(owner.status, 200);
  const approve = async email => {
    assert.equal((await request('access-requests', { email })).status, 202);
    const rows = (await request('owner/access-requests', undefined, owner.cookie)).data.requests;
    const row = rows.find(row => row.email === email);
    assert.equal((await request(`owner/access-requests/${row.id}/decision`, { decision: 'approve' }, owner.cookie)).status, 200);
    for (let i = 0; i < 50 && !mails.some(mail => mail.to === email && mail.subject === 'Your Story Poster invitation'); i++) await new Promise(resolve => setTimeout(resolve, 5));
    const mail = mails.findLast(mail => mail.to === email && mail.subject === 'Your Story Poster invitation'); assert.ok(mail);
    return new URL(mail.text.match(/https:\/\/\S+/)[0]).searchParams.get('invite');
  };
  return { request, owner, approve, mails, directory, restart: async () => { await app.close(); app = createApp(settings); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); } };
}

test('request-only admission has no legacy signup bypass or GET approval; inspect is read-only and redemption verifies once', async t => {
  const h = await harness(t);
  const cfg = await h.request('config'); assert.equal(cfg.data.signup.requiresInvitation, true); assert.equal(cfg.data.signup.mode, 'request');
  for (const input of [{ email: 'new@example.test', password: 'fixture-password' }, { username: 'legacy_new', password: 'fixture-password', family: {} }, { email: 'new@example.test', password: 'fixture-password', accessApproved: true, emailVerified: true }]) assert.notEqual((await h.request('signup', input)).status, 200);
  await h.request('access-requests', { email: 'new@example.test', adultName: 'Alex' });
  const row = (await h.request('owner/access-requests', undefined, h.owner.cookie)).data.requests[0];
  assert.equal((await h.request(`owner/access-requests/${row.id}/decision`, undefined, h.owner.cookie)).status, 405);
  assert.equal((await h.request(`owner/access-requests/${row.id}/decision`, { decision: 'approve' })).status, 401);
  const token = await h.approve(row.email);
  for (let i = 0; i < 2; i++) assert.equal((await h.request('invitations/inspect', { token })).status, 200);
  assert.equal((await h.request('invitations/inspect', undefined)).status, 405);
  assert.equal((await h.request('signup', { email: 'other@example.test', password: 'fixture-password', inviteToken: token })).status, 410);
  const results = await Promise.all([1, 2].map(() => h.request('signup', { email: row.email, password: 'fixture-password', inviteToken: token })));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  const joined = results.find(result => result.status === 200); assert.equal(joined.data.emailVerified, true); assert.equal(joined.data.needsSetup, true);
  assert.equal(h.mails.some(mail => mail.to === row.email && /Confirm your/.test(mail.subject)), false);
  assert.equal((await h.request('owner/access-requests', undefined, joined.cookie)).status, 403);
  assert.equal((await h.request(`owner/access-requests/${row.id}/decision`, { decision: 'decline' }, joined.cookie)).status, 403);
  assert.equal((await h.request('invitations', undefined, joined.cookie)).data.remaining, 3);
  await h.restart(); assert.equal((await h.request('session', undefined, joined.cookie)).data.email, row.email);
  assert.equal((await h.request('invitations/inspect', { token })).status, 410);
  assert.equal((await h.request('auth/forgot-password', { email: row.email })).status, 200);
});

test('two reserved seats can be redeemed concurrently without double-counting them', async t => {
  const h = await harness(t, { count: 48 });
  const first = await h.approve('one@example.test'), second = await h.approve('two@example.test');
  const results = await Promise.all([[first, 'one@example.test'], [second, 'two@example.test']].map(([inviteToken, email]) => h.request('signup', { inviteToken, email, password: 'fixture-password' })));
  assert.equal(results.filter(row => row.status === 200).length, 2);
  assert.equal(readJSON(join(h.directory, 'accounts.json')).accounts.length, 50);
});

test('referrals need owner approval; retries preserve three total slots and another family cannot send them', async t => {
  const h = await harness(t), token = await h.approve('first@example.test');
  const joined = await h.request('signup', { email: 'first@example.test', password: 'fixture-password', inviteToken: token });
  const rows = await Promise.all(Array.from({ length: 5 }, (_, i) => h.request('invitations', { email: `friend${i}@example.test`, delivery: 'link' }, joined.cookie)));
  assert.equal(rows.filter(row => row.status === 201).length, 3); assert.equal(rows.filter(row => row.status === 409).length, 2);
  const one = rows.find(row => row.status === 201).data.invitation;
  const retry = await h.request('invitations', { email: one.email, delivery: 'email' }, joined.cookie); assert.equal(retry.status, 200); assert.equal(retry.data.used, 3); assert.equal(retry.data.invitation.link, one.link);
  assert.equal((await h.request(`invitations/${one.id}/send`, {}, h.owner.cookie)).status, 404);
  const referralToken = new URL(one.link).searchParams.get('referral');
  assert.equal((await h.request('signup', { email: one.email, password: 'fixture-password', inviteToken: referralToken })).status, 410);
  assert.equal((await h.request('access-requests', { email: one.email, referralToken })).status, 202);
  const pending = (await h.request('owner/access-requests', undefined, h.owner.cookie)).data.requests.find(row => row.email === one.email); assert.equal(pending.status, 'pending');
  assert.equal(pending.notifications.telegram.status, 'pending');
});

test('concurrent owner approvals at forty-nine accounts send only one reserved invitation', async t => {
  const h = await harness(t, { count: 49 });
  for (const email of ['last-one@example.test', 'last-two@example.test']) assert.equal((await h.request('access-requests', { email })).status, 202);
  const rows = (await h.request('owner/access-requests', undefined, h.owner.cookie)).data.requests;
  const results = await Promise.all(rows.map(row => h.request(`owner/access-requests/${row.id}/decision`, { decision: 'approve' }, h.owner.cookie)));
  assert.equal(results.filter(row => row.status === 200).length, 1); assert.equal(results.filter(row => row.status === 409).length, 1);
  const state = readJSON(join(h.directory, 'accounts.json'));
  assert.equal(state.accounts.length + state.accessRequests.filter(row => row.status === 'approved' && !row.joinedAt && row.expires > Date.now()).length, 50);
  for (let i = 0; i < 50 && !h.mails.some(mail => mail.subject === 'Your Story Poster invitation'); i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.mails.filter(mail => mail.subject === 'Your Story Poster invitation').length, 1);
});

test('delete then same-email signup needs fresh owner approval and never restores old family data or invitation allowance', async t => {
  const h = await harness(t), email = 'returning@example.test', oldToken = await h.approve(email);
  const old = await h.request('signup', { email, password: 'fixture-password', inviteToken: oldToken }); assert.equal(old.status, 200);
  const family = { real: false, nickname: 'OldFixture', age: 10, pronouns: 'he/him', loves: ['old kites'], presetId: 'comet', familyContext: 'Old fictional private notes.', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] };
  assert.equal((await h.request('family/setup', { family }, old.cookie)).status, 200);
  const oldDirectory = join(h.directory, old.data.accountId); writeFileSync(join(oldDirectory, 'old-private-story.txt'), 'Synthetic deleted story fixture.');
  for (const email of ['old-one@example.test', 'old-two@example.test']) assert.equal((await h.request('invitations', { email, delivery: 'link' }, old.cookie)).status, 201);
  assert.equal((await h.request('family', {}, old.cookie, 'DELETE')).status, 200); assert.equal(existsSync(oldDirectory), false);
  assert.equal((await h.request('invitations/inspect', { token: oldToken })).status, 410);
  assert.equal((await h.request('access-requests', { email })).status, 202);
  const rows = (await h.request('owner/access-requests', undefined, h.owner.cookie)).data.requests.filter(row => row.email === email);
  assert.equal(rows.length, 2); assert.equal(rows[0].status, 'pending'); assert.equal(rows[0].joinedAt, null); assert.ok(rows[1].joinedAt);
  assert.equal((await h.request('signup', { email, password: 'fixture-password', inviteToken: oldToken })).status, 410);
  const before = h.mails.filter(mail => mail.to === email && mail.subject === 'Your Story Poster invitation').length;
  assert.equal((await h.request(`owner/access-requests/${rows[0].id}/decision`, { decision: 'approve' }, h.owner.cookie)).status, 200);
  for (let i = 0; i < 50 && h.mails.filter(mail => mail.to === email && mail.subject === 'Your Story Poster invitation').length === before; i++) await new Promise(resolve => setTimeout(resolve, 5));
  const mail = h.mails.findLast(mail => mail.to === email && mail.subject === 'Your Story Poster invitation');
  const token = new URL(mail.text.match(/https:\/\/\S+/)[0]).searchParams.get('invite'); assert.notEqual(token, oldToken);
  const fresh = await h.request('signup', { email, password: 'fixture-password', inviteToken: token }); assert.equal(fresh.status, 200);
  assert.notEqual(fresh.data.accountId, old.data.accountId); assert.equal(fresh.data.record, null); assert.equal(fresh.data.needsSetup, true); assert.deepEqual(fresh.data.jobs, []);
  const invitations = (await h.request('invitations', undefined, fresh.cookie)).data;
  assert.equal(invitations.used, 2); assert.equal(invitations.remaining, 1); assert.deepEqual(invitations.invitations, []);
  assert.equal((await h.request('session', undefined, old.cookie)).data.record, null);
});
