import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { preparePick } from '../server/picker.js';
import { parentResponse } from '../server/route.js';
import { buildStoryRequest } from '../server/requests.js';
import { assessGenerationCheck as assessCheck } from '../server/stop-policy.js';
import { posterContent } from '../server/layout.js';
import { moves } from '../server/files.js';
import { family } from './fixture.mjs';
import { writeStory } from '../server/story.js';
import { kitText } from './kit-text-fixture.mjs';
import { openaiAnswer } from './offline-kit-fixture.mjs';
import { requireCompleteKit, parentJobFailure } from '../server/job-failure.js';

test('a writer finding no suitable guide does not buy a pointless rhyme correction', async () => {
  let calls = 0;
  const raw = { ...kitText(), moveId: '', tagline: '', story: 'She is comfortable and none of these teaching actions fits.' };
  const result = await writeStory({ call: async () => { calls++; return openaiAnswer(raw); }, recordVerdict() {} }, family, 'Lila had her sex education class today in 5th grade and she is comfortable.');
  assert.equal(result.status, 'noMatch'); assert.equal(result.reason, 'writer-no-fitting-guide'); assert.equal(calls, 1);
  assert.throws(() => requireCompleteKit(result), error => {
    const shown = parentJobFailure(error, 'story');
    assert.equal(shown.canResume, false); assert.match(shown.message, /different guide/);
    assert.doesNotMatch(shown.message, /rhyme|tagline/); return true;
  });
});

const nia = 'Earlier today, Nia came home from her new school in tears because the girls she sits with made a group chat without her. She said nobody likes her and wanted to hide in her room. It is quiet now, and Mom and Dad want to sit with her before bed. They want her to feel heard without making this another lecture.';
const eli = 'Earlier tonight, Eli missed three words while reading aloud and put his book down. He said he is stupid and never wants to read again. Mom and Dad sat beside him. They are calm now and have ten quiet minutes before bed. They want to read with him without pushing him through more homework.';

test('ordinary moments reach the original teaching bank without keyword permission', () => {
  for (const note of [nia, eli, 'She felt rejected after a friend left her out.']) {
    const pick = preparePick(family, note);
    assert.equal(pick.status, 'eligible');
    assert.ok(pick.eligible.some(item => item.move.id === 'name-it-exactly'));
    const body = buildStoryRequest(family, note);
    const payload = JSON.parse(body.input[0].content);
    assert.equal(payload.tonight, note);
    assert.equal(payload.moves.length, 14);
    assert.ok(payload.moves.every(move => moves.some(source => source.id === move.id)));
  }
});

test('the parent can choose an existing guide without repeating a match password', () => {
  const pick = preparePick(family, 'A quiet evening to practise together.', { chosenMoveId: 'name-it-exactly' });
  assert.equal(pick.eligible[0].move.id, 'name-it-exactly');
  assert.equal(preparePick(family, nia, { chosenMoveId: 'not-a-guide' }).status, 'noMatch');
});

test('figurative homework pushing is ordinary, while real protective concerns still win', () => {
  assert.equal(parentResponse(eli), null);
  assert.equal(parentResponse('They want to read again without pushing him through more homework.'), null);
  for (const note of ['Older children punched him. He has a bruise.', 'His dad hit him.', 'He said he does not want to live.']) assert.equal(preparePick(family, note).status, 'parentResponse', note);
});

test('drawing and presentation opinions cannot cause paid redraw loops', () => {
  for (const fault of ['confirmed_selected_picture_style_mismatch', 'confirmed_cast_appearance_mismatch', 'missing_cast_appearance_basis', 'narrativeEssay', 'insufficient_handwriting_space: plan']) {
    const check = assessCheck({ faults: [fault], needsRecheck: false });
    assert.equal(check.ready, true, fault);
    assert.ok(check.reviewFlags.some(flag => flag.key === fault));
  }
  const incomplete = assessCheck({ faults: ['incomplete_check'], needsRecheck: true, verified: false });
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.needsRecheck, true);
  assert.equal(incomplete.verified, false);
  for (const fault of ['writer_field_privacy', 'scienceClaimsTeachingHelped', 'printed_layout_overflow']) assert.equal(assessCheck({ faults: [fault] }).ready, false);
});

test('an unmeasured footer prints outside the complete drawing', () => {
  const html = posterContent(moves[0], { nickname: 'Nia', posterGeometry: { templateVersion: 'composed-poster-v1', verified: false } });
  assert.match(html, /data-footer-mode="outside"/);
  assert.match(html, /Nia&#39;s Confidence Guide|Nia's Confidence Guide/);
  assert.match(html, /poster-art\.png/);
});

test('original teaching records remain byte identical', () => {
  assert.equal(createHash('sha256').update(readFileSync(new URL('../content/moves.json', import.meta.url))).digest('hex'), '7e9461f8b0f91d3bd78902becf4e21e62f0d93cb4e146e3528424f93a6856873');
});
