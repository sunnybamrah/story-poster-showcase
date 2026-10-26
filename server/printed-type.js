import { readFileSync } from 'node:fs';

// Bundled font advances for offline capacity estimates. Browser ranges remain
// the authority: kerning, weight changes and line fragments need a real render.
const fonts = new Map();
function fontData(family) {
  if (fonts.has(family)) return fonts.get(family);
  const bytes = readFileSync(new URL(`../content/fonts/${family}-Variable.ttf`, import.meta.url));
  const tables = {};
  for (let i = 0; i < bytes.readUInt16BE(4); i++) {
    const at = 12 + i * 16;
    tables[bytes.toString('ascii', at, at + 4)] = bytes.readUInt32BE(at + 8);
  }
  const cmap = tables.cmap, count = bytes.readUInt16BE(cmap + 2);
  let mapping;
  for (let i = 0; i < count; i++) {
    const offset = cmap + bytes.readUInt32BE(cmap + 4 + i * 8 + 4), format = bytes.readUInt16BE(offset);
    if (format === 4 || format === 12) { mapping = { offset, format }; if (format === 12) break; }
  }
  const glyph = code => {
    const { offset, format } = mapping;
    if (format === 12) {
      for (let i = 0; i < bytes.readUInt32BE(offset + 12); i++) {
        const at = offset + 16 + i * 12, start = bytes.readUInt32BE(at), end = bytes.readUInt32BE(at + 4);
        if (code >= start && code <= end) return bytes.readUInt32BE(at + 8) + code - start;
      }
    } else {
      const n = bytes.readUInt16BE(offset + 6) / 2, ends = offset + 14, starts = ends + n * 2 + 2, deltas = starts + n * 2, offsets = deltas + n * 2;
      for (let i = 0; i < n; i++) if (code >= bytes.readUInt16BE(starts + i * 2) && code <= bytes.readUInt16BE(ends + i * 2)) {
        const delta = bytes.readInt16BE(deltas + i * 2), range = bytes.readUInt16BE(offsets + i * 2);
        if (!range) return (code + delta) & 65535;
        const value = bytes.readUInt16BE(offsets + i * 2 + range + (code - bytes.readUInt16BE(starts + i * 2)) * 2);
        return value ? (value + delta) & 65535 : 0;
      }
    }
    return 0;
  };
  const metrics = bytes.readUInt16BE(tables.hhea + 34), units = bytes.readUInt16BE(tables.head + 18);
  const data = { advance: char => bytes.readUInt16BE(tables.hmtx + Math.min(glyph(char.codePointAt(0)), metrics - 1) * 4) / units };
  fonts.set(family, data); return data;
}
export const printedWidth = (text, size, family = 'Nunito') => [...text].reduce((sum, char) => sum + fontData(family).advance(char) * size, 0);
export function printedLines(text, width, size, family = 'Nunito') {
  const lines = [];
  for (const paragraph of text.split(/\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && printedWidth(line + word, size, family) > width) { lines.push(line.trim()); line = ''; }
      for (const char of word) {
        if (printedWidth(line + char, size, family) > width && line) { lines.push(line); line = ''; }
        line += char;
      }
      line += ' ';
    }
    if (line.trim()) lines.push(line.trim());
  }
  return lines;
}
export function fitType(text, { width, height, maximum = 14, minimum = 12, lineHeight = 1.12, family = 'Nunito' }) {
  for (let size = maximum; size >= minimum; size--) {
    const lines = printedLines(text, width, size, family), used = lines.length * size * lineHeight;
    if (used <= height || size === minimum) return { fontPoints: size, lineHeight, lines: lines.length, height: used, available: height, margin: height - used, fits: used <= height, measured: false };
  }
}
