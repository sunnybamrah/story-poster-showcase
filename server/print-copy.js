import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, lstatSync, rmSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import sharp from 'sharp';
import { renderKitPDF, printedText } from './layout.js';

export const printCopyVersion = 'grayscale-paper-v2';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const names = ['poster.html', 'kit_final.html'];
const safeFile = (source, name) => { const path = join(source, name); if (name.startsWith('fonts/') && lstatSync(join(source, 'fonts')).isSymbolicLink() || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw Error('The saved print source is not a regular file.'); return path; };
const css = `<style id="black-white-print">:root,html[data-theme=dark]{color-scheme:light!important;--bg:#fff!important;--paper:#fff!important;--card:#fff!important;--ink:#000!important;--border:#333!important;--rule:#333!important;--green:#000!important;--green-tint:#fff!important;--coral-tint:#fff!important;--orange-tint:#fff!important;--badge:#fff!important}body,body *{color:#000!important;background-color:#fff!important;border-color:#333!important;box-shadow:none!important;text-shadow:none!important}.writing-blank{color:transparent!important}.reading-art,.reading-art *,.practice-vignette{background-color:transparent!important}img{filter:grayscale(1)}.poster-footer{background:#fff!important}</style>`;

// A fixed, gentle curve keeps middle shades in faces while deepening dark
// outlines and lifting only the lightest paper. No local sharpening, threshold,
// automatic contrast stretch or face-dependent adjustment changes the drawing.
const printTones = [[0, 0], [48, 40], [128, 128], [216, 220], [245, 255], [255, 255]];
const toneLookup = Uint8Array.from({ length: 256 }, (_, shade) => {
  const upper = printTones.findIndex(([input]) => input >= shade);
  if (!upper) return printTones[0][1];
  const [lowIn, lowOut] = printTones[upper - 1], [highIn, highOut] = printTones[upper];
  return Math.round(lowOut + (shade - lowIn) * (highOut - lowOut) / (highIn - lowIn));
});
async function printArtwork(path) {
  const { data, info } = await sharp(path).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  for (let index = 0; index < data.length; index++) data[index] = toneLookup[data[index]];
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer();
}
function printCopyResources(source) {
  const files = [...names];
  for (const name of names) {
    const html = readFileSync(safeFile(source, name), 'utf8');
    for (const match of html.matchAll(/(?:src=["']|url\(["']?)([^"')>\s]+)/g)) {
      const file = match[1];
      if (!/^(?:[a-zA-Z0-9_-]+\.png|fonts\/[a-zA-Z0-9_-]+\.ttf)$/.test(file)) throw Error('This saved print uses an unsupported asset.');
      files.push(file);
    }
  }
  const resources = [...new Set(files)].sort();
  for (const name of resources) safeFile(source, name);
  return resources;
}
export function printCopySources(source) { return Object.fromEntries(printCopyResources(source).map(name => [name, hash(readFileSync(safeFile(source, name)))])); }
export function printCopyAvailable(source) { try { printCopyResources(source); return true; } catch { return false; } }

async function inspectPrintPage(page) {
  const result = await page.evaluate(() => {
    const faults = [], ratios = [];
    const value = color => (color.match(/[\d.]+/g) ?? []).map(Number);
    const luminance = rgb => rgb.slice(0, 3).map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
    for (const node of document.querySelectorAll('.sheet *')) {
      if (![...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim())) continue;
      const style = getComputedStyle(node), box = node.getBoundingClientRect();
      if (!box.width || !box.height || style.visibility === 'hidden' || node.closest('.writing-blank')) continue;
      const ink = value(style.color), paper = value(style.backgroundColor);
      if (paper.length < 3 || paper.slice(0, 3).some(x => x !== 255)) faults.push('Text paper is not white.');
      const ratio = (Math.max(luminance(ink), luminance(paper)) + .05) / (Math.min(luminance(ink), luminance(paper)) + .05);
      ratios.push(ratio); if (ratio < 4.5) faults.push('Printed text contrast is too low.');
    }
    for (const sheet of document.querySelectorAll('.sheet')) if (getComputedStyle(sheet).backgroundColor !== 'rgb(255, 255, 255)') faults.push('Page paper is not white.');
    return { measured: true, minimumTextContrast: ratios.length ? Math.min(...ratios) : 0, textRuns: ratios.length, whitePaper: faults.length === 0, faults, rasterText: 'Saved drawing words remain in the grayscale art; inspect the exported artwork before printing.' };
  });
  if (!result.textRuns || result.faults.length) throw Error('Black-and-white print contrast check failed.');
  return result;
}

// Copies only print resources. No account files, request logs or private notes
// enter this derivative. Existing HTML supplies exact saved words and page cuts.
export async function renderPrintCopy({ source, outputRoot, render = renderKitPDF }) {
  source = resolve(source); outputRoot = resolve(outputRoot);
  if (source === outputRoot || source.startsWith(outputRoot + '/')) throw Error('Use a separate print-copy folder.');
  const originals = printCopySources(source);
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(outputRoot, 'bw-'));
  const artwork = [];
  for (const name of Object.keys(originals)) {
    const path = safeFile(source, name), target = join(directory, name);
    if (name.endsWith('.html')) {
      const original = readFileSync(path, 'utf8'), transformed = original.replace('</head>', `${css}</head>`);
      if (transformed === original || printedText(original) !== printedText(transformed)) throw Error('The print copy changed saved words.');
      writeFileSync(target, transformed, { mode: 0o600 });
    } else if (name.endsWith('.png')) {
      const bytes = await printArtwork(path);
      writeFileSync(target, bytes, { mode: 0o600 });
      const { data, info } = await sharp(bytes).greyscale().raw().toBuffer({ resolveWithObject: true });
      let white = 0, dark = 0; for (const value of data) { if (value === 255) white++; if (value <= 118) dark++; }
      artwork.push({ file: name, sourceSHA256: originals[name], outputSHA256: hash(bytes), width: info.width, height: info.height, whitePixels: white, darkPixels: dark, pixelCount: data.length });
    } else { mkdirSync(join(directory, 'fonts'), { recursive: true, mode: 0o700 }); copyFileSync(path, target); }
  }
  const kit = await render(join(directory, 'kit_final.html'), join(directory, 'kit-bw.pdf'), { inspectPage: inspectPrintPage });
  if (!kit.rendered) throw Error('The five-page print copy did not pass its checks.');
  const poster = await render(join(directory, 'poster.html'), join(directory, 'poster-bw.pdf'), { posterOnly: true, inspectPage: inspectPrintPage });
  if (!poster.rendered) throw Error('The poster print copy did not pass its checks.');
  if (JSON.stringify(printCopySources(source)) !== JSON.stringify(originals)) throw Error('Saved print sources changed while preparing the copy.');
  const receipt = { version: printCopyVersion, originals, artwork, toneCurve: printTones, changes: ['Black text on white paper.', 'Darker borders and writing lines.', 'Middle picture shades kept; dark lines deepened and pale paper lightened.'], kit, poster, outputs: Object.fromEntries(['kit-bw.pdf', 'poster-bw.pdf'].map(name => [name, hash(readFileSync(join(directory, name)))])), originalFilesUnchanged: true };
  writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  return { directory, receipt };
}

export function createPrintCopies({ db, dataDirectory, persist, flush, render = renderPrintCopy }) {
  let tail = Promise.resolve(); const active = new Map();
  const source = job => join(dataDirectory, job.accountId, job.id);
  const valid = job => db.jobs.includes(job) && db.accounts.some(account => account.id === job.accountId) && job.status === 'complete';
  function checkedCopyFile(job, name, copy) {
    if (!valid(job) || copy?.status !== 'ready' || !['poster-bw.pdf', 'kit-bw.pdf'].includes(name)) return null;
    const folder = copy.directory && basename(copy.directory) === copy.directory ? join(source(job), 'print-copies', copy.directory) : null;
    const file = folder && join(folder, name);
    try { if (file && hash(readFileSync(file)) === copy.outputs[name]) return { directory: folder, name }; } catch {}
    return null;
  }
  const verified = (job, copy) => ['kit-bw.pdf', 'poster-bw.pdf'].every(name => checkedCopyFile(job, name, copy));
  const refreshFailed = { status: 'failed', message: 'The clearer copy stopped. Your saved black-and-white copy is still here. You can try again.' };
  for (const job of db.jobs) if (job.printCopy?.status === 'preparing') {
    const previous = job.printCopy.previous;
    if (verified(job, previous)) { job.printCopy = previous; job.printCopyRefresh = { ...refreshFailed }; }
    else { job.printCopy = { status: 'failed', message: 'The print copy stopped. You can try again.' }; delete job.printCopyRefresh; }
  }
  function checkedFile(job, name) {
    // Keep existing links on the verified saved copy until the replacement
    // finishes rendering AND its ready record finishes saving.
    const copy = active.has(job.id) ? active.get(job.id).previous : job.printCopy;
    return checkedCopyFile(job, name, copy);
  }
  function view(job) {
    if (job.status !== 'complete') return { status: 'unavailable', message: 'Finish this kit before making a print copy.' };
    // Availability belongs to the verified download, independently of refresh.
    const assets = ['kit-bw.pdf', 'poster-bw.pdf'].every(name => checkedFile(job, name))
      ? { posterPdf: `/api/jobs/${job.id}/files/poster-bw.pdf`, kitPdf: `/api/jobs/${job.id}/files/kit-bw.pdf` } : null;
    const downloadable = assets ? { assets } : {};
    if (active.has(job.id) || job.printCopy?.status === 'preparing') {
      const message = assets ? 'We are preparing a clearer copy. Your saved black-and-white copy is still here.' : 'We are preparing a black-and-white copy of your saved pages.';
      return { status: 'preparing', message, ...downloadable, ...(assets ? { refresh: { status: 'preparing', message } } : {}) };
    }
    const sourceAvailable = printCopyAvailable(source(job));
    // Offer a fresh derivative after a print improvement. Old saved copies
    // remain on disk, and kits without editable sources keep their downloads.
    const ready = Boolean(assets);
    if (ready && (job.printCopy.version === printCopyVersion || !sourceAvailable)) return { status: 'ready', message: 'Your black-and-white print copy is ready.', ...downloadable };
    if (!sourceAvailable) return { status: 'unavailable', message: 'This older kit has no saved pages for a separate print copy.' };
    if (ready) {
      const refresh = job.printCopyRefresh?.status === 'failed' ? { ...refreshFailed } : { status: 'available', message: 'You can make a clearer black-and-white copy.' };
      return { status: 'available', message: refresh.message, ...downloadable, refresh };
    }
    return job.printCopy?.status === 'failed' ? { status: 'failed', message: 'The print copy stopped. Your colour files are safe. You can try again.' } : { status: 'available', message: 'Make a black-and-white copy from the saved words and pictures.' };
  }
  function prepare(job) {
    const current = view(job);
    if (!valid(job) || current.status === 'unavailable') throw Object.assign(Error(current.message), { status: 409 });
    if (['ready', 'preparing'].includes(current.status)) return current;
    const previous = verified(job, job.printCopy) ? job.printCopy : null;
    const restore = () => { job.printCopy = previous ?? { status: 'failed' }; if (previous) job.printCopyRefresh = { ...refreshFailed }; };
    delete job.printCopyRefresh;
    job.printCopy = { status: 'preparing', ...(previous ? { previous } : {}) };
    try { persist(); } catch (error) { restore(); throw error; }
    const task = tail.catch(() => {}).then(async () => {
      try {
        await flush(); if (!valid(job)) return;
        const result = await render({ source: source(job), outputRoot: join(source(job), 'print-copies') });
        if (!valid(job)) { rmSync(source(job), { recursive: true, force: true }); return; }
        job.printCopy = { status: 'ready', directory: basename(result.directory), outputs: result.receipt.outputs, version: printCopyVersion };
        persist(); await flush();
      } catch {
        if (valid(job)) {
          restore();
          // Keep the old download or retryable failure while storage is down.
          // Startup also restores a verified prior copy from preparing state.
          try { persist(); await flush(); } catch { /* Saving can recover later. */ }
        } else rmSync(source(job), { recursive: true, force: true });
      }
    }).catch(() => { if (valid(job)) restore(); }).finally(() => active.delete(job.id));
    active.set(job.id, { task, previous }); tail = task;
    return view(job);
  }
  return { view, prepare, checkedFile, busy: accountId => [...active.keys()].some(id => db.jobs.some(job => job.id === id && job.accountId === accountId)), settled: () => tail };
}
