import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, readJSON, saveJSON } from './files.js';
import { runCodex } from './subscription-transport.js';
import { runOwnerAlerts, executeOwnerAlert } from './owner-alert-worker.js';

// Only this fixed model protocol is accepted. No command, binary, credential,
// destination directory or cloud-supplied path can be executed by the worker.
export async function executeWorkerRequest(job, { run = runCodex, temporaryRoot = tmpdir() } = {}) {
  if (!job || !/^[a-f0-9-]{36}$/.test(job.id) || !['text', 'image'].includes(job.kind)
      || !['gpt-6-astra', 'gpt-6.1-sol'].includes(job.model)
      || !['low', 'medium', 'high', 'xhigh', 'max'].includes(job.effort)
      || typeof job.prompt !== 'string' || job.prompt.length > 4 * 1024 * 1024
      || !Array.isArray(job.images) || job.images.length > 20
      || job.images.some(image => typeof image !== 'string' || image.length > 24 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(image))) throw Error('Invalid Story Poster worker request.');
  const directory = mkdtempSync(join(temporaryRoot, 'story-poster-worker-'));
  try {
    const images = job.images.map((image, index) => { const file = join(directory, `reference-${index}.png`); writeFileSync(file, Buffer.from(image, 'base64'), { mode: 0o600 }); return file; });
    const imageOutput = job.kind === 'image' ? join(directory, 'drawing.png') : undefined;
    const prompt = job.kind === 'image' ? job.prompt.replaceAll('__STORY_POSTER_OUTPUT__', imageOutput) : job.prompt;
    const result = await run({ directory, prompt, images, schema: job.kind === 'text' ? job.schema : undefined, imageOutput, model: job.model, effort: job.effort });
    return job.kind === 'image' ? { image: result.bytes.toString('base64'), usage: result.usage, ...(result.serviceTier ? { serviceTier: result.serviceTier } : {}) } : { text: result.text, usage: result.usage, ...(result.serviceTier ? { serviceTier: result.serviceTier } : {}) };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
// Outbox contains generated output and a one-request claim only. Never store
// prompts, source images, app secrets, or Codex credentials here. Acknowledged
// output remains as private evidence; orphaned output is kept for recovery.
export function createWorkerOutbox(directory, requestedId) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const identityFile = join(directory, 'identity.json');
  const savedId = existsSync(identityFile) ? readJSON(identityFile).workerId : null;
  const workerId = requestedId ?? savedId ?? randomUUID();
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(workerId)) throw Error('Invalid worker identity.');
  if (savedId && requestedId && savedId !== requestedId) throw Error('This outbox belongs to another worker identity.');
  if (!savedId) saveJSON(identityFile, { workerId });
  const file = id => { if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid request receipt.'); return join(directory, `request-${id}.json`); };
  const pending = () => readdirSync(directory).filter(name => /^request-[a-f0-9-]{36}\.json$/.test(name)).map(name => readJSON(join(directory, name))).filter(row => row.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(row => row.completion);
  return { workerId, pending,
    deleteAccount(accountId, workId) {
      for (const name of readdirSync(directory).filter(name => /^request-[a-f0-9-]{36}\.json$/.test(name))) { const path = join(directory, name), row = readJSON(path); if (row.completion?.owner?.accountId === accountId && (!workId || row.completion.owner.workId === workId)) rmSync(path, { force: true }); }
    },
    save(completion) {
      const path = file(completion.requestId);
      const { requestId, claimToken, result, error, owner } = completion;
      if (existsSync(path)) { const saved = readJSON(path).completion; if (JSON.stringify(saved) === JSON.stringify({ requestId, claimToken, ...(owner ? { owner } : {}), ...(error ? { error } : { result }) })) return; throw Error('This request already has different generated output. It must never be generated again.'); }
      saveJSON(path, { workerId, createdAt: new Date().toISOString(), status: 'pending', completion: { requestId, claimToken, ...(owner ? { owner } : {}), ...(error ? { error } : { result }) } });
    },
    mark(id, status) { if (!['acknowledged', 'orphaned'].includes(status)) throw Error('Invalid output state.'); const path = file(id), row = readJSON(path); row.status = status; row.updatedAt = new Date().toISOString(); saveJSON(path, row); },
  };
}
export async function runGenerationWorker({ origin = process.env.STORY_POSTER_PUBLIC_ORIGIN, secret = process.env.STORY_POSTER_WORKER_SECRET, workerId = process.env.STORY_POSTER_WORKER_ID, outboxDirectory = join(root, 'context/generation-worker'), signal, fetchImpl = fetch, execute = executeWorkerRequest, executeAlert = executeOwnerAlert, onStatus = () => {} } = {}) {
  if (!origin || !secret || secret.length < 32) throw Error('Set the hosted app address and worker secret.');
  const url = new URL(origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw Error('The worker connects only over HTTPS.');
  const outbox = createWorkerOutbox(outboxDirectory, workerId); workerId = outbox.workerId;
  const request = async (path, data = {}) => {
    const response = await fetchImpl(new URL(path, origin), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` }, body: JSON.stringify({ workerId, ...data }), signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok) throw Object.assign(Error(`Worker service returned ${response.status}.`), { status: response.status });
    return response.json();
  };
  const wait = ms => new Promise(resolve => { const timer = setTimeout(done, ms); function done() { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); } signal?.addEventListener('abort', done, { once: true }); });
  const ownerAlerts = runOwnerAlerts({ request, origin: url.origin, directory: join(outboxDirectory, 'owner-alerts'), signal, execute: executeAlert });
  let completion = outbox.pending()[0] ?? null;
  while (!signal?.aborted) {
    try {
      if (completion) {
        outbox.save(completion);
        await request('/api/worker/complete', completion); outbox.mark(completion.requestId, 'acknowledged'); completion = outbox.pending()[0] ?? null; onStatus('Result saved.'); continue;
      }
      const { job, deleteAccounts = [], deleteWork = [] } = await request('/api/worker/poll');
      for (const accountId of deleteAccounts) outbox.deleteAccount(accountId);
      for (const { accountId, workId } of deleteWork) outbox.deleteAccount(accountId, workId);
      if (!job) { await wait(4000); continue; }
      onStatus('Making the next story part.');
      const heartbeat = setInterval(() => { request('/api/worker/heartbeat', { requestId: job.id, claimToken: job.claimToken }).catch(() => {}); }, 10000);
      try {
        completion = { requestId: job.id, claimToken: job.claimToken, owner: job.owner, result: await execute(job) };
      } catch {
        completion = { requestId: job.id, claimToken: job.claimToken, owner: job.owner, error: 'Generation did not finish.' };
      } finally { clearInterval(heartbeat); }
      outbox.save(completion);
    } catch (error) {
      // A stale completion is never executed again. A network failure retries only
      // the same completion upload, never the generation call.
      if (completion && [400, 409].includes(error.status)) { outbox.mark(completion.requestId, 'orphaned'); completion = outbox.pending()[0] ?? null; onStatus('The generated answer is kept on this Mac for recovery. It was not run again.'); }
      else onStatus('Waiting for the hosted service.');
      await wait(10000);
    }
  }
  await ownerAlerts;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  process.on('SIGTERM', () => controller.abort()); process.on('SIGINT', () => controller.abort());
  await runGenerationWorker({ signal: controller.signal, onStatus: message => process.stdout.write(`${message}\n`) });
}
