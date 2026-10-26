import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  REGION_IDS, EVIDENCE_LABELS, inspectBundle, percentRect, regionAtPoint, targetClipPath,
  planStorageKey, createInteractionState, verifyImageBytes, availableDemonstration, stopMedia,
  mountInteractivePoster,
} from '../web/interactive.js';
import { renderInteractiveHTML } from '../server/interactive-view.js';

const bytes = Buffer.from('Synthetic test image. Never approved artwork.');
const sha = createHash('sha256').update(bytes).digest('hex');
const names = ['ONE TINY TRY FOR TODAY', 'WHAT SCIENCE SAYS', 'WHERE IT CAME FROM', 'WHAT I CAN DO', 'HOW TO REMEMBER IT', 'Hero scene', 'Key word', 'Rhyme'];
function fixture() {
  const regions = Object.fromEntries(REGION_IDS.map((id, index) => [id, { x: 10 + (index % 2) * 300, y: 10 + Math.floor(index / 2) * 180, w: 280, h: 160 }]));
  const sections = Object.fromEntries(REGION_IDS.map((id, index) => [id, { title: names[index] }]));
  Object.assign(sections.tinyTry, { instruction: 'Hand in your work.', validation: 'It can feel hard to stop.', choices: ['Say it.', 'Try it.'], steps: ['Check once.', 'Hand it in.'], realWorldAction: 'Hand it to your teacher.' });
  Object.assign(sections.science, { claim: 'A related skill was studied.', tested: 'A broader skill.', participants: 'Children', ages: '8 to 12', result: 'A measured result.', limitation: 'This exact move was not tested.', evidenceLabel: 'ADJACENT', studyUrl: 'https://example.org/study' });
  Object.assign(sections.source, { people: 'A researcher', place: 'A university', year: 2020, studyTitle: 'A test fixture, not a real claim', searchPhrase: 'test fixture', studyUrl: 'https://example.org/study' });
  Object.assign(sections.plan, { backup: 'Ask a grown-up.' });
  Object.assign(sections.remember, { rhyme: 'Check and go.', bodyAction: 'Tap paper. Hands off.' });
  Object.assign(sections.hero, { moveSentence: 'The child hands in the work.', crop: regions.hero, jokeCrop: { x: regions.hero.x + 5, y: regions.hero.y + 5, w: 40, h: 40 }, jokeExplanation: 'The pencil is done too.' });
  Object.assign(sections.keyword, { word: 'DONE', meaning: 'You reached the agreed stopping point.', example: 'You checked once and handed it in.' });
  Object.assign(sections.tagline, { rhyme: 'Check and go.', explanation: 'The rhyme reminds you to hand it in.', recallEnabled: true });
  return {
    version: 'test-v1', profileId: 'profile-123', kitId: 'kit-456',
    image: { url: './poster.png', version: 'test-v1', sha256: sha, width: 612, height: 792 },
    pdf: { url: './poster.pdf', version: 'test-v1', sha256: 'b'.repeat(64) },
    map: { version: 'test-v1', templateVersion: 'template-test', imageSha256: sha, canvas: { width: 612, height: 792 }, regions },
    content: { version: 'test-v1', title: 'A test poster', approval: { approved: true }, printed: [{ id: 'title', text: 'A test poster' }, { id: 'plan', title: names[3], text: 'When I notice ______, I ______.' }], sections },
  };
}
function memoryStorage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('the runtime rejects mismatched versions, checksums, ratios, missing sections and unapproved content', () => {
  assert.equal(inspectBundle(fixture()).ready, true);
  for (const part of ['image', 'pdf', 'map', 'content']) {
    const bundle = fixture(); bundle[part].version = 'other'; assert.equal(inspectBundle(bundle).ready, false, part);
  }
  const variants = [
    b => { b.map.imageSha256 = 'a'.repeat(64); },
    b => { b.image.width = 999; },
    b => { b.map.regions.plan.x = 999; },
    b => { delete b.content.sections.source; },
    b => { b.content.approval.approved = false; },
  ];
  for (const alter of variants) { const bundle = fixture(); alter(bundle); assert.equal(inspectBundle(bundle).ready, false); }
});

test('all eight rectangle targets scale and keep boundary ownership at phone widths and both orientations', () => {
  const bundle = fixture();
  for (const width of [320, 360, 390, 430]) for (const landscape of [false, true]) {
    const displayedWidth = landscape ? width * 1.8 : width;
    const displayedHeight = displayedWidth * bundle.map.canvas.height / bundle.map.canvas.width;
    for (const id of REGION_IDS) {
      const r = bundle.map.regions[id], percentages = percentRect(r, bundle.map.canvas);
      const centerX = (parseFloat(percentages.left) + parseFloat(percentages.width) / 2) * displayedWidth / 100;
      const centerY = (parseFloat(percentages.top) + parseFloat(percentages.height) / 2) * displayedHeight / 100;
      assert.equal(regionAtPoint(bundle.map, centerX * 612 / displayedWidth, centerY * 792 / displayedHeight), id);
      assert.equal(regionAtPoint(bundle.map, r.x, r.y), id);
      assert.notEqual(regionAtPoint(bundle.map, r.x + r.w, r.y + r.h), id);
    }
  }
});

test('overlapping legacy badge and tagline belong only to their own button', () => {
  const map = fixture().map;
  map.regions.keyword = { x: map.regions.plan.x + 10, y: map.regions.plan.y + 10, w: 30, h: 30 };
  map.regions.tagline = { x: map.regions.hero.x + 10, y: map.regions.hero.y + 10, w: 30, h: 30 };
  assert.equal(regionAtPoint(map, map.regions.keyword.x + 1, map.regions.keyword.y + 1), 'keyword');
  assert.equal(regionAtPoint(map, map.regions.tagline.x + 1, map.regions.tagline.y + 1), 'tagline');
  assert.match(targetClipPath('plan', map), /^polygon\(evenodd,/);
  assert.match(targetClipPath('hero', map), /^polygon\(evenodd,/);
  assert.equal(targetClipPath('source', map), '');
});

test('changed image bytes, including a moved card, disable the old map', async () => {
  const response = value => ({ ok: true, arrayBuffer: async () => value });
  const valid = await verifyImageBytes(fixture(), { fetcher: async () => response(bytes), cryptoProvider: webcrypto });
  assert.equal(valid.ready, true);
  const shifted = Buffer.from('Synthetic image with a deliberately shifted card.');
  assert.equal((await verifyImageBytes(fixture(), { fetcher: async () => response(shifted), cryptoProvider: webcrypto })).ready, false);
  assert.equal((await verifyImageBytes(fixture(), { fetcher: async () => { throw new Error('offline'); }, cryptoProvider: webcrypto })).ready, false);
});

test('map or approved text changed without a new version fails its stored checksum', async () => {
  const bundle = fixture();
  for (const key of ['map', 'content']) bundle[key] = { ...bundle[key], url: `${key}.json`, sha256: createHash('sha256').update(`${JSON.stringify(bundle[key], null, 2)}\n`).digest('hex') };
  const options = { fetcher: async () => ({ ok: true, arrayBuffer: async () => bytes }), cryptoProvider: webcrypto };
  assert.equal((await verifyImageBytes(bundle, options)).ready, true);
  bundle.map.regions.plan.x += 1;
  assert.equal((await verifyImageBytes(bundle, options)).ready, false);
  bundle.map.regions.plan.x -= 1; bundle.content.sections.keyword.meaning = 'Changed';
  assert.equal((await verifyImageBytes(bundle, options)).ready, false);
});

test('plans begin blank, survive closing in memory, and save only when explicitly requested', () => {
  const bundle = fixture(), storage = memoryStorage(), state = createInteractionState(bundle, { storage });
  assert.deepEqual(state.draft, { notice: '', action: '' });
  state.open('plan'); state.update('I check again', 'hand in my work'); state.close();
  assert.equal(storage.values.size, 0);
  state.open('plan'); assert.equal(state.draft.notice, 'I check again');
  assert.equal(state.save(), true);
  assert.deepEqual(createInteractionState(bundle, { storage }).draft, state.draft);
  assert.match(planStorageKey(bundle), /profile-123:kit-456:test-v1$/);
  assert.deepEqual(createInteractionState({ ...bundle, version: 'test-v2' }, { storage }).draft, { notice: '', action: '' });
  state.edit(); state.update('A change', 'A new plan'); state.close();
  assert.equal(createInteractionState(bundle, { storage }).draft.notice, 'I check again');
  assert.equal(state.clear(), true); assert.equal(storage.values.size, 0);
});

test('storage failures tell the truth without losing a draft or claiming a saved copy was cleared', () => {
  const storage = { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } };
  const state = createInteractionState(fixture(), { storage });
  assert.match(state.storageMessage, /cannot be read/);
  state.update('My words', 'My action');
  assert.equal(state.save(), false); assert.equal(state.saved, false); assert.match(state.storageMessage, /could not save/);
  state.close(); assert.equal(state.draft.notice, 'My words');
  assert.equal(state.clear(), false); assert.match(state.storageMessage, /could not clear its saved copy/);
  assert.deepEqual(state.draft, { notice: '', action: '' });
});

test('one section at a time and plan/theme/open actions cannot change immutable bundle bytes', () => {
  const bundle = fixture(), before = JSON.stringify(bundle), state = createInteractionState(bundle, { storage: memoryStorage() });
  for (const id of REGION_IDS) { state.open(id); assert.equal(state.activeRegion, id); }
  state.update('Private', 'Private'); state.save(); state.close();
  renderInteractiveHTML(bundle);
  assert.equal(JSON.stringify(bundle), before);
  assert.equal(bundle.pdf.sha256, 'b'.repeat(64));
  assert.match(bundle.content.printed[1].text, /______.*______/);
});

test('HTML has eight real image buttons, a selectable transcript, every action, frozen print link and safe empty fields', () => {
  const html = renderInteractiveHTML(fixture());
  assert.equal((html.match(/class="image-target"/g) ?? []).length, 8);
  for (const id of REGION_IDS) assert.ok(html.includes(`data-region="${id}"`));
  assert.match(html, /data-region="keyword">Key word<\/button>/);
  assert.match(html, /data-region="tagline">Rhyme<\/button>/);
  assert.match(html, /id="print-poster" href="\.\/poster.pdf"/);
  assert.match(html, /When I notice ______, I ______\./);
  assert.match(html, /name="notice"[^>]*><\/textarea>/);
  assert.match(html, /name="action"[^>]*><\/textarea>/);
  assert.match(html, /aria-modal="true" aria-labelledby="sheet-title"/);
  assert.ok(!html.includes('user-scalable=no'));
  assert.ok(!html.includes('maximum-scale'));
  assert.ok(!html.includes('autoplay'));
  assert.ok(!html.includes('Play demonstration'));
  assert.ok(html.includes('This exact move was not tested.'));
  assert.ok(html.includes(EVIDENCE_LABELS.ADJACENT));
  assert.match(html, /target="_blank" rel="noopener noreferrer">Open study/);
  const escaped = fixture(); escaped.content.title = '</script><script>alert(1)</script>';
  assert.ok(!renderInteractiveHTML(escaped).includes('</script><script>alert(1)'));
});

test('only a checked demonstration has manual controls and the same action in text', () => {
  const bundle = fixture(), section = bundle.content.sections.remember;
  section.demonstration = { url: './demo.mp4', checked: false, caption: 'Tap paper. Hands off.' };
  assert.equal(availableDemonstration(section), null);
  assert.ok(!renderInteractiveHTML(bundle).includes('Play demonstration'));
  section.demonstration.checked = true;
  const html = renderInteractiveHTML(bundle);
  for (const label of ['Play demonstration', 'Pause', 'Replay', 'Still and text']) assert.ok(html.includes(label));
  assert.match(html, /preload="none" hidden/);
  let pauses = 0;
  const media = { pause() { pauses++; }, currentTime: 14 };
  stopMedia({ querySelectorAll: () => [media] });
  assert.equal(pauses, 1); assert.equal(media.currentTime, 0);
});

test('CSS preserves art in both themes, readable controls, keyboard space and a clean browser print fallback', () => {
  const css = readFileSync(new URL('../web/interactive.css', import.meta.url), 'utf8');
  assert.match(css, /html\[data-theme="dark"\]/);
  assert.match(css, /min-height: 48px; min-width: 48px/);
  assert.match(css, /gap: 8px/);
  assert.match(css, /font-size: 18px; line-height: 1\.5/);
  assert.match(css, /\.poster-image \{ display: block; width: 100%; height: auto;/);
  assert.ok(!css.includes('object-fit: cover'));
  assert.ok(!css.includes('filter:'));
  assert.match(css, /dialog\[data-region="plan"\].*100dvh/);
  assert.match(css, /\.plan-actions \{ position: sticky; bottom: 0/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  const print = css.slice(css.indexOf('@media print'));
  assert.match(print, /\.text-view, \.image-target, dialog, template \{ display: none/);
  assert.match(print, /visibility: visible !important/);
});

function luminance(hex) {
  return hex.match(/\w\w/g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
}
function contrast(a, b) { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); }
test('light and dark body text, links and controls meet the chosen contrast thresholds', () => {
  for (const theme of [
    { backgrounds: ['f7f3ec', 'f3eee3', 'fdfbf6'], ink: '1f2a28', secondary: '57605c', accent: '2c4a78', border: '717a76', primary: '22395e', on: 'ffffff' },
    { backgrounds: ['131f1d', '1b2926', '21332f'], ink: 'f0eee4', secondary: 'c6cfc6', accent: 'b7cdec', border: '8caaa1', primary: 'b7cdec', on: '14273f' },
  ]) {
    for (const bg of theme.backgrounds) {
      for (const ink of [theme.ink, theme.secondary, theme.accent]) assert.ok(contrast(ink, bg) >= 4.5, `${ink} on ${bg}`);
      assert.ok(contrast(theme.border, bg) >= 3, `control boundary on ${bg}`);
    }
    assert.ok(contrast(theme.on, theme.primary) >= 4.5);
  }
});

// A small event harness checks our handlers, not a browser's layout or assistive technology.
function domHarness(bundle) {
  const docListeners = {}, winListeners = {}, nodes = new Map();
  let doc;
  class Node {
    constructor(id, tagName = 'DIV') { this.id = id; this.tagName = tagName; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.hidden = false; this.disabled = false; this.style = { overflow: '', setProperty() {}, removeProperty() {} }; this.classes = new Set(); this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name), contains: name => this.classes.has(name) }; this.selectors = new Map(); this.controls = []; this.textContent = ''; }
    addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
    fire(name, extra = {}) { const event = { target: this, currentTarget: this, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra }; for (const fn of this.listeners[name] ?? []) fn(event); return event; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    focus() { doc.activeElement = this; }
    scrollIntoView() {}
    getClientRects() { return this.hidden ? [] : [{}]; }
    closest(selector) { if (selector === '[data-region]') return this.dataset.region ? this : null; if (selector === 'button') return this.tagName === 'BUTTON' ? this : null; return null; }
    matches(selector) { return selector.includes(this.tagName.toLowerCase()) || (this.name && selector.includes(this.name)); }
    querySelector(selector) { return this.selectors.get(selector) ?? null; }
    querySelectorAll(selector) { return selector === 'video, audio' ? (this.media ?? []) : this.controls; }
    replaceChildren(content) { this.selectors = content.selectors; this.controls = content.controls; }
    contains(node) { return this === node || this.controls.includes(node) || nodes.get('sheet-body').controls.includes(node); }
    showModal() { this.open = true; }
    close() { this.open = false; }
  }
  for (const id of ['poster-bundle', 'poster-sheet', 'sheet-body', 'sheet-title', 'sheet-close', 'poster-main', 'poster-wrapper', 'poster-image', 'poster-status', 'larger-text', 'read-larger', 'theme-toggle', 'sheet-header']) nodes.set(id, new Node(id, ['sheet-close', 'read-larger', 'theme-toggle'].includes(id) ? 'BUTTON' : 'DIV'));
  nodes.get('poster-bundle').textContent = JSON.stringify(bundle);
  nodes.get('larger-text').selectors.set('h2', new Node('larger-title', 'H2'));
  nodes.get('poster-sheet').controls = [nodes.get('sheet-close')];
  for (const id of REGION_IDS) {
    const template = new Node(`section-${id}`);
    template.content = { querySelectorAll: () => [], cloneNode() {
      const content = new Node('fragment');
      if (id === 'plan') {
        for (const name of ['notice', 'action']) { const input = new Node(name, 'TEXTAREA'); input.name = name; input.value = ''; content.selectors.set(`[name="${name}"]`, input); content.controls.push(input); }
        for (const command of ['save', 'edit', 'clear']) { const button = new Node(command, 'BUTTON'); button.dataset.plan = command; content.selectors.set(`[data-plan="${command}"]`, button); content.controls.push(button); }
        content.selectors.set('[data-plan-status]', new Node('plan-status'));
      }
      if (id === 'tagline') {
        for (const name of ['answer', 'explanation']) content.selectors.set(`[data-rhyme-${name}]`, new Node(name));
        for (const command of ['hide', 'show']) { const button = new Node(command, 'BUTTON'); button.dataset.recall = command; content.selectors.set(`[data-recall="${command}"]`, button); content.controls.push(button); }
      }
      return content;
    } };
    nodes.set(`section-${id}`, template);
  }
  const targets = REGION_IDS.map(id => { const button = new Node(id, 'BUTTON'); button.dataset.region = id; button.classes.add('image-target'); button.disabled = true; return button; });
  doc = { getElementById: id => nodes.get(id), body: new Node('body'), documentElement: { dataset: { theme: 'light' } }, hidden: false, activeElement: null, addEventListener: (name, fn) => { (docListeners[name] ??= []).push(fn); }, querySelectorAll: selector => selector === '.image-target' ? targets : selector === 'template' ? [...nodes.values()].filter(n => n.content) : [], fire: (name, event = {}) => { for (const fn of docListeners[name] ?? []) fn(event); } };
  const win = { localStorage: memoryStorage(), history: { state: null, pushes: 0, backs: 0, pushState(value) { this.state = value; this.pushes++; }, back() { this.backs++; } }, scrollY: 212, scrollTo(x, y) { this.lastScroll = [x, y]; }, requestAnimationFrame: fn => fn(), matchMedia: () => ({ matches: true }), addEventListener: (name, fn) => { (winListeners[name] ??= []).push(fn); }, fire: name => { for (const fn of winListeners[name] ?? []) fn(); }, fetch: async () => ({ ok: true, arrayBuffer: async () => bytes }), crypto: webcrypto, URL: { createObjectURL: () => 'blob:verified-test', revokeObjectURL() {} }, Blob, visualViewport: { height: 360, addEventListener() {} } };
  nodes.get('poster-image').naturalWidth = bundle.image.width; nodes.get('poster-image').naturalHeight = bundle.image.height;
  return { doc, win, nodes, targets, Node };
}

test('modal Close, Escape, browser Back and swipe restore focus, scroll and an unsaved plan draft', async () => {
  const harness = domHarness(fixture()), { doc, win, nodes, Node } = harness;
  const app = mountInteractivePoster(doc, win); await app.verified; nodes.get('poster-image').onload();
  const opener = new Node('open-plan', 'BUTTON');
  for (const dismissal of ['close', 'escape', 'back', 'swipe']) {
    app.openSheet('plan', opener);
    assert.equal(nodes.get('poster-main').inert, true);
    assert.equal(doc.activeElement, nodes.get('sheet-close'));
    assert.equal(nodes.get('sheet-title').textContent, 'WHAT I CAN DO');
    const body = nodes.get('sheet-body'); body.querySelector('[name="notice"]').value = `Draft ${dismissal}`; body.querySelector('[name="action"]').value = 'Try';
    body.fire('input', { target: body.querySelector('[name="notice"]') });
    if (dismissal === 'close') nodes.get('sheet-close').fire('click');
    if (dismissal === 'escape') nodes.get('poster-sheet').fire('keydown', { key: 'Escape' });
    if (dismissal === 'back') win.fire('popstate');
    if (dismissal === 'swipe') { nodes.get('sheet-header').fire('pointerdown', { clientX: 10, clientY: 10 }); nodes.get('sheet-header').fire('pointerup', { clientX: 12, clientY: 100 }); }
    assert.equal(app.state.activeRegion, null); assert.equal(nodes.get('poster-main').inert, false);
    assert.equal(doc.activeElement, opener); assert.deepEqual(win.lastScroll, [0, 212]);
    assert.equal(app.state.draft.notice, `Draft ${dismissal}`);
    assert.equal(win.localStorage.values.size, 0);
  }
});

test('modal Tab stays inside, recall hides the rhyme and poster, and backgrounding stops media', async () => {
  const { doc, win, nodes, Node } = domHarness(fixture()); const app = mountInteractivePoster(doc, win); await app.verified; nodes.get('poster-image').onload();
  app.openSheet('tagline', new Node('open-rhyme', 'BUTTON'));
  const dialog = nodes.get('poster-sheet'), body = nodes.get('sheet-body'), close = nodes.get('sheet-close');
  const hide = body.querySelector('[data-recall="hide"]'), show = body.querySelector('[data-recall="show"]');
  dialog.controls = [close, hide, show]; show.hidden = true; hide.focus();
  assert.equal(dialog.fire('keydown', { key: 'Tab' }).prevented, true); assert.equal(doc.activeElement, close);
  assert.equal(dialog.fire('keydown', { key: 'Tab', shiftKey: true }).prevented, true); assert.equal(doc.activeElement, hide);
  await body.fire('click', { target: hide });
  assert.equal(body.querySelector('[data-rhyme-answer]').hidden, true);
  assert.equal(body.querySelector('[data-rhyme-explanation]').hidden, true);
  assert.equal(nodes.get('poster-wrapper').classList.contains('recall-hidden'), true);
  assert.equal(nodes.get('poster-main').classList.contains('recall-hidden'), true);
  assert.equal(nodes.get('sheet-title').textContent, 'Rhyme');
  await body.fire('click', { target: show });
  assert.equal(body.querySelector('[data-rhyme-answer]').hidden, false);
  assert.equal(nodes.get('poster-wrapper').classList.contains('recall-hidden'), false);
  assert.equal(nodes.get('poster-main').classList.contains('recall-hidden'), false);
  let pauses = 0; body.media = [{ pause() { pauses++; }, currentTime: 3 }];
  doc.hidden = true; doc.fire('visibilitychange'); assert.equal(pauses, 1);
  app.closeSheet(); assert.equal(pauses, 2);
});

test('parent taps a wall choice and the kit record persists without changing poster content', async () => {
  const bundle = fixture();
  const { doc, win, nodes, Node } = domHarness(bundle);
  const app = mountInteractivePoster(doc, win); await app.verified;
  const original = nodes.get('poster-bundle').textContent;
  const choice = new Node('wall-choice', 'BUTTON'); choice.dataset.wallChoice = 'Keep it off the wall';
  doc.fire('click', { target: choice });
  assert.equal(app.kitRecord.record.wallChoice, 'Keep it off the wall');
  app.openSheet('hero', new Node('open-hero', 'BUTTON'));
  choice.dataset.wallChoice = 'Change it';
  doc.fire('click', { target: choice });
  assert.equal(app.kitRecord.record.wallChoice, 'Change it');
  assert.equal(nodes.get('poster-bundle').textContent, original);
  assert.equal(win.localStorage.values.size, 1);
  assert.equal(JSON.parse([...win.localStorage.values.values()][0]).wallChoice, 'Change it');
});
