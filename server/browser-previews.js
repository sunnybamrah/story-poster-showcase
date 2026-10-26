import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import sharp from 'sharp';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const unavailable = () => Object.assign(Error('This saved picture is not available.'), { status: 404 });
export const safeDirectory = path => { try { const stat = lstatSync(path); return stat.isDirectory() && !stat.isSymbolicLink(); } catch { return false; } };

// Check the file on every call, even when its content hash is already known.
// ctime and inode also catch replacements and edits that restore the old mtime.
export function createFileDigests({ read = readFileSync, limit = 256 } = {}) {
  const entries = new Map();
  const fingerprint = path => {
    const stat = lstatSync(path, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink()) throw unavailable();
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
  };
  return path => {
    const before = fingerprint(path), previous = entries.get(path);
    if (previous?.fingerprint === before) { entries.delete(path); entries.set(path, previous); return previous.hash; }
    const hash = digest(read(path));
    if (fingerprint(path) !== before) throw unavailable();
    entries.delete(path); entries.set(path, { fingerprint: before, hash });
    if (entries.size > limit) entries.delete(entries.keys().next().value);
    return hash;
  };
}

// Browser copies never replace print files. Each copy is tied to its source bytes.
export function createBrowserPreviews({ convert = async (bytes, width) => sharp(bytes).resize({ width, withoutEnlargement: true }).webp({ quality: 85, effort: 5 }).toBuffer() } = {}) {
  const fileDigest = createFileDigests(), active = new Map();
  let tail = Promise.resolve();
  async function previewFile({ source, cacheRoot = join(dirname(source), 'browser-previews'), width = 1600, isCurrent = () => true }) {
    if (!safeDirectory(dirname(source)) || !isCurrent()) throw unavailable();
    const hash = fileDigest(source), name = `webp-v1-${width}-${hash}.webp`, path = join(cacheRoot, name);
    const current = () => {
      try { return safeDirectory(dirname(source)) && isCurrent() && fileDigest(source) === hash; } catch { return false; }
    };
    const checked = () => {
      try { return safeDirectory(cacheRoot) && fileDigest(path) === readFileSync(path + '.sha256', 'utf8'); } catch { return false; }
    };
    if (!checked()) {
      if (!active.has(path)) {
        const work = tail.catch(() => {}).then(async () => {
          if (!current()) throw unavailable();
          if (checked()) return;
          const original = readFileSync(source);
          if (digest(original) !== hash) throw unavailable();
          const bytes = await convert(original, width);
          if (!current()) throw unavailable();
          mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
          if (!safeDirectory(cacheRoot)) throw unavailable();
          const temporary = path + '.tmp';
          try {
            writeFileSync(temporary, bytes, { mode: 0o600 });
            renameSync(temporary, path);
            writeFileSync(path + '.sha256', digest(bytes), { mode: 0o600 });
          } finally { rmSync(temporary, { force: true }); }
        });
        active.set(path, work); tail = work;
        work.finally(() => active.delete(path)).catch(() => {});
      }
      await active.get(path);
    }
    if (!current() || !checked()) throw unavailable();
    return { directory: cacheRoot, name, version: fileDigest(path) };
  }
  return { previewFile };
}
