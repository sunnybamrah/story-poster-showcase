import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKitSuggestions, suggestionsPerDay } from '../server/kit-suggestions.js';
import { createAccessControl } from '../server/access-control.js';
import { createApp } from '../server/app-server.mjs';
import { passwordFields } from '../server/accounts.js';
import { saveJSON, readJSON } from '../server/files.js';
import { loadPublicSample } from '../server/public-sample.js';

const input = (note = 'Please make this text larger.') => ({ requestId: randomUUID(), note, page: 2 });
function fixture() {
  const account = { id: randomUUID(), email: 'parent@example.test', emailVerified: true };
  const job = { id: randomUUID(), accountId: account.id, childId: 'primary', status: 'complete', feedback: { didItHelp: 'yes' } };
  return { account, job, db: { accounts: [account], jobs: [job], sessions: [] } };
}
test('private suggestions validate ownership and fields without changing kit feedback; retries dedupe', () => {
  const { account, job, db } = fixture(), original = JSON.stringify(job); let queued = 0;
  const store = createKitSuggestions({ db, persist() {}, queue() { queued++; } });
  const body = input(), saved = store.save(account, job, body);
  assert.equal(saved.saved, true); assert.equal(store.save(account, job, body).id, saved.id);
  assert.equal(store.save(account, job, { ...body, requestId: randomUUID() }).id, saved.id);
  assert.equal(db.kitSuggestions.length, 1); assert.equal(JSON.stringify(job), original);
  assert.throws(() => store.save(account, job, { ...body, note: 'A different request' }), { status: 409 });
  assert.throws(() => store.save({ id: 'other' }, job, input()), { status: 404 });
  job.status = 'running'; assert.throws(() => store.save(account, job, input()), { status: 409 }); job.status = 'complete';
  for (const change of [{ note: '' }, { note: 'x'.repeat(501) }, { note: 'bad\u0000text' }, { page: 0 }, { page: 6 }, { page: '2' }, { requestId: 'sample' }, { attachment: 'private-story' }]) assert.throws(() => store.save(account, job, { ...input(), ...change }), { status: 400 });
  assert.equal(store.save(account, job, { ...input('x'.repeat(500)), page: null }).saved, true);
  assert.equal(store.list()[0].requestId, undefined); assert.ok(queued >= 2);
});
test('explicit suggestion email queue survives failure and restart, retries once with same key, and deletes privately', async () => {
  const { account, job, db } = fixture(); let now = 100000, fail = true; const mails = [];
  const sender = Object.assign(async message => { mails.push(message); if (fail) throw Error('Mock mail unavailable'); return { accepted: true, providerId: 'mock-accepted' }; }, { available: true });
  const options = { db, persist() {}, sendMail: sender, accounts: { isOwner: () => false }, ownerEmails: ['owner@example.test'], publicOrigin: 'https://story.example.test', autoDeliver: false, now: () => now };
  let queue = createAccessControl(options), store = createKitSuggestions({ db, persist() {}, queue: queue.queueSuggestion, delivery: queue.suggestionDelivery });
  const body = input('<script>Not HTML</script> & please improve this page.'); const saved = store.save(account, job, body);
  await queue.drainEmail(); assert.equal(db.accessDeliveries[0].kind, 'kit-suggestion'); assert.equal(db.accessDeliveries[0].status, 'failed'); assert.equal(db.kitSuggestions[0].note, body.note);
  const restarted = JSON.parse(JSON.stringify(db)); queue.close(); queue = createAccessControl({ ...options, db: restarted });
  store = createKitSuggestions({ db: restarted, persist() {}, queue: queue.queueSuggestion, delivery: queue.suggestionDelivery });
  fail = false; now += 60000; await queue.drainEmail(); assert.equal(mails.length, 2); assert.equal(mails[0].idempotencyKey, mails[1].idempotencyKey); assert.equal(mails[1].to, 'owner@example.test');
  assert.equal(mails[1].html, undefined); assert.equal(mails[1].attachments, undefined); assert.ok(mails[1].text.includes(body.note)); assert.ok(!mails[1].text.includes(account.email));
  assert.equal(store.list()[0].notification.status, 'accepted');
  assert.equal(store.save(restarted.accounts[0], restarted.jobs[0], body).id, saved.id); await queue.drainEmail(); assert.equal(mails.length, 2);
  store.remove(account.id, job.id); assert.equal(restarted.kitSuggestions.length, 0); assert.equal(restarted.accessDeliveries.length, 0); queue.close();
});

test('HTTP suggestions require owned completed kits, block sample and foreign origins, and persist across restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'suggestion-http-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sample = loadPublicSample(), first = { id: randomUUID(), username: 'fictional-parent', email: 'parent@example.test', emailVerified: true, childIds: ['primary'], activeChildId: 'primary', ...passwordFields('fixture-password') }, owner = { ...first, id: randomUUID(), username: 'fictional-owner', email: 'owner@example.test' };
  for (const person of [first, owner]) saveJSON(join(dir, person.id, 'family.json'), sample.record);
  const job = { id: randomUUID(), accountId: first.id, childId: 'primary', status: 'complete', result: sample.result, moveId: sample.moveId, createdAt: new Date().toISOString(), chapterNumber: 1 };
  saveJSON(join(dir, 'accounts.json'), { accounts: [first, owner], jobs: [job], sessions: [] });
  let sends = 0; const sender = Object.assign(async () => { sends++; return { accepted: true }; }, { available: true });
  const settings = { dataDirectory: dir, sample, generationRoute: 'subscription', ownerAccountIds: [owner.id], sendMail: sender, publicOrigin: 'https://story.example.test', autoDeliverAccess: false, transportFactory: () => assert.fail('No model calls') };
  let app; const start = async sampleOnly => { app = createApp({ ...settings, sampleOnly }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); }; await start(false); t.after(() => app.close());
  const request = async (path, body, cookie, method = body === undefined ? 'GET' : 'POST', origin) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const parentLogin = await request('login', { username: first.username, password: 'fixture-password' }), ownerLogin = await request('login', { username: owner.username, password: 'fixture-password' }); assert.equal(parentLogin.status, 200);
  const route = `jobs/${job.id}/suggestions`, body = input();
  assert.equal((await request(route, body)).status, 401); assert.equal((await request(route, body, ownerLogin.cookie)).status, 404);
  assert.equal((await request(route, body, parentLogin.cookie, 'POST', 'https://elsewhere.example.test')).status, 403);
  assert.equal((await request(route, body, parentLogin.cookie)).data.saved, true);
  assert.equal((await request(route, body, parentLogin.cookie)).data.duplicate, true);
  assert.equal((await request('owner/suggestions', undefined, parentLogin.cookie)).status, 403);
  const list = await request('owner/suggestions', undefined, ownerLogin.cookie); assert.equal(list.data.suggestions.length, 1); assert.equal(list.data.suggestions[0].note, body.note);
  assert.equal((await request('sample/suggestions', input())).status, 404); assert.equal(sends, 0);
  await app.close(); await start(false); assert.equal((await request('owner/suggestions', undefined, ownerLogin.cookie)).data.suggestions.length, 1);
  await app.close(); await start(true); assert.equal((await request(route, input(), parentLogin.cookie)).status, 403);
  assert.equal(readJSON(join(dir, 'accounts.json')).kitSuggestions.length, 1); assert.equal(sends, 0);
});


test('feedback email cap is account-scoped, keeps safe retries and resets next Chicago day', () => {
  const { account, job, db } = fixture(); let instant = new Date('2026-10-26T23:00:00Z');
  const store = createKitSuggestions({ db, persist() {}, queue() {}, now: () => instant });
  const first = input('First note'); store.save(account, job, first);
  for (let i = 1; i < suggestionsPerDay; i++) store.save(account, job, input('Different note ' + i));
  assert.equal(store.save(account, job, first).duplicate, true);
  assert.throws(() => store.save(account, job, input('Over the email limit')), { status: 429 });
  const other = { ...account, id: randomUUID() }, otherJob = { ...job, id: randomUUID(), accountId: other.id }; db.accounts.push(other); db.jobs.push(otherJob);
  assert.equal(store.save(other, otherJob, input('Other family note')).saved, true);
  instant = new Date('2026-10-27T05:00:00Z');
  assert.equal(store.save(account, job, input('Next Chicago day')).saved, true);
  assert.equal(db.kitSuggestions.length, suggestionsPerDay + 2);
});
