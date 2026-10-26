import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { createServer } from 'vite';
import { createApp } from '../server/app-server.mjs';
import { launchMeasurementBrowser } from '../server/layout-fit.js';
import { root, saveJSON } from '../server/files.js';
import { pictureStyleOptions } from '../app/picture-styles.js';

// The family sees its own first person in three labelled looks and picks one.
// The drawings come from an offline fixture drawing service; nothing is paid.
const contrastOf = page => page.locator('button:not(:disabled), .MuiChip-root').evaluateAll(nodes => {
  const rgba = value => value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
  const mix = (front, back) => front.slice(0, 3).map((v, i) => v * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
  const lum = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  return nodes.map(node => {
    const style = getComputedStyle(node), ancestors = []; let ancestor = node;
    while (ancestor) { ancestors.unshift(ancestor); ancestor = ancestor.parentElement; }
    const surface = ancestors.reduce((colour, element) => mix(rgba(getComputedStyle(element).backgroundColor), colour), [255, 255, 255]);
    const ink = mix(rgba(style.color), surface), values = [lum(ink), lum(surface)].sort((a, b) => b - a);
    return { text: node.textContent, contrast: (values[0] + .05) / (values[1] + .05) };
  });
});

test('first setup names three looks, shows the first person in each, and one tap saves the family look', async t => {
  const directory = mkdtempSync(join(root, 'context/portrait-tests/style-ui-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  let releaseDrawing; const drawingGate = new Promise(resolve => { releaseDrawing = resolve; }); t.after(() => releaseDrawing());
  const stages = [], colours = { 'portrait-ink': 245 }; let finishes = 0;
  const app = createApp({ dataDirectory: directory, sample: null, sampleOnly: false, allowSyntheticPortraits: true, keyReader: () => 'fixture-key', transportFactory: () => ({ call: async request => {
    stages.push(request.stage);
    if (/check$/.test(request.stage)) {
      const { characterId } = JSON.parse(request.body.input[0].content[0].text);
      const answer = { castObservations: [{ characterId, observedSpecies: 'human', identityMatches: true, certainty: 'confirmed', identityEvidence: 'Fixture match.', appearance: [], clothing: [] }] };
      if (request.stage === 'portrait-render-check') answer.graphicStyle = { matchesSelectedStyle: true, flatInk: true, photographicTexture: false, toyShine: false, oversizedEyes: false, evidence: 'Fixture look match.' };
      return { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] };
    }
    if (stages.length === 1) await drawingGate;
    const red = colours[request.stage] ?? 40 + 50 * (finishes++ % 4);
    return { data: [{ b64_json: (await sharp({ create: { width: 512, height: 768, channels: 3, background: { r: red, g: 120, b: 180 } } }).png().toBuffer()).toString('base64') }] };
  } }) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  const target = `http://127.0.0.1:${app.server.address().port}`;
  const vite = await createServer({ configFile: false, root: join(root, 'app'), publicDir: join(root, 'public'), logLevel: 'error', server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target, changeOrigin: true, configure: proxy => proxy.on('proxyReq', request => request.setHeader('origin', target)) } } } });
  await vite.listen(); t.after(() => vite.close());
  const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const browser = await launchMeasurementBrowser(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const output = join(root, 'context/style-choice-ui-proof'); mkdirSync(output, { recursive: true });
  const screenshots = [];

  // Credentials come first, but the account is only created with family details.
  await page.goto(base); await page.getByRole('button', { name: 'Start our first story', exact: true }).click();
  await page.getByLabel('Choose a family login').fill('style_ui_family');
  await page.getByLabel('Choose a password').fill('fictional-ui-password');
  await page.getByRole('button', { name: 'Continue to our people', exact: true }).click();
  const beforeSave = await page.evaluate(async () => (await fetch('/api/session')).json());
  assert.ok(!beforeSave.record, 'Collecting credentials must not create an account before people are saved.');
  await page.getByRole('textbox', { name: 'Child’s story name', exact: true }).waitFor();
  assert.equal(await page.getByRole('radiogroup', { name: 'Choose your family’s look' }).count(), 0);
  assert.equal(await page.locator('img[alt$="example with made-up people"]').count(), 0);
  assert.equal(await page.getByRole('tab', { name: 'Upload photo', exact: true }).count(), 2);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  assert.equal(await page.getByLabel('Choose a family login').inputValue(), 'style_ui_family');
  await page.getByRole('button', { name: 'Continue to our people', exact: true }).click();
  await page.getByRole('textbox', { name: 'Child’s story name', exact: true }).fill('Pip'); await page.getByRole('button', { name: 'Save details', exact: true }).click();

  // Story people: the first person goes first; everyone else waits for the look.
  await page.getByRole('heading', { name: 'Your story people', exact: true }).waitFor();
  await page.locator('input[type=file]').first().setInputFiles(join(root, 'test/fixtures/offline-art.png'));
  await page.getByRole('button', { name: 'Keep selected photo for Pip', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'Keep selected photo for Pip', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'See Pip in three looks', exact: true }).click();
  await page.locator('.working-bar').waitFor();
  assert.ok((await page.locator('.working-bar').boundingBox()).height >= 10);
  await page.locator('.global-activity').getByText(/Drawing Pip/).waitFor();
  await page.getByText('We are drawing Pip first. Dad can start after those drawings are ready and you choose a look.', { exact: true }).waitFor();
  await page.emulateMedia({ reducedMotion: 'reduce' }); assert.equal(await page.locator('.saved-job-progress').evaluate(el => getComputedStyle(el).animationName), 'none'); await page.emulateMedia({ reducedMotion: 'no-preference' });
  releaseDrawing();
  for (const style of pictureStyleOptions) await page.getByRole('button', { name: `Use the ${style.label} look for our family`, exact: true }).waitFor({ timeout: 20000 });
  await page.getByText('First finish choosing your family look with Pip. Then Dad gets a drawing in that look.', { exact: true }).waitFor();
  assert.deepEqual(stages, ['portrait-render', 'portrait-render', 'portrait-render']);
  assert.equal(await page.getByText('Recommended', { exact: true }).count(), 1);
  const looks = page.locator('img[alt^="Pip in the "]');
  assert.deepEqual(await looks.evaluateAll(images => images.map(image => image.alt)), pictureStyleOptions.map(style => `Pip in the ${style.label} look`));
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Use dark theme' }).click();
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await looks.evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0 && image.getBoundingClientRect().width >= 300)), true, 'Phone previews must be large enough to compare faces.');
    const buttons = await contrastOf(page);
    for (const button of buttons) assert.ok(button.contrast >= 4.5, `${theme}: ${button.text} contrast ${button.contrast}`);
    const path = join(output, `three-looks-${theme}.png`); await page.screenshot({ path, fullPage: true }); screenshots.push({ theme, path, buttons });
  }
  await page.setViewportSize({ width: 900, height: 1000 });
  const desktop = await looks.evaluateAll(images => images.map(image => { const box = image.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height }; }));
  assert.ok(desktop.every(image => Math.abs(image.y - desktop[0].y) < 1 && Math.abs(image.width - desktop[0].width) < 1 && Math.abs(image.height - desktop[0].height) < 1), 'Three looks sit side by side at equal size.');
  assert.ok(desktop[0].x < desktop[1].x && desktop[1].x < desktop[2].x);
  await page.getByRole('button', { name: 'View the Diary doodles look for Pip', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await page.getByRole('button', { name: 'Close drawing', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });

  // One tap saves the look and Pip's drawing; a reload keeps both.
  await page.getByRole('button', { name: 'Select the Diary doodles picture for Pip', exact: true }).click();
  await page.getByAltText('Chosen story drawing of Pip', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('Story look: Diary doodles', { exact: true }).waitFor();
  const state = await page.evaluate(async () => (await fetch('/api/session')).json());
  assert.equal(state.pictureStyleId, 'diary-doodles'); assert.equal(state.record.pictureStyleId, 'diary-doodles'); assert.equal(state.look.pending, false);

  // Later people get one drawing in that look, and more only on request.
  await page.locator('.portrait-card').nth(1).getByRole('tab', { name: 'Describe person', exact: true }).click();
  await page.getByRole('textbox', { name: 'Appearance for Dad' }).fill('Short grey hair, light brown skin and a trimmed beard.');
  await page.locator('.portrait-card').nth(1).getByText('Other drawing options', { exact: true }).click();
  await page.getByRole('button', { name: 'Make their story drawing', exact: true }).click();
  await page.getByRole('button', { name: 'Choose drawing 1 for Dad', exact: true }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: 'Choose drawing 1 for Dad', exact: true }).click();
  await page.getByAltText('Chosen story drawing of Dad', { exact: true }).waitFor();
  assert.deepEqual(stages.slice(3), ['portrait-ink', 'portrait-finish']);
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: 'Use light theme' }).click();
    const path = join(output, `one-drawing-${theme}.png`); await page.screenshot({ path, fullPage: true }); screenshots.push({ theme, path, buttons: await contrastOf(page) });
  }
  await page.getByRole('button', { name: 'Save and continue to story', exact: true }).click();
  await page.getByRole('radiogroup', { name: 'Choose this story’s look', exact: true }).waitFor();
  const personalPreviews = page.locator('img[alt^="Your saved "]');
  assert.equal(await personalPreviews.count(), 3);
  const originalURLs = await personalPreviews.evaluateAll(images => images.map(image => image.src));
  const phoneCards = await personalPreviews.evaluateAll(images => images.map(image => { const box = image.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width }; }));
  assert.ok(phoneCards.every(image => Math.abs(image.y - phoneCards[0].y) < 1), 'All three personal pictures sit side by side on the phone.');
  assert.ok(phoneCards[0].x < phoneCards[1].x && phoneCards[1].x < phoneCards[2].x);
  const requestsBefore = stages.length;
  await page.getByRole('button', { name: 'Select saved Friendly anime picture', exact: true }).click();
  assert.equal(await page.getByRole('radio', { name: 'Friendly anime', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('button', { name: 'Select saved Friendly anime picture', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'View saved Friendly anime drawing', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Close drawing', exact: true }).click();
  for (const style of pictureStyleOptions) await page.getByRole('radio', { name: style.label, exact: true }).check();
  assert.equal(stages.length, requestsBefore, 'Choosing a style only changes the next-story draft.');
  assert.deepEqual(await personalPreviews.evaluateAll(images => images.map(image => image.src)), originalURLs);
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Use dark theme' }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Style cards fit the phone width.');
    const path = join(output, `next-story-looks-${theme}.png`); await page.screenshot({ path, fullPage: true }); screenshots.push({ theme, path, buttons: await contrastOf(page) });
  }
  // An existing person can explicitly compare all three looks after setup.
  await page.goto(new URL('/#people', page.url()).href);
  await page.locator('#portrait-person-grown-up-one').waitFor();
  await page.getByRole('button', { name: 'See Dad in three looks', exact: true }).click();
  for (const style of pictureStyleOptions) await page.getByRole('button', { name: `Choose the ${style.label} drawing for Dad`, exact: true }).waitFor({ timeout: 20000 });
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.getByRole('button', { name: 'Use light theme' }).click();
    assert.equal(await page.locator('img[alt^="Dad in the "]').count(), 3);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const path = join(output, `later-person-three-looks-${theme}.png`); await page.screenshot({ path, fullPage: true }); screenshots.push({ theme, path, buttons: await contrastOf(page) });
  }
  await page.getByRole('button', { name: 'Choose the Friendly anime drawing for Dad', exact: true }).click();
  await page.getByText('Story look: Friendly anime', { exact: true }).waitFor();
  const afterComparison = await page.evaluate(async () => (await fetch('/api/session')).json());
  assert.equal(afterComparison.pictureStyleId, 'diary-doodles', 'A person comparison must not change the family default.');
  assert.equal(await page.locator('img[alt^="Dad in the "]').count(), 3);
  // Model an exhausted comparison response locally and inspect the two real
  // buttons' requests. No request reaches a drawing provider in this fixture.
  let stoppedComparison, comparisonJobId;
  await page.route('**/api/portraits?*', async route => {
    const response = await route.fetch(), data = await response.json();
    const dad = data.people.find(p => p.id === 'grown-up-one');
    comparisonJobId = dad.job.id;
    dad.job = { ...dad.job, status: 'needs-input', canRestart: true, completed: 2, message: 'Saved choices need a fresh attempt.' };
    dad.candidates = dad.candidates.slice(0, 2);
    stoppedComparison = data;
    await route.fulfill({ response, json: data });
  });
  const sent = [];
  await page.route('**/api/portraits/grown-up-one', async route => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(stoppedComparison) });
  });
  await page.reload();
  await page.locator('.portrait-card').nth(1).getByText('Other drawing options', { exact: true }).click();
  await page.locator('.portrait-card').nth(1).getByRole('button', { name: 'Draw only this look', exact: true }).click();
  await page.getByRole('button', { name: 'See Dad in three looks', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="progressbar"]'));
  assert.equal(sent.length, 2);
  assert.equal(sent[0].restartJobId, undefined); assert.equal(sent[0].compareStyles, undefined);
  assert.equal(sent[1].restartJobId, comparisonJobId); assert.equal(sent[1].compareStyles, true);
  saveJSON(join(output, 'proof.json'), { fixture: true, drawings: 'Offline fixture drawing service; plain coloured PNGs stand in for real drawings. Not evidence of real style or likeness.', stages, screenshots });
});
