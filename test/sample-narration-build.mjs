// Make the optional read-aloud recording for the fictional public example, once, offline.
// Run: node test/sample-narration-build.mjs --work <private folder under context/>
// Uses a separately configured shared TTS helper, supplied with --helper (Vertex Gemini TTS
// on the current credit project; cached by exact text; at most two charged attempts per clip).
// The spoken words come from sampleNarrationParts, the same function the server uses to check the
// recording, so the file can only be offered while the example's words are unchanged.
// Writes content/public-sample-narration/{story-narration.m4a,narration.json} and prints the
// narration.json SHA-256 to pin as sampleNarrationSHA256 after review. The app never calls a provider.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { loadPublicSample } from '../server/public-sample.js';
import { sampleNarrationDirectory, sampleNarrationFile, sampleNarrationParts, sampleNarrationTranscript } from '../server/sample-narration.js';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// A speaker plan is an explicitly reviewed reading of this exact saved story. It does not
// infer who spoke, rewrite dialogue, or add spoken role labels. Every source character must
// occur once, in order, before the first helper request can run.
export function narrationClips(text, plan, { voice = 'Aoede', style = 'Warm, calm and conversational, at an unhurried pace.' } = {}) {
  const parts = sampleNarrationParts(text), transcript = sampleNarrationTranscript(text);
  if (!parts || !transcript) throw Error('The complete saved story is required.');
  if (!plan) return parts.map(part => ({ text: part, voice, style }));
  if (plan.schemaVersion !== 1 || plan.transcriptSHA256 !== sha(transcript)) throw Error('The speaker plan does not match this story.');
  if (!plan.voices || typeof plan.voices !== 'object' || Array.isArray(plan.voices) || !Array.isArray(plan.segments) || !plan.segments.length) throw Error('The speaker plan needs voices and ordered story segments.');
  const voices = Object.entries(plan.voices);
  if (voices.length !== 2 || voices.some(([name, value]) => !/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(name) || typeof value?.voice !== 'string' || !value.voice.trim() || typeof value?.style !== 'string' || !value.style.trim())) throw Error('The speaker plan needs two named voices with their own delivery styles.');
  if (plan.segments.some(segment => typeof segment?.text !== 'string' || !segment.text.trim() || !Object.hasOwn(plan.voices, segment.speaker))) throw Error('Every story segment needs exact words and a known speaker.');
  if (plan.segments.map(segment => segment.text).join('') !== transcript) throw Error('The speaker plan must preserve every story character in order.');
  if (new Set(plan.segments.map(segment => segment.speaker)).size !== 2 || new Set(voices.map(([, value]) => value.voice)).size !== 2) throw Error('The two speakers must use different voices.');
  return plan.segments.map(segment => ({ text: segment.text.trim(), sourceText: segment.text, speaker: segment.speaker, voice: plan.voices[segment.speaker].voice, style: plan.voices[segment.speaker].style }));
}

export async function main(args = process.argv.slice(2)) {
const { values: opt } = parseArgs({ args, options: {
  work: { type: 'string' }, helper: { type: 'string', default: process.env.STORY_POSTER_TTS_HELPER || '' },
  voice: { type: 'string', default: 'Aoede' }, model: { type: 'string', default: 'gemini-3.8-flash-tts' },
  style: { type: 'string', default: 'Warm, calm and conversational, at an unhurried pace.' },
  'gap-seconds': { type: 'string', default: '1.0' }, 'max-requests': { type: 'string', default: '40' },
  'speaker-plan': { type: 'string' }, 'output-directory': { type: 'string' }, 'dry-run': { type: 'boolean', default: false },
  'clip-delay-seconds': { type: 'string', default: '0' },
  'gain-db': { type: 'string', default: '0' },
} });
if (!opt.work) throw Error('Pass --work <private folder under context/>.');
const work = resolve(opt.work), outputDirectory = opt['output-directory'] ? resolve(opt['output-directory']) : sampleNarrationDirectory;
const sample = loadPublicSample();
if (!sample || sample.record.real !== false) throw Error('The checked fictional public example did not load.');
const parts = sampleNarrationParts(sample.text), transcript = sampleNarrationTranscript(sample.text);
const plan = opt['speaker-plan'] ? JSON.parse(readFileSync(opt['speaker-plan'], 'utf8')) : null;
const script = narrationClips(sample.text, plan, opt);
const gapSeconds = Number(opt['gap-seconds']);
if (!Number.isFinite(gapSeconds) || gapSeconds < 0 || gapSeconds > 5) throw Error('The quiet gap must be between zero and five seconds.');
const clipDelay = Number(opt['clip-delay-seconds']);
if (!Number.isFinite(clipDelay) || clipDelay < 0 || clipDelay > 60) throw Error('The delay between new clips must be between zero and sixty seconds.');
const gainDb = Number(opt['gain-db']);
if (!Number.isFinite(gainDb) || gainDb < -20 || gainDb > 0) throw Error('The final volume adjustment must be between minus twenty and zero decibels.');
if (!Number.isInteger(Number(opt['max-requests'])) || Number(opt['max-requests']) < 1) throw Error('The request cap must be a positive whole number.');
if (script.some(clip => Buffer.byteLength(clip.text) > 4000)) throw Error('A story clip is too long for the shared helper. Split it without changing the words.');
if (opt['dry-run']) {
  process.stdout.write(JSON.stringify({ dryRun: true, transcriptSHA256: sha(transcript), clips: script.length, voices: plan?.voices ?? { narrator: { voice: opt.voice, style: opt.style } }, exactStoryPreserved: true }) + '\n');
  return;
}
if (!opt.helper) throw Error('Pass --helper <tts-gemini.mjs> or set STORY_POSTER_TTS_HELPER. The external TTS helper is not bundled.');
mkdirSync(join(work, 'story'), { recursive: true });

const clips = [];
for (const [index, line] of script.entries()) {
  const { text } = line;
  const input = join(work, 'story', `part-${index + 1}.txt`), output = join(work, 'story', `part-${index + 1}.wav`);
  writeFileSync(input, text + '\n');
  const reply = execFileSync('node', [opt.helper, '--input', input, '--output', output, '--cache', join(work, 'tts-cache'), '--ledger', join(work, 'tts-ledger.jsonl'),
    '--voice', line.voice, '--model', opt.model, '--style', line.style, '--max-requests', opt['max-requests'], '--label', `story-${line.speaker ?? 'part'}-${index + 1}`], { encoding: 'utf8' });
  const clip = { ...line, textSha256: sha(text), ...JSON.parse(reply.trim().split('\n').at(-1)) };
  clips.push(clip);
  if (!clip.cached && clipDelay && index < script.length - 1) await wait(clipDelay * 1000);
}

// Every clip is a clean 44-byte-header PCM WAV from the helper; join them with a fixed quiet gap.
const wavs = clips.map(clip => readFileSync(clip.output));
const rate = wavs[0].readUInt32LE(24), blockAlign = wavs[0].readUInt16LE(32);
if (wavs.some(wav => wav.readUInt32LE(24) !== rate || wav.readUInt16LE(32) !== blockAlign || wav.readUInt16LE(22) !== 1)) throw Error('Clips differ in format.');
const gap = Buffer.alloc(Math.round(gapSeconds * rate) * blockAlign);
const pcm = Buffer.concat(wavs.flatMap((wav, index) => index ? [gap, wav.subarray(44)] : [wav.subarray(44)]));
// Leave room for AAC encoding peaks without changing pitch, tempo, or cached source clips.
if (gainDb) { const gain = 10 ** (gainDb / 20); for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.round(pcm.readInt16LE(i) * gain), i); }
const header = Buffer.from(wavs[0].subarray(0, 44)); header.writeUInt32LE(36 + pcm.length, 4); header.writeUInt32LE(pcm.length, 40);
const joined = join(work, 'story', 'story-narration.wav');
writeFileSync(joined, Buffer.concat([header, pcm]));

mkdirSync(outputDirectory, { recursive: true });
const audioPath = join(outputDirectory, sampleNarrationFile);
execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', joined, audioPath]);
const audio = readFileSync(audioPath), seconds = Number(/estimated duration: ([\d.]+)/.exec(execFileSync('afinfo', [audioPath], { encoding: 'utf8' }))[1]);
const narration = {
  schemaVersion: 1, fictional: true,
  note: 'Optional reading of the fictional public example. Made once offline; the app serves this static file and never calls a voice provider.',
  transcript, transcriptSHA256: sha(transcript),
  parts: plan ? parts.map(text => ({ textSha256: sha(text) })) : clips.map(clip => ({ textSha256: clip.textSha256, seconds: clip.seconds, wavSha256: clip.sha256 })),
  ...(plan ? { speakerPlanSHA256: sha(JSON.stringify(plan)), segments: clips.map(clip => ({ speaker: clip.speaker, text: clip.sourceText, textSha256: clip.textSha256, voice: clip.voice, style: clip.style, seconds: clip.seconds, wavSha256: clip.sha256 })) } : {}),
  gapSeconds,
  gainDb,
  audio: { name: sampleNarrationFile, mimeType: 'audio/mp4', bytes: audio.length, sha256: sha(audio), seconds: Math.round(seconds * 1000) / 1000, sourceWavSha256: sha(readFileSync(joined)) },
  voice: { provider: 'Google Vertex AI', project: 'decision-council-ai', model: opt.model, ...(plan ? { speakers: plan.voices } : { voice: opt.voice, style: opt.style }) },
};
const bytes = Buffer.from(JSON.stringify(narration, null, 1) + '\n');
writeFileSync(join(outputDirectory, 'narration.json'), bytes);
process.stdout.write(JSON.stringify({ narrationSHA256: sha(bytes), audio: narration.audio, parts: narration.parts, cached: clips.map(clip => clip.cached) }, null, 1) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
