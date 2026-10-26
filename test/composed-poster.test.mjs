import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { composedPosterTemplate, composedPosterPrompt, templateGuidePNG, posterTemplate, legacyPosterTemplate, validateGeometryReceipt, makePosterMap, unverifiedGeometry, measuredFooter, measuredRegions, comparisonHTML, regionIds, geometryIds, posterImageTransform } from '../server/poster-template.js';
import { buildPosterRequest, buildWordCheckRequest, buildPortraitStageRequest, buildPortraitRequest } from '../server/requests.js';
import { posterContent } from '../server/layout.js';
import { isHardFault } from '../server/stop-policy.js';
import { comicFaceRule, comicFaceRuleFor } from '../server/graphic-style.js';
import { publicCast } from '../server/cast.js';
import { moves } from '../server/files.js';
import { family } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';

// Owner decision, October 16: the same core parts on every poster, composed
// freely by the drawing model like the original Project posters. These
// receipts are offline measurements in source pixels, not real drawings.
const version = composedPosterTemplate.version, footerText = "Pip's Confidence Guide";
function receiptFor(layout) {
  const observed = [], textLines = [];
  for (const [id, r] of Object.entries(layout)) observed.push({ id, ...r });
  for (const id of ['tinyTry', 'science', 'plan', 'remember', 'source']) {
    const c = layout[id];
    observed.push({ id: `${id}.heading`, x: c.x + 16, y: c.y + 12, w: c.w - 32, h: 44 }, { id: `${id}.body`, x: c.x + 16, y: c.y + 64, w: c.w - 32, h: c.h - 80 });
    if (id !== 'plan') textLines.push({ boxId: `${id}.body`, text: 'Approved card words', x: c.x + 20, y: c.y + 70, w: Math.min(260, c.w - 60), h: 30 });
  }
  const p = layout.plan;
  observed.push({ id: 'plan.handwriting', x: p.x + 16, y: p.y + 60, w: p.w - 32, h: 80 }, { id: 'plan.backup', x: p.x + 16, y: p.y + 150, w: p.w - 32, h: 34 });
  textLines.push({ boxId: 'plan.body', text: 'When I notice', x: p.x + 20, y: p.y + 70, w: 104, h: 26 }, { boxId: 'plan.body', text: 'I', x: p.x + 20, y: p.y + 110, w: 12, h: 26 },
    { boxId: 'plan.backup', text: 'Backup: ask once.', x: p.x + 20, y: p.y + 152, w: 180, h: 28 });
  const writableRows = [{ blank: 'notice', x: p.x + 130, y: p.y + 64, w: 160, h: 30, baselineY: p.y + 94 }, { blank: 'action', x: p.x + 40, y: p.y + 104, w: 250, h: 30, baselineY: p.y + 134 }]
    .map(row => ({ ...row, measurementKind: 'writable-area', certainty: 'confirmed', evidence: 'Synthetic fixture: clear area above its own baseline.' }));
  const flags = Object.fromEntries(['textIconCollision', 'fillOutsideCard', 'heroOutsideRegion', 'actionBodyPartHidden', 'clutteredActionBackground', 'glossOrDistortedProportions', 'printTextTooSmall'].map(key => [key, false]));
  return { templateVersion: version, actionBackgroundArea: 'none', coordinateSpace: { unit: 'source-pixels', width: 1024, height: 1536 }, observed, textLines, writableRows, ...flags, evidence: Object.fromEntries(Object.keys(flags).map(key => [key, ''])) };
}
// Like Butterflies Are Fuel: big scene on top, three cards, then two wide cards, badge inside the first card.
const butterflies = { title: { x: 120, y: 40, w: 784, h: 110 }, tagline: { x: 250, y: 150, w: 520, h: 60 }, hero: { x: 50, y: 220, w: 924, h: 560 },
  tinyTry: { x: 40, y: 800, w: 300, h: 300 }, science: { x: 362, y: 800, w: 300, h: 300 }, source: { x: 684, y: 800, w: 300, h: 300 },
  plan: { x: 40, y: 1120, w: 460, h: 280 }, remember: { x: 524, y: 1120, w: 460, h: 280 }, keyword: { x: 90, y: 1000, w: 200, h: 80 }, footer: { x: 262, y: 1430, w: 500, h: 76 } };
// Like Good Enough Is Done: two cards, a DONE badge in the middle over both rows, then three narrow cards.
const goodEnough = { title: { x: 60, y: 40, w: 904, h: 150 }, tagline: { x: 280, y: 160, w: 460, h: 50 }, hero: { x: 70, y: 230, w: 884, h: 520 },
  tinyTry: { x: 70, y: 780, w: 420, h: 260 }, science: { x: 534, y: 780, w: 420, h: 260 }, keyword: { x: 420, y: 990, w: 184, h: 110 },
  plan: { x: 70, y: 1070, w: 300, h: 330 }, remember: { x: 390, y: 1070, w: 250, h: 330 }, source: { x: 660, y: 1070, w: 294, h: 330 }, footer: { x: 70, y: 1420, w: 884, h: 80 } };
const allWordsRead = ['title', 'tagline', 'tiny', 'science', 'keyword', 'move', 'remember', 'source'].map(id => ({ id, matches: true }));
const check = (receipt, options = {}) => validateGeometryReceipt(receipt, { expectedTemplateVersion: version, expectedCoordinateUnit: 'source-pixels', footerText, wordVerdicts: allWordsRead, ...options });

test('two very different compositions both pass, with no grid drift notes and maps that follow each page', () => {
  const maps = [];
  for (const layout of [butterflies, goodEnough]) {
    const result = check(receiptFor(layout));
    assert.equal(result.ready, true, JSON.stringify([result.faults, result.measurementFaults]));
    assert.equal(result.fit, null); assert.ok(!result.reviewFlags.some(flag => flag.key.startsWith('geometry_deviation')));
    assert.equal(measuredFooter(result), true); assert.equal(Object.keys(measuredRegions(result)).length, regionIds.length); assert.equal(result.writingAssessment.verified, true);
    const map = makePosterMap('kit-v1', 'a'.repeat(64), result);
    assert.equal(map.templateVersion, version); assert.equal(map.regionsMeasured, true);
    for (const id of regionIds) assert.deepEqual(map.regions[id], (({ x, y, w, h }) => ({ x, y, w, h }))(result.exported[id]));
    maps.push(map);
  }
  // The same parts sit in different places, and each map follows its own page.
  assert.notDeepEqual(maps[0].regions.keyword, maps[1].regions.keyword); assert.notDeepEqual(maps[0].regions.source, maps[1].regions.source);
  assert.ok(maps[1].regions.keyword.y < maps[1].regions.plan.y && maps[0].regions.keyword.y > maps[0].regions.tinyTry.y);
  // Heading icons are optional decoration on a composed poster.
  assert.ok(!geometryIds(composedPosterTemplate).filter(id => id.endsWith('.icon')).some(id => receiptFor(butterflies).observed.some(row => row.id === id)));
});

test('a part with words that is missing after one recheck stops; an uncertain box only loses its tap area', () => {
  for (const id of ['science', 'keyword', 'title']) {
    const receipt = receiptFor(goodEnough); receipt.observed = receipt.observed.filter(row => row.id !== id && !row.id.startsWith(`${id}.`));
    if (id === 'science') receipt.textLines = receipt.textLines.filter(line => !line.boxId.startsWith('science'));
    const first = check(receipt);
    assert.equal(first.ready, false); assert.equal(first.needsRecheck, true); assert.match(first.measurementFaults.join(' '), new RegExp(`Measure ${id} where it actually is`));
    const wordsId = { science: 'science', keyword: 'keyword', title: 'title' }[id];
    const missingWords = allWordsRead.map(row => row.id === wordsId ? { ...row, matches: false } : row);
    const after = check(receipt, { subBoxesRechecked: true, wordVerdicts: missingWords });
    assert.ok(after.faults.some(fault => fault.startsWith(`missing_core_part: ${id}`)), id); assert.equal(after.ready, false);
    assert.ok(after.faults.filter(fault => fault.startsWith('missing_core_part')).every(isHardFault));
  }
  // The hero has no words: an unmeasured hero is an uncertain box, never proof the drawing is broken.
  // Cast checks still catch a missing person. Readable card words with an unmeasured card likewise pass.
  for (const id of ['hero', 'source']) {
    const receipt = receiptFor(goodEnough); receipt.observed = receipt.observed.filter(row => row.id !== id && !row.id.startsWith(`${id}.`));
    receipt.textLines = receipt.textLines.filter(line => !line.boxId.startsWith(id));
    const kept = check(receipt, { subBoxesRechecked: true });
    assert.equal(kept.ready, true, JSON.stringify(kept.faults)); assert.ok(kept.reviewFlags.some(flag => flag.key === 'unmeasuredPart' && flag.evidence === id));
    const map = makePosterMap('kit-v1', 'a'.repeat(64), kept);
    assert.equal(map.regions[id], undefined, 'no tap area for an unmeasured part'); assert.equal(map.regionsMeasured, false);
    assert.equal(Object.keys(map.regions).length, regionIds.length - 1); assert.equal(measuredFooter(kept), true);
  }
});

test('words under the footer banner, a banner too small for the footer words, crossing and cut-off text all fail', () => {
  const under = receiptFor(butterflies); under.textLines.push({ boxId: 'remember.body', text: 'Hidden under the banner', x: 540, y: 1380, w: 300, h: 70 });
  under.observed.find(row => row.id === 'remember').h = 380; under.observed.find(row => row.id === 'remember.body').h = 300;
  const underResult = check(under);
  assert.ok(underResult.faults.some(fault => fault.startsWith('text_under_footer_banner: remember.body')), JSON.stringify(underResult.faults)); assert.equal(underResult.ready, false);
  const small = receiptFor(butterflies); Object.assign(small.observed.find(row => row.id === 'footer'), { x: 412, w: 200, h: 34 });
  const smallResult = check(small);
  assert.ok(smallResult.faults.some(fault => fault.startsWith('footer_banner_too_small')), JSON.stringify(smallResult.faults)); assert.equal(smallResult.ready, false);
  // A longer footer needs more room in the same banner; a short one fits.
  const roomy = receiptFor(butterflies); Object.assign(roomy.observed.find(row => row.id === 'footer'), { x: 298, w: 427, h: 77 });
  assert.equal(check(roomy).ready, true);
  assert.ok(check(roomy, { footerText: "Alexandria-Rosemary Fitzgerald-Okonkwo's Confidence Guide" }).faults.some(fault => fault.startsWith('footer_banner_too_small')));
  const crossing = receiptFor(goodEnough); crossing.textLines.find(line => line.boxId === 'science.body').w = 440;
  assert.ok(check(crossing).faults.some(fault => fault.startsWith('text_crosses_boundary: science.body')));
  const overlapping = receiptFor(goodEnough); overlapping.textLines.push({ boxId: 'tinyTry.body', text: 'Second line on top', x: 95, y: 855, w: 200, h: 30 });
  assert.ok(check(overlapping).faults.some(fault => fault.startsWith('text_lines_overlap')));
  const cut = receiptFor(goodEnough); cut.textLines.find(line => line.boxId === 'source.body').x = 1000;
  assert.equal(check(cut).ready, false); assert.match(check(cut).measurementFaults.join(' '), /outside the image/);
  for (const fault of [underResult, smallResult].flatMap(result => result.faults)) assert.ok(isHardFault(fault), fault);
});

test('unmeasured composed parts have no guessed tap areas, with a separate printable footer', () => {
  const fallback = unverifiedGeometry(undefined, undefined, version);
  assert.equal(fallback.exported, null); assert.equal(fallback.ready, false); assert.equal(measuredFooter(fallback), false);
  // No guessed tap areas: the viewer shows the picture and plain buttons instead.
  assert.deepEqual(makePosterMap('kit-v1', 'a'.repeat(64), fallback).regions, {});
  assert.match(posterContent(moves[0], { nickname: 'Pip', posterGeometry: fallback }), /data-footer-mode="outside"/);
  const measured = check(receiptFor(butterflies)), page = posterContent(moves[0], { nickname: 'Pip', posterGeometry: measured });
  const f = measured.exported.footer;
  assert.ok(page.includes(`left:${100 * f.x / 612}%;right:auto;top:${100 * f.y / 792}%;width:${100 * f.w / 612}%`), 'footer words sit in the measured banner');
  assert.match(comparisonHTML('poster.png', measured), /boxes the checker measured/); assert.doesNotMatch(comparisonHTML('poster.png', null, version), /<rect/);
  // A saved fixed-layout kit keeps its old guess-free behaviour and target outlines.
  assert.ok(unverifiedGeometry(undefined, undefined, posterTemplate.version).exported.hero);
});

test('an uncertain drawing review preserves valid measured placement without an approval gate', () => {
  const geometry = check(receiptFor(butterflies));
  const uncertain = { ...geometry, ready: false, verified: false };
  assert.deepEqual(posterImageTransform(uncertain), posterImageTransform(geometry));
  assert.equal(measuredFooter(uncertain), true);
  assert.match(posterContent(moves[0], { nickname: 'Pip', posterGeometry: uncertain }), /data-footer-mode="banner"/);
  for (const scale of [0, -1, NaN, Infinity]) assert.throws(() => posterImageTransform({ ...uncertain, placement: { ...uncertain.placement, scale } }), /valid size and position/);
  assert.throws(() => posterImageTransform({ ...uncertain, placement: { ...uncertain.placement, offset: { x: NaN, y: 36 } } }), /valid size and position/);
  assert.throws(() => posterImageTransform(uncertain, { width: 100, height: 100 }), /different image size/);
});

test('the drawing request lists the core parts and limits, with no coordinates, guide picture or fixed slots', () => {
  const prompt = composedPosterPrompt();
  for (const part of ['YOU choose the composition', 'title banner near the top', 'rhyme in its own ribbon or pill', 'One large hero scene', 'Exactly FIVE cards', 'ONE TINY TRY FOR TODAY', 'WHERE IT CAME FROM', 'ONE keyword badge', 'EMPTY light footer banner', 'never below 26', '154 pixels', 'Never fill either blank', 'wordless']) assert.ok(prompt.includes(part), part);
  assert.doesNotMatch(prompt, /\{"x"|Target layout|two wide cards per row|full-width source card|Keep the same arrangement|outline guide/);
  const text = kitText(), references = [{ characterId: 'child', data: 'data:image/png;base64,AA==' }];
  const body = buildPosterRequest({ ...family, pictureStyleId: 'anime-comic' }, moves[0], '', text, { referenceImages: references });
  assert.deepEqual(body.image, ['data:image/png;base64,AA==']); assert.ok(body.prompt.includes(prompt)); assert.ok(body.prompt.includes(comicFaceRule));
  assert.doesNotMatch(body.prompt, /approved positions|preserving their rectangles|fixed footer rectangle|Code-fit card plan/);
});

test('saved fixed-layout kits keep their measuring words, guide and grid notes byte for byte', () => {
  // Hashes of the geometry instruction from the approved snapshot before this change.
  const pinned = { 'letter-photo-five-cards-v2': '0107344fe2390c4872a0847dcc2588f49acd16e052206274078a8b56e7190b7d', 'letter-five-cards-v1': 'c5e67c72569b749daff9ff18565b2fbe084f5a27efc28be7cfcbfa2cc280984c' };
  for (const template of [posterTemplate, legacyPosterTemplate]) {
    const request = buildWordCheckRequest(family, moves[0], '', 'data:image/png;base64,AA==', { templateVersion: template.version });
    const payload = JSON.parse(request.input[0].content[0].text);
    assert.equal(createHash('sha256').update(payload.geometryInstruction).digest('hex'), pinned[template.version]);
    assert.ok(payload.expectedRectangles); assert.equal(request.input[0].content[2].image_url, `data:image/png;base64,${templateGuidePNG(template).toString('base64')}`);
  }
  // The same measured page judged as an older fixed-layout receipt still reports grid drift.
  const legacy = { ...receiptFor(goodEnough), templateVersion: posterTemplate.version };
  const result = validateGeometryReceipt(legacy, { expectedTemplateVersion: posterTemplate.version });
  assert.ok(result.fit); assert.ok(result.reviewFlags.some(flag => flag.key.startsWith('geometry_deviation')));
});

test('comic family faces ride on new drawings for the three earlier first-setup looks; saved key wording and older looks stay', () => {
  for (const id of ['heritage-storybook', 'bold-ink-comic', 'anime-comic']) {
    const record = { ...family, pictureStyleId: id }, person = publicCast(record)[0];
    assert.equal(comicFaceRuleFor(id), comicFaceRule);
    const render = buildPortraitStageRequest(record, person, { phase: 'render', inputMode: 'photo', referenceData: 'data:image/png;base64,AA==' });
    assert.ok(render.prompt.includes(comicFaceRule)); assert.match(render.prompt, /Keep them recognisable as this person/); assert.doesNotMatch(render.prompt, /facial features, skin tone/);
    assert.ok(!buildPortraitRequest(record, person, 'data:image/png;base64,AA==').prompt.includes('COMIC FAMILY FACES'), 'saved person keys use unchanged wording');
  }
  for (const id of ['painted-comic', 'classic-comic', 'animated-film', 'detailed-comic']) assert.equal(comicFaceRuleFor(id), '');
  for (const word of ['recognisable', 'skin tone', 'expressive illustrated eyes', 'clean 2D outlines', 'warm colour fills', 'soft cel shadows', 'No photographic pores', 'baby or chibi', 'never a generic face', 'only when their own photo or words show them']) assert.ok(comicFaceRule.includes(word), word);
  // The checkers judge recognisability, not photo geometry, and allow expressive comic eyes.
  const payload = JSON.parse(buildWordCheckRequest({ ...family, pictureStyleId: 'bold-ink-comic' }, moves[0], '', 'data:image/png;base64,AA==').input[0].content[0].text);
  assert.match(payload.instruction, /Family faces are drawn in the selected look, often simplified or stylised/); assert.match(payload.graphicStyleInstruction, /set oversizedEyes true only for baby or chibi eyes/);
});

test('an unmeasured footer banner keeps the drawing for review with no redraw; other unmeasured parts do not stop the kit', async t => {
  const { mkdtempSync, rmSync } = await import('node:fs'), { tmpdir } = await import('node:os'), { join } = await import('node:path');
  const { checkWords } = await import('../server/check-words.js'), { withKitEvidence } = await import('../server/kit-evidence.js');
  const { posterBoxes } = await import('../server/format.js'), { offlineTransport, openaiAnswer, run5 } = await import('./offline-kit-fixture.mjs');
  const { syntheticCastEvidence, wordCheckAnswer } = await import('./checker-fixture.mjs');
  const boxes = posterBoxes(moves[0], run5);
  for (const missing of ['source', 'footer']) {
    const directory = mkdtempSync(join(tmpdir(), 'composed-unmeasured-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
    const answer = wordCheckAnswer(boxes);
    // Every approved word reads back, but this part itself is never measured.
    answer.geometry.observed = answer.geometry.observed.filter(row => row.id !== missing && !row.id.startsWith(`${missing}.`));
    answer.geometry.textLines = answer.geometry.textLines.filter(line => !line.boxId.startsWith(missing));
    const transport = offlineTransport(t, directory, request => openaiAnswer({ ...syntheticCastEvidence(request), ...answer }));
    const run = checkWords(withKitEvidence(transport, directory), family, moves[0], '', 'data:image/png;base64,AA==', boxes, { templateVersion: version });
    const result = await run; assert.equal(result.ready, true);
    assert.equal(makePosterMap('kit-v1', 'a'.repeat(64), result.geometry).regions[missing], undefined);
    if (missing === 'footer') assert.match(posterContent(moves[0], { nickname: 'Pip', posterGeometry: result.geometry }), /data-footer-mode="outside"/);
    assert.deepEqual(transport.calls.map(call => call.stage), ['poster-word-check'], 'one readback, no extra approval or drawing bought');
    assert.match(transport.calls[0].body.input[0].content[0].text, /There is no target layout/);
  }
});
