import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessControl } from '../server/access-control.js';
import { createAccounts } from '../server/accounts.js';

function harness(t) {
  let time = Date.parse('2026-10-25T12:00:00Z');
  const db = { accounts: [{ id: 'owner', email: 'owner@example.test', emailVerified: true }], jobs: [], sessions: [] };
  const mails = [];
  const sendMail = Object.assign(async message => { mails.push(message); return { accepted: true, providerId: 'fictional-mail' }; }, { available: true });
  const persist = () => {};
  let access;
  const accounts = createAccounts({ db, persist, sendMail, publicOrigin: 'https://story.example.test', ownerAccountIds: ['owner'], assertAdmission: account => access?.assertAdmitted(account) });
  access = createAccessControl({ db, persist, accounts, sendMail, publicOrigin: 'https://story.example.test', enabled: true, autoDeliver: false, now: () => time });
  t.after(access.close);
  const advance = ms => { time += ms; };
  const request = email => { access.requestAccess({ email }); return db.accessRequests.findLast(row => row.email === email); };
  const approve = async email => {
    const row = request(email);
    access.decide(row.id, 'approve', 'owner');
    await access.drainEmail();
    const mail = mails.findLast(item => item.to === email && item.subject === 'Your Story Poster invitation');
    return { row, token: new URL(mail.text.match(/https:\/\/\S+/)[0]).searchParams.get('invite') };
  };
  const join = (token, email) => {
    const account = { id: `account:${email}`, email, emailVerified: true, accessApproved: true, creationEnabled: true };
    access.redeem(access.inspect(token, email), account); db.accounts.push(account); return account;
  };
  return { db, access, accounts, mails, advance, request, approve, join };
}

test('repeat pending access request coalesces immediately and sends a fresh owner notice after a minute', async t => {
  const h = harness(t), email = 'parent@example.test';
  const row = h.request(email); await h.access.drainEmail();
  const initial = h.db.accessDeliveries.filter(item => item.kind === 'owner-request' && item.subjectId === row.id);
  assert.equal(initial.length, 2);
  initial.find(item => item.channel === 'telegram').status = 'delivered';
  assert.equal(h.mails.filter(mail => mail.subject === 'Story Poster access request').length, 1);

  h.request(email); await h.access.drainEmail();
  assert.equal(h.db.accessRequests.length, 1);
  assert.equal(h.db.accessDeliveries.length, 2);
  assert.equal(h.mails.filter(mail => mail.subject === 'Story Poster access request').length, 1);

  h.advance(60000); h.request(email); await h.access.drainEmail();
  const deliveries = h.db.accessDeliveries.filter(item => item.kind === 'owner-request' && item.subjectId === row.id);
  assert.equal(h.db.accessRequests.length, 1);
  assert.equal(deliveries.length, 4);
  assert.notEqual(deliveries[2].id, initial[0].id);
  assert.notEqual(deliveries[3].id, initial[1].id);
  assert.equal(h.mails.filter(mail => mail.subject === 'Story Poster access request').length, 2);
  assert.equal(row.status, 'pending');
  assert.equal(h.db.accessRequests.filter(item => item.status === 'approved').length, 0);
});

test('approved request and family invite can be emailed again after a minute without changing tokens or slots', async t => {
  const h = harness(t), email = 'approved@example.test';
  const { row, token } = await h.approve(email);
  const tokenVersion = row.tokenVersion, expiry = row.expires;
  h.request(email); await h.access.drainEmail();
  assert.equal(h.db.accessRequests.length, 1);
  assert.equal(h.mails.filter(mail => mail.to === email && mail.subject === 'Your Story Poster invitation').length, 1);

  h.advance(60000); h.request(email); await h.access.drainEmail();
  const admissionMails = h.mails.filter(mail => mail.to === email && mail.subject === 'Your Story Poster invitation');
  assert.equal(admissionMails.length, 2);
  assert.equal(new URL(admissionMails[1].text.match(/https:\/\/\S+/)[0]).searchParams.get('invite'), token);
  assert.equal(row.tokenVersion, tokenVersion);
  assert.equal(row.expires, expiry);
  assert.equal(h.db.accessRequests.length, 1);
  assert.equal(h.db.accessDeliveries.filter(item => item.kind === 'admission' && item.subjectId === row.id).length, 2);

  const account = h.join(token, email);
  const invitation = h.access.createInvitation(account, { email: 'friend@example.test', delivery: 'link' }).invitation;
  const referralToken = new URL(invitation.link).searchParams.get('referral');
  const before = h.access.invitationStatus(account);
  assert.equal(before.used, 1); assert.equal(before.remaining, 2);
  h.access.resend(account, invitation.id); await h.access.drainEmail();
  const firstReferralMail = h.mails.findLast(mail => mail.to === invitation.email && mail.subject === 'A family invited you to Story Poster');
  assert.equal(new URL(firstReferralMail.text.match(/https:\/\/\S+/)[0]).searchParams.get('referral'), referralToken);
  h.access.resend(account, invitation.id); await h.access.drainEmail();
  assert.equal(h.mails.filter(mail => mail.to === invitation.email && mail.subject === 'A family invited you to Story Poster').length, 1);
  h.advance(60000); h.access.resend(account, invitation.id); await h.access.drainEmail();
  const referralMails = h.mails.filter(mail => mail.to === invitation.email && mail.subject === 'A family invited you to Story Poster');
  assert.equal(referralMails.length, 2);
  assert.equal(new URL(referralMails[1].text.match(/https:\/\/\S+/)[0]).searchParams.get('referral'), referralToken);
  assert.equal(h.access.invitationStatus(account).used, 1);
  assert.equal(h.access.invitationStatus(account).remaining, 2);
  assert.throws(() => h.access.resend({ ...account, emailVerified: false }, invitation.id), /confirm your address/);
  assert.throws(() => h.access.resend({ id: 'unapproved', email: 'stranger@example.test', emailVerified: true, creationEnabled: true }, invitation.id), /waiting for access approval/);
});
