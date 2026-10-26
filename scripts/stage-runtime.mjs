// Export one reviewed Git revision through an existing runtime allowlist, never private working files.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { resolve, join, dirname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const [manifestPath, revision, outputPath] = process.argv.slice(2);
if (!manifestPath || !revision || !outputPath) throw Error('Usage: node scripts/stage-runtime.mjs BASE_MANIFEST GIT_REVISION RECEIPT_FOLDER');
const base = JSON.parse(readFileSync(manifestPath, 'utf8'));
const commit = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', revision + '^{commit}'], { encoding: 'utf8' }).trim();
const paths = base.files.map(row => row.path);
if (!paths.length || new Set(paths).size !== paths.length || paths.some(name => typeof name !== 'string' || name.startsWith('/') || name.includes('\\') || name.includes('\0') || name.split('/').some(part => !part || part === '.' || part === '..') || /^(?:context|node_modules|app-dist|\.git)(?:\/|$)/.test(name) || /(?:^|\/)\.env(?:$|\.)/.test(name))) throw Error('Unsafe or duplicate runtime path.');
const root = realpathSync(process.cwd()), context = realpathSync(join(root, 'context')), output = resolve(outputPath);
if (!output.startsWith(context + sep)) throw Error('Receipt folder must be inside this project’s context folder.');
mkdirSync(output, { recursive: true });
if (!realpathSync(output).startsWith(context + sep)) throw Error('Receipt folder cannot point outside context.');
const directory = mkdtempSync(join(tmpdir(), 'story-poster-runtime-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = paths.map(name => {
  const mode = execFileSync('git', ['--literal-pathspecs', 'ls-tree', commit, '--', name], { encoding: 'utf8' });
  if (!/^100(?:644|755) blob /.test(mode)) throw Error('Runtime input must be a committed regular file: ' + name);
  const bytes = execFileSync('git', ['show', commit + ':' + name], { maxBuffer: 128 * 1024 * 1024 });
  const target = join(directory, name); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes, { mode: mode.startsWith('100755') ? 0o755 : 0o644 });
  return { path: name, bytes: bytes.length, sha256: hash(bytes) };
});
const receipt = { createdAt: new Date().toISOString(), commit, baseCommit: base.commit, workingTreeSnapshot: false, freezePending: false, uploadAuthorized: false, directory, fileCount: files.length, totalBytes: files.reduce((sum, row) => sum + row.bytes, 0), changedRuntimeFiles: files.filter(row => base.files.find(old => old.path === row.path)?.sha256 !== row.sha256).map(row => row.path), files };
writeFileSync(join(output, 'package.json'), JSON.stringify(receipt, null, 2) + '\n');
writeFileSync(join(output, 'files.sha256'), files.map(row => `${row.sha256}  ${row.path}`).join('\n') + '\n');
console.log(JSON.stringify({ directory, commit, fileCount: files.length, totalBytes: receipt.totalBytes, changedRuntimeFiles: receipt.changedRuntimeFiles }));
