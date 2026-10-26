import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTransport } from '../server/transport.js';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { moves, readJSON, saveJSON } from '../server/files.js';
import { textModels } from '../server/text-models.js';
import { family, sentences } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { offlineTransport, offlineExports } from './offline-kit-fixture.mjs';

const request = () => ({ provider: 'openai', path: '/v1/responses', stage: 'story', familyRecord: { real: false }, body: { model: textModels().story, store: false, max_output_tokens: 100, input: [{ role: 'user', content: 'Fictional test.' }] } });
const temp = t => { const directory = mkdtempSync(join(tmpdir(), 'preflight-proof-')); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; };
test('missing key and refused budget prove that no request was sent', async t => {
  const directory = temp(t);
  for (const options of [{ keys: { openai: '' } }, { keys: { openai: 'offline' }, budget: { reserve: () => { throw Error('Daily budget reached.'); } } }]) {
    const transport = createTransport({ ...options, logFile: join(directory, 'requests.jsonl') });
    await assert.rejects(transport.call(request()), error => error.preflight === true);
    assert.equal(transport.wireCount(), 0);
  }
});
test('a budget refusal after a sent attempt never becomes no-send proof', async t => {
  const directory = temp(t), originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let reservations = 0;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'synthetic-server-error' } }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  const transport = createTransport({ keys: { openai: 'offline' }, logFile: join(directory, 'requests.jsonl'), wait: async () => {}, budget: { reserve() { if (reservations++) throw Error('Daily budget reached.'); return { id: 'fixture' }; }, settle() {} } });
  await assert.rejects(transport.call(request()), error => error.preflight === false);
  assert.equal(transport.wireCount(), 1);
});
test('a proven pre-send stop preserves a saved page-fitting allowance', async t => {
  const directory = temp(t), memory = createMemory(join(directory, 'family.json')); memory.store(family);
  const text = { ...kitText(moves[0]), ready: true };
  saveJSON(join(directory, 'checkpoint.json'), { version: 1, kit: 1, tonight: sentences[0], recordAtStart: memory.exportRecord(), stages: { text }, fitAttempts: { story: 1 } });
  const transport = offlineTransport(t, directory);
  transport.call = async () => { const error = new Error('Daily budget reached.'); error.preflight = true; throw error; };
  transport.wireCount = () => 0;
  const overflow = readJSON(new URL('./fixtures/pass29-overflow.json', import.meta.url)).receipt;
  await assert.rejects(createKit(transport, memory, sentences[0], { kit: 1, directory, resume: true, stopBeforePictures: true, exports: { ...offlineExports(), measureLayout: async () => ({ ...overflow, pages: overflow.pages.slice(0, 1) }) } }), /Daily budget reached/);
  assert.equal(readJSON(join(directory, 'checkpoint.json')).fitAttempts.story, 1);
});
