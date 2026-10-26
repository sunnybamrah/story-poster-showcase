import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { moves, readJSON, saveJSON } from '../server/files.js';
import { assertRewriteLocks, keepRewriteLocks, writeStory } from '../server/story.js';
import { recoverFitAttempts } from '../server/fit-recovery.js';
import { privacyFor } from '../server/requests.js';
import { scrubWriterImageText } from '../server/writer-image-text.js';
import { normalizeKitText } from '../server/writing-guidance.js';
import { kitText } from './kit-text-fixture.mjs';
import { family, sentences } from './fixture.mjs';
import { offlineTransport, textAnswer } from './offline-kit-fixture.mjs';

const temp = t => { const d = mkdtempSync(join(tmpdir(), 'lock-recovery-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
const rory = readJSON(new URL('./fixtures/rory-lock-recovery.json', import.meta.url));
const privacy = privacyFor(family, sentences[0]);
test('all immutable root and nested fields use the same cleanup and retain original bytes', () => {
  const previous = kitText();
  previous.chapterTitle = 'The hero’s fullwidth Ａ'; previous.tagline = 'The hero’s turn';
  previous.jokeIdea = 'The hero’s  odd   hat'; previous.panelLines[0].scene = 'The hero’s hat';
  previous.panelLines[1].line = 'I can’t yet.'; previous.feelFirst[0] = '  Two   feelings  ';
  previous.whereElse.line = '  One   try '; previous.tinyTryOptions[0].text = '  One   try ';
  const candidate = normalizeKitText(scrubWriterImageText(previous, privacy).text); candidate.story += '\nA new ending.';
  assert.doesNotThrow(() => assertRewriteLocks(candidate, previous, ['story'], privacy));
  const restored = keepRewriteLocks(candidate, previous, ['story'], privacy);
  assert.deepEqual({ ...restored, story: previous.story }, previous);
  const nested = structuredClone(candidate); nested.panelLines[0].line = 'A different spoken line.';
  const allowed = keepRewriteLocks(nested, previous, ['story', 'panelLines[0].line'], privacy);
  assert.equal(allowed.panelLines[0].scene, previous.panelLines[0].scene);
  assert.equal(allowed.panelLines[1].line, previous.panelLines[1].line);
  assert.equal(allowed.panelLines[0].line, nested.panelLines[0].line);
  for (const change of [x => x.replayCue += ' New advice.', x => x.panelLines[2].line += ' New line.', x => x.tinyTryOptions[1].seconds++]) {
    const bad = structuredClone(candidate); change(bad);
    assert.throws(() => assertRewriteLocks(bad, previous, ['story'], privacy), /rewrite_changed_locked_field/);
  }
});
test('a real rewrite keeps the saved original rhyme even if the library changed later', async t => {
  const previous = kitText(moves[0]); previous.tagline = 'Saved rhyme’s exact words.';
  previous.story = previous.story.replaceAll('Dad', family.parentLabel);
  const candidate = structuredClone(previous); candidate.story += '\nThe evening stays quiet.';
  const transport = offlineTransport(t, temp(t), () => textAnswer(candidate));
  const accepted = await writeStory(transport, family, sentences[0], { priorStory: previous, lockedMoveId: previous.moveId, rewriteFields: ['story'], attempts: 1 });
  assert.equal(accepted.tagline, previous.tagline);
});

function savedFailure(t, { changedWriter = false, missingAnswer = false, duplicateReceipt = false } = {}) {
  const directory = temp(t), text = structuredClone(rory.text), ledger = [];
  for (const [i, raw] of rory.rawAnswers.entries()) {
    const attempt = i + 2, receiptAttempt = i * 2 + 2;
    ledger.push({ stage: 'printed-fit', attempt: receiptAttempt - 1, verdict: 'OVERFLOW' });
    const answer = structuredClone(raw);
    if (changedWriter && i === 1) answer.whereElse.line += ' This really changed.';
    if (!missingAnswer || i !== 1) saveJSON(join(directory, `story-attempt-${attempt}.json`), answer);
    ledger.push({ stage: 'story-rewrite', attempt, verdict: 'rewrite_changed_locked_field: tagline. Keep every unlisted field exactly as supplied.' });
    const saved = { receipt: { shorteningRejected: 'Story rejected after 1 attempt(s): rewrite_changed_locked_field: tagline. Keep every unlisted field exactly as supplied.', plan: { fields: ['story'], page: 'story' } } };
    saveJSON(join(directory, `printed-fit-${receiptAttempt}.json`), saved);
    ledger.push({ stage: 'printed-fit', attempt: receiptAttempt, verdict: saved.receipt.shorteningRejected });
    if (duplicateReceipt) ledger.push({ stage: 'printed-fit', attempt: receiptAttempt, verdict: saved.receipt.shorteningRejected });
  }
  saveJSON(join(directory, 'kit-log.json'), ledger);
  return { directory, checkpoint: { recordAtStart: rory.recordAtStart, tonight: rory.tonight, stages: { text }, fitAttempts: { story: 2 } } };
}
test('Rory gets exactly the two proven lost allowances back, once; originals remain unchanged', t => {
  const { directory, checkpoint } = savedFailure(t, { duplicateReceipt: true });
  const before = readFileSync(join(directory, 'story-attempt-2.json'));
  const recovered = recoverFitAttempts(checkpoint, directory);
  assert.equal(recovered.length, 2); assert.equal(checkpoint.fitAttempts.story, 0);
  assert.deepEqual(readFileSync(join(directory, 'story-attempt-2.json')), before);
  checkpoint.fitAttempts.story = 1;
  assert.deepEqual(recoverFitAttempts(checkpoint, directory), []); assert.equal(checkpoint.fitAttempts.story, 1);
});
for (const scenario of [{ changedWriter: true }, { missingAnswer: true }]) test(`unproven or real writer violations stay spent: ${JSON.stringify(scenario)}`, t => {
  const { directory, checkpoint } = savedFailure(t, scenario);
  assert.equal(recoverFitAttempts(checkpoint, directory).length, 1);
  assert.equal(checkpoint.fitAttempts.story, 1);
});
