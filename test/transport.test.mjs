import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTransport, readLog } from '../server/transport.js';
import { createMemory } from '../server/memory.js';
import { privacyFor } from '../server/requests.js';
import { family, sentences, deletedFact } from './fixture.mjs';

test('the send boundary rejects family text before network or logging', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'slice0-transport-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const logFile = join(directory, 'requests.jsonl');
  const transport = createTransport({ keys: {}, logFile });
  // No key and no fake network response. The privacy check must fire first.
  await assert.rejects(transport.call({ provider: 'openai', path: '/v1/images/generations', body: { prompt: 'Pip' }, privacy: privacyFor(family, sentences[0]) }), /nickname/);
  assert.equal(existsSync(logFile), false);
});
test('forbidden Anthropic models are rejected before any network call', async () => {
  const transport = createTransport({ keys: {} });
  for (const model of ['claude-fable-5', 'claude-mythos-5', 'a-made-up-model']) await assert.rejects(transport.call({ provider: 'anthropic', path: '/v1/messages', body: { model } }), /Only OpenAI is allowed/);
});
test('the deletion marker appends after the real delete without rewriting earlier log bytes', t => {
  const directory = mkdtempSync(join(tmpdir(), 'slice0-deletion-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const logFile = join(directory, 'requests.jsonl');
  const earlier = JSON.stringify({ event: 'request', body: deletedFact }) + '\n';
  appendFileSync(logFile, earlier);
  const memory = createMemory(join(directory, 'family.json'));
  memory.store(family);
  memory.deleteFact(deletedFact);
  const transport = createTransport({ keys: {}, logFile });
  const marker = transport.recordDeletion(memory.exportRecord().revision);
  assert.ok(readFileSync(logFile, 'utf8').startsWith(earlier));
  assert.equal(readLog(logFile)[1].event, 'memory-delete');
  assert.equal(readLog(logFile)[1].revision, memory.exportRecord().revision);
  assert.equal(marker.runId, transport.runId);
});
