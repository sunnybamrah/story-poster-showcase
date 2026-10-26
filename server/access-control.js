import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { accountLimit, emailAddress, tokenHash } from './accounts.js';

export const familyInvitationLimit = 3;
const tokenPattern = /^[a-f0-9]{64}$/;
const problem = (message, status = 400) => Object.assign(Error(message), { status });
const stamp = now => new Date(now()).toISOString();
const nameFor = value => { if (value == null) return ''; if (typeof value !== 'string' || value.length > 80 || !/^[\p{L}\p{M} .’'-]*$/u.test(value)) throw problem('Use a short grown-up name, or leave it blank.'); return value.trim(); };
const channelView = row => row ? { status: row.status, attempts: row.attempts, updatedAt: row.updatedAt, ...(row.reason ? { reason: row.reason } : {}) } : { status: 'pending', attempts: 0 };

// This state lives in the existing private account store, never the shared guide
// bank. A separate key reproduces emailed links for durable, idempotent retries.
export function createAccessControl({ db, persist, flush = async () => {}, accounts, sendMail, publicOrigin, enabled = false, ownerEmails = [], ownerNotificationEmail, now = Date.now, autoDeliver = true, readyJobExists = () => false } = {}) {
  db.accessRequests ??= []; db.familyInvitations ??= []; db.accessDeliveries ??= [];
  if (enabled && !db.accessTokenKey) { db.accessTokenKey = randomBytes(32).toString('hex'); db.admittedAccountIds = db.accounts.map(account => account.id); persist(); }
  const origin = publicOrigin ? new URL(publicOrigin).origin : null;
  const tokenFor = (purpose, row) => createHmac('sha256', db.accessTokenKey).update(`${purpose}:${row.id}:${row.tokenVersion ?? 0}`).digest('hex');
  const linkFor = (purpose, row) => { const url = new URL('/', origin); url.searchParams.set(purpose, tokenFor(purpose, row)); return url.href; };
  const ownerEmail = () => emailAddress(ownerNotificationEmail) ?? db.accounts.find(account => accounts.isOwner(account) && account.emailVerified && account.email)?.email ?? ownerEmails.map(emailAddress).find(Boolean);
  const admitted = account => !enabled || account?.accessApproved === true || db.admittedAccountIds?.includes(account?.id) || accounts.isOwner(account);
  const assertAdmitted = account => { if (!admitted(account)) throw problem('This family is waiting for access approval. Saved stories are still here.', 403); };
  const assertEnabled = () => { if (!enabled || !origin) throw problem('Access requests are not open here.', 404); };
  const requestFor = id => { const row = db.accessRequests.find(row => row.id === id); if (!row) throw problem('That access request was not found.', 404); return row; };
  function delivery(kind, subjectId, channel, revision = 0) {
    let row = db.accessDeliveries.find(item => item.kind === kind && item.subjectId === subjectId && item.channel === channel && item.revision === revision);
    if (!row) { row = { id: randomUUID(), kind, subjectId, channel, revision, status: 'pending', attempts: 0, updatedAt: stamp(now), nextAttemptAt: 0 }; db.accessDeliveries.push(row); }
    return row;
  }
  const currentDelivery = (kind, id, channel, revision = 0) => db.accessDeliveries.findLast(row => row.kind === kind && row.subjectId === id && row.channel === channel && row.revision === revision);
  function queueAnother(kind, subjectId, channel, revision = 0) {
    const previous = currentDelivery(kind, subjectId, channel, revision);
    if (!previous) return delivery(kind, subjectId, channel, revision);
    if (['pending', 'sending', 'failed'].includes(previous.status)) {
      if (previous.status === 'failed') previous.nextAttemptAt = 0;
      return previous;
    }
    if (now() - Date.parse(previous.updatedAt) < 60000) return previous;
    const row = { id: randomUUID(), kind, subjectId, channel, revision, status: 'pending', attempts: 0, updatedAt: stamp(now), nextAttemptAt: 0 };
    db.accessDeliveries.push(row);
    return row;
  }
  const publicRequest = row => ({ id: row.id, email: row.email, adultName: row.adultName, status: row.status, createdAt: row.createdAt, joinedAt: row.joinedAt ?? null,
    ...(row.referralId ? { referrerEmail: db.accounts.find(account => account.id === db.familyInvitations.find(item => item.id === row.referralId)?.accountId)?.email ?? null } : {}),
    notifications: Object.fromEntries(['email', 'telegram'].map(channel => [channel, channelView(currentDelivery('owner-request', row.id, channel))])),
    ...(row.approvedAt ? { invitationEmail: channelView(currentDelivery('admission', row.id, 'email', row.tokenVersion)), invitationExpiresAt: new Date(row.expires).toISOString(), invitationExpired: !row.joinedAt && row.expires <= now() } : {}) });
  function invitationView(row) {
    const request = db.accessRequests.findLast(item => item.email === row.email);
    return { id: row.id, email: row.email, adultName: row.adultName, createdAt: row.createdAt, status: request?.joinedAt ? 'joined' : request ? request.status === 'pending' ? 'pending-review' : request.status : 'pending-request', link: linkFor('referral', row), emailDelivery: channelView(currentDelivery('referral', row.id, 'email')) };
  }
  function invitationStatus(account) {
    const own = db.familyInvitations.filter(row => row.inviterEmailHash === tokenHash(account.email ?? ''));
    let reason = '', canSendInvitations = true;
    try { assertEnabled(); assertAdmitted(account); accounts.assertCreation(account); if (!account.email || !account.emailVerified) throw problem('Confirm your email before inviting a family.', 403); if (own.length >= familyInvitationLimit) reason = 'You have used your three invitations.'; } catch (error) { reason = error.message; canSendInvitations = false; }
    return { limit: familyInvitationLimit, used: own.length, remaining: Math.max(0, familyInvitationLimit - own.length), canInvite: !reason, canSendInvitations, canInviteReason: reason, invitations: own.filter(row => row.accountId === account.id).map(invitationView) };
  }
  function requestAccess(input) {
    assertEnabled(); const email = emailAddress(input.email), adultName = nameFor(input.adultName);
    if (!email) throw problem('Use a valid email address.');
    let referral;
    if (input.referralToken !== undefined) {
      if (typeof input.referralToken !== 'string' || !tokenPattern.test(input.referralToken)) throw problem('This invitation link is invalid.', 410);
      referral = db.familyInvitations.find(row => row.tokenHash === tokenHash(input.referralToken));
      if (!referral || referral.email !== email) throw problem('Use the email address this invitation was sent to.', 410);
    }
    // A deleted account may ask again, but its earlier consumed token stays
    // spent. Only a new request and owner decision can admit a new account.
    const existingAccount = db.accounts.some(account => account.email === email);
    const outstanding = db.accessRequests.findLast(row => row.email === email && (!row.joinedAt || db.accounts.some(account => account.id === row.accountId)));
    if (!existingAccount && !outstanding) {
      const row = { id: randomUUID(), email, adultName, status: 'pending', createdAt: stamp(now), ...(referral ? { referralId: referral.id } : {}) };
      db.accessRequests.push(row); for (const channel of ['email', 'telegram']) delivery('owner-request', row.id, channel); persist(); kick();
    } else if (!existingAccount && outstanding?.status === 'approved' && outstanding.expires <= now()) {
      outstanding.status = 'pending'; outstanding.rerequestedAt = stamp(now);
      for (const channel of ['email', 'telegram']) queueAnother('owner-request', outstanding.id, channel);
      persist(); kick();
    } else if (!existingAccount && outstanding?.status === 'pending') {
      for (const channel of ['email', 'telegram']) queueAnother('owner-request', outstanding.id, channel);
      persist(); kick();
    } else if (!existingAccount && outstanding?.status === 'approved' && outstanding.expires > now()) {
      queueAnother('admission', outstanding.id, 'email', outstanding.tokenVersion);
      persist(); kick();
    }
    return { ok: true, message: 'Your request is saved. If you are approved, we will email your sign-up link.' };
  }
  function decide(id, decision, ownerId) {
    assertEnabled(); if (!['approve', 'decline'].includes(decision)) throw problem('Choose approve or decline.'); const row = requestFor(id);
    if (row.joinedAt) return { request: publicRequest(row) };
    if (decision === 'decline') { row.status = 'declined'; row.decidedAt = stamp(now); row.decidedBy = ownerId; persist(); return { request: publicRequest(row) }; }
    if (db.accounts.some(account => account.email === row.email)) throw problem('That email already has an account.', 409);
    // Reserve before any await or email. Refreshing this same invitation does
    // not need a second seat; registered, expired and declined rows do not.
    const activeReservations = db.accessRequests.filter(item => item.id !== row.id && item.status === 'approved' && !item.joinedAt && item.expires > now()
      && !db.accounts.some(account => account.id === item.accountId || account.email === item.email)).length;
    if (db.accounts.length + activeReservations >= accountLimit) throw problem('The showcase is full for now.', 409);
    if (row.status !== 'approved' || row.expires <= now()) {
      row.status = 'approved'; row.decidedBy = ownerId; row.approvedAt = stamp(now); row.expires = now() + 7 * 86400000; row.tokenVersion = (row.tokenVersion ?? 0) + 1;
      row.inviteHash = tokenHash(tokenFor('invite', row)); delivery('admission', row.id, 'email', row.tokenVersion);
    } else queueAnother('admission', row.id, 'email', row.tokenVersion);
    persist(); kick(); return { request: publicRequest(row) };
  }
  function inspect(token, expectedEmail) {
    assertEnabled(); if (typeof token !== 'string' || !tokenPattern.test(token)) throw problem('This sign-up link is invalid or has expired.', 410);
    const row = db.accessRequests.find(row => row.inviteHash === tokenHash(token) && row.status === 'approved' && !row.joinedAt && row.expires > now());
    if (!row || expectedEmail !== undefined && row.email !== expectedEmail) throw problem('This sign-up link is invalid, used, expired, or for another email.', 410);
    return row;
  }
  function redeem(row, account) {
    if (row.status !== 'approved' || row.joinedAt || row.expires <= now() || row.email !== account.email) throw problem('This sign-up link cannot be used again.', 409);
    row.joinedAt = stamp(now); row.accountId = account.id; account.emailVerified = true; account.accessApproved = true; account.accessRequestId = row.id;
  }
  function createInvitation(account, input) {
    assertEnabled(); assertAdmitted(account); accounts.assertCreation(account);
    if (!account.email || !account.emailVerified) throw problem('Confirm your email before inviting a family.', 403);
    const email = emailAddress(input.email), adultName = nameFor(input.adultName);
    if (!email || !['link', 'email'].includes(input.delivery)) throw problem('Add an email and choose link or email.');
    if (email === account.email) throw problem('Invite another family, not your own email.', 409);
    let row = db.familyInvitations.find(row => row.accountId === account.id && row.inviterEmailHash === tokenHash(account.email) && row.email === email);
    const created = !row;
    if (!row) {
      if (db.accounts.some(item => item.email === email) || db.familyInvitations.some(item => item.email === email) || db.accessRequests.some(item => item.email === email)) throw problem('That email already has an account, invitation or access request.', 409);
      if (!invitationStatus(account).canInvite) throw problem('You have used your three invitations.', 409);
      row = { id: randomUUID(), accountId: account.id, inviterEmailHash: tokenHash(account.email), email, adultName, createdAt: stamp(now) }; row.tokenHash = tokenHash(tokenFor('referral', row)); db.familyInvitations.push(row);
    }
    if (input.delivery === 'email') queueAnother('referral', row.id, 'email'); persist(); kick(); return { created, invitation: invitationView(row), ...invitationStatus(account) };
  }
  function resend(account, id) {
    assertEnabled(); assertAdmitted(account); accounts.assertCreation(account);
    if (!account.emailVerified) throw problem('Confirm your email before inviting a family.', 403);
    const row = db.familyInvitations.find(row => row.id === id && row.accountId === account.id); if (!row) throw problem('That invitation is not in this family.', 404);
    const mail = queueAnother('referral', row.id, 'email');
    // A deliberate retry can send another email, without another slot or token.
    persist(); kick(); return { invitation: invitationView(row), ...invitationStatus(account), ...(mail.status === 'accepted' ? { message: 'An email was requested less than a minute ago. Try again shortly.' } : {}) };
  }
  const readyRecipient = account => Boolean(account?.emailVerified && emailAddress(account.email));
  const readyEmailEligible = account => Boolean(origin && sendMail?.available && readyRecipient(account));
  function queueReady(job) {
    if (job.notifyWhenReady !== true || job.status !== 'complete' || !readyJobExists(job)) return;
    const account = db.accounts.find(item => item.id === job.accountId);
    if (!readyRecipient(account)) return;
    const row = delivery('kit-ready', job.id, 'email'); row.accountId = job.accountId;
    persist(); kick();
  }
  function readyEmailView(job) {
    const row = currentDelivery('kit-ready', job.id, 'email');
    return { enabled: job.notifyWhenReady === true, status: job.notifyWhenReady !== true ? 'off' : row?.status === 'sending' ? 'pending' : row?.status ?? 'waiting' };
  }
  function mailFor(row) {
    if (row.kind === 'kit-suggestion') {
      const suggestion = db.kitSuggestions?.find(item => item.id === row.subjectId && item.accountId === row.accountId);
      if (!suggestion || !db.accounts.some(account => account.id === suggestion.accountId) || !db.jobs.some(job => job.id === suggestion.jobId && job.accountId === suggestion.accountId && job.status === 'complete')) return null;
      const to = ownerEmail(); if (!to || !origin) throw Error('Owner email is not ready.');
      // Plain text only. No attached pages, family story, photo or automatic name.
      return { to, subject: 'Story Poster feedback', text: `A parent suggested a change.\nKit: ${suggestion.jobId}\n${suggestion.page ? 'Page: ' + suggestion.page : 'Whole kit'}\n\n${suggestion.note}\n\nReview after signing in:\n${new URL('/#owner', origin)}` };
    }
    if (row.kind === 'kit-ready') {
      const job = db.jobs.find(job => job.id === row.subjectId && job.accountId === row.accountId);
      const account = db.accounts.find(account => account.id === row.accountId);
      if (!job || job.notifyWhenReady !== true || job.status !== 'complete' || !readyJobExists(job) || !readyRecipient(account)) return null;
      return { to: account.email, subject: 'Your Story Poster kit is ready', text: `Your kit is saved and ready to read. Sign in to open your shelf:\n\n${new URL('/#shelf', origin)}\n\nYou asked for this notice when you started the kit.` };
    }
    if (row.kind === 'owner-request') { const request = requestFor(row.subjectId), to = ownerEmail(); if (!to) throw Error('Owner email is not ready.'); return { to, subject: 'Story Poster access request', text: `${request.adultName || 'A grown-up'} (${request.email}) asked for access.\n\nReview requests after signing in:\n${new URL('/#owner', origin)}` }; }
    if (row.kind === 'admission') { const request = requestFor(row.subjectId); if (request.status !== 'approved' || request.joinedAt || row.revision !== request.tokenVersion || request.expires <= now()) return null; return { to: request.email, subject: 'Your Story Poster invitation', text: `Your access request is approved. Choose your password using this link:\n\n${linkFor('invite', request)}\n\nThis link is for ${request.email}, works once and expires in seven days. Your email is confirmed when you use it.` }; }
    const invitation = db.familyInvitations.find(item => item.id === row.subjectId), inviter = invitation && db.accounts.find(account => account.id === invitation.accountId);
    if (!inviter || !admitted(inviter) || inviter.creationEnabled === false || !inviter.emailVerified) return null;
    return { to: invitation.email, subject: 'A family invited you to Story Poster', text: `A family invited you to ask for Story Poster access. Sunny still reviews each new family.\n\n${linkFor('referral', invitation)}\n\nUse ${invitation.email} on the request form.` };
  }
  let pumping = null, stopped = false;
  async function drainEmail() {
    if (pumping) return pumping;
    pumping = (async () => {
      for (const row of db.accessDeliveries.filter(row => row.channel === 'email' && ['pending', 'failed', 'sending'].includes(row.status) && (row.nextAttemptAt ?? 0) <= now())) {
        if (stopped) break;
        row.status = 'sending'; row.attempts++; row.updatedAt = stamp(now); persist(); await flush();
        try {
          const message = mailFor(row); if (!message) { row.status = 'failed'; row.reason = 'This message no longer applies.'; row.nextAttemptAt = Number.MAX_SAFE_INTEGER; }
          else { if (!sendMail?.available) throw Error('Email is not ready.'); const result = await sendMail({ ...message, idempotencyKey: `story-poster-access-${row.id}` }); if (result?.accepted !== true) throw Error('Not accepted'); row.status = 'accepted'; row.providerId = result.providerId ?? null; row.reason = null; }
        } catch { row.status = 'failed'; row.reason = 'Email was not accepted. It will be retried.'; row.nextAttemptAt = now() + Math.min(3600000, 15000 * 2 ** Math.min(row.attempts, 8)); }
        row.updatedAt = stamp(now); persist(); await flush();
      }
    })().finally(() => { pumping = null; }); return pumping;
  }
  function queueSuggestion(suggestion) {
    const row = delivery('kit-suggestion', suggestion.id, 'email'); row.accountId = suggestion.accountId;
    persist(); kick(); return channelView(row);
  }
  function kick() { if (autoDeliver && !stopped) Promise.resolve().then(() => drainEmail()).catch(() => {}); }
  async function claimAlert(workerId) {
    if (!enabled) return null;
    const row = db.accessDeliveries.find(row => row.channel === 'telegram' && !['delivered'].includes(row.status) && (row.nextAttemptAt ?? 0) <= now() && (!row.leaseUntil || row.leaseUntil <= now()));
    if (!row) return null;
    const request = requestFor(row.subjectId), claimToken = randomBytes(32).toString('hex');
    row.status = 'sending'; row.workerId = workerId; row.claimHash = tokenHash(claimToken); row.leaseUntil = now() + 60000; row.attempts++; row.updatedAt = stamp(now); persist(); await flush();
    return { id: row.id, kind: 'owner-access-alert', requestId: request.id, email: request.email, adultName: request.adultName, claimToken };
  }
  async function completeAlert(workerId, input) {
    const row = db.accessDeliveries.find(row => row.id === input.alertId && row.channel === 'telegram');
    if (!row || row.workerId !== workerId || typeof input.claimToken !== 'string' || row.claimHash !== tokenHash(input.claimToken)) throw problem('This alert has no matching claim.', 409);
    if (row.status === 'delivered') return { ok: true, alreadyReceived: true };
    if (input.delivered === true && input.receipt === `delivered: Story Poster access request ${row.subjectId}`) { row.status = 'delivered'; row.reason = null; }
    else { row.status = 'failed'; row.reason = 'Telegram delivery is not confirmed. It will be retried.'; row.nextAttemptAt = now() + Math.min(3600000, 15000 * 2 ** Math.min(row.attempts, 8)); }
    row.leaseUntil = 0; row.updatedAt = stamp(now); persist(); await flush(); return { ok: true };
  }
  const timer = autoDeliver ? setInterval(kick, 15000) : null; timer?.unref(); kick();
  return { enabled, admitted, assertAdmitted, requestAccess, decide, inspect, redeem, createInvitation, resend, invitationStatus,
    list: () => db.accessRequests.map(publicRequest).reverse(), inspectPublic: token => { const row = inspect(token); return { status: 'ready', email: row.email, expiresAt: new Date(row.expires).toISOString() }; },
    queueSuggestion, suggestionDelivery: id => channelView(currentDelivery('kit-suggestion', id, 'email', 0)),
    readyEmailEligible, readyEmailView, queueReady, drainEmail, claimAlert, completeAlert, close: () => { stopped = true; if (timer) clearInterval(timer); },
    notificationConfig: () => ({ emailReady: !!sendMail?.available && !!ownerEmail(), telegramQueuedThroughWorker: true }) };
}
