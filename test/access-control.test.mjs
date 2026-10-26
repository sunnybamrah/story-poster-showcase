import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessControl } from '../server/access-control.js';
import { createAccounts } from '../server/accounts.js';

function harness(t, overrides = {}) {
  let time = Date.parse('2026-10-20T04:00:00Z');
  const db = overrides.db ?? { accounts: [{ id: 'owner', email: 'owner@example.test', emailVerified: true }], jobs: [], sessions: [] }, mails = [], saves = [];
  const sendMail = overrides.sendMail ?? Object.assign(async message => { mails.push(message); return { accepted: true, providerId: 'fixture-only' }; }, { available: true });
  let access;
  const persist = () => saves.push(structuredClone(db));
  const accounts = createAccounts({ db, persist, sendMail, publicOrigin: 'https://example.test', ownerAccountIds: ['owner'], assertAdmission: account => access?.assertAdmitted(account) });
  access = createAccessControl({ db, persist, accounts, sendMail, publicOrigin: 'https://example.test', enabled: true, autoDeliver: false, now: () => time, ...overrides }); t.after(access.close);
  const request = (email, extra = {}) => { access.requestAccess({ email, ...extra }); return db.accessRequests.findLast(row => row.email === email); };
  const approve = async email => { const row = request(email); access.decide(row.id, 'approve', 'owner'); await access.drainEmail(); return new URL(mails.findLast(mail => mail.to === email).text.match(/https:\/\/\S+/)[0]).searchParams.get('invite'); };
  const join = (token, email, id = email) => { const account = { id, email, creationEnabled: true }; access.redeem(access.inspect(token, email), account); db.accounts.push(account); persist(); return account; };
  return { db, access, accounts, mails, saves, request, approve, join, advance: ms => { time += ms; } };
}

test('requests dedupe, notify both channels independently and require an approved one-use email-bound signup', async t => {
  const h = harness(t), row = h.request('family@example.test', { adultName: 'Ari' });
  h.request('family@example.test'); assert.equal(h.db.accessRequests.length, 1); assert.equal(h.db.accessDeliveries.length, 2);
  await h.access.drainEmail(); assert.equal(h.mails.length, 1); assert.equal(h.mails[0].to, 'owner@example.test'); assert.match(h.mails[0].text, /#owner/); assert.doesNotMatch(h.mails[0].text, /decision|approve=|token=/);
  assert.equal(h.access.list()[0].notifications.email.status, 'accepted'); assert.equal(h.access.list()[0].notifications.telegram.status, 'pending');
  assert.throws(() => h.access.inspect('0'.repeat(64)), /invalid/);
  const token = await h.approve('family@example.test'); assert.throws(() => h.access.inspect(token, 'wrong@example.test'), /another email/);
  assert.equal(h.access.inspectPublic(token).email, row.email); assert.equal(row.joinedAt, undefined);
  const account = h.join(token, row.email); assert.equal(account.emailVerified, true); assert.equal(account.accessApproved, true);
  assert.throws(() => h.access.inspect(token), /used/); assert.throws(() => h.access.redeem(row, { id: 'copy', email: row.email }), /again/);
  assert.equal(h.access.invitationStatus(account).remaining, 3);
});

test('exact three lifetime referral slots survive duplicate retries, rejection, self-invite and restart', async t => {
  const h = harness(t), token = await h.approve('family@example.test'), account = h.join(token, 'family@example.test');
  assert.throws(() => h.access.createInvitation(account, { email: account.email, delivery: 'link' }), /own email/);
  for (const email of ['one@example.test', 'two@example.test', 'three@example.test']) h.access.createInvitation(account, { email, delivery: 'link' });
  const status = h.access.invitationStatus(account); assert.equal(status.used, 3); assert.equal(status.remaining, 0); assert.equal(status.canInvite, false); assert.equal(status.canSendInvitations, true);
  const one = status.invitations[0]; assert.equal(h.access.createInvitation(account, { email: one.email, delivery: 'email' }).invitation.link, one.link);
  h.access.resend(account, one.id); await h.access.drainEmail(); assert.equal(h.mails.filter(mail => mail.to === one.email).length, 1);
  h.access.resend(account, one.id); await h.access.drainEmail(); assert.equal(h.mails.filter(mail => mail.to === one.email).length, 1);
  assert.throws(() => h.access.createInvitation(account, { email: 'four@example.test', delivery: 'link' }), /three invitations/);
  const referralToken = new URL(one.link).searchParams.get('referral');
  assert.throws(() => h.request('different@example.test', { referralToken }), /email address/);
  const referred = h.request(one.email, { referralToken }); assert.equal(referred.status, 'pending'); assert.throws(() => h.access.inspect(referralToken, one.email), /invalid/);
  h.access.decide(referred.id, 'decline', 'owner'); assert.equal(h.access.invitationStatus(account).remaining, 0);
  const restored = harness(t, { db: structuredClone(h.db) }); assert.equal(restored.access.invitationStatus(account).remaining, 0);
  assert.throws(() => restored.access.resend({ ...account, id: 'intruder' }, one.id), /not in this family/);
});

test('concurrent reservation/approval calls cannot create extra slots or seats', async t => {
  const h = harness(t), account = h.join(await h.approve('family@example.test'), 'family@example.test');
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => Promise.resolve().then(() => h.access.createInvitation(account, { email: `other${i}@example.test`, delivery: 'link' }))));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 3); assert.equal(h.db.familyInvitations.length, 3);
  const row = h.request('capped@example.test'); while (h.db.accounts.length < 50) h.db.accounts.push({ id: `fixture-${h.db.accounts.length}` });
  assert.throws(() => h.access.decide(row.id, 'approve', 'owner'), /full/);
});

test('decline and expiry invalidate links; refresh uses same request; revoked accounts cannot invite or create work', async t => {
  const h = harness(t), token = await h.approve('family@example.test'), row = h.request('family@example.test');
  h.access.decide(row.id, 'decline', 'owner'); assert.throws(() => h.access.inspect(token), /invalid/);
  const fresh = await h.approve('family@example.test'); assert.notEqual(token, fresh);
  h.advance(8 * 86400000); assert.throws(() => h.access.inspect(fresh), /expired/);
  const current = await h.approve('family@example.test'), account = h.join(current, row.email); assert.equal(h.db.accessRequests.length, 1);
  account.creationEnabled = false; assert.throws(() => h.accounts.assertCreation(account), /turned off/); assert.throws(() => h.access.createInvitation(account, { email: 'friend@example.test', delivery: 'link' }), /turned off/);
  assert.equal(h.access.invitationStatus(account).canSendInvitations, false);
  assert.throws(() => h.accounts.assertCreation({ id: 'unapproved', email: 'bad@example.test', emailVerified: true }), /waiting for access approval/);
});

test('email failure/restart retries stable idempotency keys without new requests; Telegram claims are isolated and replay-safe', async t => {
  let fail = true; const sent = [];
  const sender = Object.assign(async message => { sent.push(message); if (fail) throw Error('fixture outage'); return { accepted: true, providerId: 'fixture' }; }, { available: true });
  const h = harness(t, { sendMail: sender }); const row = h.request('family@example.test'); await h.access.drainEmail(); assert.equal(h.access.list()[0].notifications.email.status, 'failed');
  fail = false; h.advance(60000); await h.access.drainEmail(); assert.equal(sent.length, 2); assert.equal(sent[0].idempotencyKey, sent[1].idempotencyKey);
  const claim = await h.access.claimAlert('worker-one'); assert.equal((await h.access.claimAlert('worker-one')), null);
  await assert.rejects(() => h.access.completeAlert('worker-two', { alertId: claim.id, claimToken: claim.claimToken, delivered: true }), /matching claim/);
  const restored = harness(t, { db: structuredClone(h.db) }); const result = { alertId: claim.id, claimToken: claim.claimToken, delivered: true, receipt: `delivered: Story Poster access request ${row.id}` };
  await restored.access.completeAlert('worker-one', result); assert.equal((await restored.access.completeAlert('worker-one', result)).alreadyReceived, true); assert.equal(restored.access.list()[0].notifications.telegram.status, 'delivered');
});

test('restart keeps email retry identity and expired Telegram leases get a new claim without a second request', async t => {
  const messages = []; let fail = true;
  const sender = Object.assign(async message => { messages.push(message); if (fail) throw Error('fixture mail outage'); return { accepted: true }; }, { available: true });
  const first = harness(t, { sendMail: sender }); first.request('family@example.test'); await first.access.drainEmail();
  const alert = await first.access.claimAlert('worker-one'); first.access.close();
  const restored = harness(t, { db: structuredClone(first.db), sendMail: sender }); restored.advance(61000); fail = false;
  await restored.access.drainEmail(); assert.equal(messages.length, 2); assert.equal(messages[0].idempotencyKey, messages[1].idempotencyKey); assert.equal(restored.db.accessRequests.length, 1);
  const next = await restored.access.claimAlert('worker-two'); assert.equal(next.id, alert.id); assert.notEqual(next.claimToken, alert.claimToken);
  await assert.rejects(() => restored.access.completeAlert('worker-one', { alertId: alert.id, claimToken: alert.claimToken, delivered: true, receipt: `delivered: Story Poster access request ${alert.requestId}` }), /matching claim/);
  await restored.access.completeAlert('worker-two', { alertId: next.id, claimToken: next.claimToken, delivered: false });
  assert.equal(await restored.access.claimAlert('worker-two'), null);
  assert.equal(restored.access.list()[0].notifications.telegram.status, 'failed');
});

test('simultaneous approvals reserve the last seat before email and cannot oversubscribe it', async t => {
  const h = harness(t); while (h.db.accounts.length < 49) h.db.accounts.push({ id: `fixture-${h.db.accounts.length}` });
  const rows = [h.request('first@example.test'), h.request('second@example.test')];
  const outcomes = await Promise.allSettled(rows.map(row => Promise.resolve().then(() => h.access.decide(row.id, 'approve', 'owner'))));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
  const approved = rows.find(row => row.status === 'approved'), pending = rows.find(row => row.status === 'pending');
  assert.ok(approved); assert.ok(pending);
  const tokenHash = approved.inviteHash, version = approved.tokenVersion;
  assert.doesNotThrow(() => h.access.decide(approved.id, 'approve', 'owner'));
  assert.equal(approved.inviteHash, tokenHash); assert.equal(approved.tokenVersion, version);
  await h.access.drainEmail();
  assert.equal(h.mails.filter(mail => mail.subject === 'Your Story Poster invitation').length, 1);
  assert.equal(h.mails.some(mail => mail.to === pending.email && mail.subject === 'Your Story Poster invitation'), false);
  const restored = harness(t, { db: structuredClone(h.db) });
  assert.throws(() => restored.access.decide(pending.id, 'approve', 'owner'), /full/);
});

test('declined and expired reservations release seats while consumed reservations are counted only as accounts', async t => {
  const h = harness(t); while (h.db.accounts.length < 49) h.db.accounts.push({ id: `fixture-${h.db.accounts.length}` });
  const first = h.request('first@example.test'), second = h.request('second@example.test');
  h.access.decide(first.id, 'approve', 'owner'); assert.throws(() => h.access.decide(second.id, 'approve', 'owner'), /full/);
  h.access.decide(first.id, 'decline', 'owner'); assert.doesNotThrow(() => h.access.decide(second.id, 'approve', 'owner'));
  h.advance(8 * 86400000); assert.doesNotThrow(() => h.access.decide(first.id, 'approve', 'owner'));
  assert.throws(() => h.access.decide(second.id, 'approve', 'owner'), /full/, 'Refreshing an expired invitation needs a free seat.');
  const consumed = harness(t); while (consumed.db.accounts.length < 48) consumed.db.accounts.push({ id: `fixture-${consumed.db.accounts.length}` });
  consumed.join(await consumed.approve('joined@example.test'), 'joined@example.test');
  const last = consumed.request('last@example.test'); assert.doesNotThrow(() => consumed.access.decide(last.id, 'approve', 'owner'));
  assert.equal(consumed.db.accounts.length, 49);
});

test('deleted families rejoin only through a fresh approval without reviving tokens or lifetime invitation credits', async t => {
  const h = harness(t), email = 'returning@example.test', oldToken = await h.approve(email), oldAccount = h.join(oldToken, email, 'old-account');
  const oldRequest = h.db.accessRequests.find(row => row.accountId === oldAccount.id);
  for (const email of ['old-one@example.test', 'old-two@example.test']) h.access.createInvitation(oldAccount, { email, delivery: 'link' });
  const oldInvitation = h.db.familyInvitations[0];
  h.db.accounts = h.db.accounts.filter(account => account.id !== oldAccount.id);
  h.request(email); h.request(email);
  const requests = h.db.accessRequests.filter(row => row.email === email);
  assert.equal(requests.length, 2); const fresh = requests.at(-1);
  assert.equal(fresh.status, 'pending'); assert.equal(fresh.joinedAt, undefined); assert.notEqual(fresh.id, oldRequest.id);
  assert.throws(() => h.access.inspect(oldToken), /used/);
  const restored = harness(t, { db: structuredClone(h.db) });
  const newToken = await restored.approve(email), newAccount = restored.join(newToken, email, 'new-account');
  assert.notEqual(newToken, oldToken); assert.notEqual(newAccount.id, oldAccount.id);
  assert.equal(restored.db.accessRequests.find(row => row.id === oldRequest.id).joinedAt, oldRequest.joinedAt);
  assert.throws(() => restored.access.inspect(oldToken), /used/);
  const status = restored.access.invitationStatus(newAccount);
  assert.equal(status.used, 2); assert.equal(status.remaining, 1); assert.deepEqual(status.invitations, [], 'Deleted account contacts and links are not revived.');
  assert.throws(() => restored.access.resend(newAccount, oldInvitation.id), /not in this family/);
  assert.throws(() => restored.access.createInvitation(newAccount, { email: oldInvitation.email, delivery: 'link' }), /already/);
  restored.access.createInvitation(newAccount, { email: 'new-third@example.test', delivery: 'link' });
  assert.equal(restored.access.invitationStatus(newAccount).remaining, 0);
  assert.throws(() => restored.access.createInvitation(newAccount, { email: 'fourth@example.test', delivery: 'link' }), /three invitations/);
});
