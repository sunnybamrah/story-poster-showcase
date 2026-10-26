import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Optional read-aloud audio for the fictional public example only. It was made once offline
// and is served as a static file, so the server never calls a voice provider. It is offered
// only while the example's exact words still match the words the recording was made from.
export const sampleNarrationSHA256 = 'c95187863245dd0ee52e580f3900e9195e1f48ce6d0f9c436bf5b5db6f8078b9';
export const sampleNarrationDirectory = fileURLToPath(new URL('../content/public-sample-narration/', import.meta.url));
export const sampleNarrationFile = 'story-narration.m4a';
const digest = value => createHash('sha256').update(value).digest('hex');

// The spoken words: the chapter title, then each story page exactly as the reader shows it.
// Each part is a complete story page; the offline builder may record it as one clip or
// reviewed speaker segments, without cutting the story short.
export function sampleNarrationParts(text) {
  const title = typeof text?.chapterTitle === 'string' ? text.chapterTitle.trim() : '', pages = text?.pagination?.pages;
  if (!title || !Array.isArray(pages) || !pages.length || !pages.every(page => typeof page === 'string' && page.trim())) return null;
  return pages.map((page, index) => index ? page.trim() : `${/[.!?]$/.test(title) ? title : title + '.'}\n\n${page.trim()}`);
}
export const sampleNarrationTranscript = text => sampleNarrationParts(text)?.join('\n\n') ?? null;

export function loadSampleNarration(sample, { directory = sampleNarrationDirectory, expectedSHA256 = sampleNarrationSHA256 } = {}) {
  try {
    if (sample?.record?.real !== false) return null;
    const transcript = sampleNarrationTranscript(sample.text);
    if (!transcript) return null;
    const manifestPath = join(directory, 'narration.json');
    if (!lstatSync(manifestPath).isFile()) return null;
    const bytes = readFileSync(manifestPath);
    if (digest(bytes) !== expectedSHA256) return null;
    const narration = JSON.parse(bytes);
    if (narration.schemaVersion !== 1 || narration.fictional !== true || narration.transcript !== transcript || narration.transcriptSHA256 !== digest(transcript) || narration.audio?.name !== sampleNarrationFile) return null;
    if (narration.segments !== undefined) {
      const speakers = narration.voice?.speakers;
      if (!speakers || typeof speakers !== 'object' || Array.isArray(speakers) || Object.keys(speakers).length !== 2 || Object.values(speakers).some(value => typeof value?.voice !== 'string' || !value.voice.trim()) || new Set(Object.values(speakers).map(value => value.voice)).size !== 2) return null;
      if (!Array.isArray(narration.segments) || !narration.segments.length || narration.segments.some(segment => typeof segment?.text !== 'string' || !segment.text.trim() || !Object.hasOwn(speakers, segment.speaker) || segment.voice !== speakers[segment.speaker]?.voice || segment.textSha256 !== digest(segment.text.trim()))) return null;
      if (narration.segments.map(segment => segment.text).join('') !== transcript || new Set(narration.segments.map(segment => segment.speaker)).size !== 2) return null;
    }
    const file = join(directory, sampleNarrationFile);
    if (!lstatSync(file).isFile()) return null;
    const audio = readFileSync(file);
    if (audio.length !== narration.audio.bytes || digest(audio) !== narration.audio.sha256) return null;
    return { directory, name: sampleNarrationFile, src: `/api/sample/narration.m4a?v=${narration.audio.sha256.slice(0, 16)}`, seconds: narration.audio.seconds };
  } catch {
    // A missing or changed recording only hides the optional player.
    return null;
  }
}
