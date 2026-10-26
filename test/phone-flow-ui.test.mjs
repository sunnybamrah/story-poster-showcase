import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { createServer } from 'vite';
import { heicWorkerPlugin } from '../vite.config.js';
import { createApp } from '../server/app-server.mjs';
import { loadPublicSample } from '../server/public-sample.js';
import { passwordFields } from '../server/accounts.js';
import { root, saveJSON } from '../server/files.js';
import { launchMeasurementBrowser } from '../server/layout-fit.js';
import { hostedSubscriptionDataPolicyVersion } from '../app/data-policy.js';

test('phone setup checks photos before upload, shows missing drawings and opens screens without waiting for refresh', async t => {
  const out = join(root, 'context/phone-flow-2026-10-25/ui'); mkdirSync(out, { recursive: true });
  const directory = mkdtempSync(join(out, 'fixture-')), sample = loadPublicSample(), password = 'fictional-phone-check';
  const account = { id: randomUUID(), username: 'fictional-phone-parent', childIds: ['primary'], activeChildId: 'primary', creationEnabled: true, pictureStyleId: 'adventure-comic', ...passwordFields(password) };
  const record = structuredClone(sample.record); record.real = true;
  record.dataPolicyConsent = { accepted: true, version: hostedSubscriptionDataPolicyVersion, acceptedAt: '2026-10-25T00:00:00Z' };
  saveJSON(join(directory, account.id, 'family.json'), record);
  let providerCalls = 0;
  const app = createApp({ dataDirectory: directory, sample, sampleOnly: false, generationRoute: 'subscription', publicOrigin: 'http://localhost', autoDeliverAccess: false,
    stateStore: { initialState: { accounts: [account], jobs: [], sessions: [] }, assertWritable() {}, save() {}, flush: async () => {} },
    sendMail: Object.assign(async () => assert.fail('No email in local UI check'), { available: false }),
    transportFactory: () => { providerCalls++; assert.fail('No generation in this check'); },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const target = 'http://127.0.0.1:' + app.server.address().port;
  const productionCSP = (await fetch(target + '/health')).headers.get('content-security-policy');
  assert.ok(productionCSP); assert.ok(!productionCSP.includes("worker-src 'self' blob:"));
  const vite = await createServer({ plugins: [heicWorkerPlugin()], worker: { plugins: () => [heicWorkerPlugin()] }, configFile: false, root: join(root, 'app'), publicDir: join(root, 'public'), logLevel: 'error', server: { headers: { 'Content-Security-Policy': productionCSP }, host: '127.0.0.1', port: 0, proxy: { '/api': { target, changeOrigin: true, configure: proxy => proxy.on('proxyReq', req => req.setHeader('origin', 'http://localhost')) } } } });
  await vite.listen(); t.after(() => vite.close());
  const base = process.env.STORY_POSTER_PRODUCTION_UI === '1' ? target : 'http://127.0.0.1:' + vite.httpServer.address().port;
  const browser = await launchMeasurementBrowser(); t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage();
  const errors = [], requests = [], checks = [];
  page.on('pageerror', error => errors.push(error.message)); page.on('request', req => { if (req.url().includes('/api/')) requests.push({ method: req.method(), path: new URL(req.url()).pathname }); });
  const shot = async name => { await page.evaluate(() => window.scrollTo(0, 0)); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.screenshot({ path: join(out, name + '.png'), fullPage: true }); };
  const theme = async mode => { if (await page.evaluate(() => document.documentElement.dataset.theme) !== mode) await page.getByRole('button', { name: 'Use ' + mode + ' theme', exact: true }).click(); };
  await page.goto(base + '/#login'); await page.getByLabel(/^Email or existing family login/).fill(account.username); await page.getByLabel(/^Password/).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByText(/Choose a drawing for .* before making the story/).waitFor();
  await page.getByRole('textbox', { name: 'What stayed with you today?', exact: true }).fill('Fictional child was upset after a board game.');
  assert.equal(await page.getByRole('button', { name: 'Create our story', exact: true }).isEnabled(), false);
  assert.equal(await page.locator('.tonight-people').innerText().then(x => x.includes('✓')), false);
  checks.push('Missing drawings have no false checkmark and no generation can start');
  for (const width of [390, 1280]) for (const mode of ['light', 'dark']) { await page.setViewportSize({ width, height: 844 }); await theme(mode); await shot('not-ready-' + width + '-' + mode); }
  await page.setViewportSize({ width: 390, height: 844 }); await theme('light');
  await page.getByRole('button', { name: 'Finish choosing drawings', exact: true }).click();
  await page.getByRole('heading', { name: 'Your story people', exact: true }).waitFor();
  const card = page.locator('.portrait-card').first(), input = card.locator('input[type=file]');
  const large = await sharp({ create: { width: 8000, height: 6000, channels: 3, background: 'white' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  await input.setInputFiles({ name: 'large-phone.jpg', mimeType: 'image/jpeg', buffer: large });
  await card.getByRole('button', { name: 'Keep this photo', exact: true }).waitFor();
  const image = card.getByAltText(/^Photo selected for/); await image.evaluate(node => node.decode());
  const size = await image.evaluate(node => [node.naturalWidth, node.naturalHeight]); assert.ok(Math.max(...size) <= 1536); assert.ok(size[1] >= size[0], 'EXIF orientation retained');
  await card.getByRole('button', { name: 'Keep this photo', exact: true }).click(); assert.ok(await card.getByRole('button', { name: /See .* in three looks/ }).isEnabled());
  await shot('phone-photo-preview-light'); await theme('dark'); await shot('phone-photo-preview-dark');
  await input.setInputFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not a photo') });
  await page.getByRole('alert').filter({ hasText: /This photo could not be opened/ }).waitFor();
  assert.equal(await card.getByAltText(/^Photo selected for/).count(), 0); assert.equal(await card.getByRole('button', { name: /See .* in three looks/ }).count(), 0);
  checks.push('48 megapixel phone photo is oriented, resized and previewed; corrupt replacement clears ready state');
  const heic = join(root, 'context/phone-flow-2026-10-25/fixtures/public-libheif-example.heic');
  if (existsSync(heic)) {
  await input.setInputFiles({ name: 'photo.heic', mimeType: 'image/heic', buffer: readFileSync(heic) });
  await card.getByRole('button', { name: 'Keep this photo', exact: true }).waitFor({ timeout: 30000 }); await image.evaluate(node => node.decode());
  assert.ok(await image.evaluate(node => node.naturalWidth > 0 && node.naturalWidth <= 1536));
  checks.push('Real public HEIC fixture converts locally in Chromium using the lazy fallback'); await shot('heic-preview-dark');
  } else { t.diagnostic('External HEIC test photo is not included in the public source. This section was not run.'); }
  assert.equal(requests.filter(r => r.method === 'POST' && /\/portraits\//.test(r.path)).length, 0, 'Selecting/keeping a photo makes no generation request');
  await page.getByRole('button', { name: 'Account and sign out', exact: true }).click(); await page.getByRole('menuitem', { name: 'Family and settings', exact: true }).click();
  await page.getByRole('button', { name: 'Edit people and hero', exact: true }).click(); assert.equal(await page.getByLabel('School grade (optional)').count(), 0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  let release; const held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/session', async route => { await held; await route.continue(); });
  const started = Date.now(); await page.getByRole('button', { name: 'Our stories', exact: true }).click(); await page.waitForURL('**/#shelf', { timeout: 1000 }); assert.ok(Date.now() - started < 1000); release(); await page.waitForResponse(r => new URL(r.url()).pathname === '/api/session'); await page.unrouteAll({ behavior: 'wait' });
  checks.push('Shelf opens before a deliberately held session refresh finishes');
  await page.goto(base + '/?invite=' + 'a'.repeat(64) + '#join'); await page.getByRole('heading', { name: 'One moment, together.', exact: true }).waitFor(); assert.equal(await page.getByRole('heading', { name: 'Your family is welcome here', exact: true }).count(), 0);
  checks.push('A consumed invitation never shows signup inside an authenticated family');
  // A chosen non-default look lives outside record.cast. Simulate the exact
  // server response shape while leaving the real session/cast snapshot unchanged.
  let chosenAlternate = false;
  const fixtureImage = '/api/sample/previews/poster.webp';
  const alternate = () => ({ look: { pending: false, pictureStyleId: 'diary-doodles', revision: 0 }, people: [
    { id: 'child', label: 'Pip', role: 'child', selectedUrl: chosenAlternate ? fixtureImage : null, hasStyleComparison: false,
      candidates: [{ id: 'candidate-fixture', url: fixtureImage, selected: chosenAlternate }], job: { id: 'job-fixture', kind: 'selected-style', status: 'complete', completed: 1, expected: 1 } },
    { id: 'grown-up-one', label: 'Dad', role: 'grown-up', selectedUrl: fixtureImage, candidates: [] },
  ] });
  await page.route('**/api/portraits?**', route => route.fulfill({ json: alternate() }));
  await page.route('**/api/portraits/child/select', async route => { chosenAlternate = true; await route.fulfill({ json: alternate() }); });
  await page.getByRole('radio', { name: 'Diary doodles', exact: true }).check();
  await page.getByRole('button', { name: 'Finish choosing drawings', exact: true }).click();
  await page.getByRole('button', { name: 'Choose drawing 1 for Pip', exact: true }).click();
  await page.getByRole('button', { name: 'Save and continue to story', exact: true }).click();
  await page.getByRole('button', { name: 'Create our story', exact: true }).waitFor();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Create our story')?.disabled);
  assert.equal(chosenAlternate, true); checks.push('Choosing a non-default drawing refreshes readiness even when cast IDs stay unchanged');
  assert.equal(providerCalls, 0); assert.deepEqual(errors, []);
  saveJSON(join(out, 'RESULT.json'), { checks, providerCalls, pageErrors: errors, resizedPhoto: size });
});
