import assert from 'node:assert/strict';
import { readFileSync, copyFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, moves, extractJSON, saveJSON } from '../server/files.js';
import { createTransport } from '../server/transport.js';
import { storyCheckKeys, pictureCheckKeys, wordCheckBooleans } from '../server/requests.js';
import { posterBoxes, boxText } from '../server/format.js';
import { posterTemplate, geometryRects, geometryBooleanKeys } from '../server/poster-template.js';

import { storyCheckAnswer, pictureCheckAnswer, wordCheckAnswer, castObservation } from './checker-fixture.mjs';
import { selectedRhymeFor } from '../server/rhyme.js';
import { offlinePrices } from './offline-prices.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { family } from './fixture.mjs';
import { validateStory } from '../server/story.js';
import { panelWithSpeaker } from '../server/panel-contract.js';
import { makePages, combinedKitHTML, copyFonts } from '../server/layout.js';
const historicalRun5 = readJSON(new URL('./fixtures/run5-story.json', import.meta.url));
// Keep its chapter and panels; use a current-rule synthetic rhyme for pipeline tests.
export const run5 = { ...historicalRun5, panelLines: historicalRun5.panelLines.map(panel => ({ ...panel, speakerId: panelWithSpeaker(family, panel, historicalRun5.story).speakerId ?? 'child' })), tagline: kitText(moves.find(move => move.id === historicalRun5.moveId)).tagline };
export const textAnswer = value => openaiAnswer(value);
export const openaiAnswer = value => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: typeof value === 'string' ? value : JSON.stringify(value) }] }] });
export const passingStoryCheck = () => storyCheckAnswer(run5.tagline);
export const passingWordCheck = wordCheckAnswer;

// Run the real transport's privacy and billing paths against in-process answers.
// Zero-token usage is a fixture receipt, never a real cost measurement.
export function offlineTransport(t, directory, override = () => undefined, { maxCalls = 24, budget } = {}) {
  const logFile = join(directory, 'offline-requests.jsonl');
  const base = createTransport({ keys: { openai: 'offline-key' }, logFile, maxCalls, costCatalog: offlinePrices, budget });
  const calls = [];
  let current, selectedTagline, fixtureStory = run5;
  const png = readFileSync(new URL('./fixtures/offline-art.png', import.meta.url));
  t.mock.method(globalThis, 'fetch', async () => {
    assert.ok(current, 'No external fetch is allowed in rehearsal');
    const request = current;
    if (request.stage === 'story-check') { const data = JSON.parse(request.body.input[0].content); fixtureStory = data.story; selectedTagline = data.story.tagline; }
    const replacement = override(request);
    let answer = replacement;
    if (answer === undefined) {
      if (['story', 'story-rewrite'].includes(request.stage)) answer = textAnswer(run5);
      else if (request.stage === 'story-check') { const data = JSON.parse(request.body.input[0].content); selectedTagline = data.selectedRhyme.tagline; answer = textAnswer(storyCheckAnswer(data.story.tagline)); }
      else if (request.stage === 'hero-check' || request.stage.endsWith('-reference-check')) {
        const data = extractJSON(request.body.input[0].content[0].text);
        answer = openaiAnswer({ ...pictureCheckAnswer(), castObservations: data.cast.slice(0, data.expectedPeopleCount).map(castObservation) });
      } else if (request.stage === 'cast-continuity-check') {
        const data = extractJSON(request.body.input[0].content[0].text);
        answer = openaiAnswer({ pictures: data.images.filter(image => image.kind === 'kit-picture').map(image => ({ id: image.id, castObservations: data.cast.map(castObservation) })) });
      }
      else if (request.stage === 'comic-word-check') {
        const data = extractJSON(request.body.input[0].content[0].text);
        answer = openaiAnswer({ panels: data.panels.map((row, index) => ({ panelId: row.panelId, check: { ...passingWordCheck([{ id: 'bubble', text: fixtureStory.panelLines[index].line }]), bubbleSpeaker: { characterId: row.expectedSpeakerId ?? 'child', certainty: 'confirmed', evidence: 'Synthetic fixture tail touches this supplied person.' } } })), extraText: [] });
      }
      else if (request.stage.endsWith('-word-check')) {
        const index = request.stage.match(/^panel-(\d)/)?.[1];
        const boxes = index ? [{ id: 'bubble', text: fixtureStory.panelLines[Number(index) - 1].line }] : posterBoxes(moves.find(move => move.id === fixtureStory.moveId), { ...fixtureStory, tagline: selectedTagline ?? fixtureStory.tagline });
        const data = extractJSON(request.body.input[0].content[0].text);
        answer = openaiAnswer({ ...passingWordCheck(boxes), castObservations: data.expectedVisibleCast.map(castObservation), ...(index ? { bubbleSpeaker: { characterId: data.expectedSpeakerId ?? 'child', certainty: 'confirmed', evidence: 'Synthetic fixture bubble tail touches this character mouth.' } } : {}) });
      } else if (request.path.startsWith('/v1/images/')) {
        // One fixed PNG, with per-stage test bytes. This is not distinct generated art.
        answer = { data: [{ b64_json: Buffer.concat([png, Buffer.from(`OFFLINE FIXTURE ${request.stage}`)]).toString('base64') }] };
      } else assert.fail(`Unexpected offline stage: ${request.stage}`);
    }
    if (answer.content && answer.stop_reason) answer = { ...openaiAnswer(answer.content.filter(block => block.type === 'text').map(block => block.text).join('\n')), ...(answer.stop_reason !== 'end_turn' ? { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } : {}) };
    answer.usage = { input_tokens: 0, output_tokens: 0, input_tokens_details: { text_tokens: 0, image_tokens: 0, cached_tokens: 0 } };
    return new Response(JSON.stringify(answer), { status: 200 });
  });
  return { ...base, calls, logFile, async call(request) { calls.push(request); current = request; try { return await base.call(request); } finally { current = null; } } };
}

// The sandbox refuses both installed browser processes. These saved exports let
// the pipeline reach its interactive view. They are not renders of the new HTML.
export function offlineExports() {
  return {
    async measureLayout() { return { ready: true, measured: true, fixture: true, faults: [], reason: 'Injected browser geometry receipt. This is not fresh rendering.' }; },
    async renderPoster(htmlPath, pngPath) {
      assert.match(readFileSync(htmlPath, 'utf8'), /poster-art.png/);
      copyFileSync(new URL('./fixtures/offline-export.png', import.meta.url), pngPath);
      return { rendered: true, fixture: true, reason: 'Saved PNG export fixture. Browser rendering is not exercised.' };
    },
    async renderKitPDF(htmlPath, pdfPath, { posterOnly = false } = {}) {
      const html = readFileSync(htmlPath, 'utf8');
      assert.equal((html.match(/data-page=/g) ?? []).length, posterOnly ? 1 : 5);
      copyFileSync(new URL(`./fixtures/offline-${posterOnly ? 'poster' : 'kit'}.pdf`, import.meta.url), pdfPath);
      return { rendered: true, fixture: true, inspection: { pages: posterOnly ? 1 : 5, letter: true }, reason: 'Saved PDF export fixture. Browser rendering is not exercised.' };
    },
  };
}

// A self-contained sample for HTTP tests. Every export remains explicitly a
// saved fixture; this is neither a historical model run nor a fresh render.
export async function offlineSample(directory) {
  mkdirSync(directory, { recursive: true }); copyFonts(directory);
  const text = { ...kitText(moves[0]), ready: true }, record = structuredClone(family);
  text.pagination = validateStory(text).pagination;
  const pages = makePages(moves[0], text);
  for (const [name, html] of Object.entries(pages)) writeFileSync(join(directory, name), html);
  writeFileSync(join(directory, 'kit_final.html'), combinedKitHTML(pages));
  const exporter = offlineExports();
  const png = await exporter.renderPoster(join(directory, 'poster.html'), join(directory, 'poster.png'));
  const posterPDF = await exporter.renderKitPDF(join(directory, 'poster.html'), join(directory, 'poster.pdf'), { posterOnly: true });
  const kitPDF = await exporter.renderKitPDF(join(directory, 'kit_final.html'), join(directory, 'kit_final.pdf'));
  saveJSON(join(directory, 'fixture-exports.json'), { fixture: true, png, posterPDF, kitPDF });
  return { directory, text, record, fixture: true };
}
