import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { runGenerationWorker } from '../server/generation-worker.mjs';
import { createApp } from '../server/app-server.mjs';
import { createAccounts, contestJudgingEndsAt, showcaseAccessEndsAt, passwordFields, passwordMatches } from '../server/accounts.js';
import { openHostedStore } from '../server/hosted-store.js';
import { createMailSender } from '../server/mail.js';
import { saveJSON, readJSON } from '../server/files.js';

const family = { real: false, nickname: 'Pip', age: 10, pronouns: 'he/him', loves: [], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] };
async function harness(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'story-accounts-test-')), mail = [];
  const sendMail = async message => { mail.push(message); }; sendMail.available = true;
  const app = createApp({ dataDirectory: directory, sample: null, sendMail, publicOrigin: 'https://stories.example.test', generationRoute: 'subscription', ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  let cookie = '';
  const request = async (path, data, opts = {}) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, { method: opts.method ?? (data === undefined ? 'GET' : 'POST'), headers: { 'Content-Type': 'application/json', Cookie: opts.cookie ?? cookie, ...opts.headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { response, status: response.status, data: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.text(), cookie };
  };
  return { ...app, request, directory, mail };
}
const token = (message, name) => new URL(message.text.match(/https:\/\/\S+/)[0]).searchParams.get(name);

test('email signup precedes People; verification and recovery preserve the same family and invalidate old sessions', async t => {
  const h = await harness(t);
  const signed = await h.request('/api/signup', { email: 'Parent@Example.test', password: 'first-password' });
  assert.equal(signed.status, 200); assert.equal(signed.data.needsSetup, true); assert.equal(signed.data.record, null); assert.equal(signed.data.emailVerified, false);
  assert.match(signed.response.headers.get('set-cookie'), /Secure/);
  const originalId = signed.data.accountId, oldCookie = signed.cookie, verify = token(h.mail[0], 'verify');
  assert.equal((await h.request('/api/auth/verify', { token: verify })).status, 200);
  assert.equal((await h.request('/api/auth/verify', { token: verify })).status, 400);
  assert.equal((await h.request('/api/family/setup', { family })).status, 200);
  const ready = await h.request('/api/session'); assert.equal(ready.data.accountId, originalId); assert.equal(ready.data.record.hero.nickname, 'Pip');
  assert.equal((await h.request('/api/auth/forgot-password', { email: 'parent@example.test' }, { cookie: '' })).status, 200);
  const reset = token(h.mail[1], 'reset');
  assert.equal((await h.request('/api/auth/reset-password', { token: reset, password: 'new-password' }, { cookie: '' })).status, 200);
  assert.equal((await h.request('/api/session', undefined, { cookie: oldCookie })).data.record, null);
  assert.equal((await h.request('/api/login', { email: 'parent@example.test', password: 'first-password' })).status, 401);
  const recovered = await h.request('/api/login', { email: 'parent@example.test', password: 'new-password' });
  assert.equal(recovered.data.accountId, originalId); assert.equal(recovered.data.record.hero.nickname, 'Pip');
  assert.equal((await h.request('/api/auth/reset-password', { token: reset, password: 'another-password' })).status, 400);
  const disk = readFileSync(join(h.directory, 'accounts.json'), 'utf8'); assert.ok(!disk.includes(reset)); assert.ok(!disk.includes(verify)); assert.ok(!disk.includes('new-password'));
});

test('signup ceiling is checked atomically; an unverified email does not grant ownership', async t => {
  const db = { accounts: Array.from({ length: 49 }, (_, i) => ({ id: randomUUID(), username: `prior${i}`, needsSetup: true, childIds: [], ...passwordFields('some-password') })), jobs: [], sessions: [] };
  const stateStore = { initialState: db, assertWritable() {}, save() {}, async flush() {} };
  const h = await harness(t, { stateStore, ownerEmails: ['owner@example.test'] });
  const replies = await Promise.all(['owner', 'other'].map(name => h.request('/api/signup', { email: `${name}@example.test`, password: 'safe-password' })));
  assert.deepEqual(replies.map(reply => reply.status).sort(), [200, 409]); assert.equal(db.accounts.length, 50);
  const winner = replies.find(reply => reply.status === 200); assert.equal(winner.data.isOwner, false);
});

test('quota reservation spans children, survives job deletion, reuses a job slot and resets at Chicago midnight', () => {
  let instant = new Date('2026-10-18T04:59:59Z'); const account = { id: 'family' }, db = { accounts: [account], sessions: [], jobs: [] };
  const service = createAccounts({ db, persist() {}, now: () => instant });
  for (const id of ['one', 'two', 'three']) service.reserveStory(account, { id });
  assert.equal(service.allowance(account).remaining, 0);
  service.reserveStory(account, { id: 'one' }); assert.equal(service.allowance(account).used, 3);
  assert.throws(() => service.reserveStory(account, { id: 'four' }), /three stories/);
  // Removing the failed job never removes the independent durable reservation.
  db.jobs = []; const restarted = createAccounts({ db, persist() {}, now: () => instant });
  assert.equal(restarted.allowance(account).used, 3);
  instant = new Date('2026-10-18T05:00:01Z'); assert.equal(restarted.allowance(account).remaining, 3);
});

test('dated judge grant removes only the family daily quota, retains reservations, and cannot grant owner rights', () => {
  let instant = new Date('2026-10-20T12:00:00Z');
  const owner = { id: 'owner' }, family = { id: 'family' }, db = { accounts: [owner, family], sessions: [], jobs: [] };
  const service = createAccounts({ db, persist() {}, ownerAccountIds: ['owner'], now: () => instant });
  assert.throws(() => service.prepareJudge(family, { password: 'safe-judge-password' }), /Only the owner/);
  const prepared = service.prepareJudge(owner, { password: 'safe-judge-password' });
  const judge = db.accounts.find(item => item.id === prepared.accountId);
  assert.equal(prepared.expiresAt, showcaseAccessEndsAt);
  assert.equal(judge.needsSetup, true); assert.deepEqual(judge.childIds, []); assert.equal(judge.accessApproved, true);
  assert.equal(service.flags(judge).isOwner, false); assert.equal(passwordMatches(judge, 'safe-judge-password'), true);
  for (const id of ['one', 'two', 'three', 'four']) service.reserveStory(judge, { id });
  assert.equal(service.allowance(judge).used, 4); assert.equal(service.allowance(judge).remaining, null);
  assert.equal(service.allowance(family).remaining, 3);
  judge.creationEnabled = false;
  assert.throws(() => service.reserveStory(judge, { id: 'five' }), /turned off/);
  db.sessions.push({ accountId: judge.id }, { accountId: owner.id });
  service.prepareJudge(owner, { password: 'changed-judge-password' });
  assert.equal(judge.creationEnabled, false); assert.equal(db.accounts.length, 3); assert.deepEqual(db.sessions, [{ accountId: owner.id }]);
  assert.equal(passwordMatches(judge, 'safe-judge-password'), false);
  judge.creationEnabled = true;
  const accidentalOwner = createAccounts({ db, persist() {}, ownerAccountIds: ['owner', judge.id], now: () => instant });
  assert.equal(accidentalOwner.isOwner(judge), false);
  instant = new Date('2026-10-30T20:59:59Z');
  for (const id of ['last-one', 'last-two', 'last-three', 'last-four']) service.reserveStory(judge, { id });
  judge.judgeAccess.expiresAt = contestJudgingEndsAt; // A previously issued grant still works.
  instant = new Date('2026-10-20T12:00:00Z');
  assert.equal(service.allowance(judge).remaining, null);
  assert.equal(service.allowance(family).remaining, 3);
  instant = new Date('2026-11-04T19:00:00Z');
  assert.equal(service.allowance(judge).remaining, null);
  instant = new Date(showcaseAccessEndsAt);
  assert.equal(service.allowance(judge).remaining, 3);
  for (let n = 0; n < 3; n++) service.reserveStory(judge, { id: 'after-cutoff-' + n });
  assert.equal(service.allowance(judge).remaining, 0);
  assert.throws(() => service.reserveStory(judge, { id: 'expired' }), /three stories/);
  assert.throws(() => service.prepareJudge(owner, { password: 'later-judge-password' }), /showcase access period has ended/);
});

test('judge preparation is owner-only, stays invitation-only, and carries no owner family data', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-20T12:00:00Z') });
  const ownerId = randomUUID(), readerId = randomUUID();
  const db = { accounts: [{ id: ownerId, username: 'owner@example.test', email: 'owner@example.test', emailVerified: true, needsSetup: true, childIds: [], ...passwordFields('owner-password') }, { id: readerId, username: 'reader@example.test', email: 'reader@example.test', emailVerified: true, needsSetup: true, childIds: [], ...passwordFields('reader-password') }], sessions: [], jobs: [] };
  const h = await harness(t, { stateStore: { initialState: db, assertWritable() {}, save() {}, async flush() {} }, ownerAccountIds: [ownerId], inviteOnly: true });
  assert.equal((await h.request('/api/owner/judge-account', { password: 'judge-password' })).status, 401);
  await h.request('/api/login', { email: 'reader@example.test', password: 'reader-password' });
  assert.equal((await h.request('/api/owner/judge-account', { password: 'judge-password' })).status, 403);
  await h.request('/api/login', { email: 'owner@example.test', password: 'owner-password' });
  const prepared = await h.request('/api/owner/judge-account', { password: 'judge-password', isOwner: true, expiresAt: '2099-01-01T00:00:00Z' });
  assert.equal(prepared.status, 200); assert.equal(prepared.data.expiresAt, showcaseAccessEndsAt);
  const clean = await h.request('/api/owner/judge-account', { username: 'devpost-reviewer', password: 'fresh-reviewer-password' });
  assert.equal(clean.status, 200); assert.notEqual(clean.data.accountId, prepared.data.accountId);
  const freshLogin = await h.request('/api/login', { username: 'devpost-reviewer', password: 'fresh-reviewer-password' });
  assert.equal(freshLogin.status, 200); assert.equal(freshLogin.data.isOwner, false); assert.equal(freshLogin.data.record, null);
  assert.equal(freshLogin.data.needsSetup, true); assert.deepEqual(freshLogin.data.jobs, []);
  const login = await h.request('/api/login', { username: 'devpost-judge', password: 'judge-password' });
  assert.equal(login.status, 200); assert.equal(login.data.isOwner, false); assert.equal(login.data.record, null);
  assert.deepEqual(login.data.jobs, []); assert.equal(login.data.storyAllowance.remaining, null);
  assert.equal((await h.request('/api/family/setup', { family })).status, 200);
  assert.equal((await h.request('/api/owner/accounts')).status, 403);
  assert.equal((await h.request('/api/owner/kits')).status, 403);
  assert.equal((await h.request('/api/config')).data.signup.requiresInvitation, true);
  assert.equal((await h.request('/api/signup', { email: 'uninvited@example.test', password: 'some-password' })).status, 410);
});

test('creation-only revoke keeps family reading, recovery, and downloads; owner sees only finished jobs', async t => {
  const ownerId = randomUUID(), readerId = randomUUID(), kitId = randomUUID();
  const db = { accounts: [{ id: ownerId, username: 'owner@example.test', email: 'owner@example.test', emailVerified: true, needsSetup: true, childIds: [], ...passwordFields('owner-password') }, { id: readerId, username: 'reader@example.test', email: 'reader@example.test', emailVerified: true, needsSetup: true, childIds: [], ...passwordFields('reader-password') }], sessions: [], jobs: [] };
  const h = await harness(t, { stateStore: { initialState: db, assertWritable() {}, save() {}, async flush() {} }, ownerAccountIds: [ownerId] });
  await h.request('/api/login', { email: 'reader@example.test', password: 'reader-password' }); await h.request('/api/family/setup', { family });
  db.jobs.push({ id: kitId, accountId: readerId, childId: 'primary', status: 'complete', createdAt: new Date().toISOString(), chapterNumber: 1, tonight: 'PRIVATE RAW NOTE', result: { chapterTitle: 'A finished story', story: 'Fictional finished words.' } }, { id: randomUUID(), accountId: readerId, childId: 'primary', status: 'failed', createdAt: new Date().toISOString(), tonight: 'PRIVATE UNFINISHED NOTE' });
  mkdirSync(join(h.directory, readerId, kitId), { recursive: true }); writeFileSync(join(h.directory, readerId, kitId, 'kit_final.pdf'), '%PDF fictional');
  assert.equal((await h.request('/api/owner/kits')).status, 403);
  await h.request('/api/login', { email: 'owner@example.test', password: 'owner-password' });
  const kits = await h.request('/api/owner/kits'); assert.equal(kits.data.kits.length, 1); assert.ok(!JSON.stringify(kits.data).includes('PRIVATE'));
  assert.equal((await h.request(`/api/owner/accounts/${readerId}`, { creationEnabled: false }, { method: 'PATCH' })).status, 200);
  const login = await h.request('/api/login', { email: 'reader@example.test', password: 'reader-password' }); assert.equal(login.data.creationEnabled, false); assert.equal(login.data.jobs.length, 2);
  assert.equal((await h.request('/api/jobs', { childId: 'primary', tonight: 'A hard moment.' })).status, 403);
  const pdf = await h.request(`/api/jobs/${kitId}/files/kit_final.pdf`); assert.equal(pdf.status, 200); assert.equal(pdf.data, '%PDF fictional');
  assert.equal((await h.request('/api/auth/forgot-password', { email: 'reader@example.test' })).status, 200);
});

test('tokens expire, failed delivery creates no usable link, and email credentials stay server-side', async () => {
  const account = { id: 'a', email: 'a@example.test', ...passwordFields('first-password') }, db = { accounts: [account], sessions: [], jobs: [] }; let instant = new Date('2026-10-17T12:00:00Z'), message;
  const sender = async value => { message = value; }; sender.available = true;
  const service = createAccounts({ db, persist() {}, sendMail: sender, publicOrigin: 'https://stories.example.test', now: () => instant });
  await service.issue(account, 'reset'); const reset = token(message, 'reset'); instant = new Date('2026-10-17T13:00:01Z'); assert.throws(() => service.consume(reset, 'reset', 'new-password'), /expired/);
  assert.equal(passwordMatches(account, 'first-password'), true);
  const senderAdapter = createMailSender({ STORY_POSTER_MAIL_FROM: 'Stories <stories@example.test>', STORY_POSTER_RESEND_KEY: 'test-secret' }, { fetchImpl: async (url, options) => { assert.equal(url, 'https://api.resend.com/emails'); assert.equal(JSON.parse(options.body).to[0], 'a@example.test'); return { ok: true, async json() { return { id: 'provider-receipt' }; } }; } });
  assert.equal(senderAdapter.available, true); assert.deepEqual(await senderAdapter({ to: 'a@example.test', subject: 'Check', text: 'Text', idempotencyKey: 'receipt' }), { accepted: true, providerId: 'provider-receipt' });
  const failing = async () => { throw Error('secret details'); }; failing.available = true;
  const failed = createAccounts({ db, persist() {}, sendMail: failing, publicOrigin: 'https://stories.example.test', now: () => instant });
  await assert.rejects(() => failed.issue(account, 'verify'), /could not be sent/); assert.equal(db.authTokens.some(row => row.kind === 'verify'), false);
});

class FakeClient extends EventEmitter {
  failUpdate = false; updates = [];
  async connect() {} async end() {}
  async query(sql, params) {
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.startsWith('SELECT body')) return { rows: [{ body: { accounts: [], jobs: [], sessions: [] } }] };
    if (sql.startsWith('UPDATE')) { if (this.failUpdate) throw Error('Connection failed'); this.updates.push(JSON.parse(params[0])); }
    return { rows: [] };
  }
}
test('Postgres snapshots are acknowledged in order and lost writes reject further generation and replies', async () => {
  const client = new FakeClient(), store = await openHostedStore({ client });
  const state = { accounts: [{ id: 'first' }] }; store.save(state); state.accounts.push({ id: 'second' }); store.save(state); await store.flush();
  assert.equal(client.updates[0].accounts.length, 1); assert.equal(client.updates[1].accounts.length, 2);
  client.failUpdate = true; store.save(state); await assert.rejects(() => store.flush(), /temporarily unavailable/); assert.throws(() => store.save(state), /temporarily unavailable/); await store.close();
  const next = new FakeClient(), locked = await openHostedStore({ client: next }); next.emit('end'); assert.throws(() => locked.assertWritable(), /temporarily unavailable/); await locked.close();
});

test('real clarification HTTP route shares the family lock and returns its saved decision', async t => {
  let calls = 0;
  const h = await harness(t, { transportFactory: () => ({ async call() { calls++; return { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ status: 'ready', question: '', missingFact: 'none' }) }] }] }; }, recordRejection() {}, recordVerdict() {} }) });
  await h.request('/api/signup', { email: 'clarify@example.test', password: 'fixture-password' });
  await h.request('/api/auth/verify', { token: token(h.mail[0], 'verify') }); await h.request('/api/family/setup', { family });
  const input = { childId: 'primary', tonight: 'Pip felt upset after losing a game.', kitContext: {} };
  const first = await h.request('/api/moment/clarify', input); assert.equal(first.status, 200); assert.equal(first.data.status, 'ready'); assert.equal(calls, 1);
  const again = await h.request('/api/moment/clarify', input); assert.equal(again.data.draftId, first.data.draftId); assert.equal(calls, 1); assert.equal(h.active.size, 0);
});

test('a rejected database deletion leaves all family files intact for restart recovery', async t => {
  let unavailable = false;
  const store = { initialState: { accounts: [], sessions: [], jobs: [] }, assertWritable() {}, save() {}, async flush() { if (unavailable) throw Error('offline'); } };
  const h = await harness(t, { stateStore: store });
  const user = await h.request('/api/signup', { email: 'delete@example.test', password: 'fixture-password' });
  await h.request('/api/family/setup', { family });
  const path = join(h.directory, user.data.accountId, 'family.json'), before = readFileSync(path, 'utf8');
  unavailable = true;
  const result = await h.request('/api/family', {}, { method: 'DELETE' }); assert.equal(result.status, 503); assert.equal(readFileSync(path, 'utf8'), before);
});


test('email delivery failure never reveals whether a recovery address is registered', async t => {
  const sendMail = async () => { throw Error('provider unavailable'); }; sendMail.available = true;
  const h = await harness(t, { sendMail });
  await h.request('/api/signup', { email: 'existing@example.test', password: 'fixture-password' });
  const existing = await h.request('/api/auth/forgot-password', { email: 'existing@example.test' }, { cookie: '' });
  const absent = await h.request('/api/auth/forgot-password', { email: 'absent@example.test' }, { cookie: '' });
  assert.equal(existing.status, absent.status); assert.deepEqual(existing.data, absent.data); assert.equal(existing.status, 200);
  assert.equal(readJSON(join(h.directory, 'accounts.json')).mailFailures[0].reason, 'provider-unavailable');
});

test('acknowledged family deletion removes its generated cache and records worker cleanup without touching another family', async t => {
  const db = { accounts: [], sessions: [], jobs: [], workerRequests: [] };
  const h = await harness(t, { stateStore: { initialState: db, assertWritable() {}, save() {}, async flush() {} } });
  const user = await h.request('/api/signup', { email: 'remove@example.test', password: 'fixture-password' }); await h.request('/api/family/setup', { family });
  const requestId = randomUUID(), otherId = randomUUID(); mkdirSync(join(h.directory, 'worker-results'), { recursive: true });
  db.workerRequests.push({ id: requestId, owner: { accountId: user.data.accountId, workId: 'story' }, status: 'complete' }, { id: otherId, owner: { accountId: randomUUID(), workId: 'other-story' }, status: 'complete' });
  writeFileSync(join(h.directory, 'worker-results', `${requestId}.json`), 'private generated content'); writeFileSync(join(h.directory, 'worker-results', `${otherId}.json`), 'other family');
  const deleted = await h.request('/api/family', {}, { method: 'DELETE' }); assert.equal(deleted.status, 200);
  assert.throws(() => readFileSync(join(h.directory, 'worker-results', `${requestId}.json`))); assert.equal(readFileSync(join(h.directory, 'worker-results', `${otherId}.json`), 'utf8'), 'other family');
  assert.equal(db.deletions[0].accountId, user.data.accountId); assert.throws(() => readFileSync(join(h.directory, user.data.accountId, 'family.json')));
});


test('actual outbound worker HTTP completes clarification and saves its generated output on both ends', async t => {
  const secret = 'fixture-worker-secret-at-least-thirty-two-characters';
  const h = await harness(t, { workerSecret: secret });
  const signed = await h.request('/api/signup', { email: 'remote@example.test', password: 'fixture-password' });
  await h.request('/api/auth/verify', { token: token(h.mail[0], 'verify') }); await h.request('/api/family/setup', { family });
  const controller = new AbortController(); let executions = 0;
  const running = runGenerationWorker({ origin: `http://127.0.0.1:${h.server.address().port}`, secret, outboxDirectory: join(h.directory, 'mac-outbox'), signal: controller.signal, execute: async () => { executions++; return { text: JSON.stringify({ status: 'ready', question: '', missingFact: 'none' }) }; } });
  t.after(async () => { controller.abort(); await running; });
  for (let i = 0; i < 30; i++) { if ((await h.request('/api/config')).data.worker.online) break; await new Promise(resolve => setTimeout(resolve, 10)); }
  const answer = await h.request('/api/moment/clarify', { childId: 'primary', tonight: 'Pip felt disappointed after losing the game.', kitContext: {} });
  assert.equal(answer.status, 200); assert.equal(answer.data.status, 'ready'); assert.equal(executions, 1);
  const state = readJSON(join(h.directory, 'accounts.json')), receipt = state.workerRequests[0]; assert.equal(receipt.owner.accountId, signed.data.accountId); assert.equal(receipt.status, 'complete');
  assert.equal(readJSON(join(h.directory, 'worker-results', `${receipt.id}.json`)).result.text.includes('ready'), true);
  assert.equal(readJSON(join(h.directory, 'mac-outbox', `request-${receipt.id}.json`)).completion.result.text.includes('ready'), true);
  controller.abort(); await running;
});

test('all admitted families can make more than three stories during review while reservations and gates stay intact', () => {
  let instant = new Date('2026-10-25T16:00:00Z');
  const db = { accounts: [], sessions: [], jobs: [] };
  const service = createAccounts({ db, persist() {}, now: () => instant, assertAdmission: account => { if (account.denied) throw Object.assign(Error('Admission required'), { status: 403 }); } });
  for (const id of ['owner', 'ordinary', 'new-family']) {
    const account = { id, email: id + '@example.test', emailVerified: true };
    for (let n = 0; n < 6; n++) service.reserveStory(account, { id: id + n });
    service.reserveStory(account, { id: id + 5 });
    assert.deepEqual(service.allowance(account), { limit: null, remaining: null, used: 6, day: '2026-10-25', timeZone: 'America/Chicago' });
    for (const change of [{ creationEnabled: false }, { emailVerified: false }, { denied: true }]) assert.throws(() => service.assertCreation({ ...account, ...change }, { newStory: true }), { status: 403 });
  }
  assert.equal(db.storyReservations.length, 18);
  instant = new Date(Date.parse(showcaseAccessEndsAt) - 1);
  const account = { id: 'expiry' };
  for (let n = 0; n < 5; n++) service.reserveStory(account, { id: 'expiry' + n });
  assert.equal(service.allowance(account).limit, null);
  instant = new Date(showcaseAccessEndsAt);
  assert.equal(service.allowance(account).used, 0); assert.equal(service.allowance(account).remaining, 3);
  for (let n = 0; n < 3; n++) service.reserveStory(account, { id: 'after-expiry' + n });
  assert.throws(() => service.assertCreation(account, { newStory: true }), { status: 429 });
  service.reserveStory(account, { id: 'after-expiry2' });
  assert.equal(db.storyReservations.filter(row => row.accountId === account.id).length, 8);
  instant = new Date('2026-10-25T04:59:59.999Z');
  assert.equal(service.allowance({ id: 'before' }).limit, 3);
});

test('fresh reviewer login preserves the old test account, sessions and stories', () => {
  const owner = { id: 'owner' };
  const older = { id: 'old-judge', username: 'devpost-judge', role: 'contestJudge', childIds: ['primary'], ...passwordFields('old-private-test-password') };
  const db = { accounts: [owner, older], sessions: [{ accountId: older.id, hash: 'old-session' }], jobs: [{ id: 'old-story', accountId: older.id, tonight: 'Private test input' }] };
  const before = JSON.stringify({ older, sessions: db.sessions, jobs: db.jobs });
  const service = createAccounts({ db, persist() {}, ownerAccountIds: [owner.id], now: () => new Date('2026-10-26T18:00:00Z') });
  assert.throws(() => service.prepareJudge(older, { username: 'devpost-reviewer', password: 'new-reviewer-password' }), /Only the owner/);
  assert.throws(() => service.prepareJudge(owner, { username: 'owner', password: 'new-reviewer-password' }), /supported reviewer/);
  const created = service.prepareJudge(owner, { username: 'devpost-reviewer', password: 'new-reviewer-password' });
  const fresh = db.accounts.find(a => a.id === created.accountId);
  assert.equal(JSON.stringify({ older, sessions: db.sessions, jobs: db.jobs }), before);
  assert.notEqual(fresh.id, older.id); assert.deepEqual(fresh.childIds, []); assert.equal(fresh.needsSetup, true);
  assert.equal(service.flags(fresh).isOwner, false); assert.equal(service.allowance(fresh).remaining, null);
  assert.equal(passwordMatches(older, 'old-private-test-password'), true);
});
