import { createRequire } from 'node:module';
import { chromeExecutable } from './chrome-path.js';
import { reviewNote } from './stop-policy.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { saveJSON } from './files.js';

// Runs in the same browser, with the same fonts and type sizes, as the export.
export function measureDocument() {
  const pt = pixels => pixels * 72 / 96;
  const rect = node => { const r = node.getBoundingClientRect(); return { x: pt(r.x), y: pt(r.y), w: pt(r.width), h: pt(r.height) }; };
  const clearance = (a, b) => Math.min(a.x - b.x, a.y - b.y, b.x + b.w - a.x - a.w, b.y + b.h - a.y - a.h);
  const beyond = (a, b) => Math.max(-clearance(a, b), 0);
  const pages = [], faults = [];
  for (const sheet of document.querySelectorAll('.sheet')) {
    const page = sheet.dataset.page, bounds = rect(sheet), footer = sheet.querySelector('.page-footer');
    const content = { ...bounds, h: footer ? Math.min(rect(footer).y - bounds.y, bounds.h - rect(footer).h) : bounds.h };
    const elements = [], cardNodes = [...sheet.querySelectorAll('.card')];
    const footerOverflowPoints = footer ? beyond(rect(footer), bounds) : 0;
    if (footerOverflowPoints > .01) faults.push(`${page}.footer: rendered footer extends ${footerOverflowPoints.toFixed(2)} points beyond the fixed page`);
    const panelBox = sheet.querySelector('.panels');
    const panelArtwork = panelBox ? [...panelBox.querySelectorAll('img')].map((node, index) => ({ panel: index + 1, bounds: rect(node), overflowPoints: beyond(rect(node), rect(panelBox)) })) : [];
    for (const art of panelArtwork) if (art.overflowPoints > .75) faults.push(`${page}.panel-${art.panel}: image extends ${art.overflowPoints.toFixed(2)} points beyond its picture row`);
    for (const node of sheet.querySelectorAll('h1,h2,h3,p,li,.identity,.writing-frame,.key-word,.page-footer span,.poster-footer')) {
      // An empty text range is at the viewport origin, even when its element
      // belongs to an offscreen fixed-furniture probe. It contains no ink.
      if (!node.textContent.trim()) continue;
      const r = rect(node), range = document.createRange(); range.selectNodeContents(node);
      const ink = rect({ getBoundingClientRect: () => range.getBoundingClientRect() });
      const limit = node.closest('footer,.page-footer,.poster-footer') ? bounds : content;
      const style = getComputedStyle(node);
      const overflow = Math.max(beyond(r, limit), beyond(ink, limit), style.overflowY === 'visible' ? 0 : pt(node.scrollHeight - node.clientHeight), style.overflowX === 'visible' ? 0 : pt(node.scrollWidth - node.clientWidth));
      const row = { field: node.dataset.generated ?? node.dataset.owned ?? node.className ?? node.tagName, generated: node.dataset.generated ?? null, footer: Boolean(node.closest('.page-footer,.poster-footer')), card: node.closest('.card')?.dataset.card ?? null, cardIndex: cardNodes.indexOf(node.closest('.card')), text: node.textContent.trim(), bounds: r, textBounds: ink, fontPoints: pt(parseFloat(style.fontSize)), linePoints: pt(parseFloat(style.lineHeight)), paragraphGapPoints: pt(parseFloat(style.marginBottom) || 0), lastParagraph: node.parentElement?.lastElementChild === node, lineCount: range.getClientRects?.().length ?? null, overflowPoints: overflow };
      if (row.generated === 'story' && node.firstChild?.nodeType === 3) {
        // Count actual characters on each rendered line, rather than dividing a
        // paragraph's length by its line count. Dialogue may form a short line.
        const lines = new Map(), textNode = node.firstChild;
        for (let index = 0; index < textNode.length; index++) {
          range.setStart(textNode, index); range.setEnd(textNode, index + 1);
          const box = range.getBoundingClientRect(), y = Math.round(box.y * 10) / 10;
          if (box.height) lines.set(y, (lines.get(y) ?? 0) + 1);
        }
        row.lineCharacters = [...lines.values()];
      }
      elements.push(row);
      if (overflow > .75) faults.push(`${page}.${row.field || node.tagName}: rendered text extends ${overflow.toFixed(2)} points beyond its ${limit.w.toFixed(2)} by ${limit.h.toFixed(2)} point content area at ${row.fontPoints.toFixed(2)} point type`);
      const card = node.closest('.card');
      if (card && beyond(ink, rect(card)) > .75) {
        row.overflowPoints = Math.max(row.overflowPoints, beyond(ink, rect(card)));
        faults.push(`${page}.${row.field || node.tagName}: text exceeds card by ${beyond(ink, rect(card)).toFixed(2)} points at ${row.fontPoints.toFixed(2)} point type`);
      }
    }
    const storyRows = elements.filter(row => row.generated === 'story');
    const parentRows = elements.filter(row => row.card === 'sources' && row.text);
    const storyTypography = storyRows.length ? { bodyPoints: Math.min(...storyRows.map(row => row.fontPoints)), lineHeight: Math.min(...storyRows.map(row => row.linePoints / row.fontPoints)), paragraphGapPoints: Math.min(...storyRows.filter(row => !row.lastParagraph).map(row => row.paragraphGapPoints)), maxCharactersPerLine: Math.max(...storyRows.flatMap(row => row.lineCharacters ?? []), 0), estimatedCharactersPerLine: Math.max(...storyRows.filter(row => row.lineCount > 1).map(row => row.text.length / row.lineCount), 0), panelHeightPoints: sheet.querySelector('.panels') ? rect(sheet.querySelector('.panels')).h : null } : null;
    if (storyTypography && (storyTypography.bodyPoints < 11.99 || storyTypography.paragraphGapPoints < storyTypography.bodyPoints / 2 - .01)) faults.push(`${page}.readability: story needs at least 12 point body type and a half-body-size paragraph gap`);
    const parentBodyPoints = parentRows.length ? Math.min(...parentRows.map(row => row.fontPoints)) : null;
    if (parentBodyPoints !== null && parentBodyPoints < 9.99) faults.push(`${page}.readability: parent strip needs at least 10 point type`);
    const sourceBlocks = [...sheet.querySelectorAll('.source')].map(node => ({ source: node.dataset.source, fragments: node.getClientRects?.().length ?? 1, bounds: rect(node) }));
    for (const block of sourceBlocks) if (block.fragments > 1) faults.push(`${page}.source-${block.source}: study, DOI and fit label split across columns`);
    const cards = cardNodes.map((card, index) => {
      const box = rect(card), rows = elements.filter(row => row.cardIndex === index);
      const margin = rows.length ? Math.min(...rows.map(row => clearance(row.textBounds, box))) : null;
      return { card: card.dataset.card, title: card.querySelector('h2')?.textContent.trim(), bounds: box, fitMarginPoints: margin, overflowPoints: Math.max(0, -(margin ?? 0)) };
    });
    const ink = elements.filter(row => row.text && row.textBounds.h > 0).map(row => row.textBounds);
    const inset = page === 'poster' ? 0 : 36;
    const textMargins = ink.length ? { top: inset + Math.min(...ink.map(r => r.y - bounds.y)), bottom: inset + bounds.y + bounds.h - Math.max(...ink.map(r => r.y + r.h)), left: inset + Math.min(...ink.map(r => r.x - bounds.x)), right: inset + bounds.x + bounds.w - Math.max(...ink.map(r => r.x + r.w)) } : null;
    const artwork = sheet.querySelector('[data-art-bounds]');
    let artMargins = null;
    if (artwork) {
      // The browser places the saved checker's raster bounds. This is not new OCR.
      const saved = JSON.parse(artwork.dataset.artBounds), frame = rect(artwork), sx = frame.w / 612, sy = frame.h / 792;
      artMargins = { top: frame.y + saved.y * sy - bounds.y, bottom: bounds.y + bounds.h - frame.y - (saved.y + saved.h) * sy, left: frame.x + saved.x * sx - bounds.x, right: bounds.x + bounds.w - frame.x - (saved.x + saved.w) * sx };
    }
    const bodyInk = elements.filter(row => row.text && !row.footer).map(row => row.textBounds);
    const fitMarginPoints = bodyInk.length ? content.y + content.h - Math.max(...bodyInk.map(r => r.y + r.h)) : textMargins ? Math.min(...Object.values(textMargins), ...Object.values(artMargins ?? {})) - 36 : null;
    const overflowPoints = Math.max(footerOverflowPoints, ...panelArtwork.map(row => row.overflowPoints), ...elements.map(row => row.overflowPoints), ...cards.map(row => row.overflowPoints));
    pages.push({ page, bounds, content, elements, cards, panelArtwork, footerOverflowPoints, overflowPoints, textMargins, artMargins, fitMarginPoints, storyTypography, parentBodyPoints, sourceBlocks });
  }
  return { ready: faults.length === 0, measured: true, unit: 'Letter points', faults, pages, fonts: document.fonts.status, method: 'Browser DOM and text ranges after fonts load. Readable type floors, intact source blocks and targeted shortening before compacting generated text.' };
}

// Shared by measurement, individual pages and the complete printed export.
// Type never shrinks. Small spills first recover discretionary furniture gaps.
// Remaining generated overflow goes to targeted shortening before card compacting.
export function fitDocument(measure) {
  const changes = [];
  const balance = sheet => {
    const body = sheet.querySelector('.sources .card-body');
    if (body) {
      const card = body.closest('.sources'), header = card.querySelector('h2');
      const pixels = card.getBoundingClientRect().height - header.getBoundingClientRect().height - 2 * parseFloat(getComputedStyle(card).borderTopWidth);
      body.style.height = `${Math.max(0, pixels)}px`;
      changes.push({ page: sheet.dataset.page, action: 'Balance source lines within the available card height.' });
    }
  };
  const sheets = [...document.querySelectorAll('.sheet')];
  sheets.forEach(balance);
  // Each complete source stays together; spare space is shared by both columns.
  let result = measure();
  const initialFaults = [...result.faults];
  const overflows = page => (page.footerOverflowPoints ?? 0) > .01 || (page.overflowPoints ?? 0) > .75 || page.elements.some(row => row.overflowPoints > .75);
  // Recover only overflowing parent-page furniture before shortening prose.
  // Keep all source words, type, handwriting and cut-out card dimensions.
  for (const page of result.pages.filter(overflows)) {
    if (page.page !== 'for-you') continue;
    const sheet = sheets.find(sheet => sheet.dataset.page === page.page);
    if (!sheet?.querySelector('.sources')) continue;
    sheet.dataset.notesFit = 'spacing';
    balance(sheet);
    changes.push({ page: page.page, action: 'Recover parent-page furniture gaps. Keep all words, type, artwork and writing space.' });
  }
  result = measure();
  // Small spills use discretionary furniture gaps before any paid rewrite.
  // This changes no words, type, paragraph gaps, image size or page boundary.
  for (const page of result.pages.filter(overflows)) {
    const spill = Math.max(page.overflowPoints ?? 0, page.footerOverflowPoints ?? 0, ...page.elements.map(row => row.overflowPoints ?? 0));
    const sheet = sheets.find(sheet => sheet.dataset.page === page.page);
    if (spill <= 24 && sheet?.querySelector('.page-heading')) {
      sheet.dataset.gapFit = 'small';
      changes.push({ page: page.page, action: 'Recover discretionary heading and panel gaps for a small spill; keep all words, type and artwork.' });
    }
  }
  result = measure();
  // Older saved chapters put almost every spoken turn in a separate short
  // paragraph. An explicit saved-export revision may group these beats only
  // while the page overflows. Keep the hook, all words, page cuts, type and art.
  // Stop as soon as the measured page fits; never touch a page that already fits.
  for (const page of result.pages.filter(overflows)) {
    if (!page.page.startsWith('story')) continue;
    const sheet = sheets.find(sheet => sheet.dataset.page === page.page);
    const body = sheet?.querySelector('.chapter-text');
    if (!body?.children || body.dataset.savedRevision !== 'true') continue;
    const before = body.textContent.replace(/\s+/gu, ' ').trim();
    let joins = 0;
    while (true) {
      const paragraphs = [...body.children];
      const pairs = paragraphs.slice(0, -1).flatMap((node, index) => {
        const next = paragraphs[index + 1];
        if (page.page === 'story' && index < 3) return [];
        return [{ node, next, length: node.textContent.length + next.textContent.length }];
      }).sort((a, b) => a.length - b.length);
      if (!pairs.length) break;
      const { node, next } = pairs[0];
      node.textContent = node.textContent.trimEnd() + ' ' + next.textContent.trimStart();
      node.dataset.reflowJoined = 'true'; next.remove(); joins++;
      result = measure();
      const current = result.pages.find(row => row.page === page.page);
      if (current && current.overflowPoints <= 24 && overflows(current) && sheet.dataset.gapFit !== 'small') {
        sheet.dataset.gapFit = 'small';
        changes.push({ page: page.page, action: 'Recover discretionary heading and panel gaps after saved paragraph reflow; keep type and art.' });
        result = measure();
      }
      if (!result.pages.some(row => row.page === page.page && overflows(row))) break;
    }
    if (joins) {
      // Compare word streams rather than layout whitespace at paragraph joins.
      const tokens = value => value.match(/\S+/gu) ?? [];
      const original = tokens(before).join(''), packed = tokens(body.textContent).join('');
      if (original !== packed) throw new Error('Story reflow changed saved words.');
      changes.push({ page: page.page, action: 'Group adjacent saved beats only until the measured page fits. Keep every word, hook line, page cut, type size and artwork.', paragraphJoins: joins, wordsChanged: false });
    }
  }
  result = measure();
  for (const page of result.pages.filter(overflows)) {
    const sheet = sheets.find(sheet => sheet.dataset.page === page.page);
    // Let the writer shorten the overflowing page before changing its spacing.
    if (page.elements.some(row => row.generated && row.text)) continue;
    sheet.dataset.fit = 'compact';
    balance(sheet);
    changes.push({ page: page.page, action: 'Fit fixed furniture at its spacing floor. Keep readable type and story paragraph gaps.' });
  }
  result = measure();
  for (const page of result.pages.filter(overflows)) {
    const original = sheets.find(sheet => sheet.dataset.page === page.page);
    const probe = original.cloneNode(true);
    probe.style.position = 'absolute'; probe.style.left = '-10000px'; probe.style.top = '0';
    probe.querySelectorAll('[data-generated]').forEach(node => { node.textContent = node.dataset.fixedText ?? ''; });
    document.body.append(probe); balance(probe);
    const fixedPage = measure().pages.at(-1);
    page.fixedOnlyOverflow = overflows(fixedPage);
    probe.remove();
  }
  return { ...result, fitting: { initialFaults, changes, typeShrunk: false, textHidden: false, generatedOverflow: 'small furniture gaps, then targeted shortening before card compacting' } };
}

export function shorteningPlan(receipt, text, { allowBubbleShortening = true } = {}) {
  if (!receipt?.measured || receipt.ready) return [];
  const plans = [];
  for (const page of receipt.pages ?? []) {
    const rows = page.elements.filter(row => row.overflowPoints > .75);
    const pageOverflow = Math.max(page.overflowPoints ?? 0, page.footerOverflowPoints ?? 0, ...rows.map(row => row.overflowPoints), 0);
    if (pageOverflow <= .75 && (page.footerOverflowPoints ?? 0) <= .01) continue;
    const flowingFields = page.elements.filter(row => row.generated && row.text).map(row => row.generated);
    const flowFields = page.page.startsWith('story') && flowingFields.includes('story') ? ['story'] : flowingFields;
    const fields = [...new Set(rows.flatMap(row => {
      if (row.generated) return [row.generated];
      // A fixed checkbox or heading can overflow because earlier generated
      // words filled its card. Shorten that card's words, not an unrelated card.
      const local = page.elements.filter(other => other.generated && (Number.isInteger(row.cardIndex) && row.cardIndex >= 0 ? other.cardIndex === row.cardIndex : row.card && other.card === row.card)).map(other => other.generated);
      // A footer is pushed by the complete page flow. A fixed source card,
      // however, cannot be repaired by changing an unrelated generated card.
      return local.length ? local : row.card ? [] : flowFields;
    }).concat(rows.length ? [] : flowFields))];
    if (!fields.length) continue;
    const overflowPoints = pageOverflow;
    const reference = page.elements.filter(row => fields.includes(row.generated));
    const measuredWords = reference.reduce((total, row) => total + (row.text.match(/\S+/g) ?? []).length, 0);
    // Dialogue uses many short paragraphs. The densest paragraph greatly
    // overstates how many words can be removed per point from that page.
    const pageIndex = page.page === 'story' ? 0 : page.page === 'story-2' ? 1 : null;
    const storyRows = pageIndex !== null && fields.includes('story') ? reference.filter(row => row.generated === 'story') : [];
    const canMeasureSpan = storyRows.length && storyRows.every(row => Number.isFinite(row.bounds?.y));
    const occupiedPoints = canMeasureSpan ? Math.max(...storyRows.map(row => row.bounds.y + row.bounds.h)) - Math.min(...storyRows.map(row => row.bounds.y)) : reference.reduce((total, row) => total + Math.max(row.bounds.h, row.linePoints || row.fontPoints * 1.36), 0);
    const wordsPerPoint = measuredWords && occupiedPoints ? measuredWords / occupiedPoints : 1;
    const cutWords = Math.max(1, Math.ceil((overflowPoints + 2) * wordsPerPoint));
    if (allowBubbleShortening && storyRows.length) {
      const pageWords = (text.pagination.pages[pageIndex].match(/\S+/g) ?? []).length;
      const bubbles = (text.panelLines ?? []).flatMap((panel, index) => (text.pagination.panelPages?.[index] ?? (index < 2 ? 0 : 1)) === pageIndex ? [{ index, words: (panel.line.match(/\S+/g) ?? []).length }] : []);
      // A bubble is copied from the story. If its page's bubbles alone exceed
      // the remaining target, those local lines must be allowed to shorten too.
      if (bubbles.reduce((sum, bubble) => sum + bubble.words, 0) > Math.max(0, pageWords - cutWords)) fields.push(...bubbles.map(bubble => `panelLines[${bubble.index}].line`));
    }
    plans.push({ page: page.page, fields, overflowPoints, cutWords,
      ...(pageIndex !== null && fields.includes('story') ? { pageIndex, pageText: text.pagination.pages[pageIndex], lockedPage: text.pagination.pages[1 - pageIndex] } : {}) });
  }
  return plans;
}

// No count can stop a run. Only a final, measured overflow can do that.
export async function fitPrintedText({ text, measure, shorten, save = () => {}, accept = () => {}, priorAttempts = {}, allowBubbleShortening = true, recover }) {
  let current = text, attempt = 0;
  const tries = new Map(Object.entries(priorAttempts));
  while (true) {
    const receipt = await measure(current, attempt);
    await save(receipt, attempt);
    if (!receipt.measured || receipt.ready) return { text: current, receipt };
    const plan = shorteningPlan(receipt, current, { allowBubbleShortening }).find(plan => (tries.get(plan.page) ?? 0) < 2);
    if (!plan) {
      if (recover) {
        const recovered = await recover(current, receipt);
        if (recovered?.measured && recovered.ready) return { text: current, receipt: recovered };
        throw Object.assign(new Error('printed_layout_review_required: Saved words still do not fit after the measured layout revision.'), { code: 'printed_layout_review_required', canResume: false, details: recovered ?? receipt });
      }
      assertLayoutFit(receipt);
    }
    const pageTry = (tries.get(plan.page) ?? 0) + 1; tries.set(plan.page, pageTry);
    try { const next = await shorten(current, plan, pageTry); await accept(next); current = next; }
    catch (error) {
      // A billing, privacy or network stop is not a rejected shortening answer.
      if (!/^(Story rejected|Shortened text needs correction|Two page shortening|The selected move)/.test(error.message)) throw error;
      await save({ shorteningRejected: error.message, plan }, `shortening-${pageTry}-${plan.page}`);
    }
    attempt++;
  }
}

export function assertLayoutFit(receipt) {
  if (!receipt?.measured) return { ...receipt, ready: true, measured: false, reviewFlags: [reviewNote('layout_unverified', receipt?.reason ?? 'Browser measurements missing.')] };
  if (!receipt.ready) throw new Error('printed_layout_overflow: ' + receipt.faults.join('; '));
  return receipt;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function waitForLayoutResult(page, { pollMs = 100, softMs = 10000, quietMs = 180000, runawayMs = 1800000, now = Date.now, wait = pause, onSlow = message => process.stderr.write(message + '\n') } = {}) {
  const start = now(); let progressAt = start, previous = '', notified = false;
  while (true) {
    const state = await page.evaluate(() => ({ result: document.querySelector('#layout-measurements')?.textContent ?? null,
      progress: [document.readyState, document.fonts.status, [...document.images].filter(image => image.complete).length].join(':') }));
    if (state.result !== null) return JSON.parse(state.result);
    const time = now();
    if (state.progress !== previous) { previous = state.progress; progressAt = time; }
    if (!notified && time - start >= softMs) { notified = true; try { onSlow('Page measurements are taking longer; still waiting for the result element.'); } catch { /* Reporting cannot interrupt work. */ } }
    if (time - progressAt >= quietMs || time - start >= runawayMs) return { measured: false, ready: false, reason: 'The page produced no measurement element after waiting for font, image and document progress.', progress: previous };
    await wait(pollMs);
  }
}
export async function launchMeasurementBrowser() {
  const require = createRequire(import.meta.url);
  let engine;
  try { engine = require('playwright-core'); }
  catch (error) { if (!process.env.STORY_POSTER_PLAYWRIGHT) throw error; engine = require(process.env.STORY_POSTER_PLAYWRIGHT); }
  return engine.chromium.launch({ executablePath: chromeExecutable(), headless: true,
    args: ['--allow-file-access-from-files', '--disable-background-networking'], timeout: 180000 });
}
export async function measureLayout(htmlPath, { theme = 'light', launch = launchMeasurementBrowser, waitOptions = {}, attempts = 2 } = {}) {
  const path = join(dirname(htmlPath), `layout-measure-${theme}.html`);
  const script = `<script>document.fonts.ready.then(()=>requestAnimationFrame(()=>requestAnimationFrame(async()=>{if(globalThis.storyPosterLayoutPending)await new Promise(resolve=>{const poll=()=>globalThis.storyPosterLayoutPending?requestAnimationFrame(poll):resolve();poll();});const result=globalThis.storyPosterLayout??(${fitDocument.toString()})(${measureDocument.toString()});const output=document.createElement('pre');output.id='layout-measurements';output.textContent=JSON.stringify(result);document.body.append(output);})));</script>`;
  writeFileSync(path, readFileSync(htmlPath, 'utf8').replace('</body>', script + '</body>'), { mode: 0o600 });
  const diagnostics = []; let result;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let browser;
    try {
      browser = await launch();
      const page = await browser.newPage();
      await page.goto(`${pathToFileURL(path)}?print=1&theme=${theme}`, { waitUntil: 'commit', timeout: 180000 });
      result = await waitForLayoutResult(page, waitOptions);
      diagnostics.push({ attempt, measured: result.measured, reason: result.reason });
      if (result.measured) break;
    } catch (error) {
      diagnostics.push({ attempt, error: error.message });
      result = { measured: false, ready: false, reason: 'The browser closed or could not load the page before producing its measurement element.' };
    } finally { if (browser) try { await browser.close(); } catch { /* Retain the measured result even if browser cleanup fails. */ } }
  }
  result = { ...result, diagnostics, completion: 'measurement element, not a virtual-time budget' };
  saveJSON(join(dirname(htmlPath), `layout-fit-${theme}.json`), result);
  return result;
}
