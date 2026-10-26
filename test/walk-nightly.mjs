import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { createApp } from '../server/app-server.mjs';
import { moves, readJSON, saveJSON, root } from '../server/files.js';
import { libraryTransportFixture, librarySearchFixture, librarySource } from './library-fixture.mjs';
import { createMemory } from '../server/memory.js';
import { recordDataConsent } from '../server/config.js';
import { dataPolicyVersion, childDataNotice } from '../app/data-policy.js';

// A real-browser walk of the real HTTP/UI flow with explicitly injected image
// replies and kit exports. This does not claim new model quality or a paid run.
const args = process.argv.slice(2);
if (!args.includes('--offline')) throw Error('Use --offline. This walk never calls a provider.');
const option = name => args[args.indexOf(name) + 1];
if (!args.includes('--sample') || !option('--sample')) throw Error('Supply --sample with a saved fictional kit directory.');
const directory = resolve(option('--sample'));
const checkpoint = readJSON(join(directory, 'checkpoint.json'));
assert.equal(checkpoint.recordAtStart.real, false, 'Only an explicitly fictional saved family is allowed.');
assert.ok(checkpoint.stages.text.ready);
const sample = { directory, text: checkpoint.stages.text, record: checkpoint.recordAtStart };
const out = resolve(args.includes('--output') ? option('--output') : join(root, 'context/nightly-ui', new Date().toISOString().replaceAll(':', '-')));
mkdirSync(out, { recursive: true });
writeFileSync(join(root, 'context/continuation-walker-progress.md'), `# Local browser walk starting\n\nOutput: ${out}\nCurrent local app, fictional accounts, injected replies. No live provider calls.\n`);
const files = ['poster.png', 'poster.pdf', 'kit_final.pdf', ...[1, 2, 3, 4].map(n => `panel-${n}.png`)];
for (const file of files) assert.ok(existsSync(join(directory, file)), `Missing saved export ${file}`);
const png = readFileSync(join(directory, 'poster.png'));
const inkFixture = readFileSync(join(root, 'public/style-examples/bold-ink-comic.png'));
const portraitFixture = personId => {
  const reference = sample.record.cast?.find(person => person.id === personId)?.referencePath;
  return reference && existsSync(reference) ? readFileSync(reference) : readFileSync(join(root, 'public/style-examples/anime-comic.png'));
};
let portraitReplies = 0, identityCheckReplies = 0;
const libraryCalls = [], libraryTransport = libraryTransportFixture({ calls: libraryCalls });
const app = createApp({ dataDirectory: join(out, 'private-test-state'), sample, sampleOnly: false, allowSyntheticPortraits: true,
  librarySearch: librarySearchFixture, libraryFetch: async () => librarySource(),
  keyReader: () => 'offline-fixture-not-a-real-key',
  transportFactory: () => ({ call: async request => {
    if (request.stage.startsWith('library-')) return libraryTransport.call(request);
    // Injected sketch check: the same person, so the walk tests screens, not the checker.
    if (['portrait-identity-check', 'portrait-render-check'].includes(request.stage)) { identityCheckReplies++; const { characterId } = JSON.parse(request.body.input[0].content[0].text); return { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ ...(request.stage === 'portrait-render-check' ? { graphicStyle: { matchesSelectedStyle: true, flatInk: true, photographicTexture: false, toyShine: false, oversizedEyes: false, evidence: 'Injected fixture: drawn in the expected look.' } } : {}), castObservations: [{ characterId, observedSpecies: 'human', identityMatches: true, certainty: 'confirmed', identityEvidence: 'Injected fixture: same face and hair as the input.', appearance: [], clothing: [] }] }) }] }] }; }
    assert.ok(['portrait', 'portrait-description', 'portrait-ink', 'portrait-finish', 'portrait-render'].includes(request.stage), 'Only portrait and teaching-library replies are injected.'); portraitReplies++;
    const personId = request.body.prompt.match(/called (child|grown-up-(?:one|two))/)?.[1] ?? 'child';
    return { data: [{ b64_json: (request.stage === 'portrait-ink' ? inkFixture : portraitFixture(personId)).toString('base64') }] };
  } }),
  runKit: async (_transport, memory, _tonight, options) => {
    if (_tonight === 'Fixture terminal layout. Homework felt hard.') {
      saveJSON(join(options.directory, 'checkpoint.json'), { fixture: true, fitAttempts: { story: 2 }, stages: { text: sample.text } });
      throw Object.assign(Error('Private provider body must not reach this screen.'), { code: 'printed_layout_review_required', canResume: false });
    }

    assert.equal(options.chosenMoveId, sample.text.moveId);
    mkdirSync(options.directory, { recursive: true });
    for (const file of files) copyFileSync(join(directory, file), join(options.directory, file));
    return { ...structuredClone(sample.text), move: moves.find(move => move.id === sample.text.moveId), recordAtStart: memory.exportRecord(), complete: true };
  },
});
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.STORY_POSTER_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const errors = [], checks = [], screenshots = [], access = [], measurements = [];
let activePage;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  activePage = page;
  const mediaRequests = []; page.on('request', request => { if (request.url().includes('/videos/story-poster-how-to.mp4')) mediaRequests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  let dropNextPortraitRead = false, droppedPortraitReads = 0;
  page.on('response', response => {
    if (response.status() === 202 && response.request().method() === 'POST' && /\/api\/portraits\/child$/.test(response.url()) && !droppedPortraitReads) dropNextPortraitRead = true;
  });
  await page.route('**/api/portraits?*', route => {
    if (dropNextPortraitRead) { dropNextPortraitRead = false; droppedPortraitReads++; return route.abort('connectionfailed'); }
    return route.continue();
  });
  const shot = async name => {
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `Horizontal overflow at ${name}`);
    const measure = () => page.evaluate(() => {
      const rect = selector => { const node = document.querySelector(selector); if (!node) return null; const box = node.getBoundingClientRect(); return { top: box.top + scrollY, height: box.height, bottom: box.bottom + scrollY, minHeight: getComputedStyle(node).minHeight }; };
      return { width: innerWidth, height: innerHeight, scrollY, documentHeight: document.documentElement.scrollHeight, bodyHeight: document.body.scrollHeight, root: rect('#root'), frame: rect('#root > div'), main: rect('main'), nav: rect('nav[aria-label="Main navigation"]') };
    });
    const before = await measure(), path = join(out, name + '.png'); const bytes = await page.screenshot({ path, fullPage: true, animations: 'disabled' }); const after = await measure();
    measurements.push({ name, before, after, png: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } }); screenshots.push(path);
    saveJSON(join(out, 'progress.json'), { status: 'running', latestScreen: name, screenshotCount: screenshots.length, checkedThemes: access.length, output: out });
    writeFileSync(join(root, 'context/continuation-walker-progress.md'), `# Current local browser walk\n\nRunning current UI with fictional accounts and injected replies. No live providers or deployment.\nOutput: ${out}\nLatest screen: ${name}\nSaved screenshots: ${screenshots.length}\nFinal assertions and report still pending.\n`);
  };
  const theme = async dark => {
    const desired = dark ? 'dark' : 'light';
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== desired) await page.getByRole('button', { name: dark ? 'Use dark theme' : 'Use light theme', exact: true }).click();
    await page.waitForFunction(value => document.documentElement.dataset.theme === value, desired);
  };
  const audit = async name => {
    const rows = await page.locator('h1,h2,h3,p,legend,label,a,button,.MuiChip-label,.MuiFormLabel-root,.MuiBottomNavigationAction-label').evaluateAll(nodes => {
      const rgba = value => value.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0];
      const mix = (front, back) => front.slice(0, 3).map((v, i) => v * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
      const lum = rgb => rgb.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      return nodes.filter(node => node.textContent.trim() && node.getBoundingClientRect().width && node.getBoundingClientRect().height && !node.closest(':disabled,[aria-disabled=true],[hidden]') && getComputedStyle(node).visibility !== 'hidden').map(node => {
        const style = getComputedStyle(node), ancestors = []; let ancestor = node;
        while (ancestor) { ancestors.unshift(ancestor); ancestor = ancestor.parentElement; }
        const surface = ancestors.reduce((colour, element) => mix(rgba(getComputedStyle(element).backgroundColor), colour), [255, 255, 255]);
        const ink = mix(rgba(style.color), surface), values = [lum(ink), lum(surface)].sort((a, b) => b - a);
        return { text: node.textContent.trim().slice(0, 100), contrast: (values[0] + .05) / (values[1] + .05), minimum: parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700 ? 3 : 4.5 };
      });
    });
    access.push({ name, theme: await page.evaluate(() => document.documentElement.dataset.theme), textContrast: rows });
    for (const row of rows) assert.ok(row.contrast >= row.minimum, `${name}: ${row.text} contrast ${row.contrast}, needs ${row.minimum}`);
  };
  const both = async name => { await theme(false); await shot(name + '-light-phone'); await audit(name + '-light'); await theme(true); await shot(name + '-dark-phone'); await audit(name + '-dark'); await theme(false); };
  // The first captures show the live invitation-only entry. The rest of the
  // offline walk keeps its existing fictional-login setup.
  const invitationPreview = async route => {
    const response = await route.fetch(), config = await response.json();
    await route.fulfill({ response, json: { ...config, signup: { ...config.signup, requiresInvitation: true, mode: 'request' }, accessRequests: { enabled: true } } });
  };
  await page.route('**/api/config', invitationPreview);
  await page.goto(base);
  const localConfig = await page.request.get(base + '/api/config').then(response => response.json());
  assert.equal(localConfig.signup.enabled, false, 'This local walk uses the current made-up-login fallback. Email delivery is covered separately.');
  await page.getByRole('heading', { name: 'One moment. One skill. One rhyme.' }).waitFor();
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const dark of [false, true]) {
      await theme(dark);
      await shot(`promise-${width}-${dark ? 'dark' : 'light'}`);
      await page.getByRole('button', { name: 'About', exact: true }).click();
      const about = page.getByRole('dialog', { name: 'About Story Poster', exact: true });
      await about.waitFor();
      const questions = about.getByRole('button', { name: /^\d+\. / });
      assert.equal(await questions.count(), 10);
      await shot(`about-${width}-${dark ? 'dark' : 'light'}`);
      for (let question = 0; question < 10; question++) {
        const failSample = route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Sample temporarily unavailable.' }) });
        const checkRetry = width === 320 && !dark && question === 2;
        if (checkRetry) await page.route('**/api/sample', failSample);
        await questions.nth(question).click();
        if (checkRetry) {
          await about.getByText('Sample temporarily unavailable.', { exact: true }).waitFor();
          await page.unroute('**/api/sample', failSample);
          await about.getByRole('button', { name: 'Try again', exact: true }).click();
        }
        if (question === 2) {
          const hash = new URL(page.url()).hash;
          for (const [label, first, last] of [['poster', 1, 1], ['two-page story', 2, 3], ['Try It page', 4, 4], ['cards with a grown-up guide', 5, 5]]) {
            const trigger = about.getByRole('button', { name: `Preview ${label}`, exact: true });
            await trigger.click();
            const reader = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Close pages', exact: true }) });
            const image = reader.locator('.kit-reader-page');
            await image.waitFor();
            await page.waitForFunction(() => [...document.querySelectorAll('.kit-reader-page')].some(node => node.complete && node.naturalWidth > 0));
            assert.ok((await image.getAttribute('alt')).startsWith(`Page ${first} of 5.`));
            assert.equal(await reader.getByRole('button', { name: 'Previous page', exact: true }).isDisabled(), true);
            assert.equal(await reader.getByRole('button', { name: 'Next page', exact: true }).isDisabled(), first === last);
            await shot(`faq-page-${first}-${width}-${dark ? 'dark' : 'light'}`);
            await reader.getByRole('button', { name: 'Make page bigger', exact: true }).click();
            await reader.getByRole('button', { name: 'Reset page size', exact: true }).click();
            if (first !== last) {
              await reader.getByRole('button', { name: 'Next page', exact: true }).click();
              await reader.getByRole('img', { name: new RegExp(`^Page ${last} of 5\\.`) }).waitFor();
              assert.equal(await reader.getByRole('button', { name: 'Next page', exact: true }).isDisabled(), true);
              await shot(`faq-page-${last}-${width}-${dark ? 'dark' : 'light'}`);
            }
            await page.keyboard.press('Escape'); await reader.waitFor({ state: 'hidden' });
            assert.equal(await trigger.evaluate(node => node === document.activeElement), true);
            assert.equal(new URL(page.url()).hash, hash);
          }
        }
        if (question === 4) {
          await about.getByRole('button', { name: 'Sources and limits for the sample', exact: true }).click();
          await about.locator('.about-sample-sources a').first().waitFor();
          const links = await about.locator('.about-sample-sources a').evaluateAll(nodes => nodes.map(node => ({ href: node.href, target: node.target, rel: node.rel })));
          assert.ok(links.length > 0 && links.every(link => link.href.startsWith('https://') && link.target === '_blank' && link.rel.includes('noreferrer')));
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await shot(`faq-${question + 1}-${width}-${dark ? 'dark' : 'light'}`);
      }
      await page.keyboard.press('Escape');
      await about.waitFor({ state: 'hidden' });
      assert.equal(await page.getByRole('button', { name: 'About', exact: true }).evaluate(node => node === document.activeElement), true);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.unroute('**/api/config', invitationPreview);
  await page.reload();
  await page.getByRole('heading', { name: 'One moment. One skill. One rhyme.' }).waitFor();
  if (args.includes('--all-screens')) {
    assert.equal(await page.locator('video').count(), 0); assert.equal(mediaRequests.length, 0);
    for (const dark of [false, true]) {
      await theme(dark); await page.getByRole('button', { name: 'Help: watch the short guide', exact: true }).click();
      const guide = page.getByRole('dialog', { name: 'A quick guide to Story Poster', exact: true }); await guide.waitFor();
      const video = guide.locator('video'); assert.equal(await video.getAttribute('preload'), 'none'); assert.equal(await video.getAttribute('autoplay'), null);
      await video.evaluate(node => { node.muted = true; return node.play(); }); await page.waitForFunction(() => document.querySelector('video')?.currentTime > 0);
      await video.evaluate(node => { node.pause(); node.currentTime = 35; });
      await page.waitForFunction(() => { const node = document.querySelector('video'); return node && !node.seeking && node.currentTime >= 35; });
      await guide.getByText('Read the steps', { exact: true }).click(); await guide.getByText('Next evening, add a new moment and choose a look again.', { exact: false }).waitFor();
      await shot('how-to-guide-' + (dark ? 'dark' : 'light') + '-phone'); await audit('how-to-guide-' + (dark ? 'dark' : 'light'));
      await guide.getByRole('button', { name: 'Close guide', exact: true }).click(); await guide.waitFor({ state: 'hidden' }); assert.equal(await page.locator('video').count(), 0);
    }
    assert.ok(mediaRequests.length > 0);
    const unavailableMedia = route => route.abort('connectionfailed'); await page.route('**/videos/story-poster-how-to.mp4', unavailableMedia);
    for (const dark of [false, true]) {
      await theme(dark); await page.getByRole('button', { name: 'Help: watch the short guide', exact: true }).click();
      await page.getByRole('dialog').waitFor(); await page.locator('video').evaluate(node => { node.muted = true; return node.play().catch(() => {}); });
      await page.getByText('The video did not load. You can read the steps below.', { exact: true }).waitFor();
      await page.getByText('Read the steps', { exact: true }).click();
      await shot('how-to-unavailable-' + (dark ? 'dark' : 'light') + '-phone'); await audit('how-to-unavailable-' + (dark ? 'dark' : 'light'));
      await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Help: watch the short guide', exact: true }).evaluate(node => { if (document.activeElement !== node) throw Error('Guide focus did not return to Help.'); });
    }
    await page.unroute('**/videos/story-poster-how-to.mp4', unavailableMedia); await theme(false);
    checks.push('The optional guide stays unloaded until opened; the actual local MP4 plays and seeks in both themes, missing video keeps readable steps, Close stops/unmounts playback, and Help/Escape returns focus without leaving the family route.');
  }
  await shot('home-light-phone'); await theme(true); await shot('home-dark-phone'); await theme(false);
  if (args.includes('--all-screens')) {
    await audit('home-light'); await theme(true); await audit('home-dark'); await theme(false);
    for (const width of [320, 768, 1280]) { await page.setViewportSize({ width, height: 900 }); await shot('home-light-' + width); await theme(true); await shot('home-dark-' + width); await theme(false); }
    await page.setViewportSize({ width: 390, height: 844 });
    let releaseConfig; const heldConfig = new Promise(resolve => { releaseConfig = resolve; });
    const slowConfig = async route => { await heldConfig; await route.continue(); };
    await page.route('**/api/config', slowConfig); await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByRole('heading', { name: 'Opening your evening…', exact: true }).waitFor(); await both('opening'); releaseConfig(); await page.getByRole('heading', { name: 'One moment. One skill. One rhyme.', exact: true }).waitFor(); await page.unroute('**/api/config', slowConfig);
    const failedConfig = route => route.abort('connectionfailed'); await page.route('**/api/config', failedConfig); await page.reload(); await page.getByRole('heading', { name: 'Let’s reconnect', exact: true }).waitFor(); await both('reconnect'); await page.unroute('**/api/config', failedConfig); await page.getByRole('button', { name: 'Try again', exact: true }).click(); await page.getByRole('heading', { name: 'One moment. One skill. One rhyme.', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await both('login');
    await page.getByLabel(/^Email or existing family login/).fill('unknown-fictional-family'); await page.getByLabel(/^Password/).fill('fixture-not-a-login'); await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'did not match' }).waitFor(); await both('login-error');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
  }
  // Keep the old focused flag as an alias for the current login-first entry.
  // The guest textarea and quick-pick screen are intentionally no longer public UI.
  if (args.includes('--guest-first-only') || args.includes('--all-screens')) {
    const moment = 'The homework got hard, and the notebook went across the room.';
    const guestOptions = await page.request.post(base + '/api/quick-pick', { data: { tonight: moment } }).then(response => response.json()); assert.equal(guestOptions.status, 'eligible');
    assert.equal(await page.getByLabel(/^What stayed with you today/).count(), 0);
    await page.getByRole('button', { name: 'Start our first story', exact: true }).click();
    const firstLogin = 'guest-' + randomUUID().slice(0, 8);
    await page.getByLabel(/^Choose a family login/).fill(firstLogin); await page.getByLabel(/^Choose a password/).fill(randomUUID());
    await page.getByRole('button', { name: 'Continue to our people', exact: true }).click();
    assert.ok(!(await page.request.get(base + '/api/session').then(response => response.json())).record);
    await page.getByRole('button', { name: 'Back', exact: true }).click(); assert.equal(await page.getByLabel(/^Choose a family login/).inputValue(), firstLogin);
    await page.getByRole('button', { name: 'Continue to our people', exact: true }).click();
    await page.getByRole('button', { name: 'Save people and choose our look', exact: true }).click();
    await page.getByRole('heading', { name: 'Your family, in the story', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Continue to our evening', exact: true }).click();
    await page.getByLabel(/^What stayed with you today/).fill(moment); await both('login-first-moment');
    await page.reload(); assert.equal(await page.getByLabel(/^What stayed with you today/).inputValue(), moment);
    const retained = await page.request.post(base + '/api/pick', { data: { childId: 'primary', tonight: moment } }).then(response => response.json());
    assert.equal(retained.status, 'eligible'); assert.ok(retained.suggestions.some(move => guestOptions.suggestions.some(guest => guest.id === move.id)));
    assert.equal((await page.request.get(base + '/api/session').then(response => response.json())).jobs.length, 0); assert.equal(portraitReplies, 0); assert.equal(libraryCalls.length, 0);
    checks.push('Current local-login fallback creates no account before family save, preserves unsaved login on Back, then keeps the signed-in moment across reload. Guest quick-pick is checked through the API only; the removed guest note/selection flow is not claimed as reachable UI. No portrait, library or kit generation was invoked.');
    await page.getByRole('button', { name: 'Family', exact: true }).click(); await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.getByRole('heading', { name: 'One moment. One skill. One rhyme.', exact: true }).waitFor();
  }
  if (args.includes('--guest-first-only')) {
    assert.equal(portraitReplies, 0); assert.equal(libraryCalls.length, 0);
  } else if (args.includes('--lesson-fit-only')) {
    // The quick-pick endpoint is retained for compatibility, but Welcome no
    // longer exposes it. Do not manufacture screenshots of a removed flow.
    const comfortable = 'Lila had her sex education class today in 5th grade and she is comfortable.';
    const planning = 'Theo had a bad day. He was upset because he did not get another book from the library, because he forgot to return his old book.';
    const findMove = (endpoint, tonight, allowRepeat = false) => page.request.post(base + '/api/' + endpoint, { data: { tonight, allowRepeat, childId: 'primary' } }).then(response => response.json());
    const calmGuest = await findMove('quick-pick', comfortable); assert.equal(calmGuest.status, 'eligible'); assert.ok(calmGuest.suggestions.length);
    const planningGuest = await findMove('quick-pick', planning); assert.equal(planningGuest.status, 'eligible');
    assert.ok(planningGuest.suggestions.some(move => move.id === 'snag-plan'));
    assert.match(planningGuest.suggestions.find(move => move.id === 'snag-plan').reason, /Its school study did not test forgotten books/);
    const username = 'fit-' + randomUUID().slice(0, 8);
    const signup = await page.request.post(base + '/api/signup', { data: { username, password: randomUUID(), family: { real: false, nickname: 'Pip', age: 10, pronouns: 'they/them', loves: ['books', 'space', 'games'], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] } } });
    assert.equal(signup.status(), 200);
    const calmFamily = await findMove('pick', comfortable); assert.equal(calmFamily.status, 'eligible'); assert.ok(calmFamily.suggestions.length);
    const unavailableGuide = await page.request.post(base + '/api/pick', { data: { tonight: comfortable, childId: 'primary', requestedMoveId: 'missing-guide' } }).then(response => response.json());
    assert.equal(unavailableGuide.status, 'noMatch'); assert.equal(unavailableGuide.reason, 'guide-unavailable'); assert.deepEqual(unavailableGuide.suggestions, []);
    const account = readJSON(join(out, 'private-test-state/accounts.json')).accounts.find(account => account.username === username);
    const memory = createMemory(join(out, 'private-test-state', account.id, 'family.json'));
    memory.addKit({ date: '2026-10-15', chapterNumber: 1, moveId: 'snag-plan', triedMove: 'yes', didItHelp: 'a little', adventureLine: 'Fictional reminder planning.', world: 'comic strip', colourSet: 'warm', wallChoice: 'Keep it off the wall' });
    const repeatChoice = await findMove('pick', planning); assert.equal(repeatChoice.status, 'eligible'); assert.ok(repeatChoice.suggestions.some(move => move.id === 'snag-plan' && move.repeated));
    const repeated = await findMove('pick', planning, true); assert.equal(repeated.status, 'eligible'); assert.ok(repeated.suggestions.some(move => move.id === 'snag-plan' && move.repeated));
    await page.goto(base + '#tonight'); await page.getByLabel(/^What stayed with you today/).fill(comfortable);
    await page.getByRole('button', { name: 'Browse teaching guides', exact: true }).click(); await page.getByRole('heading', { name: 'Browse teaching guides', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Our moment', { exact: true }).inputValue(), comfortable); await both('current-guide-entry');
    await page.getByRole('button', { name: 'Back to tonight', exact: true }).click(); assert.equal(await page.getByLabel(/^What stayed with you today/).inputValue(), comfortable);
    assert.equal((await page.request.get(base + '/api/session').then(response => response.json())).jobs.length, 0);
    assert.equal(portraitReplies, 0); assert.equal(libraryCalls.length, 0);
    saveJSON(join(out, 'legacy-fit-api.json'), { fixture: true, evidence: 'HTTP API assertions only; removed guest screens are not UI proof.', calmGuest, planningGuest, calmFamily, unavailableGuide, repeatChoice, repeated });
    checks.push('API fit checks confirm calm days remain eligible without invented distress, unavailable guide ids are refused, and forgotten-book planning retains its source limits. Helpful prior moves stay eligible without a repeat gate and are marked as repeated; the explicit repeat preference also remains accepted. Current UI keeps the private moment through Browse teaching guides and Back in both themes. No claim is made that the removed guest quick-pick screens remain reachable. No generated jobs or injected model replies.');
  } else {
  await page.getByRole('button', { name: 'Try the saved sample', exact: true }).click();
  await page.getByRole('button', { name: 'Poster and pages →', exact: true }).click();
  await page.getByRole('button', { name: 'Open all five pages', exact: true }).waitFor();
  await shot('poster-light-phone'); await theme(true); await shot('poster-dark-phone'); await theme(false);
  const pdfLink = page.getByRole('link', { name: 'Download full five-page PDF', exact: true });
  await pdfLink.waitFor();
  const downloadReady = page.waitForEvent('download'); await pdfLink.click();
  const download = await downloadReady;
  assert.equal(download.suggestedFilename(), 'tonights-five-page-kit.pdf');
  const downloaded = join(out, download.suggestedFilename()); await download.saveAs(downloaded);
  assert.deepEqual(readFileSync(downloaded), readFileSync(join(directory, 'kit_final.pdf')));
  assert.ok(await page.getByText('Your browser may save the file or open it.', { exact: false }).isVisible());
  checks.push('Primary download returns the exact saved full-kit PDF and truthful mobile save/open help. Chromium download checked; physical iPhone save sheet untested.');

  if (args.includes('--repair-controls-only')) {
    const username = 'repair-' + randomUUID().slice(0, 8);
    const signup = await page.request.post(base + '/api/signup', { data: { username, password: randomUUID(), family: { real: false, nickname: 'Pip', age: 10, pronouns: 'they/them', loves: ['books', 'space', 'games'], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] } } });
    assert.equal(signup.status(), 200);
    const made = await page.request.post(base + '/api/jobs', { data: { tonight: 'Fixture terminal layout. Homework felt hard.', moveId: sample.text.moveId } });
    assert.equal(made.status(), 202); const created = await made.json();
    let failed;
    for (let poll = 0; poll < 100; poll++) {
      failed = await page.request.get(base + '/api/jobs/' + created.id).then(response => response.json());
      if (failed.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(failed.status, 'failed'); assert.equal(failed.canResume, false);
    await page.goto(base); await page.getByRole('button', { name: 'Our stories', exact: true }).click();
    await page.getByRole('button', { name: 'Open saved work', exact: true }).click();
    await page.getByText('The saved story still does not fit the page.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Resume saved work', exact: true }).count(), 0);
    await shot('terminal-layout-light-phone'); await theme(true); await shot('terminal-layout-dark-phone'); await theme(false);
    await page.getByRole('button', { name: 'Keep this kit and set it aside', exact: true }).click();
    await page.getByRole('heading', { name: 'One moment, together.', exact: true }).waitFor();
    const kept = await page.request.get(base + '/api/jobs/' + created.id).then(response => response.json());
    assert.equal(kept.status, 'set-aside');
    assert.ok(existsSync(join(out, 'private-test-state', readJSON(join(out, 'private-test-state/accounts.json')).accounts[0].id, created.id, 'checkpoint.json')));
    checks.push('Terminal layout screen hides Resume, keeps private errors off-screen, and sets work aside without deletion in both themes.');
  } else {
  await page.getByRole('button', { name: 'Open all five pages', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  for (let pageNumber = 1; pageNumber <= 5; pageNumber++) {
    await page.getByRole('dialog').getByText(`Page ${pageNumber} of 5`, { exact: true }).waitFor();
    await page.locator('.kit-reader-page').evaluate(image => image.decode());
    assert.equal(await page.locator('.kit-reader-page').evaluate(image => Math.max(image.naturalWidth, image.naturalHeight)), 1800);
    await shot(`saved-kit-page-${pageNumber}-phone`);
    if (pageNumber < 5) await page.getByRole('button', { name: 'Next page', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Close pages', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  checks.push('All five saved PDF pages open as pictures with a page counter and Next; Close returns to the poster.');
  await page.getByRole('button', { name: 'Read the poster in larger type', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  assert.ok((await page.getByRole('dialog').innerText()).replace(/\s+/g, ' ').includes('When I notice ______, I ______.'));
  await shot('poster-large-type-phone'); await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  checks.push('approved poster words expand; empty plan remains blank; Escape closes');
  await page.getByRole('button', { name: 'Sit together and read our story', exact: true }).click();
  assert.equal(await page.locator('img').count(), 4);
  await shot('story-light-phone'); await theme(true); await shot('story-dark-phone'); await theme(false);
  await page.setViewportSize({ width: 1280, height: 900 }); await shot('story-light-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Story Poster', exact: true }).click();
  await page.getByRole('button', { name: 'Start our first story', exact: true }).click();
  if (args.includes('--all-screens')) await both('setup-login');
  const username = 'nightly-' + randomUUID().slice(0, 8), password = randomUUID();
  await page.getByLabel(/^Choose a family login/).fill(username);
  await page.getByLabel(/^Choose a password/).fill(password);
  await page.getByRole('button', { name: 'Continue to our people', exact: true }).click();
  assert.ok(!(await page.request.get(base + '/api/session').then(response => response.json())).record);
  if (args.includes('--all-screens')) {
    await both('setup-people');
    const interests = page.getByLabel('Things they love (optional)'); assert.equal(await interests.isVisible(), true);
    await interests.fill(''); assert.equal(await page.getByRole('button', { name: 'Save people and choose our look', exact: true }).isEnabled(), true);
    await interests.fill('books, space');
    await page.setViewportSize({ width: 1280, height: 900 }); await shot('setup-light-desktop'); await theme(true); await shot('setup-dark-desktop'); await theme(false); await page.setViewportSize({ width: 390, height: 844 });
  }
  await page.getByRole('button', { name: 'Save people and choose our look', exact: true }).click();
  await page.getByRole('heading', { name: 'Your family, in the story', exact: true }).waitFor();
  const nickname = await page.request.get(base + '/api/session').then(response => response.json()).then(data => data.record.hero.nickname);
  await page.getByText('0 of 2 people have a chosen drawing in this look.', { exact: true }).waitFor();
  // A new family: the first person is drawn in three looks from the same photo,
  // one tap picks the family look, then Dad gets one drawing in that look.
  await page.locator('input[type=file]').nth(0).setInputFiles(join(directory, 'poster.png'));
  await page.getByRole('button', { name: `See ${nickname} in three looks`, exact: true }).click();
  await page.getByRole('button', { name: 'Use the Adventure comic look for our family', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Use the Adventure comic look for our family', exact: true }).click();
  await page.getByText('This drawing is saved for your stories.', { exact: true }).nth(0).waitFor();
  await page.locator('input[type=file]').nth(1).setInputFiles(join(directory, 'poster.png'));
  await page.getByRole('button', { name: 'Draw only this look', exact: true }).click();
  await page.getByRole('button', { name: 'Choose drawing 1 for Dad', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Choose drawing 1 for Dad', exact: true }).click();
  await page.getByText('This drawing is saved for your stories.', { exact: true }).nth(1).waitFor();
  assert.equal(portraitReplies, 4); assert.equal(identityCheckReplies, 0, 'Current portraits go directly to parent choice without an appearance judge.');
  await page.getByText('2 of 2 people have a chosen drawing in this look.', { exact: true }).waitFor();
  assert.equal(droppedPortraitReads, 1);
  checks.push('successful photo upload remains visible and polling recovers after the next network read fails');
  await shot('photo-choices-offline-fixtures-phone');
  await theme(true); await shot('photo-choices-offline-fixtures-dark-phone'); await theme(false);
  await page.getByRole('button', { name: `View the Adventure comic look for ${nickname}`, exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await shot('portrait-large-preview-light-phone');
  const portraitDialogLight = join(out, 'portrait-dialog-light.png'); await page.getByRole('dialog').screenshot({ path: portraitDialogLight }); screenshots.push(portraitDialogLight);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); assert.equal(await page.getByRole('button', { name: 'Show whole drawing', exact: true }).getAttribute('aria-pressed'), 'true');
  const zoomPosition = await page.locator('[data-portrait-zoom]').evaluate(node => ({ left: node.scrollLeft, top: node.scrollTop, windowWidth: node.clientWidth, imageWidth: node.scrollWidth }));
  assert.ok(Math.abs(zoomPosition.left - (zoomPosition.imageWidth - zoomPosition.windowWidth) / 2) < 1); assert.equal(zoomPosition.top, 0); access.push({ portraitZoom: zoomPosition });
  const portraitZoom = join(out, 'portrait-dialog-zoom-light.png'); await page.getByRole('dialog').screenshot({ path: portraitZoom }); screenshots.push(portraitZoom);
  await page.getByRole('button', { name: 'Show whole drawing', exact: true }).click();
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await page.getByRole('button', { name: `View the Adventure comic look for ${nickname}`, exact: true }).evaluate(node => node === document.activeElement), true);
  await theme(true); await page.getByRole('button', { name: `View the Adventure comic look for ${nickname}`, exact: true }).click();
  await page.getByRole('dialog').waitFor(); await shot('portrait-large-preview-dark-phone');
  const portraitDialogDark = join(out, 'portrait-dialog-dark.png'); await page.getByRole('dialog').screenshot({ path: portraitDialogDark }); screenshots.push(portraitDialogDark);
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await theme(false);
  checks.push('portrait choices open in a large view for face comparison, in both themes, and Escape returns to selection');
  await page.reload();
  await page.getByRole('heading', { name: 'Your family, in the story', exact: true }).waitFor();
  await page.getByText('This drawing is saved for your stories.', { exact: true }).nth(1).waitFor();
  assert.equal(await page.getByText('This drawing is saved for your stories.', { exact: true }).count(), 2);
  const people = await page.request.get(base + '/api/portraits?childId=primary').then(response => response.json());
  const privateURL = people.people[0].selectedUrl;
  assert.equal((await fetch(base + privateURL)).status, 401);
  checks.push('first person in three labelled looks with one family choice, then one drawing for Dad; chosen portraits persist after reload; private assets reject guest access');
  await page.getByRole('button', { name: 'Continue to our evening', exact: true }).click();
  if (args.includes('--all-screens')) {
    const styleReplies = portraitReplies;
    for (const style of ['Friendly anime', 'Adventure comic', 'Diary doodles']) await page.getByRole('radio', { name: style, exact: true }).check();
    await page.getByRole('radio', { name: 'Adventure comic', exact: true }).check();
    assert.equal(await page.locator('img[alt^="Your saved "]').count(), 3);
    assert.equal(portraitReplies, styleReplies, 'Changing the next story style reuses the three personal previews.');
    await both('tonight-empty');
    await page.getByRole('button', { name: 'Our stories', exact: true }).click(); await page.getByRole('heading', { name: 'Our stories', exact: true }).waitFor(); await both('shelf-empty'); await page.reload(); await page.getByRole('heading', { name: 'Our stories', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Family', exact: true }).click(); await page.getByRole('heading', { name: 'Your family’s story record', exact: true }).waitFor(); await both('family'); await page.reload(); await page.getByRole('heading', { name: 'Your family’s story record', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Delete this saved family', exact: true }).click(); await page.getByRole('dialog').waitFor(); await shot('delete-family-light-phone'); await audit('delete-family-light'); await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await theme(true); await page.getByRole('button', { name: 'Delete this saved family', exact: true }).click(); await shot('delete-family-dark-phone'); await audit('delete-family-dark'); await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await theme(false);
    await page.getByRole('button', { name: 'Tonight', exact: true }).click();
    await page.getByLabel(/^What stayed with you today/).fill('This made-up child is comfortable after a normal lesson.');
    await page.getByRole('button', { name: 'Create our story', exact: true }).waitFor(); await page.getByRole('button', { name: 'Browse teaching guides', exact: true }).click(); await page.getByRole('button', { name: 'Check this topic', exact: true }).click(); await page.getByRole('heading', { name: 'Tonight’s move', exact: true }).waitFor(); await page.getByRole('button', { name: 'None of these fits. Check a new topic', exact: true }).click(); await page.getByRole('button', { name: 'Look beyond these guides', exact: true }).waitFor(); await both('parent-chosen-new-topic');
    checks.push('An ordinary calm-day note offers prepared guides. The parent can reject the offered choices and reach the explicit new-topic check, without claiming the app returned no match.');
    await page.getByRole('button', { name: 'Back to tonight', exact: true }).click();
    await page.getByLabel(/^What stayed with you today/).fill('I yelled at my child.'); await page.getByRole('button', { name: 'Create our story', exact: true }).waitFor(); await page.getByRole('button', { name: 'Browse teaching guides', exact: true }).click(); await page.getByRole('button', { name: 'Check this topic', exact: true }).click();
    await page.getByRole('heading', { name: 'Stay with them tonight', exact: true }).waitFor(); await both('parent-guidance');
    await page.getByRole('button', { name: 'Back to tonight', exact: true }).click();
  }
  await page.getByLabel(/^What stayed with you today/).fill('Pip is upset about something and slammed the door after school.');
  await page.getByRole('button', { name: 'Create our story', exact: true }).waitFor(); await page.getByRole('button', { name: 'Browse teaching guides', exact: true }).click(); await page.getByRole('button', { name: 'Check this topic', exact: true }).click();
  await page.getByRole('heading', { name: 'Tonight’s move', exact: true }).waitFor();
  if (args.includes('--all-screens')) await both('move-choice');
  await page.getByRole('button', { name: 'None of these fits. Check a new topic', exact: true }).click();
  const startingCatalog = await page.request.get(base + '/api/library').then(response => response.json());
  assert.equal(startingCatalog.entries.filter(entry => entry.kind === 'original').length, 14);
  assert.ok(startingCatalog.entries.every(entry => !JSON.stringify(entry).includes(username)));
  await page.getByLabel('Find a teaching guide', { exact: true }).fill('No matching fixture guide');
  await page.getByText('No guides match this search. Clear the search to see them all.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Clear guide search', exact: true }).click();
  assert.equal(await page.getByLabel('Our moment', { exact: true }).inputValue(), 'Pip is upset about something and slammed the door after school.');
  const chosenEntry = startingCatalog.entries.find(entry => entry.id === sample.text.moveId);
  assert.ok(chosenEntry);
  const originalMoment = await page.getByLabel('Our moment', { exact: true }).inputValue();
  const oldFit = await page.request.post(base + '/api/pick', { data: { childId: 'primary', tonight: originalMoment, requestedMoveId: chosenEntry.id } }).then(response => response.json()); assert.equal(oldFit.status, 'eligible'); assert.equal(oldFit.suggestions[0].id, chosenEntry.id);
  await page.getByRole('button', { name: chosenEntry.title, exact: true }).click();
  let releaseOldFit, announceOldFit;
  const oldFitGate = new Promise(resolve => { releaseOldFit = resolve; }), oldFitRequested = new Promise(resolve => { announceOldFit = resolve; });
  const deferredFit = async route => { announceOldFit(); await oldFitGate; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(oldFit) }); };
  await page.route('**/api/pick', deferredFit);
  await page.locator('.guide-row').filter({ has: page.getByRole('button', { name: chosenEntry.title, exact: true }) }).getByRole('button', { name: 'Use this guide for our story', exact: true }).click(); await oldFitRequested;
  await page.getByLabel('Our moment', { exact: true }).fill('A different made-up moment while the old reply is delayed.');
  const oldFitReturned = page.waitForResponse(response => response.url().endsWith('/api/pick')); releaseOldFit(); await oldFitReturned;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(new URL(page.url()).hash, '#library'); assert.equal(await page.getByRole('heading', { name: 'Tonight’s move', exact: true }).count(), 0);
  await page.unroute('**/api/pick', deferredFit); await page.getByLabel('Our moment', { exact: true }).fill(originalMoment);
  checks.push('A selected guide fit reply for an earlier note cannot navigate or reinstate a move after the current private moment is edited.');
  await page.getByRole('button', { name: 'Check this topic', exact: true }).click();
  await page.getByRole('heading', { name: 'Tonight’s move', exact: true }).waitFor(); assert.equal(libraryCalls.length, 0);
  await page.getByRole('button', { name: 'None of these fits. Check a new topic', exact: true }).click();
  await page.getByRole('button', { name: 'Look beyond these guides', exact: true }).click();
  await page.getByRole('heading', { name: 'A general guide is ready', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Feelings after setbacks', exact: true }).click();
  const sharedGuide = page.locator('.guide-row').filter({ has: page.getByRole('button', { name: 'Feelings after setbacks', exact: true }) });
  await sharedGuide.getByRole('heading', { name: 'The prepared practice', exact: true }).waitFor();
  await shot('shared-library-offline-fixture-light-phone'); await theme(true); await shot('shared-library-offline-fixture-dark-phone'); await theme(false);
  const general = await page.request.get(base + '/api/library').then(response => response.json());
  assert.equal(general.documents.length, startingCatalog.documents.length + 1);
  for (const document of startingCatalog.documents) assert.equal(general.documents.find(item => item.id === document.id)?.sha256, document.sha256);
  const addedDocuments = general.documents.filter(document => !startingCatalog.documents.some(item => item.id === document.id));
  assert.equal(addedDocuments.length, 1); assert.equal(addedDocuments[0].review.ownerApproved, false);
  assert.equal(libraryCalls.length, 5);
  checks.push('all fourteen original guides are browsable without private words; search/current moment are separate. Initial prepared fit is free, then the explicit Look beyond escape buys only the five injected research stages. Shared guides show exact practice and separate source/check detail.');
  await page.getByRole('button', { name: 'Back to tonight', exact: true }).click();
  await page.getByRole('button', { name: 'Create our story', exact: true }).waitFor(); await page.getByRole('button', { name: 'Browse teaching guides', exact: true }).click(); await page.getByRole('button', { name: 'Check this topic', exact: true }).click();
  await page.getByRole('heading', { name: 'Tonight’s move', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Make our evening story and poster', exact: true }).click();
  await page.getByRole('heading', { name: sample.text.chapterTitle, exact: true }).waitFor(); await page.getByRole('button', { name: 'Sit together and read our story', exact: true }).waitFor();
  if (args.includes('--all-screens')) {
    await both('own-result');
    const ownResult = await page.request.get(base + '/api/session').then(response => response.json()); const completed = ownResult.jobs.find(job => job.status === 'complete');
    const newerId = randomUUID(), pausedId = randomUUID();
    const catalogSnapshot = { ...ownResult, jobs: [{ ...completed, id: newerId, chapterNumber: completed.chapterNumber + 1, result: { ...completed.result, chapterTitle: 'Newer fixture kit' } }, { ...completed, id: pausedId, status: 'paused', result: undefined, canSetAside: false, chapterNumber: completed.chapterNumber + 2 }, completed] };
    const catalogSession = route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(catalogSnapshot) });
    const newerCover = route => route.fulfill({ contentType: 'image/png', body: png });
    await page.route('**/api/session', catalogSession); await page.route('**/api/jobs/' + newerId + '/files/poster.png', newerCover);
    await page.getByRole('button', { name: 'Our stories', exact: true }).first().click(); await page.waitForFunction(() => document.querySelectorAll('.kit-card').length === 3); await page.reload(); await page.waitForFunction(() => document.querySelectorAll('.kit-card').length === 3);
    assert.equal(await page.locator('.story-search').getAttribute('open'), null);
    await page.locator('.story-search > summary').click();
    await page.getByLabel('Find a story', { exact: true }).fill('Newer fixture'); assert.equal(await page.locator('.kit-card').count(), 1);
    await page.getByLabel('Find a story', { exact: true }).fill('No such saved title'); await page.getByText('No saved stories match this search and filter.', { exact: true }).waitFor();
    await page.locator('.story-search > summary').click(); assert.equal(await page.getByRole('button', { name: 'Clear search and filters', exact: true }).isVisible(), true);
    await both('shelf-no-matches'); await page.getByRole('button', { name: 'Clear search and filters', exact: true }).click(); await page.locator('.story-search > summary').click();
    await page.getByRole('combobox', { name: 'Show stories', exact: true }).click(); await page.getByRole('option', { name: 'Saved work', exact: true }).click(); assert.equal(await page.locator('.kit-card').count(), 1); await both('shelf-filtered');
    await page.getByRole('button', { name: 'Clear search and filters', exact: true }).click();
    await page.locator('.kit-card').filter({ has: page.getByRole('heading', { name: completed.result.chapterTitle, exact: true }) }).getByRole('button', { name: 'Read ' + completed.result.chapterTitle, exact: true }).click();
    await page.waitForFunction(id => location.hash === '#story/' + id && document.querySelector('[data-reader-ready=true]'), completed.id);
    assert.equal(await page.getByRole('button', { name: 'Sit together and read our story', exact: true }).count(), 0);
    const expectedRhyme = completed.result.posterSections?.find(section => section.id === 'tagline' && typeof section.text === 'string' && section.text.trim())?.text;
    if (expectedRhyme) assert.equal(await page.locator('.shared-rhyme-line').textContent(), expectedRhyme); else assert.equal(await page.locator('.shared-rhyme-line').count(), 0);
    await page.getByRole('button', { name: 'Story Poster', exact: true }).click();
    assert.equal(await page.locator('.return-card h2').textContent(), completed.result.chapterTitle);
    await page.getByRole('button', { name: 'Or open the saved sample', exact: true }).click(); await page.getByText('Made with Story Poster. Pip and Dad are a made-up family.', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Story Poster', exact: true }).click(); assert.equal(await page.locator('.return-card h2').textContent(), completed.result.chapterTitle);
    await page.unroute('**/api/session', catalogSession); await page.unroute('**/api/jobs/' + newerId + '/files/poster.png', newerCover);
    checks.push('Our stories opens completed cards directly in the owned reader, without a result detour, and shows only the exact saved rhyme when available. Optional search stays near the top and Clear remains visible when its disclosure is closed. Title/status retrieval distinguishes no matches from an empty shelf; Clear restores the owned list. Opening an older kit, then a sample, retains that actual private return rather than the newest-created fixture. No search enters a URL or calls a provider.');
    await page.getByRole('button', { name: 'Our stories', exact: true }).first().click(); await page.getByRole('heading', { name: 'Our stories', exact: true }).waitFor();
    await page.reload(); await page.getByRole('heading', { name: 'Our stories', exact: true }).waitFor(); await both('shelf-ready');
    await page.getByRole('button', { name: 'Read it again', exact: true }).click(); await page.waitForFunction(() => location.hash.startsWith('#story/') && document.querySelector('[data-reader-ready=true]'));
    await page.reload(); await page.getByRole('heading', { name: completed.result.chapterTitle, exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-reader-ready=true]'));
    const actual = await page.locator('.story-prose p').allTextContents(); assert.equal(actual.join(' ').replace(/\s+/g, ' ').trim(), completed.result.storyPages.join(' ').replace(/\s+/g, ' ').trim());
    assert.equal(await page.locator('.story-scenes img').count(), 4);
    await page.locator('.reading-options > summary').click(); await page.getByRole('button', { name: 'Larger text', exact: true }).click();
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.story-prose p')).fontSize === '24px');
    // Let the reader restore its anchor after the type-size render before
    // this test acts as a separate user scroll.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    // Short new dialogue can put two paragraph starts within the reader's
    // visible-anchor band. The final paragraph has the ending section after it.
    const readerAnchor = await page.locator('.story-prose p').last().getAttribute('id');
    assert.match(readerAnchor, /^story-paragraph-2-\d+$/);
    await page.locator('#' + readerAnchor).evaluate(node => node.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await page.waitForFunction(({ key, id, anchor }) => JSON.parse(sessionStorage.getItem(key))?.places?.[id] === anchor, { key: 'sp-view-v2-' + ownResult.accountId + ':primary', id: completed.id, anchor: readerAnchor });
    await page.goBack(); await page.getByRole('heading', { name: 'Our stories', exact: true }).waitFor();
    await page.goForward(); await page.getByRole('heading', { name: completed.result.chapterTitle, exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-reader-ready=true]'));
    assert.equal(await page.locator('.reading-options button').filter({ hasText: /^Larger text$/ }).getAttribute('aria-pressed'), 'true');
    assert.ok(Math.abs(await page.locator('#' + readerAnchor).evaluate(node => node.getBoundingClientRect().top) - 24) < 3);
    await page.reload(); await page.waitForFunction(() => document.querySelector('[data-reader-ready=true]')); assert.ok(Math.abs(await page.locator('#' + readerAnchor).evaluate(node => node.getBoundingClientRect().top) - 24) < 3);
    await both('reader-saved-place-larger');
    checks.push('Larger reader text, all exact prose and four ordered full scenes persist. A named paragraph place survives Back/Forward and reload within the owned browser tab, without claiming reading or learning.');
    await page.getByRole('button', { name: 'Back to our poster', exact: true }).click();
    let releaseBack; const heldBack = new Promise(resolve => { releaseBack = resolve; }); let heldRead;
    const slowBack = async route => { heldRead = route; await heldBack; await route.continue(); };
    await page.route('**/api/session', slowBack); await page.goBack();
    for (let wait = 0; !heldRead && wait < 100; wait++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(heldRead);
    await page.getByRole('button', { name: 'Story Poster', exact: true }).click(); const backResponse = page.waitForResponse(response => response.url().endsWith('/api/session')); releaseBack(); await backResponse;
    await page.getByRole('heading', { name: 'One moment, together.', exact: true }).waitFor(); assert.equal(new URL(page.url()).hash, '#tonight'); await page.unroute('**/api/session', slowBack);
    await page.locator('.return-card').getByRole('button', { name: 'Read it again', exact: true }).click();
    await page.waitForFunction(id => location.hash === '#story/' + id && document.querySelector('[data-reader-ready=true]'), completed.id);
    await page.getByRole('button', { name: 'Back to our poster', exact: true }).click();
    checks.push('Stable shelf/family/result/reader reload and browser Back/Forward restore owned current-child work; all saved story words remain in order. Optional interests stay visible and allow an empty value; the parent can save only what the story needs.');
    checks.push('A deliberately delayed Back session response cannot repaint the prior reader after explicit navigation to Tonight.');
  }
  await page.getByRole('button', { name: 'Tomorrow: did you try it?', exact: true }).click();
  if (args.includes('--all-screens')) await both('feedback');
  await page.getByRole('radio', { name: 'Yes, we tried it', exact: true }).check();
  await page.getByRole('radio', { name: 'This one is not for us', exact: true }).check();
  await page.getByRole('radio', { name: 'Keep it private, or not tonight', exact: true }).check();
  await page.getByRole('button', { name: 'Save and start tonight', exact: true }).click();
  await page.getByRole('button', { name: 'Create our story', exact: true }).waitFor(); await page.getByRole('button', { name: 'Browse teaching guides', exact: true }).click(); await page.getByRole('button', { name: 'Check this topic', exact: true }).click();
  await page.getByRole('heading', { name: 'Tonight’s move', exact: true }).waitFor();
  const after = await page.request.post(base + '/api/pick', { data: { tonight: 'Pip is upset about something and slammed the door after school.', allowRepeat: true, childId: 'primary' } }).then(response => response.json());
  assert.ok(!after.suggestions.some(move => move.id === 'name-it-exactly'));
  checks.push('saved feedback changes the next fitting choices; rejected move is not revived');
  if (args.includes('--all-screens')) {
    await page.getByRole('button', { name: 'Tonight', exact: true }).click();
    const firstDraft = await page.getByLabel(/^What stayed with you today/).inputValue();
    await both('tonight-return');
    await page.getByRole('button', { name: 'Family', exact: true }).click();
    const notes = page.getByLabel('Family notes for future stories'); await notes.fill('Fictional note saved during the browser check.'); await page.getByRole('button', { name: 'Save notes', exact: true }).click(); await page.getByRole('status').filter({ hasText: 'Notes saved.' }).waitFor();
    await page.reload(); await page.getByRole('heading', { name: 'Your family’s story record', exact: true }).waitFor(); assert.equal(await notes.inputValue(), 'Fictional note saved during the browser check.');
    await page.getByRole('button', { name: 'Add another child', exact: true }).click();
    await page.getByLabel(/^Made-up hero nickname/).fill('Milo'); await both('add-child'); await page.getByRole('button', { name: 'Save child', exact: true }).click();
    await page.getByRole('heading', { name: 'One moment, together.', exact: true }).waitFor();
    assert.equal(await page.getByLabel(/^What stayed with you today/).inputValue(), '');
    assert.equal(await page.getByRole('img', { name: 'Chosen story drawing of ' + nickname, exact: true }).count(), 0);
    await page.getByLabel(/^What stayed with you today/).fill('A made-up second child forgot to bring a book.'); await both('sibling-tonight');
    await page.reload(); await page.getByRole('heading', { name: 'One moment, together.', exact: true }).waitFor(); assert.equal(await page.getByLabel(/^What stayed with you today/).inputValue(), 'A made-up second child forgot to bring a book.');
    await page.getByRole('combobox', { name: 'Tonight is for', exact: true }).click(); await page.getByRole('option', { name: nickname + ' · age 10', exact: true }).click();
    await page.getByRole('combobox', { name: 'Tonight is for', exact: true }).filter({ hasText: nickname + ' · age 10' }).waitFor(); assert.equal(await page.getByLabel(/^What stayed with you today/).inputValue(), firstDraft);
    const current = await page.request.get(base + '/api/session').then(response => response.json());
    const completed = current.jobs.find(job => job.status === 'complete');
    const libraryDone = current.libraryJobs[0];
    let injectedSession = null, injectedKit = null, injectedLibrary = null;
    const sessionRoute = route => injectedSession ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(injectedSession) }) : route.continue();
    const kitRoute = route => route.request().method() === 'GET' && injectedKit ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(injectedKit) }) : route.continue();
    const libraryRoute = route => route.request().method() === 'GET' && injectedLibrary ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(injectedLibrary) }) : route.continue();
    await page.route('**/api/session', sessionRoute); await page.route('**/api/jobs/' + completed.id, kitRoute); await page.route('**/api/library/jobs/' + libraryDone.id, libraryRoute);
    for (const state of [{ name: 'making-writing', status: 'running', stage: 'writing', canResume: false }, { name: 'making-drawing', status: 'running', stage: 'drawing', canResume: false }, { name: 'making-checking', status: 'running', stage: 'checking', canResume: false }, { name: 'paused-work', status: 'paused', stage: 'drawing', canResume: true }, { name: 'terminal-work', status: 'failed', stage: 'checking', canResume: false }, { name: 'kept-aside', status: 'set-aside', stage: 'checking', canResume: false }]) {
      injectedKit = { ...completed, result: undefined, ...state, progress: { state: state.status === 'running' ? 'working' : state.status, active: state.status === 'running', message: state.status === 'running' ? ({ writing: 'We are writing the story.', drawing: 'We are drawing the story pictures.', checking: 'We are checking the story.' })[state.stage] : 'Your finished steps are saved.' }, canSetAside: ['paused', 'failed'].includes(state.status), canRepairLayout: false, message: state.status === 'running' ? '' : 'Your finished steps are saved.' };
      injectedSession = { ...current, jobs: [injectedKit] };
      await page.goto(base + '#wait/' + completed.id); await page.getByRole('heading', { name: state.status === 'running' ? 'Making tonight’s kit' : 'Your work is saved', exact: true }).waitFor(); await page.getByText(injectedKit.progress.message, { exact: true }).waitFor(); assert.equal(await page.locator('.saved-job-progress').getAttribute('data-active'), String(injectedKit.progress.active)); await both('fixture-' + state.name);
      assert.equal(await page.getByRole('button', { name: 'Resume saved work', exact: true }).count(), state.canResume ? 1 : 0);
    }
    injectedKit = null;
    for (const state of [{ name: 'running', status: 'running', canResume: false }, { name: 'review', status: 'review', canResume: false }, { name: 'failed', status: 'failed', canResume: true }, { name: 'paused', status: 'paused', canResume: true }]) {
      injectedLibrary = { ...libraryDone, ...state, message: state.status === 'review' ? 'This topic needs a human review before a new teaching guide can be made.' : 'Your topic check is saved.' };
      injectedSession = { ...current, libraryJobs: [injectedLibrary] };
      await page.goto(base + '#library'); await page.reload(); await page.getByRole('heading', { name: 'Browse teaching guides', exact: true }).waitFor();
      await page.getByRole('heading', { name: state.status === 'running' ? 'Looking for a useful guide' : 'Your topic check is saved', exact: true }).waitFor();
      await page.getByText(injectedLibrary.message, { exact: true }).waitFor();
      assert.equal(await page.getByRole('progressbar', { name: 'Checking this teaching topic', exact: true }).count(), state.status === 'running' ? 1 : 0);
      assert.equal(await page.getByRole('button', { name: 'Resume the saved check', exact: true }).count(), state.canResume ? 1 : 0);
      await both('fixture-library-' + state.name);
      assert.equal(await page.locator('.content-panel').getByRole('button', { name: 'Use this guide for our story', exact: true }).count(), 0);
    }
    injectedLibrary = null; injectedSession = null;
    await page.unroute('**/api/session', sessionRoute); await page.unroute('**/api/jobs/' + completed.id, kitRoute); await page.unroute('**/api/library/jobs/' + libraryDone.id, libraryRoute);
    const otherContext = await browser.newContext();
    const otherSignup = await otherContext.request.post(base + '/api/signup', { data: { username: 'other-' + randomUUID().slice(0, 8), password: randomUUID(), family: { real: false, nickname: 'Nico', age: 10, pronouns: 'they/them', loves: ['books', 'space', 'games'], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] } } }); assert.equal(otherSignup.status(), 200);
    assert.equal((await otherContext.request.get(base + privateURL)).status(), 404); assert.equal((await otherContext.request.get(base + '/api/jobs/' + completed.id + '/files/poster.png')).status(), 404); await otherContext.close();
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto(base + '#family'); await page.getByRole('heading', { name: 'Your family’s story record', exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.hasAttribute('data-heading')); await page.keyboard.press('Tab');
    const keyboard = await page.evaluate(() => ({ focused: document.activeElement?.textContent, outline: getComputedStyle(document.activeElement).outlineStyle, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, activeAnimations: document.getAnimations().filter(animation => animation.playState === 'running').length }));
    assert.equal(keyboard.reduced, true); assert.equal(keyboard.activeAnimations, 0); assert.notEqual(keyboard.outline, 'none'); access.push({ keyboard });
    await page.getByRole('button', { name: 'Delete this saved family', exact: true }).focus(); await page.keyboard.press('Enter'); await page.getByRole('dialog').waitFor(); await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' }); assert.equal(await page.getByRole('button', { name: 'Delete this saved family', exact: true }).evaluate(node => node === document.activeElement), true);
    await page.setViewportSize({ width: 320, height: 900 });
    await page.addStyleTag({ content: 'html{font-size:200%!important}p{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important;margin-bottom:2em!important}' }); await shot('family-320-text-enlarged-reduced-motion');
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await page.getByRole('heading', { name: 'Your family’s story record', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByLabel(/^Email or existing family login/).fill(username); await page.getByLabel(/^Password/).fill(password); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.getByRole('heading', { name: 'One moment, together.', exact: true }).waitFor(); assert.equal(await page.getByLabel(/^What stayed with you today/).inputValue(), firstDraft);
    checks.push('Actual family notes and sibling drafts persist without showing the other child’s portrait. A second account cannot open private portraits or kit covers. Clearly injected running/paused/terminal/library states respect server booleans. Keyboard dialogs restore focus; reduced motion has no active animation; enlarged and spaced text reflows at 320px.');
  }
  if (args.includes('--all-screens') || args.includes('--return-state-only')) {
    await page.goto(base + '#people'); await page.reload(); await page.getByRole('heading', { name: nickname, exact: true }).waitFor();
    const originalPeople = await page.request.get(base + '/api/portraits?childId=primary').then(response => response.json());
    const oldSelected = originalPeople.people[0].selectedUrl;
    let replacement = structuredClone(originalPeople);
    replacement.people[0].job = { id: randomUUID(), inputMode: 'description', description: 'Short curly hair, brown eyes and a round face.', status: 'needs-input', canRestart: false, message: 'Saved replacement choices need your appearance input.' };
    replacement.people[0].candidates = replacement.people[0].candidates.map(candidate => ({ ...candidate, selected: false }));
    const replacementRoute = route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(replacement) });
    await page.route('**/api/portraits?childId=*', replacementRoute);
    for (const state of ['needs-input', 'running', 'complete']) {
      replacement.people[0].job.status = state;
      await page.reload(); await page.getByRole('heading', { name: nickname, exact: true }).waitFor();
      assert.equal(await page.getByRole('img', { name: 'Chosen story drawing of ' + nickname, exact: true }).getAttribute('src'), oldSelected);
      await page.getByText('2 of 2 people have a chosen drawing in this look.', { exact: true }).waitFor();
      await page.getByText(new RegExp(nickname + ' has (?:new drawings being made|new choices waiting|saved replacement work)')).waitFor();
      assert.equal(await page.getByRole('button', { name: 'View drawing 1 for ' + nickname, exact: true }).isVisible(), true);
      if (state === 'running') assert.equal(await page.getByRole('progressbar', { name: 'Drawing choices for ' + nickname, exact: true }).isVisible(), true);
      else assert.equal(await page.getByLabel('Appearance for ' + nickname).isVisible(), true);
      await both('replacement-' + state);
    }
    await page.unroute('**/api/portraits?childId=*', replacementRoute);
    await page.reload(); await page.getByRole('heading', { name: nickname, exact: true }).waitFor();
    const ownerCookies = await context.cookies();
    const otherContext = await browser.newContext();
    const otherName = 'return-' + randomUUID().slice(0, 8);
    const otherSignup = await otherContext.request.post(base + '/api/signup', { data: { username: otherName, password: randomUUID(), family: { real: false, nickname: 'Nico', age: 10, pronouns: 'they/them', loves: ['books', 'space', 'games'], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] } } }); assert.equal(otherSignup.status(), 200);
    const otherCookies = await otherContext.cookies();
    const accountBack = async (cookies, expected, routeName) => {
      await context.addCookies(cookies);
      const response = page.waitForResponse(reply => reply.url().endsWith('/api/session') && reply.request().method() === 'GET');
      await page.evaluate(name => { history.pushState(null, '', '#' + name); history.back(); }, routeName);
      assert.equal((await (await response).json()).username, expected);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    await page.getByRole('button', { name: 'Family', exact: true }).click(); await page.getByRole('heading', { name: nickname + ', 10', exact: true }).waitFor();
    await page.getByLabel('Family notes for future stories').fill('This old family note must never be saved into a different login.');
    await context.addCookies(otherCookies);
    await page.getByRole('button', { name: 'Save notes', exact: true }).click(); await page.getByRole('heading', { name: 'Nico, 10', exact: true }).waitFor();
    assert.equal((await otherContext.request.get(base + '/api/session').then(response => response.json())).record.familyContext, '');
    assert.equal(await page.getByLabel('Family notes for future stories').inputValue(), ''); await both('cookie-only-notes-blocked');
    await accountBack(ownerCookies, username, 'family'); await page.getByRole('heading', { name: nickname + ', 10', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Delete this saved family', exact: true }).click(); await page.getByRole('dialog').waitFor();
    await context.addCookies(otherCookies); await page.getByRole('button', { name: 'Delete family', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await page.getByRole('heading', { name: 'Nico, 10', exact: true }).waitFor();
    const notDeleted = await otherContext.request.get(base + '/api/session').then(response => response.json()); assert.equal(notDeleted.username, otherName); assert.equal(notDeleted.record.hero.nickname, 'Nico'); await both('cookie-only-delete-blocked');
    await accountBack(ownerCookies, username, 'family'); await page.getByRole('button', { name: 'Delete this saved family', exact: true }).click(); await page.getByRole('dialog').waitFor(); await accountBack(otherCookies, otherName, 'family'); await page.getByRole('dialog').waitFor({ state: 'hidden' }); await page.getByRole('heading', { name: 'Nico, 10', exact: true }).waitFor();
    await accountBack(ownerCookies, username, 'family');
    await page.getByRole('button', { name: 'Our stories', exact: true }).click(); await page.getByRole('button', { name: 'Read it again', exact: true }).click(); await page.waitForFunction(() => location.hash.startsWith('#story/') && document.querySelector('[data-reader-ready=true]'));
    const ownedStoryHash = new URL(page.url()).hash, publicSample = await page.request.get(base + '/api/sample').then(response => response.json());
    let releaseSample, announceSample;
    const sampleGate = new Promise(resolve => { releaseSample = resolve; }), sampleRequested = new Promise(resolve => { announceSample = resolve; });
    const delayedSample = async route => { announceSample(); await sampleGate; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(publicSample) }); };
    await page.route('**/api/sample', delayedSample);
    await page.evaluate(hash => { history.replaceState(null, '', '#story/sample'); history.pushState(null, '', hash); }, ownedStoryHash);
    await context.addCookies(otherCookies); await page.evaluate(() => history.back()); await sampleRequested;
    await page.getByRole('heading', { name: 'One moment, together.', exact: true }).waitFor(); assert.equal(await page.locator('.story-prose').count(), 0); assert.equal(await page.locator('img[src^="/api/jobs/"]').count(), 0); assert.equal(await page.getByRole('dialog').count(), 0); await both('account-change-awaiting-sample');
    const sampleReturned = page.waitForResponse(response => new URL(response.url()).pathname === '/api/sample'); releaseSample(); await sampleReturned; await page.getByText('Made with Story Poster. Pip and Dad are a made-up family.', { exact: true }).first().waitFor(); await page.unroute('**/api/sample', delayedSample);
    await context.addCookies(ownerCookies); await page.goto(base + '#people'); await page.reload(); await page.getByRole('heading', { name: nickname, exact: true }).waitFor();
    let releasePortrait, announcePortrait;
    const portraitGate = new Promise(resolve => { releasePortrait = resolve; }), portraitRequested = new Promise(resolve => { announcePortrait = resolve; });
    let holdPortrait = true;
    const delayedPortrait = async route => {
      if (!holdPortrait) return route.continue();
      announcePortrait(); await portraitGate; return route.fulfill({ contentType: 'application/json', body: JSON.stringify(originalPeople) });
    };
    await page.route('**/api/portraits?childId=*', delayedPortrait);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await portraitRequested;
    holdPortrait = false; await accountBack(otherCookies, otherName, 'people'); await page.getByRole('heading', { name: 'Nico', exact: true }).waitFor();
    const portraitReturned = page.waitForResponse(response => response.url().includes('/api/portraits?'));
    releasePortrait(); await portraitReturned; await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByRole('img', { name: 'Chosen story drawing of ' + nickname, exact: true }).count(), 0); assert.equal(await page.getByRole('heading', { name: nickname, exact: true }).count(), 0);
    await both('account-return-people'); await page.unroute('**/api/portraits?childId=*', delayedPortrait);
    await accountBack(ownerCookies, username, 'people'); await page.getByRole('heading', { name: nickname, exact: true }).waitFor();
    for (const requestKind of ['topic', 'use']) {
      await page.goto(base + '#library'); await page.reload(); await page.getByRole('heading', { name: 'A general guide is ready', exact: true }).waitFor();
      let releaseReply, announceReply;
      const gate = new Promise(resolve => { releaseReply = resolve; }), requested = new Promise(resolve => { announceReply = resolve; });
      const endpoint = requestKind === 'topic' ? '**/api/library/jobs' : '**/api/pick';
      const delayedReply = async route => { announceReply(); await gate; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'parentResponse', lines: ['Old private reply must not appear.'] }) }); };
      await page.route(endpoint, delayedReply);
      await (requestKind === 'topic' ? page.getByRole('button', { name: 'Check this topic', exact: true }) : page.locator('.content-panel').filter({ has: page.getByRole('heading', { name: 'A general guide is ready', exact: true }) }).getByRole('button', { name: 'Use this guide for our story', exact: true })).click(); await requested;
      await accountBack(otherCookies, otherName, 'library');
      assert.equal(await page.getByRole('heading', { name: 'A general guide is ready', exact: true }).count(), 0);
      const replyReturned = page.waitForResponse(response => new URL(response.url()).pathname === (requestKind === 'topic' ? '/api/library/jobs' : '/api/pick') && response.request().method() === 'POST');
      releaseReply(); await replyReturned; await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.getByRole('heading', { name: 'Browse teaching guides', exact: true }).waitFor(); assert.equal(new URL(page.url()).hash, '#library'); assert.equal(await page.getByText('Old private reply must not appear.', { exact: true }).count(), 0);
      await both('account-return-library-' + requestKind); await page.unroute(endpoint, delayedReply);
      await accountBack(ownerCookies, username, 'library'); await page.getByRole('heading', { name: 'A general guide is ready', exact: true }).waitFor();
    }
    await accountBack(otherCookies, otherName, 'library');
    const oldOther = await page.request.get(base + '/api/session').then(response => response.json());
    await page.getByRole('button', { name: 'Story Poster', exact: true }).click();
    const oldOtherDraft = 'Private draft from the first made-up Nico account.';
    await page.getByLabel(/^What stayed with you today/).fill(oldOtherDraft);
    await page.evaluate(name => { sessionStorage.setItem('sp-draft-' + name + '-primary', 'Legacy username-only draft must stay private.'); sessionStorage.setItem('sp-view-' + name + '-primary', JSON.stringify({ jobId: 'legacy-unbound-id' })); }, otherName);
    assert.equal((await otherContext.request.post(base + '/api/portraits/child', { data: { childId: 'primary', inputMode: 'description', description: 'Short curly dark hair, brown eyes and glasses.' } })).status(), 202);
    let otherPeople;
    for (let poll = 0; poll < 100; poll++) {
      otherPeople = await otherContext.request.get(base + '/api/portraits?childId=primary').then(response => response.json());
      if (otherPeople.people[0].job?.status === 'complete') break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(otherPeople.people[0].job.status, 'complete');
    assert.equal((await otherContext.request.post(base + '/api/portraits/child/select', { data: { childId: 'primary', jobId: otherPeople.people[0].job.id, candidateId: otherPeople.people[0].candidates[0].id } })).status(), 200);
    let otherResearch = await otherContext.request.post(base + '/api/library/jobs', { data: { childId: 'primary', tonight: 'A setback felt heavy after a quiet afternoon.' } }).then(response => response.json());
    for (let poll = 0; poll < 100 && otherResearch.status === 'running'; poll++) { await new Promise(resolve => setTimeout(resolve, 10)); otherResearch = await otherContext.request.get(base + '/api/library/jobs/' + otherResearch.id).then(response => response.json()); }
    assert.equal(otherResearch.status, 'complete');
    await page.goto(base + '#people'); await page.reload(); await page.getByRole('img', { name: 'Chosen story drawing of Nico', exact: true }).waitFor();
    await page.goto(base + '#library'); await page.reload(); await page.getByRole('heading', { name: 'A general guide is ready', exact: true }).waitFor();
    assert.equal((await otherContext.request.delete(base + '/api/family', { data: {} })).status(), 200);
    const recreatedResponse = await otherContext.request.post(base + '/api/signup', { data: { username: otherName, password: randomUUID(), family: { real: false, nickname: 'Ravi', age: 10, pronouns: 'they/them', loves: ['books', 'space', 'games'], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] } } });
    assert.equal(recreatedResponse.status(), 200); const recreated = await recreatedResponse.json(); assert.notEqual(recreated.accountId, oldOther.accountId);
    await accountBack(await otherContext.cookies(), otherName, 'library');
    assert.equal(await page.getByRole('heading', { name: 'A general guide is ready', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Story Poster', exact: true }).click(); assert.equal(await page.getByLabel(/^What stayed with you today/).inputValue(), '');
    const retained = await page.evaluate(({ name, id }) => ({ legacy: sessionStorage.getItem('sp-draft-' + name + '-primary'), priorBound: sessionStorage.getItem('sp-draft-v2-' + id + ':primary') }), { name: otherName, id: oldOther.accountId });
    assert.equal(retained.legacy, 'Legacy username-only draft must stay private.'); assert.equal(retained.priorBound, oldOtherDraft);
    await page.getByRole('button', { name: 'Family', exact: true }).click(); await page.getByRole('heading', { name: 'Ravi, 10', exact: true }).waitFor(); assert.equal(await page.getByRole('img', { name: 'Chosen story drawing of Nico', exact: true }).count(), 0); await both('account-recreated');
    await accountBack(ownerCookies, username, 'family'); await page.getByRole('heading', { name: nickname + ', 10', exact: true }).waitFor();
    await otherContext.close();
    checks.push('Targeted return-state fixtures: a replacement job remains visible after reload while its old selected drawing stays saved. Cookie-only swaps cannot save old notes into or delete another account; the UI discovers the current account without replaying a write. Back accepts a different account with the same primary child id; deferred old portrait, topic and use replies cannot repaint, restore an old job or navigate the new account. Actual delete/recreate of the same username changes accountId and inherits no prior bound/legacy draft, portrait or private topic job. Old username-only storage remains untouched. Cookie values are never recorded.');
  }
  const portraitRepliesBeforeProtection = portraitReplies, libraryRepliesBeforeProtection = libraryCalls.length;
  // The people remain fictional. Simulate an older profile's real marker only
  // to check the production under-13 guard; no model reply may be requested.
  const account = readJSON(join(out, 'private-test-state/accounts.json')).accounts.find(account => account.username === username);
  const protectedMemory = createMemory(join(out, 'private-test-state', account.id, 'family.json'));
  const protectedRecord = protectedMemory.exportRecord();
  protectedMemory.store({ ...protectedRecord, real: true, hero: { ...protectedRecord.hero, age: 12 }, dataPolicyConsent: recordDataConsent({ accepted: true, version: dataPolicyVersion }) });
  await page.reload(); await page.getByRole('button', { name: 'Family', exact: true }).click();
  await page.getByText(childDataNotice, { exact: false }).first().waitFor();
  await shot('under13-data-notice-light-phone'); await theme(true); await shot('under13-data-notice-dark-phone'); await theme(false);
  const protectedConfig = await page.request.get(base + '/api/config').then(response => response.json());
  assert.equal(protectedConfig.photoUploadsApproved, false); assert.equal(protectedConfig.realFamiliesApproved, false);
  const deniedPhoto = await page.request.post(base + '/api/portraits/child', { data: { childId: 'primary', photo: { mime: 'image/png', base64: 'AAAA' } } });
  assert.equal(deniedPhoto.status(), 403); assert.equal(portraitReplies, portraitRepliesBeforeProtection); assert.equal(libraryCalls.length, libraryRepliesBeforeProtection);
  checks.push('a fictional profile marked real and age 12 stays closed for new personal data even with parent consent, in both themes, with no extra provider replies');
  }
  }
  assert.deepEqual(errors, []);
  saveJSON(join(out, 'walk.json'), { fixture: true, providerCalls: 0, portraitReplyFixtures: portraitReplies, identityCheckReplyFixtures: identityCheckReplies, libraryReplyFixtures: libraryCalls.length, note: args.includes('--guest-first-only') || args.includes('--lesson-fit-only') ? 'Actual browser, HTTP, accounts and persistence with made-up moments. No portrait, library or kit generation was invoked. The existing fictional sample was loaded without changing it. This is interface proof, not new model work.' : 'Actual browser, HTTP, accounts and persistence. Portrait replies use clearly injected saved fictional references and public example pixels for the ink stage; this is not a likeness or ink-pipeline quality check. Library evidence/replies and kit generation are injected saved fixtures, not new research or model work.', checks, access, measurements, errors, screenshots });
  writeFileSync(join(root, 'context/continuation-walker-progress.md'), `# Local browser walk complete\n\nPASS with offline fictional fixtures. No live model, physical phone or deployment claim.\nOutput: ${out}\nScreenshots: ${screenshots.length}\nChecks: ${checks.length}\nReport: ${join(out, 'walk.json')}\n`);
  process.stdout.write(`Browser walk passed. Offline fixtures, no provider calls. ${out}\n`);
} catch (error) {
  writeFileSync(join(root, 'context/continuation-walker-progress.md'), `# Local browser walk stopped\n\nOutput: ${out}\nFailure: ${error.message}\nScreenshots captured before failure: ${screenshots.length}\nNo PASS recorded.\n`);
  if (activePage) {
    await activePage.screenshot({ path: join(out, 'failure.png'), fullPage: true });
    saveJSON(join(out, 'failure.json'), { error: error.message, text: await activePage.locator('body').innerText(), invalid: await activePage.locator('input:invalid').evaluateAll(inputs => inputs.map(input => ({ label: input.labels?.[0]?.textContent, value: input.type === 'password' ? '[hidden]' : input.value, message: input.validationMessage }))) });
  }
  throw error;
} finally { await browser.close(); await app.close(); }
