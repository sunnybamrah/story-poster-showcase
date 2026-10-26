import { copyFileSync, existsSync, mkdirSync, mkdtempSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// Render and inspect a candidate before publishing it. Rejected bytes remain
// evidence; an interrupted/unaccepted final file cannot poison the next resume.
export async function exportAttempt(path, { replaceUnaccepted = false } = {}, render) {
  if (existsSync(path) && !replaceUnaccepted) throw new Error('Refusing to overwrite an existing export or count it as a new render.');
  const attempts = join(dirname(path), 'export-attempts');
  mkdirSync(attempts, { recursive: true, mode: 0o700 });
  const directory = mkdtempSync(join(attempts, `${basename(path)}-`));
  const candidate = join(directory, basename(path));
  const result = await render(candidate);
  if (!result?.rendered) return { ...result, candidate };
  if (!existsSync(candidate)) throw new Error('Accepted export candidate is missing.');
  if (existsSync(path)) copyFileSync(path, join(directory, `previous-${basename(path)}`));
  // Retain accepted candidate evidence too. Only the final rename publishes.
  const publishing = join(directory, `publish-${basename(path)}`);
  copyFileSync(candidate, publishing);
  renameSync(publishing, path);
  return { ...result, candidate };
}
