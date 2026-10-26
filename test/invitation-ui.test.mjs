import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
import { createApp } from '../server/app-server.mjs';
import { passwordFields } from '../server/accounts.js';
import { root, saveJSON, readJSON } from '../server/files.js';
import { launchMeasurementBrowser } from '../server/layout-fit.js';

// Real local frontend/HTTP/accounts. Only delivery is injected; no actual mail,
// Telegram, model work, family photo, production account or hosted write.
test('storybook request, owner approval, one-use signup and family invitations work in both themes', async t => {
  const output = join(root, 'context/invitation-build-2026-10-20/access-ui'); mkdirSync(output, { recursive: true });
  const directory = mkdtempSync(join(output, 'private-')), ownerId = randomUUID(), password = 'fictional-ui-password';
  saveJSON(join(directory, 'accounts.json'), { accounts: [{ id: ownerId, username: 'owner@example.test', email: 'owner@example.test', emailVerified: true, needsSetup: true, childIds: [], activeChildId: null, ...passwordFields(password) }], jobs: [], sessions: [] });
  const emails = [], sender = Object.assign(async message => { emails.push(message); return { accepted: true, providerId: 'ui-fixture-only' }; }, { available: true });
  const publicOrigin = 'http://localhost:43177';
  const app = createApp({ dataDirectory: directory, sample: null, sampleOnly: false, inviteOnly: true, ownerAccountIds: [ownerId], ownerNotificationEmail: 'owner@example.test', publicOrigin, sendMail: sender, generationRoute: 'subscription', allowSyntheticPortraits: true, transportFactory: () => ({ call() { assert.fail('No provider call belongs in the access UI check.'); } }) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const target = 'http://127.0.0.1:' + app.server.address().port;
  const vite = await createServer({ configFile: false, root: join(root, 'app'), publicDir: join(root, 'public'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target, changeOrigin: true, configure: proxy => proxy.on('proxyReq', request => request.setHeader('origin', publicOrigin)) } } } });
  await vite.listen(); t.after(() => vite.close());
  const base = 'http://127.0.0.1:' + vite.httpServer.address().port;
  const browser = await launchMeasurementBrowser(); t.after(() => browser.close());
  const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await visitor.newPage();
  const errors = [], screenshots = [], checks = [], requests = [];
  const observe = page => { page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { const path = new URL(request.url()).pathname; if (path.startsWith('/api/')) requests.push({ path, method: request.method() }); }); };
  observe(page);
  const both = async (page, name) => {
    for (const dark of [false, true]) {
      const desired = dark ? 'dark' : 'light';
      if (await page.evaluate(() => document.documentElement.dataset.theme) !== desired) await page.getByRole('button', { name: dark ? 'Use dark theme' : 'Use light theme', exact: true }).click();
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' fits the phone');
      const path = join(output, name + '-' + desired + '.png'); await page.screenshot({ path, fullPage: true, animations: 'disabled' }); screenshots.push(path);
    }
  };
  const waitEmail = async email => {
    for (let i = 0; i < 100; i++) { const mail = emails.findLast(mail => mail.to === email && /\?invite=/.test(mail.text)); if (mail) return new URL(mail.text.match(/https?:\/\/\S*\?invite=\S+/)[0]); await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.fail('Injected invitation email did not arrive.');
  };
  const clickRow = (page, email) => page.locator('.owner-account').filter({ hasText: email });
  await page.goto(base); await page.getByRole('button', { name: 'Request access', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Start our first story', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Try the saved sample', exact: true }).count(), 0);
  assert.doesNotMatch(await page.locator('body').innerText(), /50 accounts|3 stories|3-story/);
  await both(page, 'public-welcome');
  await page.getByText('For shared learning about everyday feelings. This is not therapy or emergency help.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'What gets sent, and what stays here' }).click(); await page.getByText('Picture setup sends your photo or appearance description to OpenAI to make the story drawings.', { exact: false }).waitFor(); await both(page, 'public-privacy');
  await page.getByRole('button', { name: 'What gets sent, and what stays here' }).click();
  for (const dark of [false, true]) {
    const theme = dark ? 'dark' : 'light';
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole('button', { name: dark ? 'Use dark theme' : 'Use light theme', exact: true }).click();
    await page.getByRole('button', { name: 'Help: watch the short guide' }).click();
    const guide = page.getByRole('dialog', { name: 'A quick guide to Story Poster' });
    await guide.getByText('Read the steps', { exact: true }).click(); await guide.getByText('Request access, then use your approved email link to join.', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const path = join(output, 'request-help-' + theme + '.png'); await page.screenshot({ path, fullPage: true, animations: 'disabled' }); screenshots.push(path);
    await guide.getByRole('button', { name: 'Close guide', exact: true }).click();
  }
  checks.push('Welcome retains the existing quiet not-therapy line and working privacy disclosure in both themes. Help explains request-only approval with no account/story-limit advertising.');
  await page.getByRole('button', { name: 'Request access', exact: true }).click();
  await page.getByLabel(/^Your email address/).fill('parent@example.test'); await page.getByLabel('Your name (optional)', { exact: true }).fill('Alex');
  assert.equal(await page.locator('input[type=password]').count(), 0); await both(page, 'request-access');
  await page.getByRole('button', { name: 'Request access', exact: true }).click(); await page.getByRole('heading', { name: 'Thanks for asking', exact: true }).waitFor(); await both(page, 'request-saved');
  assert.equal((await visitor.request.get(base + '/api/session').then(r => r.json())).record, null);
  checks.push('Public request needs only an email and optional adult name; no account or child record is created. Missing sample is not advertised.');

  const ownerContext = await browser.newContext({ viewport: { width: 390, height: 844 } }), owner = await ownerContext.newPage(); observe(owner);
  await owner.goto(base + '/#owner'); await owner.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
  await owner.getByLabel(/^Email or existing family login/).fill('owner@example.test'); await owner.getByLabel(/^Password/).fill(password); await owner.getByRole('button', { name: 'Sign in', exact: true }).click();
  await owner.getByRole('heading', { name: 'Families asking to join', exact: true }).waitFor();
  assert.equal(new URL(owner.url()).hash, '#owner');
  assert.equal(requests.filter(r => r.path.endsWith('/decision') && r.method === 'POST').length, 0);
  await both(owner, 'owner-requests'); await clickRow(owner, 'parent@example.test').getByRole('button', { name: 'Approve and email invite' }).click();
  await clickRow(owner, 'parent@example.test').getByText('Approved', { exact: true }).waitFor();
  const inviteURL = await waitEmail('parent@example.test');
  const actualRequests = await ownerContext.request.get(base + '/api/owner/access-requests').then(r => r.json());
  const expiredView = route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ requests: actualRequests.requests.map(request => ({ ...request, invitationExpired: true })) }) });
  await owner.route('**/api/owner/access-requests', expiredView); await owner.getByRole('button', { name: 'Refresh requests' }).click();
  await owner.getByRole('button', { name: 'Send fresh link' }).waitFor(); await both(owner, 'owner-expired-link-fixture');
  await owner.unroute('**/api/owner/access-requests', expiredView); await owner.getByRole('button', { name: 'Refresh requests' }).click();
  checks.push('Expired-link rendering uses a labelled read-only response fixture; the real request remains unchanged and a fresh-link action is available.');
  checks.push('Owner notification landing requires sign-in and returns an actual owner to requests. Approval happens only after its explicit button.');

  await page.goto(base + '/?' + inviteURL.searchParams.toString());
  await page.getByLabel('Your email address', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Your email address', { exact: true }).inputValue(), 'parent@example.test');
  assert.equal(new URL(page.url()).search, '', 'The raw token leaves the address bar after opening.');
  assert.equal(readJSON(join(directory, 'accounts.json')).accounts.length, 1, 'Inspecting an invite does not create an account.');
  await page.reload(); await page.getByLabel('Your email address', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Your email address', { exact: true }).inputValue(), 'parent@example.test', 'Tab-only invite survives reload.');
  await both(page, 'approved-signup'); await page.getByLabel(/^Choose a password/).fill(password); await page.getByRole('button', { name: 'Continue to our people', exact: true }).click();
  await page.getByRole('heading', { name: 'Who’s in your story?', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('sp-entry-link-v1')), null, 'Joining clears the temporary invite.');
  const joined = await visitor.request.get(base + '/api/session').then(r => r.json()); assert.equal(joined.emailVerified, true); assert.equal(joined.needsSetup, true);
  await page.getByRole('textbox', { name: 'Child’s story name', exact: true }).fill('Pip'); await page.getByRole('button', { name: 'Save details', exact: true }).click(); await page.getByRole('heading', { name: 'Your story people', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Save and continue to story', exact: true }).click(); await page.getByRole('button', { name: 'Family', exact: true }).click(); await page.getByRole('tab', { name: 'Account', exact: true }).click(); await page.getByRole('button', { name: 'Invite a family', exact: true }).click();
  await page.getByRole('heading', { name: '3 of 3 invitations left', exact: true }).waitFor(); await both(page, 'family-invites-empty');
  for (let n = 1; n <= 3; n++) {
    await page.getByLabel(/^Parent’s email address/).fill('friend' + n + '@example.test');
    await page.getByRole('button', { name: n === 2 ? 'Email invitation to this parent' : 'Make invite link', exact: true }).click();
    await page.getByRole('heading', { name: `${3 - n} of 3 invitations left`, exact: true }).waitFor();
  }
  await both(page, 'family-invites-used'); assert.equal(await page.getByRole('button', { name: 'Make invite link', exact: true }).count(), 0, 'Used invitations show saved links without an empty disabled form.');
  const invites = await visitor.request.get(base + '/api/invitations').then(r => r.json()); assert.equal(invites.used, 3); assert.equal(invites.invitations.length, 3);
  const first = invites.invitations.find(i => i.email === 'friend1@example.test');
  assert.equal(await page.locator('.invitation-card').filter({ hasText: 'friend1@example.test' }).getByText('The email is queued.', { exact: true }).count(), 0, 'A link-only invite does not claim an email was queued.');
  await page.locator('.invitation-card').filter({ hasText: 'friend1@example.test' }).getByRole('button', { name: 'Email this invite' }).click();
  assert.equal((await visitor.request.get(base + '/api/invitations').then(r => r.json())).used, 3);
  assert.equal((await visitor.request.get(base + '/api/owner/access-requests')).status(), 403);
  checks.push('An approved verified family gets3 invitations. Three explicit recipient actions exhaust them; sending an existing invite does not use another slot. Owner pages remain forbidden.');

  const friendContext = await browser.newContext({ viewport: { width: 390, height: 844 } }), friend = await friendContext.newPage(); observe(friend);
  await friend.goto(base + '/?' + new URL(first.link).searchParams.toString()); await friend.getByRole('heading', { name: 'A story night for your family', exact: true }).waitFor();
  await friend.reload(); await friend.getByRole('heading', { name: 'A story night for your family', exact: true }).waitFor();
  await friend.getByLabel(/^Your email address/).fill('friend1@example.test'); await friend.getByRole('button', { name: 'Request access', exact: true }).click(); await friend.getByRole('heading', { name: 'Thanks for asking', exact: true }).waitFor();
  await owner.getByRole('button', { name: 'Refresh requests' }).click(); await clickRow(owner, 'friend1@example.test').getByRole('button', { name: 'Approve and email invite' }).waitFor();
  assert.equal((await ownerContext.request.get(base + '/api/owner/access-requests').then(r => r.json())).requests.find(r => r.email === 'friend1@example.test').status, 'pending');
  assert.equal((await ownerContext.request.get(base + '/api/owner/access-requests').then(r => r.json())).requests.find(r => r.email === 'friend1@example.test').referrerEmail, 'parent@example.test', 'Reload retains the referral binding.');
  await both(owner, 'owner-referral-request'); await clickRow(owner, 'friend1@example.test').getByRole('button', { name: 'Approve and email invite' }).click();
  const friendURL = await waitEmail('friend1@example.test'); await friend.goto(base + '/?' + friendURL.searchParams.toString()); await friend.getByLabel(/^Choose a password/).fill(password); await friend.getByRole('button', { name: 'Continue to our people' }).click(); await friend.getByRole('heading', { name: 'Who’s in your story?', exact: true }).waitFor();
  assert.equal((await friendContext.request.get(base + '/api/invitations').then(r => r.json())).remaining, 3);
  checks.push('Referral link opens a request, not automatic admission. Its new owner-approved recipient receives3 own credits after joining.');
  const expired = await browser.newPage({ viewport: { width: 390, height: 844 } }); observe(expired); await expired.goto(base + '/?invite=' + 'a'.repeat(64)); await expired.getByRole('alert').waitFor(); await both(expired, 'invalid-invite');
  assert.equal(await expired.getByRole('button', { name: 'Continue to our people', exact: true }).count(), 0);
  assert.equal(await expired.evaluate(() => sessionStorage.getItem('sp-entry-link-v1')), null, 'Invalid token is removed from temporary storage.');
  assert.deepEqual(errors, []);
  saveJSON(join(output, 'proof.json'), { fixture: true, actualLocalHTTP: true, externalMail: false, telegram: false, providerCalls: 0, checks, screenshots, errors, requests, emailFixtureCount: emails.length });
});
