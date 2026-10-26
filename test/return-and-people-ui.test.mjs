import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
import { createApp } from '../server/app-server.mjs';
import { loadPublicSample } from '../server/public-sample.js';
import { passwordFields } from '../server/accounts.js';
import { root, saveJSON } from '../server/files.js';
import { launchMeasurementBrowser } from '../server/layout-fit.js';
import { hostedSubscriptionDataPolicyVersion } from '../app/data-policy.js';

// Uses the existing local app, Vite proxy and browser helper. All people and saved
// jobs are fictional fixtures. No job is started and no provider is available.
test('people edits preserve a draft and entry restores saved progress without generation', async t => {
  const out = process.env.STORY_POSTER_RETURN_UI_OUT || join(root, 'context/return-and-people-2026-10-25/independent-ui');
  mkdirSync(out, { recursive: true });
  const directory = mkdtempSync(join(out, 'fixture-'));
  const sample = loadPublicSample(), password = 'fictional-check-password';
  const accounts = ['accepted', 'unaccepted'].map(username => ({ id: randomUUID(), username, childIds: ['primary'], activeChildId: 'primary', creationEnabled: true, pictureStyleId: 'adventure-comic', ...passwordFields(password) }));
  const db = { accounts, jobs: [], sessions: [] };
  for (const account of accounts) {
    const record = structuredClone(sample.record);
    record.real = true; // Fictional data marked real solely to exercise the consent UI.
    if (account.username === 'accepted') record.dataPolicyConsent = { accepted: true, version: hostedSubscriptionDataPolicyVersion, acceptedAt: '2026-10-25T00:00:00Z' };
    saveJSON(join(directory, account.id, 'family.json'), record);
  }
  let providerCalls = 0;
  const app = createApp({ dataDirectory: directory, sample, sampleOnly: false, generationRoute: 'subscription', publicOrigin: 'http://localhost', autoDeliverAccess: false,
    stateStore: { initialState: db, assertWritable() {}, save() {}, flush: async () => {} },
    sendMail: Object.assign(async () => assert.fail('No mail belongs in this check'), { available: false }),
    transportFactory: () => { providerCalls++; assert.fail('No model work belongs in this check'); },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const target = 'http://127.0.0.1:' + app.server.address().port;
  const result = await fetch(target + '/api/sample').then(r => r.json()); result.sample = false;
  const vite = await createServer({ configFile: false, root: join(root, 'app'), publicDir: join(root, 'public'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target, changeOrigin: true, configure: proxy => proxy.on('proxyReq', req => req.setHeader('origin', 'http://localhost')) } } } });
  await vite.listen(); t.after(() => vite.close());
  const base = 'http://127.0.0.1:' + vite.httpServer.address().port;
  const browser = await launchMeasurementBrowser(); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(({ key }) => {
    window.returnPointBeforeURL = [];
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method].bind(history);
      history[method] = (...args) => {
        const url = String(args[2] ?? '');
        if (/^#(?:wait|result)\//.test(url)) {
          let saved; try { saved = JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { saved = {}; }
          window.returnPointBeforeURL.push({ url, jobId: saved.jobId, screen: saved.screen });
        }
        return original(...args);
      };
    }
  }, { key: 'sp-view-v2-' + accounts[0].id + ':primary' });
  const requests = [], errors = [], checks = [], screenshots = [];
  const observe = page => { page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { const path = new URL(r.url()).pathname; if (path.startsWith('/api/')) requests.push({ method: r.method(), path }); }); };
  let page = await context.newPage(); observe(page);
  const theme = async value => { if (await page.evaluate(() => document.documentElement.dataset.theme) !== value) await page.getByRole('button', { name: value === 'dark' ? 'Use dark theme' : 'Use light theme', exact: true }).click(); };
  const capture = async name => { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, name + ' fits'); const path = join(out, name + '.png'); await page.screenshot({ path, fullPage: true }); screenshots.push(path); };
  const login = async username => { await page.goto(base + '/#login'); await page.getByLabel(/^Email or existing family login/).fill(username); await page.getByLabel(/^Password/).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); };
  const logout = async () => { await context.request.post(base + '/api/logout', { data: {}, headers: { origin: 'http://localhost' } }); };
  await login('accepted'); await page.getByRole('heading', { name: 'One moment, together.', exact: true }).waitFor();
  const draft = 'Fictional draft: a turn in a board game felt unfair.';
  for (const width of [390, 1280]) for (const look of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 844 }); await page.goto(base + '/#tonight'); await theme(look);
    assert.equal(await page.getByRole('button', { name: 'Your choice about family data', exact: true }).count(), 0);
    await page.getByRole('textbox', { name: 'What stayed with you today?', exact: true }).fill(draft);
    await page.getByRole('button', { name: 'Change who joins this story', exact: true }).click();
    await page.getByRole('button', { name: 'Add or edit people', exact: true }).click();
    await page.getByRole('heading', { name: 'Your story people', exact: true }).waitFor();
    await page.getByRole('dialog', { name: 'Who joins this story?', exact: true }).waitFor({ state: 'hidden', timeout: 3000 });
    assert.equal(await page.getByRole('button', { name: 'Your choice about family data', exact: true }).count(), 0);
    assert.equal(await page.getByRole('checkbox', { name: /I am a parent or guardian/ }).count(), 0);
    if (await page.getByRole('button', { name: 'Add another grown-up (optional)', exact: true }).count()) await page.getByRole('button', { name: 'Add another grown-up (optional)', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'Grown-up’s story name', exact: true }).count(), 2);
    await capture(`editor-${width}-${look}`);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('heading', { name: 'One moment, together.', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'What stayed with you today?', exact: true }).inputValue(), draft);
    await page.goto(base + '/#people'); await page.getByRole('heading', { name: 'Your story people', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Your choice about family data', exact: true }).count(), 0);
    await capture(`accepted-people-${width}-${look}`);
    checks.push(`Change/editor/Back retains draft; accepted consent absent on Tonight, editor and People: ${width}/${look}`);
  }
  await page.getByRole('button', { name: 'Family', exact: true }).click();
  await page.getByRole('button', { name: 'Add another child', exact: true }).click();
  assert.equal(await page.getByRole('checkbox', { name: /I am a parent or guardian/ }).isVisible(), true, 'New child has its own reachable consent checkbox');
  await logout(); await login('unaccepted'); await page.getByRole('heading', { name: 'One moment, together.', exact: true }).waitFor();
  for (const look of ['light', 'dark']) {
    await theme(look); const notice = page.getByRole('button', { name: 'Your choice about family data', exact: true });
    assert.equal(await notice.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.getByRole('link', { name: 'Read OpenAI’s data rules', exact: true }).isVisible(), false);
    assert.equal(await page.getByRole('button', { name: 'Allow photo use', exact: true }).isEnabled(), false);
    await capture(`unaccepted-collapsed-${look}`); await notice.click();
    assert.equal(await page.getByRole('link', { name: 'Read OpenAI’s data rules', exact: true }).isVisible(), true);
    await notice.click();
    await page.getByRole('link', { name: 'Read OpenAI’s data rules', exact: true }).waitFor({ state: 'hidden', timeout: 3000 });
    checks.push(`New consent begins collapsed and unchecked: ${look}`);
  }
  await logout(); await login('accepted'); await page.getByRole('heading', { name: 'One moment, together.', exact: true }).waitFor();
  const id = randomUUID(), completedId = randomUUID();
  const jobFiles = join(directory, accounts[0].id, id); mkdirSync(jobFiles, { recursive: true });
  for (const file of ['poster.png', 'poster.pdf', 'kit_final.pdf', 'panel-1.png', 'panel-2.png', 'panel-3.png', 'panel-4.png']) copyFileSync(join(sample.directory, file), join(jobFiles, file));
  db.jobs.push({ id: completedId, accountId: accounts[0].id, childId: 'primary', status: 'complete', stage: 'ready', chapterNumber: 1, moveId: sample.text.moveId, result, createdAt: '2026-10-24T00:00:00Z' });
  const running = { id, accountId: accounts[0].id, childId: 'primary', status: 'running', stage: 'drawing', privateStage: 'panel-2', chapterNumber: 2, moveId: sample.text.moveId, createdAt: new Date().toISOString() }; db.jobs.push(running);
  for (const hash of ['', '#welcome', '#tonight', '#shelf']) {
    // A new document tests initial entry. Same-document hash navigation belongs
    // to the separate Back check below and deliberately keeps explicit routes.
    await page.goto('about:blank');
    await page.goto(base + '/' + hash); await page.waitForURL('**/#wait/' + id);
    await page.getByText('We are drawing the story pictures.', { exact: true }).waitFor();
    checks.push(`Initial entry restores saved drawing stage: ${hash || 'bare URL'}`);
    console.log('initial entry passed:', hash || 'bare URL');
  }
  await page.getByRole('button', { name: 'Family', exact: true }).click();
  await page.getByRole('button', { name: 'Tonight', exact: true }).click();
  await page.getByRole('button', { name: 'Family', exact: true }).click();
  await page.goBack(); await page.waitForURL('**/#tonight');
  await page.getByRole('heading', { name: 'One moment, together.', exact: true }).waitFor();
  checks.push('Explicit browser Back to Tonight does not get hijacked by running work');
  await page.reload(); await page.waitForURL('**/#wait/' + id);
  await capture('restored-running-desktop');
  await logout(); await login('accepted'); await page.waitForURL('**/#wait/' + id);
  checks.push('Sign-out/login returns the existing running job');
  const storage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('sp-view-'))));
  assert.ok(Object.keys(storage).some(key => key.includes(accounts[0].id + ':primary')));
  assert.ok(Object.values(storage).some(value => JSON.parse(value).jobId === id));
  assert.ok(Object.values(storage).every(value => !value.includes(draft) && !value.includes('Pip')));
  await page.close(); page = await context.newPage(); observe(page); await page.goto(base + '/#tonight'); await page.waitForURL('**/#wait/' + id);
  checks.push('New tab restores progress; localStorage contains only scoped view metadata');
  running.status = 'complete'; running.stage = 'ready'; running.result = result;
  await page.close(); page = await context.newPage(); observe(page); await page.goto(base + '/#tonight'); await page.waitForURL('**/#result/' + id);
  await page.getByRole('button', { name: 'Sit together and read our story', exact: true }).waitFor();
  const returnPoints = await page.evaluate(() => window.returnPointBeforeURL);
  assert.ok(returnPoints.some(point => point.url === '#result/' + id && point.jobId === id && point.screen === 'result'));
  assert.ok(returnPoints.filter(point => point.url === '#result/' + id).every(point => point.jobId === id && point.screen === 'result'));
  checks.push('Work completed while away opens that result, not an older completed job');
  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.waitForURL('**/#welcome');
  await page.close(); page = await context.newPage(); observe(page); await page.goto(base + '/#tonight');
  await page.getByRole('heading', { name: 'One moment, together.', exact: true }).waitFor();
  assert.equal(new URL(page.url()).hash, '#tonight');
  checks.push('Deliberately leaving a completed kit clears auto-return while preserving saved stories');
  assert.equal(providerCalls, 0); assert.deepEqual(errors, []);
  assert.deepEqual(requests.filter(r => r.method !== 'GET' && !['/api/login', '/api/logout'].includes(r.path)), []);
  saveJSON(join(out, 'RESULT.json'), { checks, screenshots, pageErrors: errors, providerCalls, generationPosts: requests.filter(r => r.method === 'POST' && /\/jobs(?:\/|$)/.test(r.path)), note: 'Local fictional state only. No live calls or generated stories.' });
});
