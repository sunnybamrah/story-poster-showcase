// Explicit offline browser regression. Engine output is a saved-art fixture;
// this proves the UI lifecycle, never a newly generated or checked kit.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createApp, findSample } from '../server/app-server.mjs';
import { launchMeasurementBrowser } from '../server/layout-fit.js';
import { moves, saveJSON } from '../server/files.js';

const root = resolve('context/pass34-ui'); mkdirSync(root, { recursive: true });
const directory = mkdtempSync(join(root, 'run-')), sample = findSample();
assert.ok(sample, 'A saved fictional sample is required.');
let finishKit; const gate = new Promise(resolve => { finishKit = resolve; });
let engineCalls = 0, modelCalls = 0;
const app = createApp({ dataDirectory: join(directory, 'app-state'), sampleOnly: false, sample,
  keyReader: () => 'offline-fixture-not-a-key',
  transportFactory: () => ({ call() { modelCalls++; throw Error('All model calls are forbidden in this regression.'); } }),
  runKit: async (transport, memory, tonight, options) => {
    engineCalls++; await gate;
    mkdirSync(options.directory, { recursive: true });
    for (const name of ['poster.png', 'poster.pdf', 'kit_final.pdf', 'panel-1.png']) copyFileSync(join(sample.directory, name), join(options.directory, name));
    return { ...sample.text, moveId: options.chosenMoveId, move: moves.find(move => move.id === options.chosenMoveId), recordAtStart: memory.exportRecord(), complete: true, world: 'comic strip', colourSet: 'warm' };
  },
});
let browser, releaseShelf; const shelfGate = new Promise(resolve => { releaseShelf = resolve; });
const errors = [], checks = [];
try {
  await new Promise(resolve => app.server.listen(4328, '127.0.0.1', resolve));
  browser = await launchMeasurementBrowser();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4328');
  await page.getByRole('button', { name: 'Set up a family', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Made-up hero nickname').fill('Rin');
  const choose = async (label, option) => { await page.getByRole('combobox', { name: label, exact: true }).click(); await page.getByRole('option', { name: option, exact: true }).click(); await page.locator('.MuiPopover-root').waitFor({ state: 'detached' }); };
  await choose('Pronouns', 'she/her'); await choose('Hero hair', 'long dark hair'); await choose('Hero skin', 'dark brown skin'); await choose('Hero glasses', 'no glasses');
  await page.screenshot({ path: join(directory, '01-people-light.png'), fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  assert.ok((await page.locator('body').innerText()).includes('she/her. long dark hair, dark brown skin, no glasses.'));
  await page.getByLabel('Choose a family login').fill('pass34_browser_family');
  // This is a made-up local fixture login, never a user credential.
  await page.locator('input[type=password]').fill('offline-browser-fixture');
  await page.getByRole('button', { name: 'Save family and start tonight', exact: true }).click();
  await page.getByLabel('Tonight’s sentence').fill('Rin cried after her friend sat with someone else at lunch and now says nobody likes her.');
  const session = await page.request.get('http://127.0.0.1:4328/api/session'); const saved = await session.json();
  assert.deepEqual(saved.record.hero.lookChips, ['human girl', 'long dark hair', 'dark brown skin', 'no glasses']); checks.push('Visible appearance selections reached the saved family.');
  await page.getByRole('button', { name: 'Find tonight’s move', exact: true }).click();
  await page.getByRole('button', { name: 'Make our kit with this move', exact: true }).click();
  await page.getByRole('heading', { name: 'Making tonight’s kit', exact: true }).waitFor();
  await page.screenshot({ path: join(directory, '02-progress.png'), fullPage: true, animations: 'disabled' });
  let shelfRefreshHeld = false;
  await page.route('**/api/session', async route => { shelfRefreshHeld = true; await shelfGate; await route.continue(); });
  finishKit();
  await page.getByRole('heading', { name: 'One move for tonight', exact: true }).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
  assert.ok(shelfRefreshHeld); checks.push('The completed result appeared while the shelf refresh was still pending.');
  await page.screenshot({ path: join(directory, '03-result-light.png'), fullPage: true, animations: 'disabled' });
  releaseShelf();
  for (const name of ['Open printable poster', 'Print the full five-page kit']) {
    const href = await page.getByRole('link', { name, exact: true }).getAttribute('href');
    const response = await page.request.get('http://127.0.0.1:4328' + href); assert.equal(response.status(), 200); assert.ok((await response.body()).subarray(0, 5).toString() === '%PDF-');
  }
  checks.push('Both printable PDF links returned PDF bytes.');
  await page.getByRole('button', { name: 'Use dark theme', exact: true }).click();
  await page.screenshot({ path: join(directory, '04-result-dark.png'), fullPage: true, animations: 'disabled' });
  await page.reload(); await page.getByRole('heading', { name: 'One move for tonight', exact: true }).waitFor(); checks.push('Reload reopened the completed kit.');
  await page.getByRole('button', { name: 'Family', exact: true }).click();
  await page.getByRole('button', { name: 'Edit people and hero', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Hero hair', exact: true }).innerText(), 'long dark hair');
  assert.equal(await page.getByRole('combobox', { name: 'Hero skin', exact: true }).innerText(), 'dark brown skin');
  await page.screenshot({ path: join(directory, '05-people-dark.png'), fullPage: true, animations: 'disabled' }); checks.push('Editing preserved the selected appearance.');
  assert.equal(modelCalls, 0); assert.equal(engineCalls, 1); assert.deepEqual(errors, []);
  const report = { ready: true, fixture: true, modelCalls, engineCalls, port: 4328, checks, errors, screenshots: ['01-people-light.png', '02-progress.png', '03-result-light.png', '04-result-dark.png', '05-people-dark.png'] };
  saveJSON(join(directory, 'checks.json'), report); console.log(JSON.stringify({ directory, ...report }, null, 2));
} catch (error) { saveJSON(join(directory, 'checks.json'), { ready: false, fixture: true, modelCalls, checks, errors, reason: error.message }); throw error; }
finally { finishKit(); releaseShelf(); await browser?.close(); await app.close(); }
