import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This exact, inspected fictional kit is the public example. Private jobs are
// never discovered or copied by this loader.
export const publicSampleManifestSHA256 = 'd4f91518289bc90f1fa0b518bfbed498a4ae270a10cc699573248c7e2e4197f2';
export const publicSampleDirectory = fileURLToPath(new URL('../content/public-sample/', import.meta.url));
const requiredAssets = ['poster.png', 'poster.pdf', 'kit_final.pdf', 'poster-bw.pdf', 'kit-bw.pdf', ...[1, 2, 3, 4].map(n => `panel-${n}.png`)];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
let checkedDefault;

export function loadPublicSample({ directory = publicSampleDirectory } = {}) {
  const isDefault = resolve(directory) === resolve(publicSampleDirectory);
  if (isDefault && checkedDefault !== undefined) return structuredClone(checkedDefault);
  let sample = null;
  try {
    const manifestPath = join(directory, 'manifest.json');
    if (!lstatSync(manifestPath).isFile()) return null;
    const bytes = readFileSync(manifestPath);
    if (digest(bytes) !== publicSampleManifestSHA256) return null;
    const manifest = JSON.parse(bytes);
    if (manifest.schemaVersion !== 1 || manifest.fictional !== true || manifest.record?.real !== false || manifest.text?.ready !== true || manifest.move?.id !== manifest.text?.moveId) return null;
    if (JSON.stringify(Object.keys(manifest.assets).sort()) !== JSON.stringify([...requiredAssets].sort())) return null;
    for (const name of requiredAssets) {
      const file = join(directory, name), expected = manifest.assets[name];
      if (!lstatSync(file).isFile()) return null;
      const asset = readFileSync(file);
      if (asset.length !== expected.bytes || digest(asset) !== expected.sha256) return null;
    }
    sample = { directory, text: manifest.text, record: manifest.record, move: manifest.move,
      printCopy: { status: 'ready', message: 'Your black-and-white print copy is ready.', assets: { posterPdf: '/api/sample/files/poster-bw.pdf', kitPdf: '/api/sample/files/kit-bw.pdf' } } };
  } catch {
    // The page can still offer sign-in and requests if a public sample is absent.
  }
  if (isDefault) checkedDefault = sample;
  return structuredClone(sample);
}
