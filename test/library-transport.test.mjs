import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTransport, readLog } from '../server/transport.js';
import { calculateCost } from '../server/cost.js';
import { wireCeiling, createAppBudget } from '../server/app-budget.js';
import { readJSON } from '../server/files.js';
import { family } from './fixture.mjs';
import { privacyFor } from '../server/requests.js';
import { dataPolicyVersion } from '../app/data-policy.js';

const catalog = readJSON(new URL('../content/prices.json', import.meta.url));
const privacy = privacyFor(family, 'A difficult school day.');
const real = () => ({ ...structuredClone(family), hero: { ...family.hero, age: 13 }, real: true, dataPolicyConsent: { accepted: true, version: dataPolicyVersion, acceptedAt: '2026-10-15T12:00:00.000Z' } });
const bodyFor = (judge = false) => ({ model: catalog.selected[judge ? 'storyCheck' : 'story'], store: false, max_output_tokens: 256, input: [{ role: 'user', content: 'general practice' }] });
const requestFor = (stage, options = {}) => ({ provider: 'openai', path: '/v1/responses', stage, body: bodyFor(stage.endsWith('check') || stage === 'library-review' || stage === 'library-wording-review'), privacy, ...options });
const usage = (input = 100, output = 10) => ({ input_tokens: input, output_tokens: output, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
function setup(t, extra = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'library-transport-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, transport: createTransport({ keys: { openai: 'offline-placeholder' }, logFile: join(directory, 'requests.jsonl'), ...extra }) };
}

test('all five JSON-mode guide stages satisfy the actual API input requirement without changing the supplied data', async t => {
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.ok(body.input.some(message => typeof message.content === 'string' && /\bjson\b/i.test(message.content)), 'Instructions alone do not satisfy JSON mode.');
    assert.equal(body.input[0].content, 'general practice'); sends++;
    return new Response(JSON.stringify({ status: 'completed', output: [], usage: usage() }));
  });
  const { transport } = setup(t);
  for (const stage of ['library-topic', 'library-topic-check', 'library-research', 'library-draft', 'library-review']) {
    const request = requestFor(stage, { familyRecord: { real: false } });
    request.body.instructions = 'Return JSON.';
    request.body.text = { format: { type: 'json_object' } };
    await transport.call(request);
    assert.equal(request.body.input.length, 1, 'The original request data stays unchanged.');
  }
  assert.equal(sends, 5);
});

test('private topic stages use distinct selected models with full consent, store false and no tools', async t => {
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async () => { sends++; return new Response(JSON.stringify({ status: 'completed', output: [], usage: usage() })); });
  const current = real(), { transport } = setup(t, { familyRecordFor: () => current });
  for (const stage of ['library-topic', 'library-topic-check']) await transport.call(requestFor(stage, { familyRecord: current }));
  assert.equal(sends, 2);
  await assert.rejects(transport.call(requestFor('library-topic', { familyRecord: { real: true } })), /permission|data notice/i);
  for (const change of [body => { body.model = catalog.selected.storyCheck; }, body => { body.store = true; }, body => { body.tools = [{ type: 'web_search' }]; }]) {
    const request = requestFor('library-topic', { familyRecord: current }); change(request.body);
    await assert.rejects(transport.call(request));
  }
  assert.equal(sends, 2);
});

test('public research, draft and review remain public; arbitrary stages cannot gain writer or tool access', async t => {
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async () => { sends++; return new Response(JSON.stringify({ status: 'completed', output: [], usage: usage() })); });
  const { transport } = setup(t);
  for (const stage of ['library-research', 'library-draft', 'library-review']) await transport.call(requestFor(stage));
  assert.equal(sends, 3);
  const leaked = requestFor('library-draft'); leaked.body.input[0].content = 'Pip has trouble today.';
  await assert.rejects(transport.call(leaked), /nickname|hero name/);
  await assert.rejects(transport.call(requestFor('unrecognised-stage')), /Anonymous checks/);
  for (const mutate of [body => { body.tools = [{ type: 'web_search', filters: { allowed_domains: ['pubmed.ncbi.nlm.nih.gov'] } }]; body.max_tool_calls = 2; }, body => { body.service_tier = 'ultrafast'; }, body => { body.previous_response_id = 'saved-private-response'; }, body => { body.multi_agent = { enabled: true }; }, body => { body.tools = {}; }]) {
    const request = requestFor('library-research'); mutate(request.body); await assert.rejects(transport.call(request), /stateless standard/);
  }
  await assert.rejects(transport.call(requestFor('library-topic', { path: '/v1/images/generations', familyRecord: { real: false } })), /selected writer or judge/);
  assert.equal(sends, 3);
});

test('live consent is checked before each retry reservation and before anonymous family photo checks', async t => {
  let sends = 0, current = real();
  const directory = mkdtempSync(join(tmpdir(), 'consent-retry-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const budget = createAppBudget(join(directory, 'budget.json'));
  t.mock.method(globalThis, 'fetch', async () => { sends++; return new Response(JSON.stringify({ error: { message: 'temporary' } }), { status: 429 }); });
  const { transport } = setup(t, { budget, familyRecordFor: () => current, wait: async () => { current = { ...current, dataPolicyConsent: { ...current.dataPolicyConsent, accepted: false } }; } });
  await assert.rejects(transport.call(requestFor('library-topic', { familyRecord: real() })), /permission|data notice/i);
  assert.equal(sends, 1); assert.equal(budget.status().reserved, 0);
  const before = budget.status().spent;
  const anonymous = requestFor('picture-check', { body: { ...bodyFor(), model: catalog.selected.pictureCheck, input: [{ role: 'user', content: [{ type: 'input_text', text: 'Check the human face.' }, { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] }] } });
  current = { ...real(), real: false, cast: [{ id: 'child', referenceSource: 'photo' }], dataPolicyConsent: { ...real().dataPolicyConsent, accepted: false } };
  await assert.rejects(transport.call(anonymous), /permission|data notice/i);
  assert.equal(sends, 1); assert.equal(budget.status().spent, before);
});

test('a live age correction stops a retry before another wire or reservation', async t => {
  let sends = 0, current = real();
  const directory = mkdtempSync(join(tmpdir(), 'child-data-retry-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const budget = createAppBudget(join(directory, 'budget.json'));
  t.mock.method(globalThis, 'fetch', async () => { sends++; return new Response(JSON.stringify({ error: { message: 'temporary' } }), { status: 429 }); });
  const { transport } = setup(t, { budget, familyRecordFor: () => current, wait: async () => { current = { ...current, hero: { ...current.hero, age: 12 } }; } });
  await assert.rejects(transport.call(requestFor('library-topic', { familyRecord: current })), error => error.code === 'CHILD_DATA_REQUIRES_ZDR');
  assert.equal(sends, 1); assert.equal(budget.status().reserved, 0);
  const spent = budget.status().spent;
  await assert.rejects(transport.call(requestFor('library-topic', { familyRecord: current })), /under 13/);
  assert.equal(sends, 1); assert.equal(budget.status().spent, spent);
});

test('long-context whole-request prices and cache writes use reported usage without changing standard images', () => {
  const model = catalog.selected.story;
  close(calculateCost(model, usage(272000, 100)).usd, (272000 * 2 + 100 * 10) / 1e6);
  close(calculateCost(model, usage(272001, 100)).usd, (272001 * 4 + 100 * 15) / 1e6);
  const cached = { ...usage(300000, 100), input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 2000 } };
  close(calculateCost(model, cached).usd, (297000 * 4 + 1000 * .2 + 2000 * 5 + 100 * 15) / 1e6);
  assert.equal(calculateCost(model, { input_tokens: 2000, output_tokens: 10 }).usd, null);
  assert.equal(calculateCost(model, { ...usage(2000, 10), input_tokens_details: { cached_tokens: 1000, cache_write_tokens: 1001 } }).usd, null);
  close(calculateCost(catalog.selected.poster, { input_tokens: 300, output_tokens: 1000, input_tokens_details: { text_tokens: 100, image_tokens: 200 } }).usd, .0321);
  assert.equal(catalog.models[catalog.selected.poster].imageOutput, 30);
});

test('reported retrieved input tokens and search call fees are charged; incomplete usage remains unknown', () => {
  close(calculateCost(catalog.selected.story, usage(51000, 100), catalog, { webSearchCalls: 2 }).usd, .123);
  assert.equal(calculateCost(catalog.selected.story, { input_tokens: 51000 }, catalog, { webSearchCalls: 2 }).usd, null);
  assert.equal(calculateCost(catalog.selected.story, usage(), catalog, { webSearchCalls: NaN }).usd, null);
});

test('reservation covers long-context cache-write maximum and rejects unbounded tools or model envelopes', () => {
  const body = { ...bodyFor(), input: [{ role: 'user', content: 'x'.repeat(300000) }] };
  const ceiling = wireCeiling({ body, path: '/v1/responses' }, catalog);
  assert.ok(ceiling > 1.5);
  assert.throws(() => wireCeiling({ body: { ...body, tools: [{ type: 'web_search' }], max_tool_calls: 2 }, path: '/v1/responses' }, catalog), /bounded reservation/);
  assert.throws(() => wireCeiling({ body: { ...body, input: [{ content: 'x'.repeat(1100000) }] }, path: '/v1/responses' }, catalog), /safely/);
  assert.throws(() => wireCeiling({ body: { ...bodyFor(), max_output_tokens: 128001 }, path: '/v1/responses' }, catalog), /safely/);
});

test('missing reported output charges the saved reservation; unexpected hosted output is charged and rejected', async t => {
  let output = { status: 'completed', output: [], usage: { input_tokens: 100 } };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(output)));
  const directory = mkdtempSync(join(tmpdir(), 'library-charge-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const budget = createAppBudget(join(directory, 'budget.json'));
  const { transport } = setup(t, { budget });
  const request = requestFor('library-research');
  await transport.call(request);
  close(budget.status().spent, wireCeiling(request, catalog));
  output = { status: 'completed', output: [{ type: 'web_search_call', status: 'completed' }], usage: usage() };
  await assert.rejects(transport.call(request), /unrequested hosted tool/);
  assert.equal(budget.status().reserved, 0);
});


test('public search planning and wording repair use their explicit writer or judge model on the API wire', async t => {
  const sent = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
    const body = JSON.parse(init.body); sent.push(body);
    assert.equal(body.store, false); assert.equal(body.tools, undefined);
    return new Response(JSON.stringify({ status: 'completed', output: [], usage: usage() }));
  });
  const { transport, directory } = setup(t);
  const stages = ['library-search-plan', 'library-wording-draft', 'library-wording-review'];
  for (const stage of stages) {
    const response = await transport.call(requestFor(stage));
    const expectedModel = catalog.selected[stage === 'library-wording-review' ? 'storyCheck' : 'story'];
    assert.equal(sent.at(-1).model, expectedModel);
    const receipt = transport.responseDetails(response);
    assert.equal(receipt.stage, stage); assert.equal(receipt.model, expectedModel);
    close(receipt.cost.usd, calculateCost(expectedModel, usage()).usd);
  }
  assert.equal(transport.wireCount(), 3);
  assert.deepEqual(readLog(join(directory, 'requests.jsonl')).filter(row => row.event === 'request').map(row => row.stage), stages);
});

test('new public library stages still reject wrong models, private text, tools and unknown aliases before sending', async t => {
  let sends = 0;
  t.mock.method(globalThis, 'fetch', async () => { sends++; throw Error('Rejected input must not reach the wire.'); });
  const { transport, directory } = setup(t);
  for (const stage of ['library-search-plan', 'library-wording-draft', 'library-wording-review']) {
    const wrongModel = requestFor(stage); wrongModel.body.model = catalog.selected[stage === 'library-wording-review' ? 'story' : 'storyCheck'];
    await assert.rejects(transport.call(wrongModel), /selected text model/);
    const privateText = requestFor(stage); privateText.body.input[0].content = 'Pip has trouble today.';
    await assert.rejects(transport.call(privateText), /nickname|hero name/);
    const tool = requestFor(stage); tool.body.tools = [{ type: 'web_search' }];
    await assert.rejects(transport.call(tool), /stateless standard/);
    const stored = requestFor(stage); stored.body.store = true;
    await assert.rejects(transport.call(stored), /store false/);
    await assert.rejects(transport.call(requestFor(stage, { path: '/v1/images/generations' })), /only the Responses API/);
  }
  for (const stage of ['library-search-check', 'library-wording-extra', 'unrecognised-stage']) await assert.rejects(transport.call(requestFor(stage)), /Anonymous checks/);
  assert.equal(sends, 0); assert.equal(transport.wireCount(), 0);
  assert.equal(readLog(join(directory, 'requests.jsonl')).filter(row => row.event === 'request').length, 0);
});
