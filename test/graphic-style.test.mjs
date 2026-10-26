import test from 'node:test';
import assert from 'node:assert/strict';
import { assessGraphicStyle, pictureStyleFor, pictureStyleReferenceFor } from '../server/graphic-style.js';
import { pictureStyleIdFor, pictureStyleOptions, pictureStyleOptionFor } from '../app/picture-styles.js';
import { parseWordCheck, checkWords } from '../server/check-words.js';
import { assessCheck } from '../server/stop-policy.js';
import { wordCheckAnswer, pictureCheckAnswer } from './checker-fixture.mjs';
import { family } from './fixture.mjs';
import { moves } from '../server/files.js';
import { publicCast, lockedCast, assessCastObservations } from '../server/cast.js';
import { buildPictureRequest, buildPortraitRequest, buildPosterRequest, buildPanelRequest, buildFrameRequest, buildWordCheckRequest } from '../server/requests.js';
import { kitText } from './kit-text-fixture.mjs';
import { templateGuidePNG } from '../server/poster-template.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readyFrame, checkedFrame } from '../server/frames.js';
import { offlineTransport, openaiAnswer } from './offline-kit-fixture.mjs';
import { withKitEvidence } from '../server/kit-evidence.js';

const boxes = [{ id: 'bubble', text: 'Can you help?' }];
const parse = (answer, required = true, pictureStyleId = 'classic-comic') => parseWordCheck(JSON.stringify(answer), boxes, { requireGraphicStyle: required, pictureStyleId });
test('historical checks stay readable while a fresh check needs a visible style verdict', () => {
  const answer = wordCheckAnswer(boxes); delete answer.graphicStyle;
  assert.equal(parse(answer, false).ready, true);
  const fresh = parse(answer);
  assert.equal(fresh.ready, false); assert.equal(fresh.graphicStyle.verified, false); assert.equal(fresh.needsRecheck, true);
});
test('confirmed wrong rendering cannot become a report-only opinion at final assessment', () => {
  for (const key of ['photographicTexture', 'toyShine', 'matchesSelectedStyle']) {
    const answer = wordCheckAnswer(boxes); Object.assign(answer.graphicStyle, { [key]: true, evidence: 'Visible synthetic contradiction for this test.' });
    if (key === 'matchesSelectedStyle') answer.graphicStyle.matchesSelectedStyle = false;
    const checked = assessCheck(parse(answer), { final: true });
    assert.equal(checked.ready, false); assert.ok(checked.faults.some(code => code.startsWith('confirmed_selected_picture_style_mismatch:')));
  }
});
test('an empty approval statement and an uncertain drawing do not verify the required style', () => {
  assert.equal(assessGraphicStyle({ flatInk: true, photographicTexture: false, toyShine: false, oversizedEyes: false, evidence: '' }, { required: true }).verified, false);
  const answer = wordCheckAnswer(boxes); answer.graphicStyle.flatInk = false;
  const checked = parse(answer);
  assert.equal(checked.needsRecheck, true); assert.equal(checked.graphicStyle.verified, false); assert.deepEqual(checked.faults, []);
});
test('a fresh uncertain style verdict keeps its raw observation and continues after one check', async () => {
  let calls = 0;
  const answer = wordCheckAnswer(boxes); answer.graphicStyle.flatInk = false; answer.graphicStyle.evidence = 'The synthetic image cannot be assessed.';
  const transport = { recordRejection() {}, call: async request => {
    assert.equal(request.path, '/v1/responses'); calls++;
    return { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] };
  } };
  const result = await checkWords(transport, { ...family, pictureStyleId: 'classic-comic' }, moves[0], 'A difficult moment.', 'data:image/png;base64,AAAA', boxes, { panel: { scene: 'The child speaks beside the grown-up.', line: boxes[0].text, speakerId: 'child' }, stage: 'panel-1-word-check' });
  assert.equal(calls, 1); assert.equal(result.ready, true); assert.equal(result.needsRecheck, false);
  assert.deepEqual(result.answers, answer); assert.equal(result.graphicStyle.verified, false);
  assert.ok(result.reviewFlags.some(flag => flag.key === 'checker_unverified'));
});
test('each selected look has its own rendering checks and does not impose flat ink on film or fine detail', () => {
  const answer = wordCheckAnswer(boxes);
  answer.graphicStyle.flatInk = false;
  assert.equal(parse(answer, true, 'animated-film').ready, true);
  assert.equal(parse(answer, true, 'classic-comic').needsRecheck, true);
  answer.graphicStyle.photographicTexture = true;
  assert.equal(parse(answer, true, 'detailed-comic').ready, true);
  assert.equal(parse(answer, true, 'animated-film').ready, false);
  answer.graphicStyle.photographicTexture = false;
  answer.graphicStyle.flatInk = true;
  answer.graphicStyle.oversizedEyes = true;
  assert.equal(parse(answer, true, 'classic-comic').ready, true);
  assert.equal(parse(answer, true, 'detailed-comic').ready, false);
});
test('unknown choices fail closed, new families start with recommended Adventure comic and historical choices stay readable', () => {
  assert.equal(pictureStyleIdFor({}, { newFamily: true }), 'adventure-comic');
  assert.deepEqual(pictureStyleOptions.map(style => style.id), ['friendly-anime', 'adventure-comic', 'diary-doodles']);
  assert.deepEqual(pictureStyleOptions.filter(style => style.recommended).map(style => style.id), ['adventure-comic']);
  assert.equal(pictureStyleOptionFor('bold-ink-comic').label, 'Bold ink comic'); assert.equal(pictureStyleOptionFor('heritage-storybook').label, 'Heritage');
  assert.equal(pictureStyleIdFor({}), 'detailed-comic');
  assert.equal(pictureStyleOptionFor('animated-film').label, 'Animated film');
  assert.throws(() => pictureStyleFor('unlisted-look'), /Choose one of the three/);
});
test('fictional style guide bytes bind the selected profile version and reference hash', () => {
  for (const id of ['painted-comic', 'bold-ink-comic', 'anime-comic', 'classic-comic', 'animated-film', 'detailed-comic']) {
    const reference = pictureStyleReferenceFor(id), profile = pictureStyleFor(id);
    assert.ok(reference?.data.startsWith('data:image/png;base64,'));
    assert.equal(profile.referenceHash, reference.hash);
    assert.ok(profile.version.endsWith(':' + reference.hash));
    assert.ok(reference.file.includes('/public/style-examples/'));
    assert.ok(!reference.file.includes('parent-style-previews'));
  }
});
test('all current comic styles keep natural eyes and drawn scenery while allowing their own medium', () => {
  for (const id of ['painted-comic', 'bold-ink-comic', 'anime-comic']) {
    const answer = wordCheckAnswer(boxes), profile = pictureStyleFor(id);
    assert.equal(profile.usesInkPortrait, true);
    assert.ok(/scenery|background|room/.test(profile.rule));
    answer.graphicStyle.flatInk = id !== 'painted-comic';
    assert.equal(parse(answer, true, id).ready, true);
    answer.graphicStyle.oversizedEyes = true;
    assert.equal(parse(answer, true, id).ready, false);
    answer.graphicStyle.oversizedEyes = false;
    answer.graphicStyle.photographicTexture = true;
    assert.equal(parse(answer, true, id).ready, false);
  }
});
test('a chosen description drawing owns appearance, while identity and clothes remain checked', () => {
  const record = structuredClone(family);
  record.hero.pronouns = 'she/her';
  record.cast = [{ id: 'child', role: 'child', label: 'the child', species: 'human', pronouns: 'she/her', description: ['human boy with short dark hair'], outfit: ['green hoodie'], referenceSource: 'description', referencePath: '/private/chosen.png' }];
  assert.doesNotThrow(() => lockedCast(record));
  const cast = publicCast(record);
  assert.deepEqual(cast[0].description, ['human child']);
  assert.equal(cast[0].appearanceAuthority, 'chosen description drawing');
  const observation = { characterId: 'child', observedSpecies: 'human', identityMatches: true, certainty: 'confirmed', identityEvidence: '', appearance: [{ expected: 'human boy with short dark hair', observed: 'long hair', visible: true, matches: false, evidence: 'The preset differs from the chosen drawing.' }], clothing: [] };
  assert.equal(assessCastObservations([observation], cast).faults.length, 0);
  observation.identityMatches = false; observation.identityEvidence = 'A different face appears instead of the chosen character.';
  assert.ok(assessCastObservations([observation], cast).faults.some(fault => fault.startsWith('confirmed_identity_mismatch')));
  observation.identityMatches = true; observation.identityEvidence = '';
  observation.clothing = [{ expected: 'green hoodie', observed: 'red coat', visible: true, matches: false, evidence: 'The locked green hoodie has become a red coat.' }];
  assert.ok(assessCastObservations([observation], cast).faults.some(fault => fault.startsWith('confirmed_cast_clothing_mismatch')));
});
test('picture builders carry the selected look in words only; only the checker sees the style example', () => {
  for (const id of ['classic-comic', 'animated-film', 'detailed-comic', 'painted-comic', 'bold-ink-comic', 'anime-comic']) {
    const record = { ...family, pictureStyleId: id }, person = publicCast(record)[0], move = moves[0], text = kitText();
    const source = 'data:image/png;base64,AAAA', reference = pictureStyleReferenceFor(id), profile = pictureStyleFor(id);
    const poster = buildPosterRequest(record, move, '', text, { referenceData: source });
    const requests = [buildPictureRequest(record, move, '', { hero: true, referenceData: source }), buildPortraitRequest(record, person, source), poster, buildPanelRequest(record, move, '', text.panelLines[0], { referenceData: source }), buildFrameRequest(record, '')];
    for (const request of requests) {
      assert.ok(request.prompt.includes(profile.rule));
      assert.ok(![].concat(request.image ?? []).includes(reference.data));
      assert.doesNotMatch(request.prompt, /RENDERING STYLE EXAMPLE|rendering-style example/i);
      assert.doesNotMatch(request.prompt, /Flat graphic novel colours/);
    }
    // New posters carry only the family's own reference; the drawing model composes the page.
    assert.deepEqual(poster.image, [source]);
    // The comic-face line rides on new story drawings for the three current looks only; the
    // saved person-key wording (buildPortraitRequest) never changes.
    const comic = ['heritage-storybook', 'bold-ink-comic', 'anime-comic'].includes(id);
    for (const request of [requests[0], poster, requests[3]]) assert.equal(request.prompt.includes('COMIC FAMILY FACES'), comic, id);
    assert.ok(!requests[1].prompt.includes('COMIC FAMILY FACES'));
    const check = buildWordCheckRequest(record, move, '', source, { panel: text.panelLines[0] });
    const payload = JSON.parse(check.input[0].content[0].text);
    assert.equal(payload.expectedPictureStyleId, id); assert.equal(payload.graphicStyleVersion, profile.version);
    assert.ok(check.text.format.schema.properties.graphicStyle.required.includes('matchesSelectedStyle'));
    assert.equal(check.input[0].content.at(-1).image_url, reference.data);
  }
});
test('frame reuse keeps each chosen look separate and sends no style example, so it uses the generation route', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'selected-frame-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const transport = offlineTransport(t, directory, request => request.stage === 'frame-check' ? openaiAnswer(pictureCheckAnswer()) : undefined), evidence = withKitEvidence(transport, directory), frames = join(directory, 'frames');
  const results = [];
  for (const id of ['classic-comic', 'animated-film', 'detailed-comic']) {
    const record = { ...family, pictureStyleId: id };
    results.push(await readyFrame(evidence, record, '', { directory: frames }));
    const calls = transport.calls.length;
    await readyFrame(evidence, record, '', { directory: frames });
    assert.equal(transport.calls.length, calls);
    assert.equal(checkedFrame(frames, id).pictureStyleId, id);
  }
  assert.equal(new Set(results.map(result => result.path)).size, 3);
  const draws = transport.calls.filter(call => call.stage === 'frame');
  assert.equal(draws.length, 3);
  assert.ok(draws.every(call => call.path === '/v1/images/generations' && call.body.image === undefined));
});
