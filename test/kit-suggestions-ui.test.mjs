import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
import { root } from '../server/files.js';
import { launchMeasurementBrowser } from '../server/layout-fit.js';

test('suggestion dialog saves honestly, retries one request and ignores old kit replies in both themes', async t => {
  const out = join(root, 'context/feedback-2026-10-26/ui'); mkdirSync(out, { recursive: true });
  const html = `<!doctype html><html><body><div id="root"></div><script type="module">
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {ThemeProvider,CssBaseline} from '@mui/material'; import {appTheme} from '/theme.js'; import KitFeedback from '/KitFeedback.jsx';
    const host=createRoot(document.getElementById('root')); window.calls=[]; window.mode='fail';
    let props={open:true,jobId:'11111111-1111-1111-1111-111111111111',page:2,theme:'light'};
    const api=async(path,body)=>{window.calls.push({path,body:structuredClone(body)});if(window.mode==='hold')return await new Promise(resolve=>window.finish=resolve);if(window.mode==='fail')throw Error('Test connection failed. Your note stays here.');return {saved:true};};
    window.renderFeedback=change=>{props={...props,...change};host.render(React.createElement(ThemeProvider,{theme:appTheme(props.theme)},React.createElement(CssBaseline),React.createElement(KitFeedback,{...props,api,onClose:()=>window.renderFeedback({open:false})})));};window.renderFeedback({});
  </script></body></html>`;
  const vite = await createServer({ configFile: false, root: join(root, 'app'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'suggestion-fixture', configureServer(server) { server.middlewares.use(async (req, res, next) => { if (req.url !== '/__feedback') return next(); try { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/__feedback', html)); } catch (error) { next(error); } }); } }] });
  await vite.listen(); t.after(() => vite.close());
  const browser = await launchMeasurementBrowser(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + vite.httpServer.address().port + '/__feedback');
  const field = page.getByRole('textbox', { name: 'What would you like us to improve?', exact: true }); await field.waitFor();
  await field.fill('Please make the page heading easier to read.');
  for (const theme of ['light', 'dark']) { await page.evaluate(theme => window.renderFeedback({ theme }), theme); await page.waitForFunction(() => [...document.querySelectorAll('.MuiDialog-container, .MuiDialog-paper')].every(el => Number(getComputedStyle(el).opacity) === 1)); await page.screenshot({ path: join(out, 'dialog-' + theme + '.png'), animations: 'disabled' }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); }
  await page.getByRole('button', { name: 'Send feedback', exact: true }).click(); await page.getByText('Test connection failed. Your note stays here.', { exact: true }).waitFor(); assert.equal(await field.inputValue(), 'Please make the page heading easier to read.');
  await page.evaluate(() => { window.mode = 'success'; }); await page.getByRole('button', { name: 'Send feedback', exact: true }).click(); await page.getByText('Feedback saved. Thank you.', { exact: true }).waitFor();
  const calls = await page.evaluate(() => window.calls); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.equal(calls[0].body.page, 2);
  assert.equal(await page.getByText(/email sent|delivered/i).count(), 0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.evaluate(() => { window.mode = 'hold'; window.renderFeedback({ open: true, page: 3 }); }); await field.waitFor(); await field.fill('A note for the old kit.'); await page.getByRole('button', { name: 'Send feedback', exact: true }).click();
  await page.evaluate(() => window.renderFeedback({ jobId: '22222222-2222-2222-2222-222222222222', page: 1 })); await page.waitForFunction(() => document.querySelector('textarea')?.value === ''); assert.equal(await field.inputValue(), '');
  await page.evaluate(() => window.finish({ saved: true })); await page.waitForTimeout(50); assert.equal(await page.getByText('Feedback saved. Thank you.', { exact: true }).count(), 0);
  await page.evaluate(() => window.renderFeedback({ jobId: 'sample' })); await page.getByText('Sign in and open one of your saved kits to send feedback.', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Send feedback', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
});
