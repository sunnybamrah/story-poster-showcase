import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { createApp } from '../server/app-server.mjs';
import { loadPublicSample } from '../server/public-sample.js';
import { root } from '../server/files.js';
import { launchMeasurementBrowser } from '../server/layout-fit.js';

test('saved five-page viewer opens from the example, turns every page, zooms, swipes and recovers in both themes', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'kit-pages-ui-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sample = loadPublicSample(); assert.ok(sample);
  const app = createApp({ dataDirectory: directory, sample, sampleOnly: true,
    keyReader: () => assert.fail('No credential reads in the viewer proof.') });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const target = `http://127.0.0.1:${app.server.address().port}`;
  const vite = await createServer({ configFile: false, root: join(root, 'app'), publicDir: join(root, 'public'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target, changeOrigin: true } } } });
  await vite.listen(); t.after(() => vite.close());
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`, browser = await launchMeasurementBrowser(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__readerProbe = { requests: [], active: [] };
    const originalFetch = window.fetch.bind(window), makeURL = URL.createObjectURL.bind(URL), revokeURL = URL.revokeObjectURL.bind(URL);
    window.fetch = (...args) => { if (/\/pages\/[1-5]\.webp$/.test(String(args[0]))) window.__readerProbe.requests.push(String(args[0])); return originalFetch(...args); };
    URL.createObjectURL = blob => { const url = makeURL(blob); window.__readerProbe.active.push(url); return url; };
    URL.revokeObjectURL = url => { window.__readerProbe.active = window.__readerProbe.active.filter(item => item !== url); return revokeURL(url); };
  });
  const output = join(root, 'context/five-page-viewer-proof'); mkdirSync(output, { recursive: true });
  const dialog = page.getByRole('dialog'), image = dialog.locator('.kit-reader-page');
  const ready = async number => {
    await dialog.getByText(`Page ${number} of 5`, { exact: true }).waitFor();
    await image.evaluate(node => node.decode());
    assert.equal(await image.evaluate(node => node.naturalWidth), 1200);
  };
  const swipe = async direction => {
    await image.evaluate((node, direction) => {
      const event = (type, x) => new TouchEvent(type, { bubbles: true, touches: type === 'touchstart' ? [new Touch({ identifier: 1, target: node, clientX: x, clientY: 250 })] : [], changedTouches: [new Touch({ identifier: 1, target: node, clientX: x, clientY: 250 })] });
      node.dispatchEvent(event('touchstart', 200));
      node.dispatchEvent(event('touchend', direction === 'next' ? 80 : 320));
    }, direction);
  };
  await page.goto(base);
  await page.setViewportSize({ width: 320, height: 844 });
  for (const theme of ['light', 'dark']) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole('button', { name: `Use ${theme} theme`, exact: true }).click();
    for (const name of ['Help: watch the short guide', `Use ${theme === 'light' ? 'dark' : 'light'} theme`]) {
      const lines = await page.getByRole('button', { name, exact: true }).evaluate(node => {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT), tops = new Set();
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(walker.currentNode);
          for (const rect of range.getClientRects()) tops.add(Math.round(rect.top));
        }
        return tops.size;
      });
      assert.equal(lines, 1, `${name} must stay on one line at 320 pixels in ${theme} theme.`);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await page.screenshot({ path: join(output, `welcome-${theme}-320.png`), animations: 'disabled' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open the five-page example', exact: true }).click();
  await ready(1);
  await page.waitForFunction(() => window.__readerProbe.requests.some(url => url.endsWith('/2.webp')));
  await page.waitForFunction(() => [1,2,3,4,5].every(page => window.__readerProbe.requests.some(url => url.endsWith('/' + page + '.webp'))));
  await dialog.getByRole('button', { name: 'Close pages', exact: true }).click();
  await page.waitForFunction(() => window.__readerProbe.active.length === 0);
  for (const theme of ['light', 'dark']) {
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== theme) await page.getByRole('button', { name: `Use ${theme} theme`, exact: true }).click();
    await page.getByRole('button', { name: 'Open all five pages', exact: true }).click();
    for (let number = 1; number <= 5; number++) {
      await ready(number);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.screenshot({ path: join(output, `page-${number}-${theme}-phone.png`), animations: 'disabled' });
      if (number === 1) assert.equal(await dialog.getByRole('button', { name: 'Previous page', exact: true }).isDisabled(), true);
      if (number < 5) await dialog.getByRole('button', { name: 'Next page', exact: true }).click();
    }
    assert.equal(await dialog.getByRole('button', { name: 'Next page', exact: true }).isDisabled(), true);
    const requestsBeforeBack = await page.evaluate(() => window.__readerProbe.requests.length);
    await dialog.getByRole('button', { name: 'Previous page', exact: true }).click(); await ready(4);
    assert.equal(await page.evaluate(() => window.__readerProbe.requests.length), requestsBeforeBack, 'Going back must reuse the open reader copy.');
    assert.ok(await page.evaluate(() => window.__readerProbe.active.length <= 5));
    assert.equal(await dialog.getByRole('button', { name: 'Make page bigger', exact: true }).count(), 0);
    await page.evaluate(() => Object.defineProperty(window.visualViewport, 'scale', { configurable: true, value: 2 }));
    await swipe('previous'); await ready(4);
    await page.evaluate(() => Object.defineProperty(window.visualViewport, 'scale', { configurable: true, value: 1 }));
    await swipe('previous'); await ready(3); await page.keyboard.press('ArrowRight'); await ready(4);
    assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => window.__readerProbe.active.length === 0);
    assert.equal(await page.getByRole('button', { name: 'Open all five pages', exact: true }).evaluate(node => node === document.activeElement), true);
    if (!(await page.getByRole('button', { name: 'Read all poster words', exact: true }).isVisible())) await page.getByText('Read the poster in larger type', { exact: true }).click();
    await page.getByRole('button', { name: 'Read all poster words', exact: true }).click();
    await dialog.waitFor(); assert.ok((await dialog.innerText()).length > 100);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
  }
  const failPage = route => route.abort('connectionfailed');
  await page.route('**/api/sample/pages/1.webp', failPage);
  await page.getByRole('button', { name: 'Open all five pages', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  assert.match(await dialog.getByRole('link', { name: 'Open the five-page PDF', exact: true }).getAttribute('href'), /kit_final\.pdf$/);
  await page.unroute('**/api/sample/pages/1.webp', failPage);
  await dialog.getByRole('button', { name: 'Try again', exact: true }).click(); await ready(1);
  await dialog.getByRole('button', { name: 'Close pages', exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Open all five pages', exact: true }).click(); await ready(1);
  await page.screenshot({ path: join(output, 'page-1-dark-desktop.png'), animations: 'disabled' });
  assert.deepEqual(errors, []);
});
