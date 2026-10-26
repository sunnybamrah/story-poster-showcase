// Compare spoken words, not typography or empty handwriting rules.
export function normalizedWords(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'")
    .replace(/([\p{L}\p{N}])[-‐‑‒–—]\s*\r?\n\s*(?=[\p{L}\p{N}])/gu, '$1')
    .replace(/[-‐‑‒–—]/gu, ' ')
    .match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
}
const equal = (a, b) => a.length === b.length && a.every((word, index) => word === b[index]);
export function wordsForBox(text, heading = '') {
  const words = normalizedWords(text), title = normalizedWords(heading);
  if (!title.length || !equal(words.slice(0, title.length), title)) return words;
  // A heading copied twice by the reader is counted once, only at the start.
  let at = title.length;
  while (equal(words.slice(at, at + title.length), title)) at += title.length;
  return [...title, ...words.slice(at)];
}
function editDistance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next[j + 1] = Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1));
    row = next;
  }
  return row[b.length];
}
export function compareBoxWords(box, readText) {
  const approved = wordsForBox([box.title, box.text].filter(Boolean).join('\n'), box.title);
  let read = wordsForBox(readText, box.title);
  // Match a word split at a line-end hyphen to its approved spelling. Ordinary
  // hyphenated compounds and the same words separated by spaces also agree.
  const joinedApproved = approved.join('');
  if (!equal(approved, read) && read.join('') === joinedApproved) {
    // Only normalize joins supported by a hyphen in one of the original strings.
    const source = [box.title, box.text, readText].filter(Boolean).join('\n');
    if (/[\p{L}\p{N}][-‐‑‒–—]\s*[\p{L}\p{N}]/u.test(source)) {
      const compact = text => String(text).normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/([\p{L}\p{N}])[-‐‑‒–—]\s*(?=[\p{L}\p{N}])/gu, '$1');
      if (equal(wordsForBox(compact([box.title, box.text].filter(Boolean).join('\n')), compact(box.title ?? '')), wordsForBox(compact(readText), compact(box.title ?? '')))) read = [...approved];
    }
  }
  const table = Array.from({ length: approved.length + 1 }, () => Array(read.length + 1).fill(0));
  for (let i = 0; i <= approved.length; i++) table[i][0] = i;
  for (let j = 0; j <= read.length; j++) table[0][j] = j;
  for (let i = 1; i <= approved.length; i++) for (let j = 1; j <= read.length; j++) table[i][j] = Math.min(table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + (approved[i - 1] === read[j - 1] ? 0 : 1));
  const extra = [], missing = [], misspelled = [];
  let i = approved.length, j = read.length;
  while (i || j) {
    if (i && j && approved[i - 1] === read[j - 1] && table[i][j] === table[i - 1][j - 1]) { i--; j--; }
    else if (i && j && table[i][j] === table[i - 1][j - 1] + 1) {
      const expected = approved[--i], actual = read[--j];
      if (editDistance(expected, actual) <= Math.max(1, Math.floor(expected.length / 3))) misspelled.unshift({ approved: expected, read: actual });
      else { missing.unshift(expected); extra.unshift(actual); }
    } else if (i && table[i][j] === table[i - 1][j] + 1) missing.unshift(approved[--i]);
    else extra.unshift(read[--j]);
  }
  return { id: box.id, approvedText: [box.title, box.text].filter(Boolean).join('\n'), readText, approved, read, extra, missing, misspelled, matches: equal(approved, read) };
}
export const wordDifferenceReason = diff => `words_differ_in_${diff.id}: approved=${JSON.stringify(diff.approved)}; read=${JSON.stringify(diff.read)}; extra=${JSON.stringify(diff.extra)}; missing=${JSON.stringify(diff.missing)}; misspelled=${JSON.stringify(diff.misspelled)}`;
