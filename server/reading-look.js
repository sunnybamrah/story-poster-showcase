import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { worldChoices, inkColourSet } from './worlds.js';
import { isCastId } from './cast.js';

export const readingLookVersion = 'comic-reading-v1';
export const readingPalettes = {
  warm: { light: ['#fff9ed', '#e4f0db', '#fbe1e5', '#fff0bd'], dark: ['#26221f', '#2e4234', '#49333b', '#493f28'] },
  cool: { light: ['#f7f8ed', '#dceff1', '#ebe3f6', '#e3edf9'], dark: ['#232624', '#2c4144', '#40364b', '#303e50'] },
  night: { light: ['#fff9ed', '#e4e8f8', '#f8deea', '#fff0bd'], dark: ['#23232c', '#333b50', '#48303f', '#493f28'] },
  forest: { light: ['#faf8eb', '#e0edd4', '#f7e1d2', '#f4eccb'], dark: ['#25271f', '#33412c', '#48382e', '#43402b'] },
  // Diary doodles: off-white paper and light greys, so printed pages match a black-ink look.
  ink: { light: ['#fdfbf6', '#efefec', '#e7e7e3', '#f4f3ef'], dark: ['#232323', '#2f2f2f', '#383838', '#2b2b2b'] },
};
export function readingLookFor(selection = {}) {
  const world = worldChoices.worlds.includes(selection.world) ? selection.world : 'comic strip';
  const colourSet = [...worldChoices.colourSets, inkColourSet].includes(selection.colourSet) ? selection.colourSet : 'warm';
  return { version: readingLookVersion, world, colourSet };
}
// Diary doodles prints text, rules, borders and badges in black and greys too.
const inkFurniture = { light: ';--ink:#1f1f1f;--green:#1f1f1f;--border:#6f6f6f;--rule:#5f5f5f;--badge:#e9e9e6;--card:#fffefb', dark: ';--ink:#ecebe8;--green:#ecebe8;--border:#a3a3a3;--rule:#b3b3b3;--badge:#3a3a3a;--card:#2b2b2b' };
const paletteRule = (name, colours, prefix = '') => {
  const furniture = name === inkColourSet ? inkFurniture[colours === readingPalettes[name].dark ? 'dark' : 'light'] : '';
  const tokens = colours.map((colour, i) => `${['--paper', '--green-tint', '--coral-tint', '--orange-tint'][i]}:${colour}`).join(';') + furniture;
  const selector = `.sheet[data-reading-look="${readingLookVersion}"][data-reading-palette="${name}"]`;
  return `${prefix}${selector}{${tokens}}`;
};
export const readingLookCSS = Object.entries(readingPalettes).map(([name, palettes]) => paletteRule(name, palettes.light) + '\n' + paletteRule(name, palettes.dark, 'html[data-theme=dark] ')).join('\n') + '\n@media print{' + Object.entries(readingPalettes).map(([name, palettes]) => paletteRule(name, palettes.light, 'html[data-theme] ')).join('\n') + '}';

// Only a checked, unchanged raster can be placed in the reading cards.
export function checkedReadingArt(manifest) {
  if (!manifest) return null;
  if (manifest.status === 'omitted' && manifest.ready === false && manifest.verified === false) return null;
  const accepted = manifest.status === 'checked' && manifest.verified === true || manifest.status === 'parent-review' && manifest.verified === false;
  if (manifest.ready !== true || !accepted || !existsSync(manifest.file ?? '')) throw Error('Reading art needs its unchanged drawing and receipt.');
  const bytes = readFileSync(manifest.file), sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || sha256 !== manifest.sha256 || bytes.readUInt32BE(16) !== manifest.width || bytes.readUInt32BE(20) !== manifest.height) throw Error('Reading art bytes or dimensions changed.');
  if (!Array.isArray(manifest.cells) || !manifest.cells.length || manifest.cells.some(cell => {
    const r = cell.rect;
    return cell.personId !== null && !isCastId(cell.personId) || !r || ![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > manifest.width || r.y + r.height > manifest.height;
  })) throw Error('Reading art has an invalid character crop.');
  const filename = manifest.filename ?? 'reading-art.png';
  if (!/^[a-zA-Z0-9][\w.-]*\.png$/.test(filename)) throw Error('Reading art needs a local PNG filename.');
  return { ...manifest, filename };
}

// This runs after the ordinary page fit. Art never changes the text flow.
export function fitReadingArt() {
  const assets = [], faults = [], pt = n => n * 72 / 96;
  for (const art of document.querySelectorAll('[data-reading-art]')) {
    const host = art.closest('.card'), image = art.querySelector('img');
    const box = host.getBoundingClientRect(), ink = [];
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) if (node.textContent.trim() && !node.parentElement.closest('[data-reading-art]')) {
      const range = document.createRange(); range.selectNodeContents(node);
      for (const r of range.getClientRects()) if (r.width && r.height) ink.push(r);
    }
    const record = { personId: art.dataset.personId, page: host.closest('.sheet').dataset.page, card: host.dataset.card, assetHash: art.dataset.assetHash, placed: false };
    if (!image?.complete || !image.naturalWidth) {
      art.hidden = true; record.reason = 'Raster did not decode.'; faults.push(`${record.page}: checked reading raster did not decode.`); assets.push(record); continue;
    }
    const aspect = Number(art.dataset.aspect), maxHeight = Number(art.dataset.maxHeight) * 96 / 72;
    const maxWidth = Number(art.dataset.maxWidth) * 96 / 72, padding = 8 * 96 / 72, gap = 4 * 96 / 72;
    const height = Math.min(maxHeight, maxWidth / aspect, box.height - 2 * padding);
    for (const factor of [1, .9, .8, .7, .6, .5]) {
      const h = height * factor, w = h * aspect;
      if (h < 30 * 96 / 72) continue;
      for (const top of [(box.height - h) / 2, padding, box.height - padding - h]) {
        const left = box.width - padding - w;
        const target = { left: box.left + left, right: box.left + left + w, top: box.top + top, bottom: box.top + top + h };
        if (ink.some(r => target.left < r.right + gap && target.right > r.left - gap && target.top < r.bottom + gap && target.bottom > r.top - gap)) continue;
        Object.assign(art.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`, visibility: 'visible' });
        const actual = art.getBoundingClientRect();
        const collisions = ink.filter(r => actual.left < r.right + gap && actual.right > r.left - gap && actual.top < r.bottom + gap && actual.bottom > r.top - gap);
        const outside = actual.left < box.left || actual.top < box.top || actual.right > box.right || actual.bottom > box.bottom;
        if (collisions.length || outside) { art.style.visibility = 'hidden'; continue; }
        Object.assign(record, { placed: true, scale: factor, clearOfText: true, bounds: { x: pt(actual.x - box.x), y: pt(actual.y - box.y), w: pt(actual.width), h: pt(actual.height) }, gapPoints: 4 });
        break;
      }
      if (record.placed || record.reason) break;
    }
    if (!record.placed && !record.reason) { art.hidden = true; record.reason = 'Omitted to preserve all text and its existing type and card.'; }
    assets.push(record);
  }
  return { ready: faults.length === 0, assets, faults, method: 'Actual text-node line rectangles, four-point clearance, unchanged card bounds. Optional art shrinks or is omitted; text never moves.' };
}
