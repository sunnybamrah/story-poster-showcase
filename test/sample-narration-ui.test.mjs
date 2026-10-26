import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { createApp } from '../server/app-server.mjs';
import { root } from '../server/files.js';
import { launchMeasurementBrowser } from '../server/layout-fit.js';
import { loadPublicSample } from '../server/public-sample.js';

// Real app, real pinned example and recording, installed Chrome. No key, provider or paid call.
test('the example story offers an optional recording that waits for play, stops on leaving and fits both themes', async t => {
  const output = join(root, 'context/story-listen-2026-10-22/ui'); mkdirSync(output, { recursive: true });
  const directory = mkdtempSync(join(tmpdir(), 'story-sample-narration-ui-'));
  const app = createApp({ dataDirectory: directory, sampleOnly: true, sample: loadPublicSample(), keyReader: () => assert.fail('No key reads.'), transportFactory: () => ({ call() { assert.fail('No provider calls.'); } }) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const target = 'http://127.0.0.1:' + app.server.address().port;
  const vite = await createServer({ configFile: false, root: join(root, 'app'), publicDir: join(root, 'public'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target, changeOrigin: true, configure: proxy => proxy.on('proxyReq', request => request.setHeader('origin', 'http://localhost')) } } } });
  await vite.listen(); t.after(() => vite.close());
  const base = 'http://127.0.0.1:' + vite.httpServer.address().port, browser = await launchMeasurementBrowser(); t.after(() => browser.close());
  const label = 'Made with Story Poster. Pip and Dad are a made-up family.';

  for (const [device, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport }), page = await context.newPage(), errors = [], audioRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.url().includes('/api/sample/narration.m4a')) audioRequests.push(request.url()); });
    await page.goto(base + '/#story/sample');
    await page.getByRole('heading', { name: 'Listen to the story', exact: true }).waitFor();
    if (theme === 'dark') await page.getByRole('button', { name: 'Use dark theme', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme ?? 'light'), theme);
    const audio = page.locator('section.sample-narration audio');
    assert.deepEqual(await audio.evaluate(node => ({ preload: node.preload, autoplay: node.autoplay, controls: node.controls, paused: node.paused, scheme: getComputedStyle(node).colorScheme })), { preload: 'none', autoplay: false, controls: true, paused: true, scheme: theme });
    await page.waitForTimeout(800);
    assert.deepEqual(audioRequests, [], 'The recording must not load before play.');
    assert.equal(await page.getByText(label, { exact: true }).count(), 1);
    assert.equal(await page.getByText('words edited for this example', { exact: false }).count(), 0);
    assert.equal(await page.getByText('A computer voice', { exact: false }).count(), 0);
    assert.equal(await page.getByText('Listen to this story with your child.', { exact: true }).count(), 1);
    assert.equal(await page.locator('.story-part').count(), 2);
    assert.equal(await page.locator('.MuiAlert-root').count(), 0);
    await page.locator('section.sample-narration').screenshot({ path: join(output, `player-${device}-${theme}.png`), animations: 'disabled' });
    await page.screenshot({ path: join(output, `story-top-${device}-${theme}.png`), animations: 'disabled' });
    await page.getByText(label, { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `story-label-${device}-${theme}.png`), animations: 'disabled' });

    // Play after a real tap, then leave the story: the player must stop and let go of the file.
    await page.getByRole('heading', { name: 'Listen to the story', exact: true }).click();
    await audio.evaluate(node => node.play());
    await page.waitForFunction(() => document.querySelector('section.sample-narration audio')?.currentTime > 0.3, null, { timeout: 20000 });
    assert.ok(audioRequests.length > 0);
    const handle = await audio.elementHandle();
    await page.getByRole('button', { name: 'Poster and pages →', exact: true }).click();
    await page.getByText('Your story is ready', { exact: true }).waitFor();
    assert.deepEqual(await handle.evaluate(node => ({ connected: node.isConnected, paused: node.paused, src: node.getAttribute('src') })), { connected: false, paused: true, src: null });
    assert.equal(await page.locator('section.sample-narration').count(), 0);
    assert.equal(new URL(page.url()).hash, '#poster/sample');
    await page.reload();
    await page.getByText('Your story is ready', { exact: true }).waitFor();
    assert.equal(await page.getByText(label, { exact: true }).count(), 1);
    await page.getByText(label, { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `result-label-${device}-${theme}.png`), animations: 'disabled' });
    await page.getByRole('button', { name: 'Sit together and read our story', exact: true }).click();
    await page.locator('section.sample-narration').waitFor();
    await page.goBack();
    await page.getByText('Your story is ready', { exact: true }).waitFor();
    await page.goForward();
    await page.locator('section.sample-narration').waitFor();
    assert.equal(new URL(page.url()).hash, '#story/sample');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    await context.close();
  }

  // A recording that cannot load shows one short line; a reply without a recording shows no player.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage();
  await page.route('**/api/sample/narration.m4a*', route => route.abort('connectionfailed'));
  await page.goto(base + '/#story/sample');
  await page.getByRole('heading', { name: 'Listen to the story', exact: true }).click();
  await page.locator('section.sample-narration audio').evaluate(node => node.play().catch(() => {}));
  await page.getByText('The recording did not load. You can still read the story below.', { exact: true }).waitFor();
  await page.locator('section.sample-narration').screenshot({ path: join(output, 'player-load-error-light.png'), animations: 'disabled' });
  await page.unroute('**/api/sample/narration.m4a*');
  await page.route('**/api/sample', async route => { const reply = await (await route.fetch()).json(); delete reply.narration; await route.fulfill({ json: reply }); });
  await page.goto('about:blank'); await page.goto(base + '/#story/sample');
  await page.getByText(label, { exact: true }).waitFor();
  assert.equal(await page.locator('section.sample-narration').count(), 0);
  await context.close();
});
