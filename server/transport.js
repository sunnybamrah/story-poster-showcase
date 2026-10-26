import { isSchemaRejection, withJSONModeInput } from './structured-call.js';
import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { root } from './files.js';
import { assertNoFamilyText, portraitStageMetadata } from './requests.js';
import { assertFamilyAllowed, assertPhotoAllowed, config as defaultConfig } from './config.js';
import { textModels, textStages } from './text-models.js';
import { calculateCost } from './cost.js';
import { chargeAccounting } from './charge-accounting.js';
import { wireCeiling } from './app-budget.js';
import { readJSON } from './files.js';

export const defaultLog = join(root, 'test/log/requests.jsonl');
export function readLog(file = defaultLog) {
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
}

const privateLibraryStages = new Set(['library-topic', 'library-topic-check']);
const publicLibraryStages = new Set(['library-research', 'library-draft', 'library-review', 'library-search-plan', 'library-wording-draft', 'library-wording-review']);
const anonymousCheckStage = /^(?:picture-check|hero-check|frame-check|reading-art-check|portrait-identity-check|portrait-render-check|word-check|poster-word-check|panel-[1-4]-word-check|comic-word-check|(?:child|sibling-[1-3]|grown-up-(?:one|two|three|four))-reference-check|cast-continuity-check)$/;
const noTools = body => body.tools === undefined || Array.isArray(body.tools) && body.tools.length === 0;
const plainInput = body => Array.isArray(body.input) && body.input.length > 0 && body.input.every(message => typeof message.content === 'string');

export function createTransport({ keys, logFile = defaultLog, runId = randomUUID(), maxCalls = 24, config = defaultConfig, costCatalog, budget, familyRecordFor, allowSyntheticPortraits = false, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  if (!Number.isInteger(maxCalls) || maxCalls < 0 || maxCalls > 76) throw new Error('Call cap must be an integer from 0 to 76.');
  const privateValues = [keys.openai].filter(Boolean);
  const privateImages = new Set();
  const rememberImages = value => {
    if (typeof value === 'string') for (const match of value.matchAll(/data:image\/[^;]+;base64,([A-Za-z0-9+/=]+)/g)) privateImages.add(match[1]);
    else if (Array.isArray(value)) value.forEach(rememberImages);
    else if (value && typeof value === 'object') Object.values(value).forEach(rememberImages);
  };
  const redact = value => {
    if (typeof value === 'string') {
      let text = privateValues.reduce((text, key) => text.split(key).join('***'), value);
      text = text.replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, '[private image input]');
      for (const encoded of privateImages) text = text.split(encoded).join('[private image input]');
      return text;
    }
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /authorization|api[-_]?key/i.test(key) ? '***' : redact(item)]));
    return value;
  };
  const log = event => {
    mkdirSync(dirname(logFile), { recursive: true });
    // Portrait responses can echo the input photo under a new encoding. The
    // portrait worker stores validated output separately; transport keeps only
    // shape and accounting here, never uninspected provider image payloads.
    const token = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(value) ? value : null;
    const safe = ['portrait', 'portrait-description', 'portrait-ink', 'portrait-finish', 'portrait-render', 'reading-art'].includes(event.stage) && event.event === 'response' ? { ...event, body: {
      imageCount: Array.isArray(event.body?.data) ? event.body.data.length : 0,
      imagePayloadsOmitted: true,
      ...(event.body?.error ? { error: { code: token(event.body.error.code), type: token(event.body.error.type) } } : {}),
      ...(event.body?.malformedResponse !== undefined ? { malformedResponse: true } : {}),
    } } : event;
    appendFileSync(logFile, JSON.stringify(redact(safe)) + '\n', { mode: 0o600 });
  };
  // A slot is spent when the request is durably logged, before the wire send.
  // Network retries without a response reuse their slot. HTTP retries spend one.
  const priorSlots = new Set(), lastSlot = new Map(), reusesSlot = new Map();
  for (const row of readLog(logFile)) {
    const logical = row.logicalRequestId ?? row.id;
    if (row.event === 'transport-retry') reusesSlot.set(`${logical}:${row.nextWireAttempt}`, row.reusesCallCapSlot === true);
    if (row.event !== 'request' || row.method === 'GET') continue;
    const slot = row.callSlotId ?? (reusesSlot.get(`${logical}:${row.wireAttempt}`) ? lastSlot.get(logical) : null) ?? row.id ?? JSON.stringify(row);
    priorSlots.add(slot); lastSlot.set(logical, slot);
  }
  let calls = priorSlots.size, wireCalls = 0;
  const responseCalls = new WeakMap();
  return {
    runId,
    wireCount: () => wireCalls,
    assertFamilyAllowed: record => assertFamilyAllowed(record, config),
    responseDetails(response) { return responseCalls.get(response); },
    recordRejection(response, reason, details = {}) {
      const receipt = responseCalls.get(response);
      if (!receipt) throw new Error('Cannot attach a rejection to an unknown response.');
      const { body, usage, cost, ...common } = receipt;
      log({ ...common, event: 'validation-reject', timestamp: new Date().toISOString(), reason, ...(details.failures ? { failures: details.failures } : {}) });
    },
    recordDeletion(revision) {
      // Call only after deleteFact has returned. Array order fixes same-millisecond calls.
      const marker = { runId, id: randomUUID(), event: 'memory-delete', timestamp: new Date().toISOString(), revision };
      log(marker);
      return marker;
    },
    async call({ provider, path, body, method = 'POST', kit = null, stage, retry = 0, privacy, familyRecord, schemaFallback = false }) {
      const wireAtStart = wireCalls;
      try {
      body = withJSONModeInput(body);
      const portraitStage = ['portrait', 'portrait-description', 'portrait-ink', 'portrait-finish', 'portrait-render', 'portrait-identity-check', 'portrait-render-check'].includes(stage);
      const portraitInput = portraitStageMetadata(body);
      if (portraitStage && stage !== 'portrait' && (!portraitInput || stage !== `portrait-${portraitInput.phase}` || !['photo', 'description'].includes(portraitInput.inputMode))) throw new Error('Portrait input provenance is missing.');
      const needsPhotoPermission = record => portraitStage ? stage === 'portrait' || portraitInput.inputMode === 'photo' : record?.cast?.some(person => person.referenceSource === 'photo');
      rememberImages(body);
      if (provider !== 'openai') throw new Error('Only OpenAI is allowed.');
      if (!['/v1/models', '/v1/responses', '/v1/images/generations', '/v1/images/edits'].includes(path)) throw new Error('This API path is not part of slice 0.');
      if (path === '/v1/models' ? method !== 'GET' || body !== undefined : method !== 'POST' || !body) throw new Error('This API method and body do not match the allowed path.');
      if (publicLibraryStages.has(stage) && path !== '/v1/responses') throw new Error('Public library stages use only the Responses API.');
      const catalog = costCatalog ?? readJSON(new URL('../content/prices.json', import.meta.url));
      const familyText = textStages.includes(stage) || privateLibraryStages.has(stage);
      if (familyText) {
        const models = textModels(catalog), expected = models[stage === 'story-check' || stage === 'library-topic-check' ? 'storyCheck' : 'story'];
        if (path !== '/v1/responses' || body?.model !== expected || body.store !== false || !plainInput(body)) throw new Error('Family text is allowed only in the selected writer or judge text request with store false.');
        if (!familyRecord || typeof familyRecord.real !== 'boolean') throw new Error('Text requests need the family real marker.');
        assertFamilyAllowed(familyRecord, config);
        if (familyRecord.real && !config.zeroRetentionApproved && typeof familyRecordFor !== 'function') throw new Error('Real family requests need a live permission check.');
      } else if (body) {
        assertNoFamilyText(body, privacy);
        if (publicLibraryStages.has(stage)) {
          const models = textModels(catalog), expected = models[stage === 'library-review' || stage === 'library-wording-review' ? 'storyCheck' : 'story'];
          if (path !== '/v1/responses' || body.model !== expected || body.store !== false || !plainInput(body)) throw new Error('Public library stages need their selected text model, plain public input and store false.');
        } else if (path === '/v1/responses' && (!anonymousCheckStage.test(stage ?? '') || body.model !== catalog.selected.pictureCheck || body.store !== false)) throw new Error('Anonymous checks must use a known check stage and the selected picture checker with store false.');
        else if (path.includes('/images/') && ![catalog.selected.hero, catalog.selected.poster].includes(body.model)) throw new Error('Image requests must use a selected image model.');
        if (portraitStage || ['reading-art', 'reading-art-check'].includes(stage)) {
          if (!familyRecord || typeof familyRecord.real !== 'boolean') throw new Error('Portrait requests need the family real marker.');
          assertFamilyAllowed(familyRecord, config);
          if (needsPhotoPermission(familyRecord)) assertPhotoAllowed(familyRecord, config, { allowSyntheticPortraits });
          if (!config.zeroRetentionApproved && (familyRecord.real || needsPhotoPermission(familyRecord) && !(allowSyntheticPortraits && familyRecord.real === false)) && typeof familyRecordFor !== 'function') throw new Error('Photo requests need a live permission check.');
        }
      }
      if (body && (!noTools(body) || path === '/v1/responses' && ['previous_response_id', 'conversation', 'prompt', 'multi_agent', 'context_management', 'background', 'stream'].some(key => body[key] !== undefined) || body.service_tier !== undefined && body.service_tier !== 'default')) throw new Error('Only stateless standard requests without hosted tools are allowed. Fetch bounded public sources before research.');
      const key = keys.openai;
      if (!key) throw new Error('Missing openai key.');
      if (method !== 'GET') {
        const rateCheck = calculateCost(body?.model, { input_tokens: 0, output_tokens: 0, input_tokens_details: { text_tokens: 0, image_tokens: 0, cached_tokens: 0 } }, costCatalog);
        if (rateCheck.usd == null) throw new Error(`Cannot start a paid call: ${rateCheck.reason}`);
      }
      const logicalRequestId = randomUUID();
      const headers = { Authorization: `Bearer ${key}` };
      const url = `https://api.openai.com${path}`;
      let wireBody;
      if (path === '/v1/images/edits') {
        const { image, ...fields } = body;
        const references = Array.isArray(image) ? image : [image];
        if (!references.length || references.some(reference => typeof reference !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(reference))) throw new Error('Saved PNG character references are required.');
        wireBody = new FormData();
        for (const [name, value] of Object.entries(fields)) wireBody.set(name, String(value));
        for (const [index, reference] of references.entries()) wireBody.append('image[]', new Blob([Buffer.from(reference.split(',')[1], 'base64')], { type: 'image/png' }), `character-${index + 1}.png`);
      } else if (body) {
        headers['Content-Type'] = 'application/json';
        wireBody = JSON.stringify(body);
      }
      const receipts = [], logicalStart = performance.now();
      let reserveSlot = true, callSlotId;
      const fail = (message, response, receipt) => {
        const error = new Error(message);
        if (response) error.response = response;
        if (receipt) error.receipt = receipt;
        if (receipt?.schemaRejected) error.schemaRejected = true;
        throw error;
      };
      for (let wireAttempt = 0; wireAttempt < 3; wireAttempt++) {
        // Re-read current consent before every send, including retries and
        // anonymous pictures containing the family's selected reference images.
        if (familyRecordFor) {
          const current = familyRecordFor({ stage, path, method, kit, familyRecord });
          if (!current || typeof current.real !== 'boolean') throw new Error('The current family permission record is unavailable.');
          assertFamilyAllowed(current, config);
          const sendsImage = path.includes('/images/') || body?.input?.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'input_image'));
          if ((portraitStage || sendsImage) && needsPhotoPermission(current)) assertPhotoAllowed(current, config, { allowSyntheticPortraits });
        }
        if (method !== 'GET' && reserveSlot && calls >= maxCalls) throw new Error('The two-kit call limit was reached.');
        const reservedCeiling = method === 'GET' ? 0 : wireCeiling({ path, body }, costCatalog ?? readJSON(new URL('../content/prices.json', import.meta.url)));
        const slot = method !== 'GET' && budget ? budget.reserve(reservedCeiling) : null;
        if (method !== 'GET' && reserveSlot) { calls++; callSlotId = randomUUID(); }
        const id = randomUUID();
        const common = { runId, id, logicalRequestId, callSlotId, wireAttempt, provider, method, url, kit, stage, retry, model: body?.model ?? null, reasoningEffort: body?.reasoning?.effort ?? null, outputFormat: body?.text?.format?.type ?? null, schemaFallback, reservedCeiling };
        log({ ...common, event: 'request', timestamp: new Date().toISOString(), headers, body: body ?? null });
        const start = performance.now();
        let response, data, receipt, retryReason;
        try {
          wireCalls++;
          response = await fetch(url, { method, headers, body: wireBody, redirect: 'error' });
          const raw = await response.text();
          try { data = JSON.parse(raw); } catch { data = { malformedResponse: raw }; }
          if (!data || typeof data !== 'object') data = { malformedResponse: raw };
        } catch (error) {
          const code = error.cause?.code ?? error.code;
          const retryable = ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code) || /fetch failed/i.test(error.message);
          receipt = { ...common, event: 'response', timestamp: new Date().toISOString(), elapsedSeconds: (performance.now() - start) / 1000,
            status: response?.status ?? null, body: { error: String(error.message), cause: code }, usage: null,
            cost: { usd: method === 'GET' ? 0 : null, reason: 'Network failure; billing unknown for this wire attempt.' } };
          receipt.accounting = chargeAccounting(receipt.cost, reservedCeiling);
          receipts.push(receipt); log(receipt);
          if (slot) budget.settle(slot, null);
          if (!retryable || wireAttempt === 2) fail(`${provider} request failed (${code ?? error.name}).`, null, receipt);
          retryReason = code ?? error.message;
          // Without a received response this is the same call-cap reservation.
          reserveSlot = Boolean(response);
        }
        if (!retryReason) {
          const schemaRejected = isSchemaRejection(body, response.status, data);
          const webSearchCalls = Array.isArray(data.output) ? data.output.filter(item => item.type === 'web_search_call').length : 0;
          const cost = schemaRejected ? { usd: 0, reason: 'API schema validation rejected the request before generation; no model tokens were produced.' } : method === 'GET' ? { usd: 0, reason: 'Model list is not a generation call.' } : calculateCost(body.model, data.usage, catalog, { webSearchCalls });
          receipt = { ...common, event: 'response', timestamp: new Date().toISOString(), elapsedSeconds: (performance.now() - start) / 1000,
            status: response.status, body: data, usage: data.usage ?? null, cost, schemaRejected, reasoningTokens: Number.isSafeInteger(data.usage?.output_tokens_details?.reasoning_tokens) && data.usage.output_tokens_details.reasoning_tokens >= 0 ? data.usage.output_tokens_details.reasoning_tokens : schemaRejected ? 0 : null };
          receipt.accounting = chargeAccounting(cost, reservedCeiling);
          receipts.push(receipt);
          if (wireAttempt) {
            receipt.callElapsedSeconds = (performance.now() - logicalStart) / 1000;
            receipt.callAccounting = { usd: receipts.reduce((sum, row) => sum + row.accounting.usd, 0), basis: 'all-wire-attempts' };
            receipt.callCost = { usd: receipts.every(row => row.cost.usd !== null) ? receipts.reduce((sum, row) => sum + row.cost.usd, 0) : null,
              reason: 'All wire attempts in this logical call; unknown charges remain unknown.' };
          }
          log(receipt); responseCalls.set(data, receipt);
          if (slot) budget.settle(slot, cost.usd);
          if (!response.ok) {
            if ((response.status === 429 || response.status >= 500 && response.status <= 599) && wireAttempt < 2) {
              retryReason = `HTTP ${response.status}`; reserveSlot = true;
            } else fail(`${provider} ${stage} returned HTTP ${response.status}; details are in the private test log.`, data, receipt);
          } else {
            if (data.malformedResponse !== undefined) fail(`${provider} returned malformed JSON.`, data, receipt);
            if (webSearchCalls) fail('The service returned an unrequested hosted tool call. Its reported usage was charged and the response was rejected.', data, receipt);
            return data;
          }
        }
        if (method !== 'GET' && reserveSlot && calls >= maxCalls) fail('The two-kit call limit was reached.', data, receipt);
        const delayMilliseconds = [2000, 6000][wireAttempt];
        log({ ...common, event: 'transport-retry', timestamp: new Date().toISOString(), reason: retryReason,
          nextWireAttempt: wireAttempt + 1, delayMilliseconds, reusesCallCapSlot: !reserveSlot });
        await wait(delayMilliseconds);
      }
      } catch (error) {
        if (error && typeof error === 'object') error.preflight = wireCalls === wireAtStart;
        throw error;
      }
    },
  };
}
