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

test('fullscreen reader fits, swipes safely, preserves page bounds, sources and focus', async t => {
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
  const output = join(root, 'context/final-reader-proof'); mkdirSync(output, { recursive: true });
  const dialog = page.getByRole('dialog'), image = dialog.locator('.kit-reader-page');
  const ready = async number => {
    await dialog.getByText(`Page ${number} of 5`, { exact: true }).waitFor();
    await image.evaluate(node => node.decode());
    await dialog.getByRole('status').waitFor({state:'hidden'});
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
  await page.getByRole('button', { name: 'Open the five-page example', exact: true }).click();await ready(1);await dialog.getByRole('button',{name:'Close pages',exact:true}).click();await dialog.waitFor({state:'hidden'});
  for(const width of [390,1280])for(const theme of ['light','dark']){
    await page.setViewportSize({width,height:width===390?844:800});
    if(await page.evaluate(()=>document.documentElement.dataset.theme)!==theme)await page.getByRole('button',{name:`Use ${theme} theme`,exact:true}).click();
    await page.getByRole('button',{name:'Open all five pages',exact:true}).click();await ready(1);
    assert.equal(await dialog.getByRole('button',{name:/Zoom in|Fit page/}).count(),0);
    assert.equal(await dialog.getByRole('button',{name:'Previous page',exact:true}).isDisabled(),true);
    await swipe('previous');await ready(1);
    const fit=await image.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth});assert.ok(fit,JSON.stringify(await image.evaluate(e=>({rect:e.getBoundingClientRect().toJSON(),viewport:[innerWidth,innerHeight]}))));
    await swipe('next');await ready(2);
    await image.evaluate(node=>{const t=(id,x)=>new Touch({identifier:id,target:node,clientX:x,clientY:250});node.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[t(1,240)]}));node.dispatchEvent(new TouchEvent('touchmove',{bubbles:true,touches:[t(1,200),t(2,300)]}));node.dispatchEvent(new TouchEvent('touchend',{bubbles:true,touches:[],changedTouches:[t(1,70)]}));});await ready(2);
    await page.evaluate(()=>Object.defineProperty(window.visualViewport,'scale',{configurable:true,value:2}));await swipe('next');await ready(2);await page.evaluate(()=>Object.defineProperty(window.visualViewport,'scale',{configurable:true,value:1}));
    await page.keyboard.press('ArrowRight');await ready(3);await swipe('next');await ready(4);await swipe('next');await ready(5);await swipe('next');await ready(5);
    assert.equal(await dialog.getByRole('button',{name:'Next page',exact:true}).isDisabled(),true);
    const sources=dialog.locator('details').filter({hasText:'Sources'});assert.equal(await sources.count(),1);await sources.locator('summary').click();assert.ok(await sources.getByRole('link').count()>0);
    await page.screenshot({path:join(output,`reader-${width}-${theme}.png`),animations:'disabled'});
    await dialog.getByRole('button',{name:'Close pages',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.waitForFunction(()=>window.__readerProbe.active.length===0);assert.ok(await page.getByRole('button',{name:'Open all five pages',exact:true}).evaluate(e=>e===document.activeElement));
  }
  const text=page.locator('details').filter({has:page.locator('summary').getByText('Read the poster in larger type',{exact:true})});await text.locator('summary').click();await page.getByRole('button',{name:'Read all poster words',exact:true}).click();await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.deepEqual(errors,[]);
});
