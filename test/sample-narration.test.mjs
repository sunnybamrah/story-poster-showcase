import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app-server.mjs';
import { root } from '../server/files.js';
import { loadPublicSample } from '../server/public-sample.js';
import { loadSampleNarration, sampleNarrationDirectory, sampleNarrationFile, sampleNarrationParts, sampleNarrationSHA256, sampleNarrationTranscript } from '../server/sample-narration.js';
import { narrationClips } from './sample-narration-build.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('the pinned recording speaks the whole public example, title first, with nothing cut', () => {
  const sample = loadPublicSample(), narration = JSON.parse(readFileSync(join(sampleNarrationDirectory, 'narration.json')));
  assert.equal(digest(readFileSync(join(sampleNarrationDirectory, 'narration.json'))), sampleNarrationSHA256);
  const pages = sample.text.pagination.pages, parts = sampleNarrationParts(sample.text);
  assert.equal(parts.length, pages.length); assert.equal(narration.parts.length, pages.length);
  assert.equal(parts[0], `${sample.text.chapterTitle}.\n\n${pages[0].trim()}`);
  assert.deepEqual(parts.slice(1), pages.slice(1).map(page => page.trim()));
  assert.equal(narration.transcript, sampleNarrationTranscript(sample.text));
  for (const page of pages) assert.ok(narration.transcript.includes(page.trim()));
  assert.deepEqual(narration.parts.map(part => part.textSha256), parts.map(digest));
  const audio = readFileSync(join(sampleNarrationDirectory, sampleNarrationFile));
  assert.equal(audio.length, narration.audio.bytes); assert.equal(digest(audio), narration.audio.sha256);
  assert.ok(narration.audio.seconds > (narration.segments ?? narration.parts).reduce((sum, part) => sum + part.seconds, 0) - 1);
  assert.equal(narration.fictional, true); assert.equal(sample.record.real, false);
  assert.doesNotMatch(JSON.stringify(narration), /\/Users\/|private_key|client_email|BEGIN PRIVATE|@/);
  const offered = loadSampleNarration(sample);
  assert.equal(offered.src, `/api/sample/narration.m4a?v=${narration.audio.sha256.slice(0, 16)}`); assert.equal(offered.seconds, narration.audio.seconds);
});

test('speaker plans cannot drop, reorder or add story words before any voice call', () => {
  const sample = loadPublicSample(), transcript = sampleNarrationTranscript(sample.text);
  const at = transcript.indexOf('“I wanted to play,”'), end = at + '“I wanted to play,”'.length;
  const plan = { schemaVersion: 1, transcriptSHA256: digest(transcript), voices: { Dad: { voice: 'Charon', style: 'Warm and calm.' }, Pip: { voice: 'Puck', style: 'Youthful and gentle.' } }, segments: [{ speaker: 'Dad', text: transcript.slice(0, at) }, { speaker: 'Pip', text: transcript.slice(at, end) }, { speaker: 'Dad', text: transcript.slice(end) }] };
  const clips = narrationClips(sample.text, plan);
  assert.equal(clips.length, 3); assert.equal(clips[1].voice, 'Puck');
  assert.equal(clips.map(clip => clip.sourceText).join(''), transcript);
  const extraFields = structuredClone(plan); extraFields.voices.Pip.text = 'Extra words'; extraFields.voices.Pip.speaker = 'Other';
  assert.equal(narrationClips(sample.text, extraFields)[1].text, '“I wanted to play,”'); assert.equal(narrationClips(sample.text, extraFields)[1].speaker, 'Pip');
  for (const change of [p => p.segments.pop(), p => p.segments.reverse(), p => { p.segments[1].text = 'Pip: ' + p.segments[1].text; }, p => { p.segments[1].speaker = 'Unknown'; }, p => { p.voices.Pip.voice = 'Charon'; }, p => { p.transcriptSHA256 = 'old'; }]) {
    const bad = structuredClone(plan); change(bad); assert.throws(() => narrationClips(sample.text, bad));
  }
});

test('a speaker manifest must cover the exact story with two known distinct voices', () => {
  const sample = loadPublicSample(), directory = mkdtempSync(join(tmpdir(), 'story-speaker-record-'));
  try {
    cpSync(sampleNarrationDirectory, directory, { recursive: true });
    const original = JSON.parse(readFileSync(join(directory, 'narration.json')));
    const transcript = sampleNarrationTranscript(sample.text), at = transcript.indexOf('“I wanted to play,”'), end = at + '“I wanted to play,”'.length;
    const speakers = { Dad: { voice: 'Charon' }, Pip: { voice: 'Puck' } };
    const texts = [transcript.slice(0, at), transcript.slice(at, end), transcript.slice(end)];
    const record = { ...original, voice: { speakers }, segments: texts.map((text, index) => ({ speaker: index === 1 ? 'Pip' : 'Dad', voice: index === 1 ? 'Puck' : 'Charon', text, textSha256: digest(text.trim()) })) };
    const load = value => { const bytes = Buffer.from(JSON.stringify(value)); writeFileSync(join(directory, 'narration.json'), bytes); return loadSampleNarration(sample, { directory, expectedSHA256: digest(bytes) }); };
    assert.ok(load(record));
    for (const change of [r => r.segments.pop(), r => { r.segments[1].text = 'Extra words.'; r.segments[1].textSha256 = digest('Extra words.'); }, r => { r.segments[1].speaker = 'Other'; }, r => { r.segments[1].voice = 'Charon'; }, r => { r.voice.speakers.Pip.voice = 'Charon'; }]) {
      const bad = structuredClone(record); change(bad); assert.equal(load(bad), null);
    }
  } finally { rmSync(directory, { recursive: true }); }
});

test('changed words, a real family, a changed recording or a changed record hide the recording', () => {
  const sample = loadPublicSample();
  for (const change of [s => { s.text.pagination.pages[1] = s.text.pagination.pages[1].replace('Tomorrow, too.', 'Tomorrow.'); }, s => { s.text.chapterTitle = 'Another Game'; }, s => { s.record.real = true; }, s => { delete s.record.real; }, s => { s.text.pagination.pages.pop(); }]) {
    const altered = structuredClone(sample); change(altered);
    assert.equal(loadSampleNarration(altered), null);
  }
  const directory = mkdtempSync(join(tmpdir(), 'story-sample-narration-'));
  try {
    cpSync(sampleNarrationDirectory, directory, { recursive: true });
    assert.ok(loadSampleNarration(sample, { directory }));
    const audioPath = join(directory, sampleNarrationFile), audio = readFileSync(audioPath);
    writeFileSync(audioPath, Buffer.concat([audio, Buffer.from([0])])); assert.equal(loadSampleNarration(sample, { directory }), null);
    writeFileSync(audioPath, audio); assert.ok(loadSampleNarration(sample, { directory }));
    // A record rewritten for other words cannot be admitted, even with its own hash supplied.
    const record = JSON.parse(readFileSync(join(directory, 'narration.json'))); record.transcript = record.transcript.replace('Pip', 'Pat');
    const bytes = Buffer.from(JSON.stringify(record, null, 1) + '\n'); writeFileSync(join(directory, 'narration.json'), bytes);
    assert.equal(loadSampleNarration(sample, { directory }), null);
    assert.equal(loadSampleNarration(sample, { directory, expectedSHA256: digest(bytes) }), null);
    rmSync(join(directory, 'narration.json')); assert.equal(loadSampleNarration(sample, { directory }), null);
  } finally { rmSync(directory, { recursive: true }); }
});

async function serve(t, sample) {
  const directory = mkdtempSync(join(tmpdir(), 'story-sample-narration-app-'));
  const app = createApp({ dataDirectory: directory, sampleOnly: true, sample, keyReader: () => assert.fail('Narration must never read a key.'), transportFactory: () => ({ call() { assert.fail('Narration must never call a provider.'); } }) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  return 'http://127.0.0.1:' + app.server.address().port;
}

test('the example reply links the static recording, which plays and seeks with no key or provider call', async t => {
  const base = await serve(t, loadPublicSample()), reply = await fetch(base + '/api/sample').then(response => response.json());
  const narration = JSON.parse(readFileSync(join(sampleNarrationDirectory, 'narration.json'))), audio = readFileSync(join(sampleNarrationDirectory, sampleNarrationFile));
  assert.equal(reply.sample, true); assert.deepEqual(reply.narration, { src: `/api/sample/narration.m4a?v=${narration.audio.sha256.slice(0, 16)}`, seconds: narration.audio.seconds });
  const full = await fetch(base + reply.narration.src);
  assert.equal(full.status, 200); assert.equal(full.headers.get('content-type'), 'audio/mp4'); assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), audio);
  const part = await fetch(base + reply.narration.src, { headers: { Range: 'bytes=100-199' } });
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes 100-199/${audio.length}`); assert.deepEqual(Buffer.from(await part.arrayBuffer()), audio.subarray(100, 200));
  const head = await fetch(base + reply.narration.src, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), String(audio.length));
  for (const path of ['/api/sample/files/story-narration.m4a', '/api/sample/files/narration.json', '/api/sample/narration.json']) assert.equal((await fetch(base + path)).status, 404, path);
});

test('a changed example gets no recording link and no recording route', async t => {
  const altered = loadPublicSample(); altered.text.pagination.pages[0] = altered.text.pagination.pages[0].replace('The teams were full.', 'The teams were full today.');
  const base = await serve(t, altered), reply = await fetch(base + '/api/sample').then(response => response.json());
  assert.equal(reply.sample, true); assert.equal(reply.narration, undefined);
  assert.equal((await fetch(base + '/api/sample/narration.m4a')).status, 404);
});

test('the app reads the recording as a file and never reaches a voice provider or its helper', () => {
  const sources = ['server', 'app'].flatMap(folder => readdirSync(join(root, folder)).filter(name => /\.(m?js|jsx)$/.test(name)).map(name => [folder + '/' + name, readFileSync(join(root, folder, name), 'utf8')]));
  for (const [name, text] of sources) assert.doesNotMatch(text, /tts-gemini|aiplatform\.googleapis\.com|gemini-[\d.]+-flash[\w-]*tts|gcp-decisioncouncil/, name);
  const player = readFileSync(join(root, 'app/SampleNarration.jsx'), 'utf8');
  assert.match(player, /preload="none"/); assert.doesNotMatch(player, /autoPlay|autoplay|\.play\(/);
});
