import test from 'node:test';
import assert from 'node:assert/strict';
import { writeStory, readyStory, validateStory } from '../server/story.js';
import { family, sentences } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { openaiAnswer } from './offline-kit-fixture.mjs';
import { storyCheckAnswer } from './checker-fixture.mjs';

const legacy = () => {
  const text = kitText();
  for (const panel of text.panelLines) delete panel.speakerId;
  return text;
};
const modern = () => {
  const text = legacy();
  for (const panel of text.panelLines) panel.speakerId = 'child';
  return text;
};
function fake(answer) {
  const calls = [];
  return { calls, recordRejection() {}, recordVerdict() {}, async call(request) { calls.push(request); return answer(request, calls); } };
}

for (const fallback of [false, true]) test(`${fallback ? 'JSON fallback' : 'strict response'} cannot accept fresh panels with missing speaker metadata`, async () => {
  const transport = fake((request, calls) => {
    if (fallback && calls.length === 1) throw Object.assign(Error('Fixture schema rejection'), { schemaRejected: true, response: { error: { code: 'invalid_json_schema', message: 'Fixture unsupported schema' } } });
    return openaiAnswer(legacy());
  });
  await assert.rejects(writeStory(transport, family, sentences[0], { attempts: 1 }), /invalid_panel_speaker/);
  assert.deepEqual(transport.calls.map(call => call.body.text.format.type), fallback ? ['json_schema', 'json_object'] : ['json_schema']);
});

test('missing speakers repair only affected panels and readyStory completes after its independent judge', async () => {
  const first = modern(); delete first.panelLines[2].speakerId;
  const transport = fake(request => {
    if (request.stage === 'story') return openaiAnswer(first);
    if (request.stage === 'story-correction') {
      const data = JSON.parse(request.body.input[0].content);
      assert.deepEqual(data.correction.responseKeys, ['story', 'panelLines[2]']);
      assert.deepEqual(request.body.text.format.schema.properties['panelLines[2]'].required, ['scene', 'line', 'speakerId']);
      return openaiAnswer({ story: first.story, 'panelLines[2]': { ...first.panelLines[2], speakerId: 'child' } });
    }
    assert.equal(request.stage, 'story-check');
    return openaiAnswer(storyCheckAnswer(first.tagline));
  });
  const result = await readyStory(transport, family, sentences[0]);
  assert.equal(result.ready, true);
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-correction', 'story-check']);
  assert.deepEqual(result.panelLines, modern().panelLines);
  assert.equal(result.story, first.story);
});

test('repeated missing speaker correction stays bounded and cannot downgrade its retry schema', async () => {
  const transport = fake(request => {
    if (request.stage === 'story') return openaiAnswer(legacy());
    const data = JSON.parse(request.body.input[0].content);
    const patch = { story: data.correction.previousStory.story };
    for (const key of data.correction.responseKeys.filter(key => key !== 'story')) {
      assert.ok(request.body.text.format.schema.properties[key].required.includes('speakerId'));
      patch[key] = legacy().panelLines[Number(key.match(/\[(\d+)\]/)[1])];
    }
    return openaiAnswer(patch);
  });
  await assert.rejects(writeStory(transport, family, sentences[0]), /Story rejected after 2 attempt\(s\).*invalid_panel_shape/s);
  assert.equal(transport.calls.length, 2);
});

test('legacy saved rewrites remain compatible while modern panel rewrites cannot drop speakers', async () => {
  assert.doesNotThrow(() => validateStory(legacy()));
  const historical = legacy();
  const result = await writeStory(fake(() => openaiAnswer(historical)), family, sentences[0], { priorStory: historical, lockedMoveId: historical.moveId, rewriteFields: ['jokeIdea'], attempts: 1 });
  assert.equal(result.panelLines[0].speakerId, undefined);
  const previous = modern(), missing = legacy();
  await assert.rejects(writeStory(fake(() => openaiAnswer(missing)), family, sentences[0], { priorStory: previous, lockedMoveId: previous.moveId, rewriteFields: ['story', 'panelLines'], attempts: 1 }), /invalid_panel_speaker/);
});

test('anonymous speaker id must identify someone supplied in this family', async () => {
  const text = modern(); text.panelLines[1].speakerId = 'grown-up-four';
  await assert.rejects(writeStory(fake(() => openaiAnswer(text)), family, sentences[0], { attempts: 1 }), /invalid_panel_speaker: panelLines\[1\].speakerId/);
});
