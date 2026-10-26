import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readJSON, saveJSON } from './files.js';
import { emailAddress, tokenHash } from './accounts.js';

const execFileAsync = promisify(execFile);
export const ownerNotifierPath = join(homedir(), 'bin', 'tell-sunny');
const idOK = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const fields = ['adultName', 'claimToken', 'email', 'id', 'kind', 'requestId'];
export function validateOwnerAlert(alert) {
  if (!alert || Object.keys(alert).sort().join() !== fields.sort().join() || alert.kind !== 'owner-access-alert' || !idOK(alert.id) || !idOK(alert.requestId)
      || typeof alert.claimToken !== 'string' || !/^[a-f0-9]{64}$/.test(alert.claimToken) || typeof alert.email !== 'string' || emailAddress(alert.email) !== alert.email
      || typeof alert.adultName !== 'string' || alert.adultName.length > 80 || !/^[\p{L}\p{M} .’'-]*$/u.test(alert.adultName)) throw Error('Invalid fixed owner alert.');
  return alert;
}
export async function executeOwnerAlert(alert, { origin, directory, execute = execFileAsync } = {}) {
  validateOwnerAlert(alert);
  const base = new URL(origin);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw Error('Owner alerts need the configured app address.');
  if (base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw Error('Owner alerts need the configured app origin only.');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `${alert.id}.json`), subject = `Story Poster access request ${alert.requestId}`;
  const expectedReceipt = `delivered: ${subject}`, binding = tokenHash(JSON.stringify({ id: alert.id, requestId: alert.requestId, email: alert.email, adultName: alert.adultName, origin: base.origin }));
  if (existsSync(file)) { const saved = readJSON(file); if (saved.binding !== binding) throw Error('A saved owner alert changed.'); if (saved.delivered === true && saved.receipt === expectedReceipt) return { delivered: true, receipt: saved.receipt }; }
  saveJSON(file, { binding, delivered: false, status: 'sending', updatedAt: new Date().toISOString() });
  const link = new URL('/#owner', base.origin).href;
  const body = `${alert.adultName || 'A grown-up'} (${alert.email}) asked for Story Poster access.\n\nOpen your owner page to approve or decline after signing in:\n${link}`;
  try {
    const result = await execute(ownerNotifierPath, [subject, body], { timeout: 30000, maxBuffer: 8192, windowsHide: true });
    // Exit0 also occurs when the tool holds back a repeat. Only its exact real
    // delivery receipt, or our matching durable prior receipt, proves success.
    if (!String(result.stdout ?? '').split(/\r?\n/).includes(expectedReceipt)) throw Error('Delivery was not confirmed.');
    const saved = { binding, delivered: true, receipt: expectedReceipt, updatedAt: new Date().toISOString() }; saveJSON(file, saved); return { delivered: true, receipt: expectedReceipt };
  } catch { saveJSON(file, { binding, delivered: false, status: 'retry', updatedAt: new Date().toISOString() }); return { delivered: false }; }
}
export async function runOwnerAlerts({ request, origin, directory, signal, execute = executeOwnerAlert, wait = ms => new Promise(resolve => { const timer = setTimeout(done, ms); function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); } signal?.addEventListener('abort', done, { once: true }); }) } = {}) {
  while (!signal?.aborted) {
    try {
      const { alert } = await request('/api/worker/alerts/poll');
      if (alert) {
        validateOwnerAlert(alert);
        const result = await execute(alert, { origin, directory });
        await request('/api/worker/alerts/complete', { alertId: alert.id, claimToken: alert.claimToken, ...result });
      }
    } catch { /* Durable cloud rows and local delivery receipts survive retry. */ }
    if (!signal?.aborted) await wait(4000);
  }
}
