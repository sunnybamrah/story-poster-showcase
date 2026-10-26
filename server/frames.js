import { assessGenerationCheck as assessCheck } from './stop-policy.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { root, readJSON, saveJSON } from './files.js';
import { imageData, imageHash, pngFrom } from './picture.js';
import { buildFrameRequest, buildFrameCheckRequest, privacyFor } from './requests.js';
import { parsePictureCheck, pictureCheckFromResponse } from './check-picture.js';

import { runCheck } from './checker-contract.js';
import { pictureStyleFor } from './graphic-style.js';
const style = readJSON(new URL('../content/style.json', import.meta.url));
export const frameDirectory = join(root, 'content/frames');
const framePaths = (directory, profile) => {
  const prefix = profile.id === 'detailed-comic' ? style.id : profile.id;
  return { path: join(directory, `${prefix}-frame.png`), receipt: join(directory, `${prefix}-frame.json`) };
};

export function checkedFrame(directory = frameDirectory, recordOrId) {
  const profile = pictureStyleFor(recordOrId), paths = framePaths(directory, profile);
  if (!existsSync(paths.path) || !existsSync(paths.receipt)) throw new Error('Drawn frame pending. One generation and a picture check are required.');
  const receipt = readJSON(paths.receipt);
  const parsed = assessCheck(parsePictureCheck(JSON.stringify(receipt.check?.answers)), { final: receipt.check?.checkerAttempt > 1 });
  const png = readFileSync(paths.path);
  const styleMatches = receipt.pictureStyleId ? receipt.pictureStyleId === profile.id && receipt.pictureStyleVersion === profile.version && receipt.styleReferenceHash === profile.referenceHash && receipt.styleLine === profile.rule : profile.id === 'detailed-comic' && receipt.styleId === style.id && receipt.styleLine === style.line;
  if (!styleMatches || receipt.generations !== 1 || !receipt.ready || !parsed.ready || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || imageHash(paths.path) !== receipt.hash) throw new Error('The saved frame or its letter check changed.');
  return { ...receipt, path: paths.path };
}

// The exclusive receipt is written before the send. A crash cannot buy another frame.
export async function readyFrame(transport, record, tonight, { kit, directory = frameDirectory } = {}) {
  const profile = pictureStyleFor(record), paths = framePaths(directory, profile);
  if (existsSync(paths.receipt)) return checkedFrame(directory, record);
  const body = buildFrameRequest(record, tonight);
  mkdirSync(directory, { recursive: true });
  const receipt = { styleId: style.id, pictureStyleId: profile.id, pictureStyleVersion: profile.version, styleReferenceHash: profile.referenceHash, styleLine: profile.rule, generations: 1, ready: false, state: 'generation-started' };
  writeFileSync(paths.receipt, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    const response = await transport.call({ provider: 'openai', path: body.image ? '/v1/images/edits' : '/v1/images/generations', stage: 'frame', kit, body, privacy: privacyFor(record, tonight) });
    const bytes = pngFrom(response);
    writeFileSync(paths.path, bytes, { flag: 'wx', mode: 0o600 });
    const check = await runCheck(transport, { provider: 'openai', path: '/v1/responses', stage: 'frame-check', kit,
      body: buildFrameCheckRequest(record, tonight, imageData(paths.path)), privacy: privacyFor(record, tonight) }, response => pictureCheckFromResponse(response, { generation: true }));
    transport.recordVerdict?.(response, check.ready ? 'PASS' : check.faults.join('; '));
    Object.assign(receipt, { hash: createHash('sha256').update(bytes).digest('hex'), check, ready: check.ready, state: check.ready ? 'checked' : 'rejected' });
    saveJSON(paths.receipt, receipt);
    if (!check.ready) throw new Error(`Drawn frame failed: ${check.faults.join(', ')}. No automatic second generation.`);
    return checkedFrame(directory, record);
  } catch (error) {
    saveJSON(paths.receipt, { ...receipt, error: error.message });
    throw error;
  }
}
