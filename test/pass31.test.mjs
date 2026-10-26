import test from 'node:test';
import assert from 'node:assert/strict';
import { moves, words } from '../server/files.js';
import { kitEditorial, printedSourcesFor } from '../server/kit-editorial.js';
import { makePages, combinedKitHTML, visibleText, printedText, verifyOwnedWords } from '../server/layout.js';
import { validateStory } from '../server/story.js';
import { printedCapacity } from '../server/printed-capacity.js';
import { selectedRhymeFor } from '../server/rhyme.js';
import { posterBoxes, talkOffer, parentGuidance, replayTransfer, replayQuietNight, replayRule, printedReplayRule } from '../server/format.js';
import { publicCast, assessCastObservations } from '../server/cast.js';
import { buildStoryRequest, buildStoryCheckRequest, buildPanelRequest, buildWordCheckRequest, buildPictureCheckRequest, buildCastCheckRequest } from '../server/requests.js';
import { parseCastCheck } from '../server/check-cast.js';
import { parsePictureCheck } from '../server/check-picture.js';
import { parseWordCheck } from '../server/check-words.js';
import { castObservation, pictureCheckAnswer, wordCheckAnswer } from './checker-fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { readableKitText } from './readable-kit-fixture.mjs';
import { family, sentences } from './fixture.mjs';
import { measureDocument } from '../server/layout-fit.js';
import { sourceReaderLimitation } from '../app/reader-notes.js';

const pagesFor = move => { const text = kitText(move); text.pagination = validateStory(text).pagination; return makePages(move, text); };

test('pass 31: all fourteen kits print five pages with short practice cards and a small evidence strip', () => {
  for (const move of moves) {
    const pages = pagesFor(move), combined = combinedKitHTML(pages), print = printedText(combined);
    assert.equal((combined.match(/<main\b/g) ?? []).length, 5);
    assert.equal((print.match(/MADE UP/g) ?? []).length, 1);
    assert.doesNotMatch(print, /FOR SUNNY.S READ|longer version|\(\d+ seconds\)/);
    assert.equal((pages['try.html'].match(/data-generated="tinyTryOptions\[/g) ?? []).length, 3);
    assert.doesNotMatch(pages['try.html'], /source-long|science-record|kit-rhyme/);
    assert.equal((pages['for-you.html'].split('<aside')[0].match(/<p data-short-note=/g) ?? []).length, 4);
    assert.ok(printedText(pages['for-you.html']).includes('Sources and study details are in the app.'));
    assert.equal(verifyOwnedWords(pages, move), true);
    const notes = visibleText(combined.split('<aside class="parent-notes">')[1]);
    for (const guidance of [talkOffer, parentGuidance, replayTransfer, replayQuietNight, replayRule]) assert.ok(notes.includes(guidance));
    for (const source of move.sources) {
      for (const field of ['title', source.doi ? 'doi' : 'pubmed']) assert.ok(notes.includes(String(source[field])));
      assert.ok(notes.includes(sourceReaderLimitation(source)));
    }
    assert.match(combined, /html\[data-print\][^{]*\.parent-notes\{display:none!important\}/);
    assert.match(combined, /@media print\{\s*[^{}]*\.parent-notes\{display:none!important\}/);
    assert.ok(notes.includes("FOR SUNNY'S READ"));
  }
});

test('pass 31: length is an editorial estimate, with larger full-width type and report-only counts', () => {
  const capacity = printedCapacity(), text = readableKitText();
  assert.equal(capacity.measured, true);
  assert.match(capacity.method, /Pass 37 photographed practice layout/);
  assert.ok(capacity.story.measuredSamplePages.every(value => value >= 275));
  assert.equal(capacity.story.targetWords, 600);
  assert.deepEqual(kitEditorial.story.rangeWords, [550, 750]);
  assert.match(kitEditorial.story.basis, /writing guidance, not a word-count stop/);
  assert.ok(words(text.story).length >= 450 && words(text.story).length <= 550);
  assert.ok(text.story.split('\n').length >= 18 && text.story.split('\n').length <= 24);
  const html = makePages(moves[0], text)['story.html'];
  assert.match(html, /\.chapter-text\{font-size:13pt;line-height:1\.4;width:100%\}/);
  assert.match(html, /\.chapter-text p\{margin-bottom:6\.5pt\}/);
  assert.doesNotMatch(html, /max-width:63ch|class="kit-rhyme"/);
  for (const count of [300, 550, 800]) assert.doesNotThrow(() => validateStory(kitText(moves[0], { wordCount: count })));
});

test('pass 31: a picture extending from its row into story text is measured as overflow', t => {
  const previous = globalThis.document;
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const bounds = (width, height) => ({ getBoundingClientRect: () => ({ x: 0, y: 0, width, height }) });
  const image = bounds(300, 700), panel = { ...bounds(720, 240), querySelectorAll: () => [image] };
  const sheet = { ...bounds(720, 960), dataset: { page: 'story' }, querySelector: selector => selector === '.panels' ? panel : null, querySelectorAll: () => [] };
  globalThis.document = { querySelectorAll: () => [sheet], fonts: { status: 'loaded' } };
  const receipt = measureDocument();
  assert.equal(receipt.ready, false);
  assert.match(receipt.faults.join(' '), /panel-1: image extends/);
  image.getBoundingClientRect = () => ({ x: 0, y: 0, width: 300, height: 240 });
  assert.equal(measureDocument().ready, true);
});

test('pass 31: source selection only reuses existing evidence and retains the contradictory breathing result', () => {
  for (const move of moves) for (const source of printedSourcesFor(move)) {
    const { recordIndex, ...record } = source;
    assert.deepEqual(record, move.sources[recordIndex]);
  }
  const breathing = printedSourcesFor(moves.find(move => move.id === 'long-breath-out'));
  assert.equal(breathing.length, 2);
  assert.ok(breathing.some(source => source.limitation.includes('no average immediate benefit')));
});

test('pass 31: all rhyme selections preserve authorship and never imply delegated owner approval', () => {
  for (const move of moves) {
    const rhyme = selectedRhymeFor(move);
    assert.equal(rhyme.approved, ['name-it-exactly', 'compare-with-past-me', 'good-enough-is-done', 'make-it-right', 'check-my-battery'].includes(move.id));
    assert.equal(rhyme.selection.ownerApproval, false);
    assert.match(rhyme.selection.by, /Codex/);
    assert.ok(words(rhyme.tagline).length >= 4 && words(rhyme.tagline).length <= 7);
    assert.equal(posterBoxes(move, { tagline: rhyme.tagline })[1].text, rhyme.tagline);
    if (rhyme.source !== 'content/topic-reminders.json') assert.equal(move.detail.tagline.rhyme, rhyme.tagline);
    assert.equal(rhyme.selection.ownerApproval, false);
  }
});

test('pass 31: parent feeling slots flow naturally into sentences without changing the saved answer', () => {
  for (const [input, expected] of [['Frustrated', 'frustrated'], ['Left Out', 'left Out'], ['Épuisé', 'épuisé']]) {
    const text = kitText(); text.noticedFeeling = input; text.pagination = validateStory(text).pagination;
    const html = makePages(moves[0], text)['for-you.html'];
    assert.ok(printedText(html).includes(`I noticed you looked ${expected}. That makes sense.`));
    assert.equal(text.noticedFeeling, input);
  }
});

test('pass 31: writer, judge and pictures use one fictional grown-up identity and explicit cast overrides', () => {
  const record = structuredClone(family), cast = publicCast(record);
  assert.equal(cast[1].pronouns, 'he/him');
  assert.ok(cast[1].description.includes('human adult man'));
  const writer = JSON.parse(buildStoryRequest(record, sentences[0]).input[0].content);
  const judge = JSON.parse(buildStoryCheckRequest(kitText(), moves[0], { record }).input[0].content);
  assert.equal(writer.cast[1].pronouns, 'he/him');
  assert.equal(judge.cast[1].pronouns, 'he/him');
  assert.equal(judge.parentLabel, record.parentLabel);
  record.cast = cast; record.cast[1].pronouns = 'she/her'; record.cast[1].description = ['human adult woman', 'short dark hair'];
  const payload = JSON.parse(buildStoryRequest(record, sentences[0]).input[0].content);
  assert.equal(payload.cast[1].pronouns, 'she/her');
  assert.match(buildPanelRequest(record, moves[0], '', kitText().panelLines[0]).prompt, /human adult woman/);
});

test('pass 31: every picture checker counts bodies, and confirmed duplicate children or adults fail all parsers', () => {
  const cast = publicCast(family), text = kitText(), data = 'data:image/png;base64,AA==';
  for (const person of cast) {
    const observations = [castObservation(person), castObservation(person)];
    observations[0].identityEvidence = 'The same face appears in a body standing on the left.';
    observations[1].identityEvidence = 'A second body with the same face stands on the right.';
    assert.ok(assessCastObservations(observations, cast).faults.some(fault => fault.startsWith('confirmed_duplicate_character:')));
    const reference = parsePictureCheck(JSON.stringify({ ...pictureCheckAnswer(), castObservations: observations }), { cast });
    const panel = parseWordCheck(JSON.stringify({ ...wordCheckAnswer([{ id: 'bubble', text: text.panelLines[0].line }]), castObservations: observations }), [{ id: 'bubble', text: text.panelLines[0].line }], { cast });
    const whole = parseCastCheck(JSON.stringify({ pictures: [{ id: 'panel-1', castObservations: observations }] }), cast, ['panel-1']);
    for (const check of [reference, panel, whole]) { assert.equal(check.ready, false); assert.match(check.faults.join(' '), /confirmed_duplicate_character/); }
    observations[1].certainty = 'uncertain';
    const uncertain = assessCastObservations(observations, cast);
    assert.deepEqual(uncertain.faults, []); assert.equal(uncertain.reviewFlags[0].key, 'cast_duplicate_uncertain');
    const separatePictures = parseCastCheck(JSON.stringify({ pictures: ['panel-1', 'panel-2'].map(id => ({ id, castObservations: [castObservation(person)] })) }), cast, ['panel-1', 'panel-2']);
    assert.equal(separatePictures.ready, true);
  }
  const requests = [buildWordCheckRequest(family, moves[0], '', data, { panel: text.panelLines[0] }), buildPictureCheckRequest(family, moves[0], '', data), buildCastCheckRequest(family, moves[0], '', [{ id: 'panel-1', data }], [])];
  for (const request of requests) assert.match(JSON.stringify(request), /one row per visible BODY/);
});
