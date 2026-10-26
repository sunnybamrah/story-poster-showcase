import { pictureStyleReferenceFor } from '../server/graphic-style.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { moves } from '../server/files.js';
import { posterTemplate, legacyPosterTemplate, composedPosterTemplate, posterTemplateFor, geometryRects, posterTypePlan, validateGeometryReceipt, makePosterMap, templateGuidePNG, comparisonHTML, unverifiedGeometry } from '../server/poster-template.js';
import { makePages, combinedKitHTML, printedText, visibleText, practiceVignette, posterContent } from '../server/layout.js';
import { buildPosterRequest, buildWordCheckRequest, buildStoryRequest } from '../server/requests.js';
import { validateStory } from '../server/story.js';
import { posterBoxes, talkOffer, replayQuietNight, parentGuidance, posterWordReport } from '../server/format.js';
import { parseWordCheck } from '../server/check-words.js';
import { printedCapacity } from '../server/printed-capacity.js';
import { family } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { geometryAnswer, wordCheckAnswer } from './checker-fixture.mjs';

function receiptFor(template) {
  const receipt = geometryAnswer(), rectangles = geometryRects(template);
  receipt.templateVersion = template.version;
  receipt.observed = Object.entries(rectangles).map(([id, rect]) => ({ id, ...rect }));
  receipt.textLines = receipt.textLines.map(line => ({ ...line, x: rectangles[line.boxId].x + 2, y: rectangles[line.boxId].y + 1, w: rectangles[line.boxId].w - 4 }));
  const writing = template.slots.plan.handwriting;
  receipt.writableRows = [{ blank: 'notice', x: writing.x + 72, y: writing.y, w: writing.w - 72 }, { blank: 'action', x: writing.x + 12, y: writing.y + 12, w: writing.w - 12 }].map(row => ({ ...row, h: 12, baselineY: row.y + 12, measurementKind: 'writable-area', certainty: 'confirmed', evidence: 'Synthetic template-specific writable-row fixture, not a measured drawing.' }));
  return receipt;
}

test('pass 37: saved and new drawing receipts retain their own fit, map, comparison and export version', () => {
  for (const template of [legacyPosterTemplate, posterTemplate]) {
    const geometry = validateGeometryReceipt(receiptFor(template));
    assert.equal(geometry.ready, true, geometry.faults.join('; '));
    assert.equal(geometry.templateVersion, template.version);
    assert.deepEqual(makePosterMap('sample', 'a'.repeat(64), geometry).regions, template.regions);
    assert.equal(makePosterMap('sample', 'a'.repeat(64), geometry).templateVersion, template.version);
    assert.ok(posterContent(moves[0], { posterGeometry: geometry }).includes(`data-template="${template.version}"`));
    assert.ok(comparisonHTML('poster.png', geometry).includes(`width="${template.regions.source.w}"`));
    assert.equal(posterTemplateFor(template.version), template);
  }
  const old = validateGeometryReceipt(receiptFor(legacyPosterTemplate));
  delete old.templateVersion; // historical fitted files omitted it
  assert.equal(makePosterMap('sample', 'a'.repeat(64), old).templateVersion, legacyPosterTemplate.version);
  const unmeasuredOld = unverifiedGeometry(undefined, undefined, legacyPosterTemplate.version);
  assert.equal(makePosterMap('sample', 'a'.repeat(64), unmeasuredOld).templateVersion, legacyPosterTemplate.version);
  assert.deepEqual(unmeasuredOld.exported.hero, legacyPosterTemplate.regions.hero);
  assert.throws(() => posterTemplateFor('unknown'));
  const mismatch = validateGeometryReceipt(receiptFor(legacyPosterTemplate), { expectedTemplateVersion: posterTemplate.version });
  assert.equal(mismatch.ready, false);
  assert.match(mismatch.measurementFaults.join(' '), /templateVersion must equal/);
});

test('pass 37: all fixed move words fit the wider cards without shrinking below the existing floor', () => {
  for (const move of moves) {
    const text = kitText(move), plan = posterTypePlan(move, text);
    for (const [id, card] of Object.entries(plan.cards)) {
      for (const block of [card.heading, card.body ?? card.backup]) {
        assert.equal(block.fits, true, `${move.id}/${id}`);
        assert.ok(block.fontPoints >= 12);
      }
      if (card.handwritingHeight) assert.ok(card.handwritingHeight >= 24);
    }
    const report = posterWordReport(move, text);
    assert.equal(report.reportOnly, true);
    assert.equal(posterTemplate.regions.source.w, 540);
  }
});

test('pass 37: a new poster is composed from the family references alone; saved-kit checks keep their guide; privacy stays intact', () => {
  const move = moves[0], text = kitText(move), guide = `data:image/png;base64,${templateGuidePNG().toString('base64')}`;
  const references = [{ characterId: 'child', data: 'data:image/png;base64,AA==' }, { characterId: 'grown-up-one', data: 'data:image/png;base64,BB==' }];
  const draw = buildPosterRequest(family, move, '', text, { referenceImages: references });
  assert.deepEqual(draw.image, references.map(reference => reference.data));
  assert.ok(!draw.image.includes(pictureStyleReferenceFor(family).data) && !draw.image.includes(guide));
  assert.match(draw.prompt, /YOU choose the composition/); assert.match(draw.prompt, /Exactly FIVE cards/);
  assert.doesNotMatch(draw.prompt, /outline guide|Target layout rectangles|full-width source card|two wide cards per row/);
  assert.doesNotMatch(draw.prompt, /context\/sunny-format|page-[1-5]\.jpg|Pip|Dee/);
  // The composed check measures the actual page: no guide picture, no target boxes.
  const composedCheck = buildWordCheckRequest(family, move, '', 'data:image/png;base64,CC==', { referenceImages: references, templateVersion: composedPosterTemplate.version });
  const composedPayload = JSON.parse(composedCheck.input[0].content[0].text);
  assert.equal(composedPayload.template.version, composedPosterTemplate.version); assert.equal(composedPayload.expectedRectangles, undefined);
  assert.match(composedPayload.geometryInstruction, /There is no target layout and no guide picture/); assert.doesNotMatch(composedPayload.geometryInstruction, /Drift over 8 percent/);
  assert.deepEqual(composedCheck.input[0].content.filter(part => part.type === 'input_image').map(part => part.image_url).slice(0, 3), ['data:image/png;base64,CC==', ...references.map(reference => reference.data)]);
  assert.deepEqual(composedPayload.identityReferences.map(row => row.image), [2, 3]);
  for (const template of [posterTemplate, legacyPosterTemplate]) {
    const check = buildWordCheckRequest(family, move, '', 'data:image/png;base64,CC==', { templateVersion: template.version });
    const payload = JSON.parse(check.input[0].content[0].text);
    assert.equal(check.store, false);
    assert.equal(payload.template.version, template.version);
    assert.deepEqual(payload.expectedRectangles, geometryRects(template));
    assert.equal(check.input[0].content[2].image_url, `data:image/png;base64,${templateGuidePNG(template).toString('base64')}`);
    const boxes = posterBoxes(move, text), answer = wordCheckAnswer(boxes);
    answer.geometry = receiptFor(template);
    assert.equal(parseWordCheck(JSON.stringify(answer), boxes, { expectedTemplateVersion: template.version }).ready, true);
  }
  const unsafe = { ...text, jokeIdea: 'Pip writes a private message.' };
  assert.throws(() => buildPosterRequest(family, move, '', unsafe), /family|privacy|Pip/i);
});

test('pass 37: every move keeps five pages, stacked practice boxes, foldable card halves and full parent details', () => {
  for (const move of moves) {
    const text = kitText(move); text.pagination = validateStory(text).pagination;
    const pages = makePages(move, text), tryPage = pages['try.html'], parent = pages['for-you.html'];
    assert.equal((combinedKitHTML(pages).match(/<main\b/g) ?? []).length, 5);
    assert.doesNotMatch(tryPage, /class="paired"/);
    const ids = [...tryPage.matchAll(/data-card="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(ids, ['feel', 'one-move', 'tiny', 'talk', 'where-else']);
    assert.ok(printedText(tryPage).includes(talkOffer));
    assert.ok(visibleText(parent.split('<aside class="parent-notes">')[1]).includes(replayQuietNight));
    assert.ok(visibleText(parent.split('<aside class="parent-notes">')[1]).includes(parentGuidance));
    assert.ok(printedText(parent).includes('Sources and study details are in the app.'));
    assert.match(parent, /cut around the outside and fold down the middle\./);
    assert.match(parent, /grid-template-columns:3\.5in 3\.5in/);
    assert.match(parent, /outline:1pt dashed var\(--rule\)/);
    assert.match(parent, /My move: ______/);
    assert.match(tryPage, /data-writing-frame="empty"/);
    assert.equal((tryPage.match(/class="writing-blank"/g) ?? []).length, 2);
    assert.match(tryPage, /\.writing-blank\{flex:1;min-width:72pt/);
  }
});

test('pass 37: practice illustration is a true-shape crop of checked artwork and contains no locally added words', () => {
  const geometry = validateGeometryReceipt(receiptFor(posterTemplate));
  const svg = practiceVignette({ posterGeometry: geometry });
  assert.match(svg, /href="poster-art.png"/);
  assert.match(svg, /preserveAspectRatio="xMidYMid slice"/);
  assert.doesNotMatch(svg, /<text|Pip|Dee/);
  const [, width, height] = svg.match(/width="([\d.]+)" height="([\d.]+)"/);
  assert.ok(Math.abs(Number(width) / Number(height) - 1024 / 1536) < 1e-10);
  for (const options of [{}, { preview: true, posterGeometry: geometry }, { posterGeometry: unverifiedGeometry() }]) assert.equal(practiceVignette(options), '');
});

test('pass 37: new writing receives Sunny\'s chapter range and actual practice measurements without count-only rejection', () => {
  for (const move of moves) {
    const capacity = printedCapacity(move.id);
    assert.equal(capacity.measured, true);
    assert.match(capacity.method, /synthetic layout probes/);
    assert.ok(capacity.try.measuredSampleFields.feelFirst >= capacity.try.fields.feelFirst);
    assert.ok(capacity['for-you'].measuredSampleFields.replayCue >= capacity['for-you'].fields.replayCue);
    assert.equal(capacity.story.targetWords, 600);
    assert.equal(capacity.story.ceilingWords, 750);
  }
  // Pip and this moment are fictional input for request instructions only.
  assert.equal(JSON.parse(buildStoryRequest(family, 'Pip is nervous before a recital.').input[0].content).printedCapacity.story.targetWords, 350);
  assert.doesNotThrow(() => validateStory(kitText(moves[0], { wordCount: 499 })));
});
