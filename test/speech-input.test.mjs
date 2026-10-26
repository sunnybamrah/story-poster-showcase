import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechInput } from '../app/speech-input.js';

function fixture() {
  let text = 'Typed first.', owner = 'family-one:child-one', state;
  const instances = [];
  class Recognition {
    constructor() { instances.push(this); }
    start() { this.started = true; }
    abort() { this.aborted = true; }
  }
  const control = createSpeechInput({ Recognition, getOwner: () => owner, getText: () => text, onText: next => { text = next; }, onState: next => { state = next; } });
  const emit = (r, words, final = true) => r.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: words }], { isFinal: final })] });
  return { control, instances, emit, get text() { return text; }, get state() { return state; }, owner(next) { owner = next; }, edit(next) { control.stop(); text = next; } };
}

test('speech only starts on explicit start and appends finals without replacing typed words', () => {
  const f = fixture(); assert.equal(f.instances.length, 0); f.control.start();
  const r = f.instances[0]; assert.equal(r.started, true);
  f.emit(r, 'A new thought.'); assert.equal(f.text, 'Typed first. A new thought.');
  f.emit(r, 'still speaking', false); assert.equal(f.text, 'Typed first. A new thought.');
  f.control.stop(); assert.equal(f.text, 'Typed first. A new thought. still speaking'); assert.equal(r.aborted, true);
  assert.equal(f.state.state, 'idle'); assert.equal(r.onresult, null);
});

test('editing stops capture and late browser callbacks cannot overwrite the edit', () => {
  const f = fixture(); f.control.start(); const r = f.instances[0], late = r.onresult;
  f.emit(r, 'partial', false); f.edit('My correction.');
  late({ resultIndex: 0, results: [Object.assign([{ transcript: 'late words' }], { isFinal: true })] });
  assert.equal(f.text, 'My correction.'); assert.equal(r.aborted, true);
});

test('family change and unmount revoke late speech events, even if queued before cleanup', () => {
  for (const cleanup of [false, true]) {
    const f = fixture(); f.control.start(); const r = f.instances[0], late = r.onresult;
    f.owner('family-two:child-two'); if (cleanup) f.control.cancel();
    late({ resultIndex: 0, results: [Object.assign([{ transcript: 'private old words' }], { isFinal: true })] });
    assert.equal(f.text, 'Typed first.');
  }
});

test('Safari ending an utterance keeps partial words, never auto-restarts, allows a second tap', () => {
  const f = fixture(); f.control.start(); const r = f.instances[0]; f.emit(r, 'last phrase', false); r.onend();
  assert.equal(f.text, 'Typed first. last phrase'); assert.equal(f.instances.length, 1);
  f.control.start(); assert.equal(f.instances.length, 2); assert.equal(f.instances[1].started, true);
});

test('denied or unavailable speech keeps typing and never calls another provider', () => {
  const f = fixture(); f.control.start(); f.instances[0].onerror({ error: 'not-allowed' });
  assert.equal(f.text, 'Typed first.'); assert.match(f.state.message, /not allowed/); assert.equal(f.state.state, 'idle');
  let state; createSpeechInput({ getOwner: () => 'one', getText: () => '', onText: () => assert.fail('must not alter text'), onState: next => { state = next; } }).start();
  assert.match(state.message, /still type/);
});

test('speech respects the note field limit and releases capture', () => {
  const f = fixture(); f.control.start(); const r = f.instances[0]; f.emit(r, 'x'.repeat(2100));
  assert.equal(f.text.length, 2000); assert.equal(r.aborted, true); assert.equal(f.state.state, 'idle');
});
