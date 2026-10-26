import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadCache } from '../app/read-cache.js';
import { createSpeechInput } from '../app/speech-input.js';
import { demoServiceTier, demoFastUntil } from '../server/subscription-transport.js';

test('screen reads share in-flight work but never cross accounts or survive a write', async () => {
  let now = 10, calls = 0, finish;
  const cache = createReadCache({ now: () => now });
  const load = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const one = cache.read('account-one:child-one', load), same = cache.read('account-one:child-one', load);
  assert.equal(one, same); await Promise.resolve(); assert.equal(calls, 1);
  cache.clear(); finish({ people: [] }); await one;
  assert.deepEqual(await cache.read('account-one:child-one', async () => ({ value: 'fresh' })), { value: 'fresh' });
  assert.deepEqual(await cache.read('account-two:child-one', async () => ({ value: 'other' })), { value: 'other' });
  now += 16000;
  assert.deepEqual(await cache.read('account-one:child-one', async () => ({ value: 'expired' })), { value: 'expired' });
});

test('running drawings and failed screen reads are never cached as settled results', async () => {
  const cache = createReadCache(); let calls = 0;
  const load = async () => { calls++; return { people: [{ job: { status: 'running' } }] }; };
  await cache.read('one', load); await cache.read('one', load); assert.equal(calls, 2);
  await assert.rejects(cache.read('bad', async () => { throw Error('offline'); }));
  assert.equal(await cache.read('bad', async () => 'recovered'), 'recovered');
});

test('microphone permission check requires a tap, releases tracks and keeps existing words', async () => {
  let requested = 0, stopped = 0, state, owner = 'one', resolve;
  const control = createSpeechInput({ getOwner: () => owner, getText: () => 'Saved words', onText: () => assert.fail('No dictation from a permission check'), onState: next => { state = next; },
    requestMicrophone: () => { requested++; return new Promise(done => { resolve = done; }); } });
  assert.equal(requested, 0);
  const pending = control.checkMicrophone(); assert.equal(requested, 1); assert.equal(state.state, 'checking');
  resolve({ getTracks: () => [{ stop() { stopped++; } }] }); await pending;
  assert.equal(stopped, 1); assert.match(state.message, /Tap Talk again/);
  const other = control.checkMicrophone(); owner = 'two'; resolve({ getTracks: () => [{ stop() { stopped++; } }] }); await other;
  assert.equal(stopped, 2); assert.equal(state.state, 'checking');
});

test('the demo Fast setting expires and does not change the global account setting', () => {
  assert.equal(demoServiceTier(Date.parse('2026-10-26T20:00:00Z')), 'fast');
  assert.equal(demoServiceTier(Date.parse('2026-10-27T00:00:00Z')), 'fast');
  assert.equal(demoServiceTier(Date.parse('2026-11-04T19:00:00Z')), 'fast');
  assert.equal(demoServiceTier(Date.parse(demoFastUntil) - 1), 'fast');
  assert.equal(demoServiceTier(Date.parse(demoFastUntil)), 'default');
  assert.equal(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(demoFastUntil)), '11/6/26, 12:00:00 AM');
});
