import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, chmodSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createFileDigests } from './browser-previews.js';

const run = promisify(execFile);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pageNames = [1, 2, 3, 4, 5].map(page => `${page}.png`);
const version = 'saved-pdf-pages-v1';
const regular = path => { try { const stat = lstatSync(path); return stat.isFile() && !stat.isSymbolicLink(); } catch { return false; } };
const safeDirectory = path => { try { const stat = lstatSync(path); return stat.isDirectory() && !stat.isSymbolicLink(); } catch { return false; } };
const unavailable = () => Object.assign(Error('These saved pages are not available. You can try again or open the PDF.'), { status: 404 });

// Render the saved PDF itself, so old words and artwork cannot drift from the download.
export async function renderSavedPages({ pdf, output }) {
  const { stdout } = await run('pdfinfo', [pdf], { maxBuffer: 1024 * 1024 });
  if (!/^Pages:\s+5\s*$/m.test(stdout)) throw unavailable();
  await run('pdftoppm', ['-f', '1', '-l', '5', '-scale-to', '1800', '-png', pdf, join(output, 'page')], { maxBuffer: 1024 * 1024 });
  for (const [index, name] of pageNames.entries()) renameSync(join(output, `page-${index + 1}.png`), join(output, name));
}

export function createKitPages({ render = renderSavedPages } = {}) {
  let tail = Promise.resolve();
  const active = new Map();
  const fileDigest = createFileDigests();
  function checked(directory) {
    if (!safeDirectory(directory)) return false;
    try {
      const receipt = JSON.parse(readFileSync(join(directory, 'receipt.json'), 'utf8'));
      return receipt.version === version && pageNames.every(name => regular(join(directory, name)) && fileDigest(join(directory, name)) === receipt.files[name]);
    } catch { return false; }
  }
  async function pageFile({ source, cacheRoot = join(source, 'reader-pages'), page, isCurrent = () => true }) {
    if (!Number.isInteger(page) || page < 1 || page > 5) throw unavailable();
    source = resolve(source); cacheRoot = resolve(cacheRoot);
    const pdf = join(source, 'kit_final.pdf');
    if (!safeDirectory(source) || !regular(pdf) || !isCurrent()) throw unavailable();
    const hash = fileDigest(pdf), directory = join(cacheRoot, `${version}-${hash}`);
    const current = () => safeDirectory(source) && regular(pdf) && isCurrent() && fileDigest(pdf) === hash;
    if (!checked(directory)) {
      const key = source + ':' + directory;
      if (!active.has(key)) {
        const work = tail.catch(() => {}).then(async () => {
          if (!current()) throw unavailable();
          if (checked(directory)) return;
          const temporary = mkdtempSync(join(tmpdir(), 'story-reader-'));
          try {
            const input = join(temporary, 'saved.pdf');
            const bytes = readFileSync(pdf);
            if (digest(bytes) !== hash) throw unavailable();
            writeFileSync(input, bytes, { mode: 0o600 });
            await render({ pdf: input, output: temporary });
            if (!pageNames.every(name => regular(join(temporary, name)))) throw unavailable();
            const files = Object.fromEntries(pageNames.map(name => [name, digest(readFileSync(join(temporary, name)))]));
            rmSync(input);
            writeFileSync(join(temporary, 'receipt.json'), JSON.stringify({ version, sourceSHA256: hash, files }), { mode: 0o600 });
            for (const name of pageNames) chmodSync(join(temporary, name), 0o600);
            // This final synchronous check and copy prevent a deleted family
            // from being recreated by a render that was already running.
            if (!current()) throw unavailable();
            mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
            if (!safeDirectory(cacheRoot)) throw unavailable();
            // The saved kits may live on a different mounted disk from /tmp.
            const staged = mkdtempSync(join(cacheRoot, '.pages-'));
            try {
              for (const name of [...pageNames, 'receipt.json']) copyFileSync(join(temporary, name), join(staged, name));
              rmSync(directory, { recursive: true, force: true });
              renameSync(staged, directory);
            } finally { rmSync(staged, { recursive: true, force: true }); }
          } finally { rmSync(temporary, { recursive: true, force: true }); }
        });
        active.set(key, work);
        tail = work;
        work.finally(() => active.delete(key)).catch(() => {});
      }
      await active.get(key);
    }
    if (!current() || !checked(directory)) throw unavailable();
    return { directory, name: `${page}.png`, isCurrent: current };
  }
  return { pageFile, settled: () => tail.catch(() => {}) };
}
