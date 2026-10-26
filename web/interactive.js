export const REGION_IDS = Object.freeze(['tinyTry', 'science', 'source', 'plan', 'remember', 'hero', 'keyword', 'tagline']);

export const wallQuestion = 'Happy for a friend to see this?';
export const wallChoices = Object.freeze(['Yes', 'Change it', 'Keep it off the wall']);
export const wallInstructions = 'Ask your child before putting this on the wall. The child may reject the picture or joke. Revise it or keep the poster off the wall.';
export const kitStorageKey = bundle => `story-poster:kit:${[bundle.profileId, bundle.kitId, bundle.version].map(value => encodeURIComponent(value ?? '')).join(':')}`;

// The parent's tap records the child's answer locally, outside all model inputs.
export function createLocalKitRecord(bundle, storage) {
  const key = kitStorageKey(bundle);
  const identity = { profileId: bundle.profileId, kitId: bundle.kitId, version: bundle.version };
  let record = { ...identity, wallChoice: null };
  let message = '';
  try {
    const saved = JSON.parse(storage?.getItem(key) ?? 'null');
    if (saved && Object.entries(identity).every(([name, value]) => saved[name] === value) && wallChoices.includes(saved.wallChoice)) record.wallChoice = saved.wallChoice;
  } catch { message = 'This device could not read the saved wall choice. Ask your child again.'; }
  return {
    get record() { return { ...record }; },
    get message() { return message; },
    choose(choice) {
      if (!wallChoices.includes(choice)) throw new Error('Unknown wall choice');
      record = { ...identity, wallChoice: choice };
      try {
        if (!storage) throw new Error('Storage unavailable');
        storage.setItem(key, JSON.stringify(record));
        message = choice === 'Yes' ? 'Saved on this device: Yes.' : choice === 'Change it' ? 'Change the picture or joke before putting it on the wall.' : 'Keep this poster off the wall.';
        return true;
      } catch { message = 'This device could not save the choice. Keep the poster off the wall until you ask again.'; return false; }
    },
  };
}

export const EVIDENCE_LABELS = Object.freeze({
  DIRECT: 'Children of the relevant age practising the same skill.',
  ADJACENT: 'Related child research, but a different age or skill.',
  MECHANISM: 'A process that might explain how something works.',
  'ADULT ONLY': 'Research conducted with adults.',
});

const validRect = (r, canvas) => r && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(r[k]))
  && r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0 && r.x + r.w <= canvas.width && r.y + r.h <= canvas.height;
const inside = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
const checksum = value => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);

export function inspectBundle(bundle) {
  if (!bundle?.version || !bundle?.map?.canvas) return { ready: false, reason: 'This poster needs its matching map.' };
  const { version, image, pdf, map, content } = bundle;
  if ([image, pdf, map, content].some(item => item?.version !== version)) return { ready: false, reason: 'The picture and its buttons have different versions. Use the text below.' };
  if (!checksum(image.sha256) || !checksum(pdf.sha256) || map.imageSha256 !== image.sha256) return { ready: false, reason: 'The picture does not match its checked map. Use the text below.' };
  if (!(map.canvas.width > 0 && map.canvas.height > 0) || !REGION_IDS.every(id => validRect(map.regions?.[id], map.canvas))) return { ready: false, reason: 'The picture buttons need a checked map. Use the text below.' };
  if (!REGION_IDS.every(id => content.sections?.[id]?.title) || content.approval?.approved !== true) return { ready: false, reason: 'This is a text preview. The poster details still need approval.' };
  if (!(image.width > 0 && image.height > 0) || Math.abs(image.width / image.height - map.canvas.width / map.canvas.height) > 0.001) return { ready: false, reason: 'The picture size does not match its map. Use the text below.' };
  return { ready: true, reason: '' };
}

export function percentRect(rect, canvas) {
  return { left: `${100 * rect.x / canvas.width}%`, top: `${100 * rect.y / canvas.height}%`, width: `${100 * rect.w / canvas.width}%`, height: `${100 * rect.h / canvas.height}%` };
}

// A badge and rhyme own their pixels, including on older approved maps.
export function regionAtPoint(map, x, y) {
  for (const id of ['keyword', 'tagline', ...REGION_IDS.filter(id => id !== 'keyword' && id !== 'tagline')]) {
    if (map.regions[id] && inside(map.regions[id], x, y)) return id;
  }
  return null;
}

export function targetClipPath(id, map) {
  const excluded = id === 'plan' ? map.regions.keyword : id === 'hero' ? map.regions.tagline : null;
  const r = map.regions[id];
  if (!excluded || excluded.x >= r.x + r.w || excluded.y >= r.y + r.h || excluded.x + excluded.w <= r.x || excluded.y + excluded.h <= r.y) return '';
  const left = 100 * (Math.max(r.x, excluded.x) - r.x) / r.w;
  const right = 100 * (Math.min(r.x + r.w, excluded.x + excluded.w) - r.x) / r.w;
  const top = 100 * (Math.max(r.y, excluded.y) - r.y) / r.h;
  const bottom = 100 * (Math.min(r.y + r.h, excluded.y + excluded.h) - r.y) / r.h;
  return `polygon(evenodd, 0% 0%, 100% 0%, 100% 100%, 0% 100%, 0% 0%, ${left}% ${top}%, ${left}% ${bottom}%, ${right}% ${bottom}%, ${right}% ${top}%, ${left}% ${top}%)`;
}

export function planStorageKey(bundle) {
  return `story-poster:plan:${[bundle.profileId, bundle.kitId, bundle.version].map(value => encodeURIComponent(value ?? '')).join(':')}`;
}

export function createInteractionState(bundle, { storage } = {}) {
  let activeRegion = null;
  let draft = { notice: '', action: '' };
  let saved = false;
  let storageMessage = '';
  const key = planStorageKey(bundle);
  try {
    const value = storage?.getItem(key);
    if (value) {
      const parsed = JSON.parse(value);
      if (typeof parsed.notice === 'string' && typeof parsed.action === 'string') {
        draft = { notice: parsed.notice, action: parsed.action };
        saved = true;
      }
    }
  } catch { storageMessage = 'Saved plans cannot be read on this device. You can still write a plan here.'; }
  return {
    get activeRegion() { return activeRegion; },
    get draft() { return { ...draft }; },
    get saved() { return saved; },
    get storageMessage() { return storageMessage; },
    open(id) { if (!REGION_IDS.includes(id)) throw new Error('Unknown poster section'); activeRegion = id; },
    close() { activeRegion = null; },
    update(notice, action) {
      const next = { notice: String(notice), action: String(action) };
      if (next.notice !== draft.notice || next.action !== draft.action) { saved = false; storageMessage = ''; }
      draft = next;
    },
    edit() { saved = false; storageMessage = ''; },
    save() {
      try {
        if (!storage) throw new Error('Storage unavailable');
        storage.setItem(key, JSON.stringify(draft));
        saved = true;
        storageMessage = 'Saved on this device.';
        return true;
      } catch {
        saved = false;
        storageMessage = 'This device could not save your plan. It is still here while this page stays open.';
        return false;
      }
    },
    clear() {
      draft = { notice: '', action: '' }; saved = false;
      try {
        if (!storage) throw new Error('Storage unavailable');
        storage.removeItem(key);
        storageMessage = 'Your saved plan was cleared from this device.';
        return true;
      } catch {
        storageMessage = 'The fields are empty, but this device could not clear its saved copy.';
        return false;
      }
    },
  };
}

export async function verifyImageBytes(bundle, { fetcher = globalThis.fetch, cryptoProvider = globalThis.crypto } = {}) {
  const status = inspectBundle(bundle);
  if (!status.ready) return status;
  try {
    for (const key of ['map', 'content']) {
      if (!bundle[key].sha256) continue;
      const { url, sha256, ...record } = bundle[key];
      const encoded = new TextEncoder().encode(`${JSON.stringify(record, null, 2)}\n`);
      const recordDigest = await cryptoProvider.subtle.digest('SHA-256', encoded);
      const actualRecord = Array.from(new Uint8Array(recordDigest), value => value.toString(16).padStart(2, '0')).join('');
      if (actualRecord !== sha256) throw new Error('Stored poster details changed');
    }
    const response = await fetcher(bundle.image.url, { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) throw new Error('Image unavailable');
    const bytes = await response.arrayBuffer();
    const digest = await cryptoProvider.subtle.digest('SHA-256', bytes);
    const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    if (actual !== bundle.image.sha256) throw new Error('Image changed');
    return { ready: true, reason: '', bytes };
  } catch { return { ready: false, reason: 'The picture could not be checked. Read the text or open the print poster below.' }; }
}

export function availableDemonstration(section) {
  const demo = section?.demonstration;
  return demo?.checked === true && typeof demo.url === 'string' && demo.url.length > 0 && typeof demo.caption === 'string' && demo.caption.length > 0 ? demo : null;
}

export function stopMedia(root) {
  for (const media of root.querySelectorAll('video, audio')) {
    media.pause();
    try { media.currentTime = 0; } catch { /* Unloaded media has no seekable timeline. */ }
  }
}

export function mountInteractivePoster(doc = document, win = window) {
  const bundleNode = doc.getElementById('poster-bundle');
  if (!bundleNode) return null;
  const bundle = JSON.parse(bundleNode.textContent);
  let storage;
  try { storage = win.localStorage; } catch { /* The editor works without persistent storage. */ }
  const state = createInteractionState(bundle, { storage });
  const kitRecord = createLocalKitRecord(bundle, storage);
  function updateWallControls() {
    for (const button of doc.querySelectorAll('[data-wall-choice]')) button.setAttribute('aria-pressed', String(button.dataset.wallChoice === kitRecord.record.wallChoice));
    for (const status of doc.querySelectorAll('[data-wall-status]')) status.textContent = kitRecord.message || (kitRecord.record.wallChoice ? `Saved on this device: ${kitRecord.record.wallChoice}.` : 'No choice saved. Ask your child before putting it on the wall.');
  }
  updateWallControls();
  const dialog = doc.getElementById('poster-sheet');
  const body = doc.getElementById('sheet-body');
  const title = doc.getElementById('sheet-title');
  const closeButton = doc.getElementById('sheet-close');
  const main = doc.getElementById('poster-main');
  const poster = doc.getElementById('poster-wrapper');
  const picture = doc.getElementById('poster-image');
  const status = doc.getElementById('poster-status');
  const textView = doc.getElementById('larger-text');
  let opener = null;
  let scrollY = 0;
  let priorOverflow = '';
  let ownsHistory = false;
  let pointerStart = null;
  let verifiedObjectURL = null;
  let ready = false;

  const resetRecall = () => {
    poster.classList.remove('recall-hidden');
    poster.removeAttribute('aria-hidden');
    main.classList.remove('recall-hidden');
    if (state.activeRegion) title.textContent = bundle.content.sections[state.activeRegion].title;
  };
  function syncPlan() {
    if (state.activeRegion !== 'plan') return;
    const notice = body.querySelector('[name="notice"]');
    const action = body.querySelector('[name="action"]');
    if (notice && action) state.update(notice.value, action.value);
  }
  function updatePlanControls() {
    const notice = body.querySelector('[name="notice"]');
    const action = body.querySelector('[name="action"]');
    if (!notice || !action) return;
    notice.value = state.draft.notice;
    action.value = state.draft.action;
    notice.readOnly = state.saved;
    action.readOnly = state.saved;
    body.querySelector('[data-plan="save"]').hidden = state.saved;
    body.querySelector('[data-plan="edit"]').hidden = !state.saved;
    body.querySelector('[data-plan-status]').textContent = state.storageMessage;
  }
  function closeSheet({ fromHistory = false } = {}) {
    if (!state.activeRegion) return;
    if (!state.saved) syncPlan();
    stopMedia(body);
    resetRecall();
    state.close();
    if (dialog.open) dialog.close();
    main.inert = false;
    main.removeAttribute('aria-hidden');
    doc.body.style.overflow = priorOverflow;
    const target = opener;
    win.requestAnimationFrame(() => { win.scrollTo(0, scrollY); target?.focus({ preventScroll: true }); });
    const shouldGoBack = ownsHistory && !fromHistory;
    ownsHistory = false;
    if (shouldGoBack) win.history.back();
  }
  function openSheet(id, button) {
    if (!REGION_IDS.includes(id)) return;
    if (button.classList.contains('image-target') && !ready) return;
    const first = !state.activeRegion;
    if (!state.saved) syncPlan();
    stopMedia(body);
    resetRecall();
    state.open(id);
    opener = button;
    if (first) { scrollY = win.scrollY; priorOverflow = doc.body.style.overflow; }
    title.textContent = bundle.content.sections[id].title;
    const accent = bundle.content.sections[id].accent;
    if (/^#[0-9a-f]{6}$/i.test(accent ?? '')) dialog.style.setProperty('--section-accent', accent);
    else dialog.style.removeProperty('--section-accent');
    body.replaceChildren(doc.getElementById(`section-${id}`).content.cloneNode(true));
    updateWallControls();
    dialog.dataset.region = id;
    updatePlanControls();
    if (id === 'remember' && win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const note = body.querySelector('[data-motion-note]');
      if (note) note.hidden = false;
    }
    main.inert = true;
    main.setAttribute('aria-hidden', 'true');
    doc.body.style.overflow = 'hidden';
    if (!dialog.open) dialog.showModal();
    closeButton.focus({ preventScroll: true });
    if (first) {
      try { win.history.pushState({ ...win.history.state, posterSheet: id }, ''); ownsHistory = true; } catch { ownsHistory = false; }
    }
  }
  closeButton.addEventListener('click', () => closeSheet());
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeSheet(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) closeSheet(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeSheet(); return; }
    if (event.key !== 'Tab') return;
    const controls = [...dialog.querySelectorAll('button, a[href], input, textarea, video[controls], [tabindex="0"]')].filter(node => !node.hidden && !node.disabled && node.getClientRects().length);
    if (!controls.length) { event.preventDefault(); closeButton.focus(); return; }
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  const handle = doc.getElementById('sheet-header');
  handle.addEventListener('pointerdown', event => { if (event.target.closest('button')) return; pointerStart = { x: event.clientX, y: event.clientY }; });
  handle.addEventListener('pointerup', event => {
    if (pointerStart && event.clientY - pointerStart.y > 80 && Math.abs(event.clientX - pointerStart.x) < 60) closeSheet();
    pointerStart = null;
  });
  handle.addEventListener('pointercancel', () => { pointerStart = null; });
  body.addEventListener('input', event => { if (event.target.matches('[name="notice"], [name="action"]')) syncPlan(); });
  body.addEventListener('focusin', event => {
    if (event.target.matches('input, textarea')) win.requestAnimationFrame(() => event.target.scrollIntoView({ block: 'nearest' }));
  });
  body.addEventListener('click', async event => {
    const control = event.target.closest('button');
    if (!control) return;
    const plan = control.dataset.plan;
    if (plan === 'save') { syncPlan(); state.save(); updatePlanControls(); if (state.saved) body.querySelector('[data-plan="edit"]').focus(); }
    if (plan === 'edit') { state.edit(); updatePlanControls(); body.querySelector('[name="notice"]').focus(); }
    if (plan === 'clear') { state.clear(); updatePlanControls(); }
    if (control.dataset.recall === 'hide') {
      body.querySelector('[data-rhyme-answer]').hidden = true;
      body.querySelector('[data-rhyme-explanation]').hidden = true;
      poster.classList.add('recall-hidden');
      poster.setAttribute('aria-hidden', 'true');
      main.classList.add('recall-hidden');
      title.textContent = 'Rhyme';
      control.hidden = true;
      const show = body.querySelector('[data-recall="show"]'); show.hidden = false; show.focus();
    }
    if (control.dataset.recall === 'show') {
      body.querySelector('[data-rhyme-answer]').hidden = false;
      body.querySelector('[data-rhyme-explanation]').hidden = false;
      resetRecall(); control.hidden = true;
      const hide = body.querySelector('[data-recall="hide"]'); hide.hidden = false; hide.focus();
    }
    const command = control.dataset.media;
    const media = body.querySelector('video');
    if (command && media) {
      if (command === 'pause') media.pause();
      if (command === 'still') { stopMedia(body); media.hidden = true; }
      if (command === 'play' || command === 'replay') {
        if (command === 'replay') media.currentTime = 0;
        media.hidden = false;
        try { await media.play(); } catch { body.querySelector('[data-media-status]').textContent = 'The demonstration could not play. The same action is written below.'; }
      }
    }
  });
  doc.addEventListener('click', event => {
    const wallButton = event.target.closest('button');
    if (wallButton?.dataset.wallChoice) {
      kitRecord.choose(wallButton.dataset.wallChoice);
      updateWallControls();
      return;
    }
    const button = event.target.closest('[data-region]');
    if (button?.tagName === 'BUTTON') { event.stopPropagation(); openSheet(button.dataset.region, button); }
  });
  doc.getElementById('read-larger').addEventListener('click', () => {
    textView.hidden = false;
    textView.querySelector('h2').focus();
    textView.scrollIntoView({ block: 'start' });
  });
  doc.getElementById('theme-toggle').addEventListener('click', event => {
    const dark = doc.documentElement.dataset.theme !== 'dark';
    doc.documentElement.dataset.theme = dark ? 'dark' : 'light';
    event.currentTarget.setAttribute('aria-pressed', String(dark));
    try { storage?.setItem('story-poster:theme', dark ? 'dark' : 'light'); } catch { /* Theme remains available for this visit. */ }
  });
  doc.getElementById('theme-toggle').setAttribute('aria-pressed', String(doc.documentElement.dataset.theme === 'dark'));
  win.addEventListener('popstate', () => closeSheet({ fromHistory: true }));
  doc.addEventListener('visibilitychange', () => { if (doc.hidden) stopMedia(body); });
  win.addEventListener('pagehide', () => { stopMedia(body); if (verifiedObjectURL) win.URL.revokeObjectURL(verifiedObjectURL); });
  const resizeForKeyboard = () => {
    const height = win.visualViewport?.height;
    if (height) {
      dialog.style.setProperty('--visible-height', `${height}px`);
      if (Number.isFinite(win.innerHeight)) dialog.style.bottom = `${Math.max(0, win.innerHeight - height - (win.visualViewport.offsetTop ?? 0))}px`;
    }
  };
  win.visualViewport?.addEventListener('resize', resizeForKeyboard);
  win.visualViewport?.addEventListener('scroll', resizeForKeyboard);
  resizeForKeyboard();
  const disableTargets = message => {
    ready = false;
    for (const button of doc.querySelectorAll('.image-target')) button.disabled = true;
    status.textContent = message;
    status.hidden = false;
    textView.hidden = false;
  };
  picture.addEventListener('error', () => disableTargets('The picture could not load. Use the text or print link below.'));
  const verified = verifyImageBytes(bundle, { fetcher: win.fetch.bind(win), cryptoProvider: win.crypto }).then(result => {
    if (!result.ready) { disableTargets(result.reason); return false; }
    verifiedObjectURL = win.URL.createObjectURL(new win.Blob([result.bytes], { type: bundle.image.mimeType ?? 'image/png' }));
    picture.onload = () => {
      if (picture.naturalWidth !== bundle.image.width || picture.naturalHeight !== bundle.image.height) { disableTargets('The picture size has changed. Use the text or print link below.'); return; }
      for (const crop of doc.querySelectorAll('[data-poster-crop]')) crop.src = verifiedObjectURL;
      for (const template of doc.querySelectorAll('template')) for (const crop of template.content.querySelectorAll('[data-poster-crop]')) crop.src = verifiedObjectURL;
      ready = true;
      for (const button of doc.querySelectorAll('.image-target')) button.disabled = false;
      status.hidden = true;
    };
    picture.src = verifiedObjectURL;
    return true;
  });
  return { state, kitRecord, openSheet, closeSheet, verified };
}

if (typeof document !== 'undefined') mountInteractivePoster();
