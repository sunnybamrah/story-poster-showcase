// Offline browser proof only: mocked speech and HTTP responses are not phone or model proof.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';
import { launchMeasurementBrowser } from '../server/layout-fit.js';
import { setupRecord, heroPresets } from '../server/app-data.js';
import { root, saveJSON } from '../server/files.js';

const directory = join(root, 'context/overnight-1017/ui-proof'); mkdirSync(directory, { recursive: true });
const family = { real: false, nickname: 'Pip', age: 10, pronouns: 'he/him', loves: [], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }, { label: 'Mom', pronouns: 'she/her', hair: 'long dark hair' }] };
let saved = { record: null }, requests = [], clarifyMode = 'question', releaseClarify;
const completed = () => ({ accountId: 'fixture-family', username: 'fixture@example.test', email: 'fixture@example.test', emailVerified: true, needsSetup: false, isOwner: true, creationEnabled: true, childId: 'primary', record: setupRecord(family), children: [{ id: 'primary', nickname: 'Pip', age: 10 }], jobs: [], look: { pending: false }, storyAllowance: { limit: 3, remaining: 3, used: 0 } });
const config = { sampleOnly: false, sampleAvailable: false, realFamilySetupAllowed: false, generationRoute: 'subscription', presets: heroPresets, signup: { enabled: true, limit: 50, available: true, emailAvailable: true } };
let browser, vite; const errors = [], checks = [], screenshots = [];
try {
  vite = await createServer({ configFile: false, root: join(root, 'app'), publicDir: join(root, 'public'), logLevel: 'error', server: { host: '127.0.0.1', port: 0 } }); await vite.listen();
  const base = 'http://127.0.0.1:' + vite.httpServer.address().port;
  browser = await launchMeasurementBrowser(); const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', err => errors.push(err.message));
  await page.addInitScript(() => {
    window.fixtureRecognizers = [];
    window.SpeechRecognition = class {
      constructor() { window.fixtureRecognizers.push(this); }
      start() { this.started = true; }
      abort() { this.aborted = true; }
    };
    window.sayFixture = (words, final = true) => window.fixtureRecognizers.at(-1).onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: words }], { isFinal: final })] });
  });
  let creationEnabled = true;
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname.replace('/api/', '');
    const body = req.method() === 'GET' ? null : req.postDataJSON(); requests.push({ path, method: req.method(), body });
    const reply = json => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
    if (path === 'config') return reply(config);
    if (path === 'session') return reply(saved);
    if (path === 'signup') { saved = { ...completed(), needsSetup: true, childId: null, children: [], record: null, emailVerified: false }; return reply(saved); }
    if (path === 'family/setup') { saved = completed(); return reply(saved); }
    if (path === 'login') { saved = completed(); return reply(saved); }
    if (path === 'logout') { saved = { record: null }; return reply({ ok: true }); }
    if (path.startsWith('portraits')) return reply({ people: [], look: { pending: false } });
    if (path.startsWith('auth/')) return reply({ message: path === 'auth/reset-password' ? 'Password changed.' : 'Check your email.' });
    if (path === 'moment/clarify') {
      if (clarifyMode === 'delayed') await new Promise(resolve => { releaseClarify = resolve; });
      return reply({ status: clarifyMode === 'unavailable' ? 'unavailable' : body.answers?.length ? 'ready' : 'question', draftId: 'draft-fixture', question: 'Who took the paper?', answers: body.answers });
    }
    if (path === 'jobs') return reply({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status: 'running', stage: 'writing', message: 'Offline fixture only.' });
    if (path.startsWith('jobs/')) return reply({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', status: 'running', stage: 'writing' });
    if (path === 'owner/accounts') return reply({ accounts: [{ id: 'fixture-other', email: 'other@example.test', creationEnabled, storiesToday: 2 }] });
    if (path === 'owner/accounts/fixture-other') { creationEnabled = body.creationEnabled; return reply({ ok: true }); }
    if (path === 'owner/kits') return reply({ kits: [{ id: 'finished-fixture', createdAt: '2026-10-17T10:00:00Z', result: { chapterTitle: 'A fictional finished kit' } }] });
    if (path.endsWith('poster.png')) return route.fulfill({ status: 200, contentType: 'image/png', body: readFileSync(join(root, 'test/fixtures/offline-art.png')) });
    return reply({});
  });
  const capture = async name => {
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name + ' has no horizontal overflow');
    const file = join(directory, name + '.png'); await page.screenshot({ path: file, fullPage: true, animations: 'disabled' }); screenshots.push(file);
  };
  await page.goto(base); await page.getByRole('button', { name: 'Start our first story', exact: true }).click();
  await page.getByLabel('Your email address').fill('fixture@example.test'); await page.getByLabel('Choose a password').fill('fictional-password-only');
  assert.doesNotMatch(await page.locator('body').innerText(), /50 accounts|3 stories|showcase has room|up to 3|after the showcase/i);
  await capture('signup-light'); await page.getByRole('button', { name: 'Use dark theme' }).click(); await capture('signup-dark'); await page.getByRole('button', { name: 'Use light theme' }).click();
  await page.getByRole('button', { name: 'Continue to our people' }).click(); await page.getByRole('heading', { name: 'Who’s in your story?' }).waitFor();
  assert.deepEqual(requests.find(item => item.path === 'signup').body, { email: 'fixture@example.test', password: 'fictional-password-only' });
  await page.reload(); await page.getByRole('heading', { name: 'Who’s in your story?' }).waitFor(); checks.push('Email account persists before People, and reload resumes People without asking for credentials again.');
  await page.getByRole('button', { name: 'Save people and choose our look' }).click(); await page.getByRole('button', { name: 'Continue to our evening' }).click();
  const note = page.getByLabel('What stayed with you today?'); await note.fill('Typed beginning.');
  assert.equal(await page.evaluate(() => fixtureRecognizers.length), 0);
  await page.getByRole('button', { name: 'Talk', exact: true }).click(); await page.evaluate(() => sayFixture('Spoken ending.'));
  await page.waitForFunction(() => document.querySelector('textarea').value === 'Typed beginning. Spoken ending.');
  await note.fill('The corrected moment.'); assert.equal(await page.evaluate(() => fixtureRecognizers.at(-1).aborted), true);
  await page.getByRole('button', { name: 'Talk', exact: true }).click(); await page.evaluate(() => sayFixture('One detail.', false)); await page.getByRole('button', { name: 'Stop talking' }).click();
  await page.waitForFunction(() => document.querySelector('textarea').value === 'The corrected moment. One detail.');
  await page.getByRole('button', { name: 'Talk', exact: true }).click(); await page.evaluate(() => fixtureRecognizers.at(-1).onerror({ error: 'not-allowed' }));
  await page.getByText(/Microphone access was not allowed/).waitFor(); await note.fill('He took the paper and she cried.'); checks.push('Explicit Talk, typed edits, second recording, partial Stop and denied microphone preserve text in the mocked browser.');
  await page.getByRole('button', { name: 'Change who joins this story', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Dad', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Create our story', exact: true }).click(); await page.getByLabel('Your answer').waitFor();
  assert.deepEqual(requests.filter(item => item.path === 'moment/clarify').at(-1).body.kitContext.selectedGrownUpIds, ['grown-up-two']);
  await capture('question-light'); await page.getByRole('button', { name: 'Use dark theme' }).click(); await capture('question-dark'); await page.getByRole('button', { name: 'Use light theme' }).click();
  await page.getByLabel('Your answer').fill('The classmate took the paper.'); await page.getByRole('button', { name: 'Use my answer and create' }).click();
  await page.getByRole('heading', { name: 'Making tonight’s kit' }).waitFor();
  const job = requests.filter(item => item.path === 'jobs').at(-1).body;
  assert.equal(job.tonight, 'He took the paper and she cried.'); assert.equal(job.clarificationId, 'draft-fixture'); checks.push('Inline answer stays separate from original note; exact clarification id and chosen grown-up reach Create.');
  await page.getByRole('button', { name: 'Tonight', exact: true }).click(); await note.fill('Another original note.'); clarifyMode = 'unavailable';
  await page.getByRole('button', { name: 'Create our story', exact: true }).click(); await page.getByRole('button', { name: 'Create from my note' }).click();
  await page.getByRole('heading', { name: 'Making tonight’s kit' }).waitFor(); assert.equal(Object.hasOwn(requests.filter(item => item.path === 'jobs').at(-1).body, 'clarificationId'), false); checks.push('Unavailable clarification offers explicit original-note continuation without claiming a passed check.');
  await page.getByRole('button', { name: 'Tonight', exact: true }).click(); clarifyMode = 'delayed'; await note.fill('Old moment.');
  await page.getByRole('button', { name: 'Create our story', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[aria-label="Saving your choice"]'));
  await note.fill('New corrected moment.'); releaseClarify(); await page.waitForFunction(() => !document.querySelector('[aria-label="Saving your choice"]'));
  assert.equal(await page.getByLabel('Your answer').count(), 0); assert.equal(await note.inputValue(), 'New corrected moment.'); checks.push('A late clarification cannot attach itself to an edited moment.');
  await page.getByRole('button', { name: 'Talk', exact: true }).click(); await page.evaluate(() => { window.lateSpeech = fixtureRecognizers.at(-1).onresult; });
  await page.getByRole('button', { name: 'Family', exact: true }).click(); await page.getByRole('button', { name: 'Review finished kits and access' }).click();
  await page.getByText('other@example.test', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Turn off new stories' }).click(); await page.getByRole('button', { name: 'Allow new stories' }).waitFor();
  assert.equal(creationEnabled, false); assert.ok(requests.some(item => item.path === 'owner/accounts/fixture-other' && item.body.creationEnabled === false));
  await capture('owner-light'); await page.getByRole('button', { name: 'Use dark theme' }).click(); await capture('owner-dark');
  await page.getByRole('button', { name: 'Tonight', exact: true }).click();
  await page.evaluate(() => lateSpeech({ resultIndex: 0, results: [Object.assign([{ transcript: 'old private speech' }], { isFinal: true })] }));
  assert.equal(await note.inputValue(), 'New corrected moment.'); checks.push('Leaving Tonight aborts speech; stale callbacks do not change the returning draft. Owner sees finished kit links and changes only new-story access.');
  for (const remaining of [3, 2, 1, 0]) {
    saved = { ...completed(), storyAllowance: { limit: 3, used: 3 - remaining, remaining } };
    await page.goto(base + '#tonight'); await page.reload(); await page.getByLabel('What stayed with you today?').waitFor();
    const text = await page.locator('body').innerText();
    assert.doesNotMatch(text, /new stories left today|of 3|Resets at midnight|50 accounts/);
    assert.equal(text.includes('You have reached today’s story limit.'), remaining === 0);
  }
  await capture('limit-reached-dark'); await page.getByRole('button', { name: 'Use light theme' }).click(); await capture('limit-reached-light'); await page.getByRole('button', { name: 'Use dark theme' }).click();
  config.signup.available = false; saved = { record: null }; await page.goto(base + '#welcome'); await page.reload();
  await page.getByRole('button', { name: 'Start our first story', exact: true }).click();
  await page.getByText('The showcase is full for now. Existing families can still sign in.', { exact: true }).waitFor();
  checks.push('Account capacity appears only when full. Daily limit stays hidden with 1, 2 or 3 starts remaining and appears only at zero.');
  config.signup.available = true;
  saved = { record: null }; await page.goto(base + '?reset=fixture-token'); await page.getByLabel('New password').fill('changed-fictional-password');
  assert.equal(new URL(page.url()).search, ''); await page.getByRole('button', { name: 'Save new password' }).click(); await page.getByText('Password changed.', { exact: true }).waitFor();
  await capture('recovery-dark'); await page.getByRole('button', { name: 'Use light theme' }).click(); await capture('recovery-light');
  await page.getByRole('button', { name: 'Back to sign in' }).click(); await page.getByRole('button', { name: 'Forgot password?' }).click(); await page.getByLabel('Your email address').fill('fixture@example.test'); await page.getByRole('button', { name: 'Send recovery link' }).click(); await page.getByText('Check your email.', { exact: true }).waitFor(); checks.push('Recovery token leaves the address bar; reset and subsequent forgot-password flow use distinct forms.');
  assert.deepEqual(errors, []); saveJSON(join(directory, 'checks.json'), { ready: true, fixture: true, physicalPhone: false, checks, screenshots, errors }); console.log(JSON.stringify({ directory, checks, screenshots, errors }, null, 2));
} catch (error) { saveJSON(join(directory, 'checks.json'), { ready: false, fixture: true, checks, screenshots, errors, reason: error.message }); throw error; }
finally { releaseClarify?.(); await browser?.close(); await vite?.close(); }
