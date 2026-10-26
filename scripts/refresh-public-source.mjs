// Refresh a private public-source candidate from hash-verified reviewed files and a checked revision. Never publish or copy history.
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join, dirname, sep } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const [basePath, manifestPath, baseRevision, targetRevision, outputPath, receiptPath, runtimeManifestPath] = process.argv.slice(2);
if (!receiptPath) throw Error('Usage: node scripts/refresh-public-source.mjs BASE_DIRECTORY MANIFEST BASE_REVISION TARGET_REVISION OUTPUT_DIRECTORY RECEIPT_DIRECTORY [CHECKED_RUNTIME_MANIFEST]');
const root = realpathSync(process.cwd()), context = realpathSync(join(root, 'context'));
const base = realpathSync(resolve(basePath)), output = resolve(outputPath), receipt = resolve(receiptPath);
if (![base, output, receipt].every(p => p.startsWith(context + sep)) || existsSync(output) || output === receipt) throw Error('Use separate new candidate and receipt folders inside context.');
mkdirSync(receipt, { recursive: true }); if (!realpathSync(receipt).startsWith(context + sep)) throw Error('Receipt points outside context.');
mkdirSync(output); if (!realpathSync(output).startsWith(context + sep)) throw Error('Output points outside context.');
const git = args => execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024 });
const revision = value => git(['rev-parse', '--verify', '--end-of-options', value + '^{commit}']).toString().trim();
const oldRevision = revision(baseRevision), commit = revision(targetRevision);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const rows = JSON.parse(readFileSync(manifestPath));
const safePath = p => typeof p === 'string' && !p.startsWith('/') && !p.includes('\\') && !p.includes('\0') && !p.split('/').some(x => !x || x === '.' || x === '..') && !/^(?:context|node_modules|app-dist|\.git)(?:\/|$)/.test(p) && !/(?:^|\/)\.env(?:$|\.(?!example$))/.test(p);
if (!Array.isArray(rows) || rows.some(r => !safePath(r.path)) || new Set(rows.map(r => r.path)).size !== rows.length) throw Error('Invalid reviewed manifest.');
const previous = new Map();
for (const row of rows) {
  let bytes = existsSync(join(base, row.path)) ? readFileSync(join(base, row.path)) : Buffer.alloc(0);
  if (hash(bytes) !== row.sha256) bytes = git(['-C', base, 'show', ':' + row.path]);
  if (hash(bytes) !== row.sha256) throw Error('Reviewed bytes unavailable: ' + row.path);
  previous.set(row.path, bytes);
}
const oldPaths = new Set(git(['ls-tree', '-r', '--name-only', oldRevision]).toString().trim().split('\n'));
const newPaths = new Set(git(['ls-tree', '-r', '--name-only', commit]).toString().trim().split('\n'));
const runtime = JSON.parse(readFileSync(runtimeManifestPath ? resolve(runtimeManifestPath) : join(context, 'progress-outfits-2026-10-25/release/package.json')));
if (runtime.commit !== commit) throw Error('Target is not the checked runtime manifest.');
const paths = new Set([...previous.keys(), ...runtime.files.map(r => r.path), ...[...newPaths].filter(p => /^test\/[^/]+\.mjs$/.test(p)), ...[...newPaths].filter(p => /^scripts\/[^/]+\.mjs$/.test(p))]);
const preserve = p => /^(?:README\.md|SPEC\.md|TOOLBOX\.md|devpost\/)/.test(p);
const changes = [], files = [];
for (const name of [...paths].sort()) {
  if (!safePath(name)) throw Error('Unsafe path: ' + name);
  const reviewed = previous.get(name); let bytes = reviewed;
  if (newPaths.has(name) && !preserve(name)) {
    const mode = git(['ls-tree', commit, '--', name]).toString(); if (!/^100(?:644|755) blob /.test(mode)) throw Error('Source is not a regular file: ' + name);
    const next = git(['show', commit + ':' + name]);
    const original = oldPaths.has(name) ? git(['show', oldRevision + ':' + name]) : null;
    if (!reviewed || !original || hash(reviewed) === hash(original)) bytes = next;
    else if (hash(next) !== hash(original)) {
      const scratch = join(receipt, 'merge'); mkdirSync(scratch, { recursive: true });
      writeFileSync(join(scratch, 'public'), reviewed); writeFileSync(join(scratch, 'base'), original); writeFileSync(join(scratch, 'current'), next);
      const merged = spawnSync('git', ['merge-file', '-p', join(scratch, 'public'), join(scratch, 'base'), join(scratch, 'current')], { maxBuffer: 128 * 1024 * 1024 });
      if (merged.status !== 0) throw Error('Review public merge before proceeding: ' + name);
      bytes = merged.stdout;
    }
  }
  if (!bytes) continue;
  const file = join(output, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes);
  const entry = { path: name, bytes: bytes.length, sha256: hash(bytes) }; files.push(entry);
  if (!reviewed || hash(reviewed) !== entry.sha256) changes.push(name);
}
writeFileSync(join(receipt, 'export.json'), JSON.stringify({ commit, baseRevision: oldRevision, directory: output, inheritedHistory: false, published: false, files, changedFromReviewedCandidate: changes }, null, 2) + '\n');
console.log(JSON.stringify({ directory: output, commit, files: files.length, changedFiles: changes.length, published: false }));
