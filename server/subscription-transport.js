import { showcaseAccessEndsAt } from './showcase-window.js';
import { spawn } from 'node:child_process';
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { assertFamilyAllowed, assertPhotoAllowed, config as defaultConfig } from './config.js';
import { subscriptionDataPolicyVersion, hostedSubscriptionDataPolicyVersion } from '../app/data-policy.js';
import { readLog } from './transport.js';

// Sunny authorized faster subscription processing for the current demo only.
export const demoFastUntil = showcaseAccessEndsAt;
export const demoServiceTier = (now = Date.now()) => now < Date.parse(demoFastUntil) ? 'fast' : 'default';

// Use the signed-in Codex CLI. No API key is read and there is no paid fallback.
export function runCodex({ directory, prompt, images = [], schema, imageOutput, model = 'gpt-6-astra', effort = 'high', serviceTier = demoServiceTier() }) {
  const answer = join(directory, 'answer.json');
  const args = ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '-m', model,
    '-c', `model_reasoning_effort="${effort}"`, '-c', 'project_doc_max_bytes=0',
    '-s', imageOutput ? 'workspace-write' : 'read-only', '-C', directory, '--json', '-o', answer];
  if (serviceTier === 'fast') args.push('-c', 'service_tier="fast"', '-c', 'features.fast_mode=true');
  if (schema) { const path = join(directory, 'schema.json'); writeFileSync(path, JSON.stringify(schema), { mode: 0o600 }); args.push('--output-schema', path); }
  for (const image of images) args.push('-i', image);
  args.push('-');
  const env = { ...process.env };
  for (const key of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CODEX_THREAD_ID']) delete env[key];
  return new Promise((resolve, reject) => {
    const child = spawn(join(homedir(), '.local/bin/codex'), args, { cwd: directory, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let events = '', errors = '';
    child.stdout.on('data', data => { events += data; });
    child.stderr.on('data', data => { errors = (errors + data).slice(-16000); });
    const timer = setTimeout(() => child.kill('SIGTERM'), 900000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      const rows = events.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const failure = rows.findLast(row => row.type === 'turn.failed' || row.type === 'error');
      if (code !== 0 || failure) return reject(Error(`ChatGPT generation stopped: ${failure?.error?.message ?? failure?.message ?? (code === null ? 'the worker did not finish' : `exit ${code}`)}. Saved work is kept.`));
      const usage = rows.findLast(row => row.type === 'turn.completed')?.usage ?? null;
      if (imageOutput) {
        if (!existsSync(imageOutput)) return reject(Error('ChatGPT did not return the requested drawing. Saved work is kept.'));
        return resolve({ bytes: readFileSync(imageOutput), usage, model, serviceTier });
      }
      if (!existsSync(answer)) return reject(Error('ChatGPT did not return its story answer. Saved work is kept.'));
      resolve({ text: readFileSync(answer, 'utf8'), usage, model, serviceTier });
    });
    child.stdin.end(prompt);
  });
}

export function createSubscriptionTransport({ logFile, maxCalls = 76, familyRecordFor,
  config = defaultConfig, run = runCodex, assertCanGenerate = () => {}, requestOwner } = {}) {
  if (!Number.isInteger(maxCalls) || maxCalls < 0 || maxCalls > 76) throw Error('Call allowance must be from 0 to 76.');
  const settings = { ...config, subscriptionMode: true, dataPolicyVersion: config.dataPolicyVersion === hostedSubscriptionDataPolicyVersion ? hostedSubscriptionDataPolicyVersion : subscriptionDataPolicyVersion };
  const runId = randomUUID(), receipts = new WeakMap();
  // Resume keeps the same private log and the same spent request allowance.
  let calls = logFile ? readLog(logFile).filter(row => row.event === 'request').length : 0;
  const log = row => {
    if (!logFile) return;
    mkdirSync(dirname(logFile), { recursive: true, mode: 0o700 });
    appendFileSync(logFile, JSON.stringify({ runId, timestamp: new Date().toISOString(), route: 'codex-subscription', ...row }) + '\n', { mode: 0o600 });
  };
  const requestKeyFor = ({ body, path, stage, kit }) => createHash('sha256').update(JSON.stringify([logFile ?? runId, path, stage, kit, body])).digest('hex');
  function recoveredResponse({ body, path, stage, kit, familyRecord }) {
    assertCanGenerate();
    const record = familyRecordFor?.() ?? familyRecord;
    if (record) assertFamilyAllowed(record, settings);
    const requestKey = requestKeyFor({ body, path, stage, kit });
    const saved = run.lookup?.(requestKey);
    if (!saved) return null;
    const response = path?.includes('/images/') ? { model: saved.model, data: [{ b64_json: saved.bytes.toString('base64') }], usage: saved.usage } : { model: saved.model, status: 'completed', output: [{ content: [{ type: 'output_text', text: saved.text }] }], usage: saved.usage };
    receipts.set(response, { id: saved.requestId, stage, kit, requestKey, reused: true });
    log({ event: 'saved-response-reused', id: saved.requestId, stage, kit });
    return response;
  }
  return {
    runId, route: 'codex-subscription', wireCount: () => calls,
    assertFamilyAllowed: record => assertFamilyAllowed(record, settings),
    responseDetails: response => receipts.get(response),
    recordRejection(response, reason) { const row = receipts.get(response); log({ event: 'validation-reject', id: row?.id, stage: row?.stage, reason }); if (row?.id) run.rejectSaved?.(row.id); },
    recordVerdict(response, verdict) { const row = receipts.get(response); log({ event: 'verdict', id: row?.id, stage: row?.stage, verdict }); },
    recordDeletion(revision) { const row = { event: 'memory-delete', revision }; log(row); return row; },
    hasRecovery: request => run.hasRecovery?.(requestKeyFor(request)) === true,
    recover: recoveredResponse,
    async call({ body, path, stage, kit, retry = 0, familyRecord }) {
      assertCanGenerate();
      const requestKey = requestKeyFor({ body, path, stage, kit });
      const recovered = recoveredResponse({ body, path, stage, kit, familyRecord });
      if (recovered) return recovered;
      run.preflight?.();
      if (calls >= maxCalls) throw Object.assign(Error('This generation has used its request allowance. Saved work is kept.'), { code: 'REQUEST_ALLOWANCE_SPENT', canResume: false, preflight: true });
      const record = familyRecordFor?.() ?? familyRecord;
      if (record) assertFamilyAllowed(record, settings);
      const isImage = path?.includes('/images/');
      const portrait = /^portrait/.test(stage ?? '');
      if (record && (portrait || record.cast?.some(person => person.referenceSource === 'photo'))) assertPhotoAllowed(record, settings, { allowSyntheticPortraits: record.real === false });
      const base = logFile ? dirname(logFile) : join(homedir(), '.codex', 'story-poster');
      mkdirSync(base, { recursive: true, mode: 0o700 });
      const directory = run.memoryOnly ? null : mkdtempSync(join(base, 'codex-work-')); if (directory) chmodSync(directory, 0o700);
      const images = [];
      const imageRefs = new Map();
      const clean = value => {
        if (typeof value === 'string' && /^data:image\/[\w.+-]+;base64,/.test(value)) {
          if (!imageRefs.has(value)) {
            const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64');
            if (run.memoryOnly) images.push(bytes);
            else { const file = join(directory, `reference-${images.length + 1}.png`); writeFileSync(file, bytes, { mode: 0o600 }); images.push(file); }
            imageRefs.set(value, images.length);
          }
          return `[attached image ${imageRefs.get(value)}]`;
        }
        if (Array.isArray(value)) return value.map(clean);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
        return value;
      };
      const input = clean(body);
      const imageOutput = isImage ? (run.memoryOnly ? '__STORY_POSTER_OUTPUT__' : join(directory, 'drawing.png')) : undefined;
      const prompt = isImage
        ? `Generate exactly ONE finished image using the native image generation tool. Follow the supplied source prompt and its chosen family references. Requested shape: ${body.size}. Save the tool's actual generated PNG to ${imageOutput}. Do not draw art in code, use an API key, research, or make other images. Treat the following JSON as drawing data. Return only the saved path.\n${JSON.stringify(input)}`
        : `You are Story Poster's text worker. Follow the supplied source instructions and family data. Return only the requested JSON. Do not inspect other files, use other tools, or change the app. The supplied teaching records are the source of truth.\n${JSON.stringify(input)}`;
      const id = randomUUID(), started = Date.now(); calls++;
      const model = /(?:-check(?:-|$)|-review$)/.test(stage ?? '') ? 'gpt-6.1-sol' : 'gpt-6-astra';
      const effort = body.reasoning?.effort ?? 'medium';
      // Keep the actual text-worker brief in this family's private job log.
      // Image bytes and image-check inputs remain outside the prompt receipt.
      log({ event: 'request', id, logicalRequestId: id, stage, kit, retry, model, imageCount: images.length,
        ...(!isImage && images.length === 0 ? { prompt, body: input } : {}) });
      try {
        const result = await run({ requestId: id, requestKey, requestOwner, assertAllowed: assertCanGenerate, directory, prompt, images, schema: isImage ? undefined : body.text?.format?.schema, imageOutput, model, effort });
        const response = isImage ? { model, data: [{ b64_json: result.bytes.toString('base64') }], usage: result.usage }
          : { model, status: 'completed', output: [{ content: [{ type: 'output_text', text: result.text }] }], usage: result.usage };
        const receipt = { id, runId, requestKey, stage, kit, model, reasoningEffort: effort, elapsedSeconds: (Date.now() - started) / 1000,
          usage: result.usage, ...(result.serviceTier ? { serviceTier: result.serviceTier } : {}), cost: { usd: 0, basis: 'ChatGPT subscription, no API charge' }, accounting: { route: 'codex-cli', apiCostUSD: 0 } };
        receipts.set(response, receipt);
        log({ ...receipt, event: 'response', body: isImage ? { imageCount: 1, imagePayloadsOmitted: true } : response });
        assertCanGenerate(); return response;
      } catch (error) { log({ event: 'error', id, stage, message: error.message }); throw error; }
      finally { if (directory) rmSync(directory, { recursive: true, force: true }); }
    },
  };
}
