import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { saveJSON, readJSON } from './files.js';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest();
const safeToken = (left, right) => typeof left === 'string' && typeof right === 'string' && timingSafeEqual(hash(left), hash(right));
const error = message => Object.assign(Error(message), { status: 503, canResume: true });
// Only request receipts survive a restart. Prompt/image payloads live in memory.
// A lost worker claim is never reassigned: its real outcome may be unknown.
export function createWorkerBridge({ db, persist, flush = async () => {}, secret, resultDirectory, ownerAlerts, now = Date.now }) {
  if (typeof secret !== 'string' || secret.length < 32) throw Error('Set a worker secret of at least 32 characters.');
  if (!resultDirectory) throw Error('A private generated-result directory is required.');
  mkdirSync(resultDirectory, { recursive: true, mode: 0o700 });
  const resultFile = id => { if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid request identity.'); return join(resultDirectory, `${id}.json`); };
  const savedResult = receipt => {
    if (!receipt || !existsSync(resultFile(receipt.id))) return null;
    const saved = readJSON(resultFile(receipt.id));
    if (saved.requestId !== receipt.id || saved.requestKey !== receipt.requestKey || saved.checksum !== createHash('sha256').update(JSON.stringify(saved.result)).digest('hex')) throw error('Saved generated output needs recovery; it will not be generated again.');
    return { ...saved.result, ...(saved.result.image ? { bytes: Buffer.from(saved.result.image, 'base64') } : {}), model: receipt.model, requestId: receipt.id };
  };
  db.workerRequests ??= [];
  for (const receipt of db.workerRequests) if (['waiting', 'running'].includes(receipt.status)) { receipt.status = 'interrupted'; receipt.finishedAt = new Date(now()).toISOString(); }
  const waiting = new Map(); let seenAt = 0, connectedWorker = null;
  const status = () => ({ mode: 'remote', online: !!seenAt && now() - seenAt < 45000, waiting: [...waiting.values()].filter(row => row.receipt.status === 'waiting').length });
  const authenticate = header => typeof header === 'string' && header.startsWith('Bearer ') && safeToken(header.slice(7), secret);
  const run = async ({ requestId = randomUUID(), requestKey, requestOwner, assertAllowed = () => {}, prompt, images = [], schema, imageOutput, model, effort }) => {
    assertAllowed();
    if (requestKey) { const existing = db.workerRequests.findLast(item => item.requestKey === requestKey && item.status !== 'rejected'); if (existing) { const result = savedResult(existing); if (result) return result; throw error('This earlier request has an unfinished receipt. Its outcome must be recovered before spending another request.'); } }
    if (!status().online) throw Object.assign(error('The drawing computer is offline. Your saved stories are still available. Please try again when it returns.'), { code: 'WORKER_UNAVAILABLE' });
    if (db.workerRequests.some(item => item.id === requestId)) throw error('This request already has a saved receipt. It will not be run twice.');
    const receipt = { id: requestId, requestKey, kind: imageOutput ? 'image' : 'text', ...(requestOwner ? { owner: requestOwner } : {}), status: 'waiting', createdAt: new Date(now()).toISOString(), imageCount: images.length, model, requestHash: createHash('sha256').update(JSON.stringify({ prompt, schema, model, effort })).digest('hex') };
    db.workerRequests.push(receipt); persist(); await flush();
    return new Promise((resolve, reject) => {
      waiting.set(requestId, { receipt, assertAllowed, payload: { id: requestId, ...(requestOwner ? { owner: requestOwner } : {}), kind: imageOutput ? 'image' : 'text', prompt, images: images.map(bytes => bytes.toString('base64')), schema, model, effort }, resolve, reject });
    });
  };
  run.memoryOnly = true;
  run.preflight = () => { if (!status().online) throw Object.assign(error('The drawing computer is offline. Saved reading remains available.'), { preflight: true, code: 'WORKER_UNAVAILABLE' }); };
  run.rejectSaved = id => { const receipt = db.workerRequests.find(item => item.id === id); if (receipt) { receipt.status = 'rejected'; persist(); } };

  run.hasRecovery = requestKey => db.workerRequests.some(item => item.requestKey === requestKey && item.status !== 'rejected');
  run.lookup = requestKey => {
    const receipt = db.workerRequests.findLast(item => item.requestKey === requestKey && item.status !== 'rejected');
    if (!receipt) return null;
    const result = savedResult(receipt); if (result) return result;
    throw Object.assign(error('This earlier request needs recovery. It will not be generated again.'), { preflight: true, sent: false, code: 'WORKER_OUTCOME_UNCERTAIN' });
  };

  async function handle(path, data, authorization) {
    if (!authenticate(authorization)) throw Object.assign(Error('Worker access denied.'), { status: 401 });
    if (typeof data.workerId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(data.workerId)) throw Object.assign(Error('Worker identity is invalid.'), { status: 400 });
    if (connectedWorker && connectedWorker !== data.workerId && status().online) throw Object.assign(Error('Another worker is already connected.'), { status: 409 });
    if (path === '/api/worker/alerts/poll') return { alert: await ownerAlerts?.claim(data.workerId) ?? null };
    if (path === '/api/worker/alerts/complete') { if (!ownerAlerts) throw Object.assign(Error('Owner alerts are not available.'), { status: 404 }); return ownerAlerts.complete(data.workerId, data); }
    if (path === '/api/worker/poll' || path === '/api/worker/heartbeat') {
      seenAt = now(); connectedWorker = data.workerId;
      if (path.endsWith('heartbeat')) {
        const receipt = db.workerRequests.find(item => item.id === data.requestId && item.status === 'running' && item.workerId === data.workerId);
        if (!receipt || typeof data.claimToken !== 'string' || !safeToken(hash(data.claimToken).toString('hex'), receipt.claimHash)) throw Object.assign(Error('This heartbeat has no matching request.'), { status: 409 });
        receipt.lastHeartbeatAt = now(); return { ok: true };
      }
      if ([...waiting.values()].some(row => row.receipt.status === 'running')) return { job: null, deleteAccounts: (db.deletions ?? []).filter(item => !item.jobId).map(item => item.accountId), deleteWork: (db.deletions ?? []).filter(item => item.jobId).map(item => ({ accountId: item.accountId, workId: item.jobId })) };
      for (const [id, item] of waiting) if (item.receipt.status === 'waiting') { try { item.assertAllowed(); } catch { item.receipt.status = 'interrupted'; item.reject(error('New stories have been turned off for this account. Saved work is kept.')); waiting.delete(id); persist(); } }
      const row = [...waiting.values()].find(item => item.receipt.status === 'waiting');
      if (!row) return { job: null, deleteAccounts: (db.deletions ?? []).filter(item => !item.jobId).map(item => item.accountId), deleteWork: (db.deletions ?? []).filter(item => item.jobId).map(item => ({ accountId: item.accountId, workId: item.jobId })) };
      row.receipt.status = 'running'; row.receipt.workerId = data.workerId;
      row.receipt.claimHash = hash(row.claimToken = randomBytes(32).toString('hex')).toString('hex');
      row.receipt.lastHeartbeatAt = now(); row.receipt.startedAt = new Date(now()).toISOString(); persist(); await flush();
      try { row.assertAllowed(); } catch { row.receipt.status = 'interrupted'; row.reject(error('New stories have been turned off for this account. Saved work is kept.')); waiting.delete(row.receipt.id); persist(); await flush(); return { job: null }; }
      return { job: { ...row.payload, claimToken: row.claimToken }, deleteAccounts: (db.deletions ?? []).filter(item => !item.jobId).map(item => item.accountId), deleteWork: (db.deletions ?? []).filter(item => item.jobId).map(item => ({ accountId: item.accountId, workId: item.jobId })) };
    }
    if (path !== '/api/worker/complete') throw Object.assign(Error('Unknown worker action.'), { status: 404 });
    const receipt = db.workerRequests.find(item => item.id === data.requestId);
    if (!receipt || receipt.workerId !== data.workerId || typeof data.claimToken !== 'string' || !safeToken(hash(data.claimToken).toString('hex'), receipt.claimHash)) throw Object.assign(Error('This worker result has no matching claim.'), { status: 409 });
    if (receipt.status === 'complete' || receipt.status === 'failed') { if (receipt.status === 'complete' && !savedResult(receipt)) throw Object.assign(Error('Generated output needs recovery.'), { status: 409 }); return { ok: true, alreadyReceived: true }; }
    const row = waiting.get(data.requestId);
    if ((!row || receipt.status !== 'running') && receipt.status !== 'interrupted') throw Object.assign(Error('This request was interrupted. Saved work is kept; it will not be run again automatically.'), { status: 409 });
    if ((db.deletions ?? []).some(item => item.accountId === receipt.owner?.accountId && (!item.jobId || item.jobId === receipt.owner?.workId))) throw Object.assign(Error('This family or saved work was deleted.'), { status: 409 });
    let result;
    if (!data.error) {
      if (receipt.kind === 'image') {
        if (typeof data.result?.image !== 'string' || data.result.image.length > 48 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data.result.image)) throw Object.assign(Error('Invalid generated image.'), { status: 400 });
        const bytes = Buffer.from(data.result.image, 'base64');
        if (bytes.length < 8 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Object.assign(Error('Generated output must be a PNG.'), { status: 400 });
        result = { bytes, usage: data.result.usage, model: receipt.model, ...(['fast', 'default'].includes(data.result.serviceTier) ? { serviceTier: data.result.serviceTier } : {}) };
      } else {
        if (typeof data.result?.text !== 'string' || data.result.text.length > 2 * 1024 * 1024) throw Object.assign(Error('Invalid text result.'), { status: 400 });
        result = { text: data.result.text, usage: data.result.usage, model: receipt.model, ...(['fast', 'default'].includes(data.result.serviceTier) ? { serviceTier: data.result.serviceTier } : {}) };
      }
    }
    if (result) { const stored = { ...(receipt.kind === 'image' ? { image: data.result.image } : { text: data.result.text }), usage: data.result.usage, ...(result.serviceTier ? { serviceTier: result.serviceTier } : {}) }; saveJSON(resultFile(receipt.id), { requestId: receipt.id, requestKey: receipt.requestKey, result: stored, checksum: createHash('sha256').update(JSON.stringify(stored)).digest('hex') }); }
    receipt.status = data.error ? 'failed' : 'complete'; receipt.finishedAt = new Date(now()).toISOString();
    persist(); await flush(); waiting.delete(receipt.id);
    // Errors are generic: CLI diagnostics may contain local paths or source words.
    if (data.error) row?.reject(error('The drawing computer could not finish this request. Your saved work is kept.'));
    else row?.resolve(result);
    return { ok: true };
  }
  function expireLostClaims() {
    let changed = false;
    for (const [id, row] of waiting) {
      const lastSeen = row.receipt.status === 'running' ? row.receipt.lastHeartbeatAt : seenAt;
      if (!lastSeen || now() - lastSeen < 90000) continue;
      row.receipt.status = 'interrupted'; row.receipt.finishedAt = new Date(now()).toISOString();
      row.reject(error('The drawing computer disconnected. Saved work is kept; no request is run again automatically.')); waiting.delete(id); changed = true;
    }
    if (changed) try { persist(); } catch { /* Retain the prior unfinished receipt when storage is unavailable. */ }
  }
  const liveness = setInterval(expireLostClaims, 10000);
  liveness.unref();
  function close() { clearInterval(liveness); for (const row of waiting.values()) row.reject(error('The service restarted. Saved work is kept.')); waiting.clear(); }
  return { run, status, handle, close, expireLostClaims };
}
