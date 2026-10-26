import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
import { launchMeasurementBrowser } from '../server/layout-fit.js';
import { setupRecord, heroPresets } from '../server/app-data.js';
import { root, saveJSON } from '../server/files.js';
import { defaultPictureStyleId } from '../app/picture-styles.js';

// Labelled offline UI fixture. The separate API test proves real persistence.
test('grade input stays absent while editing preserves an older explicit grade in both themes', async t => {
  const family = { real: false, pictureStyleId: defaultPictureStyleId, nickname: 'Pip', age: 10, schoolGrade: { system: 'US', level: 4 }, pronouns: 'he/him', loves: [], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] };
  let saved = { accountId: 'fictional-grade-ui', username: 'fixture', childId: 'primary', needsSetup: false, canChangePictureStyle: true, creationEnabled: true, record: setupRecord(family), children: [{ id: 'primary', nickname: 'Pip', age: 10 }], jobs: [], look: { pending: false }, storyAllowance: { remaining: 3, limit: 3, used: 0 } };
  const config = { sampleOnly: false, sampleAvailable: false, realFamilySetupAllowed: false, generationRoute: 'subscription', presets: heroPresets, signup: { enabled: true, available: true } };
  const vite = await createServer({ configFile: false, root: join(root, 'app'), publicDir: join(root, 'public'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } }); await vite.listen(); t.after(() => vite.close());
  const browser = await launchMeasurementBrowser(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const requests = [], errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/', '');
    const reply = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (path === 'config') return reply(config);
    if (path === 'session') return reply(saved);
    if (path === 'family' && request.method() === 'PATCH') { const body = request.postDataJSON(); requests.push(body); saved = { ...saved, record: setupRecord(body.family) }; return reply(saved); }
    if (path.startsWith('portraits')) return reply({ people: [], look: { pending: false } });
    if (path.startsWith('library')) return reply({ entries: [], jobs: [] });
    return reply({});
  });
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}`);
  await page.getByRole('button', { name: 'Family', exact: true }).click();
  await page.getByRole('button', { name: 'Edit people and hero' }).click();
  const output = join(root, 'context/phone-flow-2026-10-25/grade-ui'); mkdirSync(output, { recursive: true });
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Use dark theme' }).click();
    assert.equal(await page.getByRole('combobox', { name: 'School grade (optional)' }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, `${theme}.png`), animations: 'disabled' });
  }
  await page.getByRole('textbox', { name: 'Child’s story name', exact: true }).fill('Pip updated');
  await page.getByRole('button', { name: 'Save details', exact: true }).click();
  await page.getByRole('button', { name: 'Family', exact: true }).click();
  await page.getByRole('button', { name: 'Edit people and hero' }).click();
  assert.equal(await page.getByRole('combobox', { name: 'School grade (optional)' }).count(), 0);
  assert.deepEqual(requests[0].family.schoolGrade, { system: 'US', level: 4 });
  assert.equal(requests[0].family.pictureStyleId, family.pictureStyleId);
  assert.deepEqual(saved.record.hero.schoolGrade, { system: 'US', level: 4 });
  assert.deepEqual(errors, []);
  saveJSON(join(output, 'proof.json'), { kind: 'offline mocked HTTP UI fixture', themes: ['light', 'dark'], optional: true, roundTrip: true, clearGrade: true, errors });
});
