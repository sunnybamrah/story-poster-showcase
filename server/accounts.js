import { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { centralDay } from './app-budget.js';
import { showcaseAccessEndsAt } from './showcase-window.js';
export { showcaseAccessEndsAt } from './showcase-window.js';

export const accountLimit = 50, storiesPerDay = 3;
export const reviewStoriesStartAt = '2026-10-25T05:00:00.000Z';
// Original grant stamp remains recognized without changing judge passwords.
export const contestJudgingEndsAt = '2026-10-30T21:00:00.000Z';
export const emailAddress = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;
export const tokenHash = value => createHash('sha256').update(value).digest('hex');
export function passwordFields(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw Object.assign(Error('Choose a password of 8 to 128 characters.'), { status: 400 });
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
}
export function passwordMatches(account, password) {
  const actual = scryptSync(password, account?.salt ?? 'missing-user', 64);
  const expected = Buffer.from(account?.hash ?? '00'.repeat(64), 'hex');
  return expected.length === actual.length && timingSafeEqual(actual, expected) && !!account;
}
export function createAccounts({ db, persist, sendMail, publicOrigin, ownerAccountIds = [], ownerEmails = [], assertAdmission = () => {}, now = () => new Date() }) {
  db.authTokens ??= []; db.storyReservations ??= [];
  const isOwner = account => !!account && account.role !== 'contestJudge' && (ownerAccountIds.includes(account.id) || account.emailVerified === true && ownerEmails.includes(account.email));
  const judgeAccess = account => account?.role === 'contestJudge' && [contestJudgingEndsAt, showcaseAccessEndsAt].includes(account.judgeAccess?.expiresAt)
    && typeof account.judgeAccess.grantedBy === 'string' && now().getTime() < Date.parse(showcaseAccessEndsAt);
  const unlimitedStories = account => judgeAccess(account) || now().getTime() >= Date.parse(reviewStoriesStartAt) && now().getTime() < Date.parse(showcaseAccessEndsAt);
  const allowance = account => {
    const day = centralDay(now()), ids = new Set(db.storyReservations.filter(row => row.accountId === account.id && row.day === day).map(row => row.jobId));
    // Import today's earlier jobs into the count without rewriting their history.
    for (const job of db.jobs) if (job.accountId === account.id && centralDay(new Date(job.createdAt)) === day) ids.add(job.id);
    return { limit: unlimitedStories(account) ? null : storiesPerDay, used: ids.size, remaining: unlimitedStories(account) ? null : Math.max(0, storiesPerDay - ids.size), day, timeZone: 'America/Chicago' };
  };
  function assertCreation(account, { newStory = false } = {}) {
    assertAdmission(account);
    if (account.creationEnabled === false) throw Object.assign(Error('New stories are turned off for this account. Your saved stories and downloads are still here.'), { status: 403 });
    if (account.email && !account.emailVerified) throw Object.assign(Error('Check your email and confirm your address before making new stories or drawings.'), { status: 403 });
    const remaining = newStory ? allowance(account).remaining : null;
    if (remaining !== null && remaining < 1) throw Object.assign(Error('You have started three stories today. Read your saved stories or come back tomorrow. The daily count resets at midnight in Chicago.'), { status: 429 });
  }
  function prepareJudge(owner, { password, username = 'devpost-judge' } = {}) {
    if (!isOwner(owner)) throw Object.assign(Error('Only the owner can prepare judge access.'), { status: 403 });
    if (now().getTime() >= Date.parse(showcaseAccessEndsAt)) throw Object.assign(Error('This showcase access period has ended.'), { status: 409 });
    if (!['devpost-judge', 'devpost-reviewer'].includes(username)) throw Object.assign(Error('Choose a supported reviewer login.'), { status: 400 });
    const fields = passwordFields(password);
    let account = db.accounts.find(item => item.username === username);
    if (account && account.role !== 'contestJudge') throw Object.assign(Error('That login already belongs to another account.'), { status: 409 });
    if (!account) {
      if (db.accounts.length >= accountLimit) throw Object.assign(Error('The app is full for now.'), { status: 409 });
      account = { id: randomUUID(), username, role: 'contestJudge', accessApproved: true, createdAt: now().toISOString(), creationEnabled: true, needsSetup: true, childIds: [], activeChildId: null };
      db.accounts.push(account);
    }
    Object.assign(account, fields, { judgeAccess: { expiresAt: showcaseAccessEndsAt, grantedBy: owner.id, grantedAt: now().toISOString() } });
    // Re-preparing this same login changes its password and signs out earlier
    // sessions. It never copies the owner's family or reverses a revocation.
    db.sessions = db.sessions.filter(item => item.accountId !== account.id);
    persist();
    return { accountId: account.id, username: account.username, expiresAt: showcaseAccessEndsAt, needsSetup: account.needsSetup === true, creationEnabled: account.creationEnabled !== false };
  }
  function reserveStory(account, job) {
    if (db.storyReservations.some(row => row.accountId === account.id && row.jobId === job.id)) return;
    assertCreation(account, { newStory: true });
    db.storyReservations.push({ accountId: account.id, jobId: job.id, day: centralDay(now()) }); persist();
  }
  async function issue(account, kind) {
    if (!sendMail?.available || !publicOrigin) throw Object.assign(Error('Email is not ready yet. Your saved account and stories are safe.'), { status: 503 });
    const token = randomBytes(32).toString('hex'), hash = tokenHash(token), expiry = now().getTime() + (kind === 'verify' ? 86400000 : 3600000);
    const row = { accountId: account.id, kind, hash, expires: expiry, createdAt: now().toISOString(), accepted: false };
    db.authTokens = db.authTokens.filter(item => item.expires > now().getTime());
    db.authTokens.push(row); persist();
    const link = new URL('/', publicOrigin); link.searchParams.set(kind === 'verify' ? 'verify' : 'reset', token);
    try {
      const delivery = await sendMail({ to: account.email, subject: kind === 'verify' ? 'Confirm your Story Poster email' : 'Reset your Story Poster password', text: kind === 'verify' ? `Confirm your email to make stories with your family:\n\n${link}\n\nThis link works for one day. If you did not create this account, ignore this message.` : `Choose a new password for your existing Story Poster account:\n\n${link}\n\nThis link works for one hour. Your saved stories stay with your account. If you did not ask for this, ignore this message.`, idempotencyKey: `story-poster-${hash}` });
      row.accepted = true; row.providerId = delivery?.providerId ?? null; persist();
    } catch {
      db.authTokens = db.authTokens.filter(item => item !== row); persist();
      throw Object.assign(Error('The email could not be sent. Please try again shortly. Your account and stories are safe.'), { status: 503 });
    }
  }
  function consume(token, kind, password) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw Object.assign(Error('This email link is invalid or has expired. Request a fresh link.'), { status: 400 });
    const row = db.authTokens.find(item => item.hash === tokenHash(token) && item.kind === kind && item.accepted && item.expires > now().getTime());
    const account = row && db.accounts.find(item => item.id === row.accountId);
    if (!account) throw Object.assign(Error('This email link is invalid or has expired. Request a fresh link.'), { status: 400 });
    if (kind === 'verify') account.emailVerified = true;
    else { Object.assign(account, passwordFields(password)); db.sessions = db.sessions.filter(item => item.accountId !== account.id); }
    db.authTokens = db.authTokens.filter(item => item.accountId !== account.id || item.kind !== kind); persist();
    return account;
  }
  return { isOwner, allowance, assertCreation, reserveStory, issue, consume, prepareJudge,
    flags: account => ({ email: account.email ?? null, emailVerified: account.email ? account.emailVerified === true : true, isOwner: isOwner(account), needsSetup: account.needsSetup === true, creationEnabled: account.creationEnabled !== false, storyAllowance: allowance(account) }),
    publicAccounts: () => db.accounts.map(account => ({ id: account.id, username: account.username, email: account.email ?? null, emailVerified: account.email ? account.emailVerified === true : true, creationEnabled: account.creationEnabled !== false, createdAt: account.createdAt ?? null, storiesToday: allowance(account).used })),
  };
}
