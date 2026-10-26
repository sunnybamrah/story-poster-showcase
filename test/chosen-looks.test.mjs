import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pictureStyleOptions, galleryPictureStyleOptions, legacyPictureStyleOptions, defaultPictureStyleId, pictureStyleIdFor, pictureStyleOptionFor } from '../app/picture-styles.js';
import { pictureStyleFor, pictureStyleReferenceFor, comicFaceRule, comicFaceRuleFor, lookIdentityRule, assessGraphicStyle, pictureMonochrome, ownLookFor } from '../server/graphic-style.js';
import { buildPictureRequest, buildPosterRequest, buildPanelRequest, buildFrameRequest, buildPortraitStageRequest, buildWordCheckRequest, buildPictureCheckRequest, buildCastCheckRequest, buildPortraitRenderCheckRequest } from '../server/requests.js';
import { buildReadingArtRequest, buildReadingArtCheckRequest } from '../server/reading-art.js';
import { chooseWorld, worldChoices, inkColourSet } from '../server/worlds.js';
import { readingLookFor, readingLookCSS } from '../server/reading-look.js';
import { posterSourceUses, posterSourceUsesFor, projectPosterSource, projectSourceLine } from '../server/project-source.js';
import { colourOnlyDifference, supportedFaults, pictureCheckKeys } from '../server/checker-contract.js';
import { publicCast } from '../server/cast.js';
import { comparisonTargets } from '../server/portraits.js';
import { checkPicture } from '../server/check-picture.js';
import { checkWords } from '../server/check-words.js';
import { checkCast } from '../server/check-cast.js';
import { moves } from '../server/files.js';
import { family } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { castObservation, pictureCheckAnswer, wordCheckAnswer } from './checker-fixture.mjs';

// Owner's choice, October 16 evening: Friendly anime, Adventure comic
// (recommended, the default, in the middle) and Diary doodles. Each look draws
// faces its own way; Diary doodles is black ink on off-white paper everywhere.
const chosen = ['friendly-anime', 'adventure-comic', 'diary-doodles'];

test('all three poster looks prioritize the child and teaching content with grounded props', () => {
  for (const id of chosen) {
    const record = { ...family, pictureStyleId: id };
    const request = buildPosterRequest(record, moves[0], '', kitText(), { referenceImages: [{ characterId: 'child', data: 'data:image/png;base64,AA==' }] });
    assert.match(request.prompt, /roughly half the background detail/);
    assert.match(request.prompt, /Nothing floats against a body/);
    assert.match(request.prompt, /Exactly FIVE cards/);
    assert.match(request.prompt, /Do not make the whole scene blank or bland/);
    assert.doesNotMatch(request.prompt, /Rich scenery belongs around the action|Simple background applies only/);
    if (id === 'diary-doodles') assert.match(request.prompt, /BLACK INK ONLY/);
  }
});
const png = 'data:image/png;base64,AAAA';
const promptOf = body => JSON.stringify(body);
function drawingBodies(id) {
  const record = { ...family, pictureStyleId: id }, cast = publicCast(record), move = moves[0], text = kitText(), selection = chooseWorld(record);
  const references = cast.map(person => ({ characterId: person.id, data: png }));
  return { selection, bodies: {
    hero: buildPictureRequest(record, move, '', { hero: true, referenceData: png, selection }),
    character: buildPictureRequest(record, move, '', { character: cast[0], referenceImages: [references[0]], selection }),
    poster: buildPosterRequest(record, move, '', text, { referenceImages: references, selection }),
    panel: buildPanelRequest(record, move, '', text.panelLines[0], { referenceImages: references, selection }),
    frame: buildFrameRequest(record, ''),
    render: buildPortraitStageRequest(record, cast[0], { phase: 'render', inputMode: 'photo', referenceData: png }),
    restyle: buildPortraitStageRequest(record, cast[0], { phase: 'finish', inputMode: 'description', restyle: true, referenceData: png }),
    sheet: buildReadingArtRequest(record, cast.map(person => ({ id: person.id, outfit: person.outfit })), references, { pictureCheck: 'checker', poster: 'drawer' }),
  } };
}
function checkerBodies(id) {
  const record = { ...family, pictureStyleId: id }, cast = publicCast(record), move = moves[0], references = cast.map(person => ({ characterId: person.id, data: png }));
  return {
    words: buildWordCheckRequest(record, move, '', png, { referenceImages: references }),
    picture: buildPictureCheckRequest(record, move, '', png, {}),
    cast: buildCastCheckRequest(record, move, '', [{ id: 'poster', data: png }], references),
    sheet: buildReadingArtCheckRequest(record, cast.map(person => ({ id: person.id, outfit: person.outfit })), references, Buffer.from('fixture'), { width: 1536, height: 1024 }, { pictureCheck: 'checker' }),
    portrait: buildPortraitRenderCheckRequest(record, cast[0], { inputMode: 'photo', pictureStyleId: id, renderData: png, referenceData: png }),
  };
}

test('new families see only the three chosen looks, Adventure comic in the middle as the recommended default; saved looks stay readable', () => {
  assert.deepEqual(pictureStyleOptions.map(style => [style.id, style.label]), [['friendly-anime', 'Friendly anime'], ['adventure-comic', 'Adventure comic'], ['diary-doodles', 'Diary doodles']]);
  assert.deepEqual(pictureStyleOptions.filter(style => style.recommended).map(style => style.id), ['adventure-comic']);
  assert.equal(defaultPictureStyleId, 'adventure-comic'); assert.equal(pictureStyleIdFor({}, { newFamily: true }), 'adventure-comic');
  assert.deepEqual(comparisonTargets().map(target => [target.slot, target.pictureStyleId, target.pictureStyleVersion]), [[0, 'friendly-anime', 'friendly-anime-v1'], [1, 'adventure-comic', 'adventure-comic-v1'], [2, 'diary-doodles', 'diary-doodles-v1']]);
  for (const id of chosen) { assert.equal(pictureStyleReferenceFor(id), null); assert.equal(pictureStyleOptionFor(id).example, undefined); }
  // The older gallery keeps its own fixed entries and Recommended chip; nothing is remapped by position.
  assert.deepEqual(galleryPictureStyleOptions.map(style => [style.id, style.label, style.recommended === true]), [['painted-comic', 'Painted comic', false], ['bold-ink-comic', 'Bold ink comic', true], ['anime-comic', 'Anime comic', false]]);
  assert.deepEqual(legacyPictureStyleOptions.map(style => style.id), ['heritage-storybook', 'bold-ink-comic', 'anime-comic', 'painted-comic', 'classic-comic', 'animated-film', 'detailed-comic']);
  for (const id of legacyPictureStyleOptions.map(style => style.id)) assert.equal(pictureStyleFor(id).ownFaces, undefined);
  assert.equal(pictureStyleIdFor({}), 'detailed-comic');
  assert.throws(() => pictureStyleIdFor('diary'), /Choose one of the three story looks/);
});

test('each chosen look draws faces its own way: no shared middle-grade face, no natural-eye clamp, a friendly default and story-true scenes', () => {
  const rules = Object.fromEntries(chosen.map(id => [id, pictureStyleFor(id).rule]));
  assert.match(rules['friendly-anime'], /almond-shaped eyes/); assert.match(rules['adventure-comic'], /large readable drawn eyes/); assert.match(rules['diary-doodles'], /dot or small round eyes/);
  for (const id of chosen) {
    assert.equal(comicFaceRuleFor(id), lookIdentityRule);
    assert.ok(!rules[id].includes('ink identity drawing') && !rules[id].includes('FAMILY IDENTITY'), 'the look rule carries the look; identity is its own line');
    const all = Object.values(drawingBodies(id).bodies).map(promptOf).join('\n') + Object.values(checkerBodies(id)).map(promptOf).join('\n');
    for (const banned of ['COMIC FAMILY FACES', 'middle grade', 'middle-grade', 'Smile or The Baby', 'natural eye', 'natural facial proportions', 'finished colour comic', 'Use normal proportions', 'flat warm colours', 'graphic-novel colours', 'colour scenes use']) assert.ok(!all.includes(banned), `${id}: ${banned}`);
    const { bodies } = drawingBodies(id);
    for (const name of ['hero', 'character', 'poster', 'panel', 'render', 'restyle', 'sheet']) assert.ok(promptOf(bodies[name]).includes('FAMILY IDENTITY.'), `${id} ${name} keeps identity`);
    assert.match(bodies.render.prompt, /Give a friendly, relaxed expression/); assert.match(bodies.restyle.prompt, /Give a friendly, relaxed expression/);
    assert.match(bodies.panel.prompt, /with expressions that fit the story/); assert.match(bodies.poster.prompt, /with an expression that fits the story/);
    assert.match(bodies.render.prompt, /the way the selected look draws them, including its own eyes, nose and hair shapes/);
  }
  assert.match(lookIdentityRule, /never by themselves make a different person/);
  // Older looks keep their exact wording.
  for (const id of ['heritage-storybook', 'bold-ink-comic', 'anime-comic']) assert.equal(comicFaceRuleFor(id), comicFaceRule);
  assert.match(buildPortraitStageRequest({ ...family, pictureStyleId: 'bold-ink-comic' }, publicCast(family)[0], { phase: 'render', inputMode: 'photo', referenceData: png }).prompt, /finished colour comic drawing/);
});

test('stylised eyes are the look, not a fault: Adventure and Diary accept large or dot eyes, Anime still refuses baby or chibi eyes', () => {
  const answer = changes => ({ matchesSelectedStyle: true, flatInk: true, photographicTexture: false, toyShine: false, oversizedEyes: false, evidence: 'Drawn in the expected look.', ...changes });
  for (const id of ['adventure-comic', 'diary-doodles']) {
    const style = assessGraphicStyle(answer({ oversizedEyes: true, flatInk: false }), { required: true, pictureStyleId: id });
    assert.deepEqual([style.faults, style.needsRecheck, style.verified], [[], false, true], id);
  }
  assert.equal(assessGraphicStyle(answer({ oversizedEyes: true }), { required: true, pictureStyleId: 'friendly-anime' }).faults.length, 1);
  assert.equal(assessGraphicStyle(answer({ flatInk: false }), { required: true, pictureStyleId: 'friendly-anime' }).needsRecheck, true);
  for (const id of chosen) {
    const checks = checkerBodies(id), words = JSON.parse(checks.words.input[0].content[0].text), portrait = JSON.parse(checks.portrait.input[0].content[0].text);
    assert.match(words.graphicStyleInstruction, /For Adventure comic, large readable drawn eyes/); assert.match(portrait.lookNote, /For Diary doodles, dot or small round eyes/);
    assert.match(words.instruction, /eyes that are dots, almond shapes or large drawn eyes are the drawing style, never by themselves a different person/);
  }
});

test('Diary doodles is black ink on off-white paper in every picture, page and judge; the colour looks keep their colours', () => {
  for (let kits = 0; kits < 6; kits++) {
    const pastKits = Array.from({ length: kits }, (_, index) => ({ world: worldChoices.worlds[index % worldChoices.worlds.length], colourSet: inkColourSet }));
    assert.equal(chooseWorld({ ...family, pictureStyleId: 'diary-doodles', pastKits }).colourSet, 'ink');
    for (const id of ['friendly-anime', 'adventure-comic']) assert.ok(worldChoices.colourSets.includes(chooseWorld({ ...family, pictureStyleId: id, pastKits: [] }).colourSet));
  }
  const { selection, bodies } = drawingBodies('diary-doodles');
  assert.deepEqual(selection.colourSet, 'ink');
  for (const [name, body] of Object.entries(bodies)) {
    const text = promptOf(body);
    assert.match(text, /BLACK INK ONLY: no colour/, name);
    for (const colourSet of worldChoices.colourSets) assert.ok(!text.includes(`Colour set: ${colourSet}`) && !text.includes(worldChoices.palettes[colourSet]), `${name}: ${colourSet}`);
    for (const word of ['finished colour', 'rich and colourful', 'new colour set', 'a palette that suits', 'its own colour and box', 'Carry the scene colours', 'warm colour fills']) assert.ok(!text.includes(word), `${name}: ${word}`);
  }
  for (const name of ['hero', 'character', 'poster', 'panel']) assert.match(bodies[name].prompt, /Colour set: ink\. black ink on off-white paper only; no colour anywhere\./, name);
  assert.match(bodies.poster.prompt, /with no colour anywhere, because this family look is black ink only/);
  assert.match(bodies.poster.prompt, /Carry the black-ink textures and a few themed shapes around the page and around the footer banner/);
  assert.match(bodies.poster.prompt, /Drawing style everywhere: the family's chosen look, Diary doodles, as its look rule in this request describes it/);
  // Judges: colour is never an outfit fault in black ink.
  const checks = checkerBodies('diary-doodles');
  assert.match(JSON.parse(checks.words.input[0].content[0].text).instruction, /every garment is drawn without colour/);
  assert.match(checks.picture.text.format.schema.properties.outfitMismatch.description, /every garment is drawn without colour/);
  assert.match(checks.cast.instructions, /every garment is drawn without colour/);
  assert.match(JSON.parse(checks.sheet.input[0].content[0].text).outfitRule, /every garment is drawn without colour/);
  // Printed pages 2 to 5: off-white paper with black text, rules and borders.
  assert.equal(readingLookFor({ world: 'comic strip', colourSet: 'ink' }).colourSet, 'ink');
  const inkRules = readingLookCSS.split('\n').filter(line => line.includes('data-reading-palette="ink"'));
  assert.equal(inkRules.length, 3);
  for (const line of inkRules) for (const token of ['--paper:', '--ink:', '--green:', '--border:', '--rule:', '--badge:', '--card:']) assert.ok(line.includes(token), token);
  const greys = [...inkRules.join(' ').matchAll(/#([0-9a-f]{6})/g)].map(match => match[1]);
  assert.ok(greys.every(hex => { const [r, g, b] = [0, 2, 4].map(at => parseInt(hex.slice(at, at + 2), 16)); return Math.max(r, g, b) - Math.min(r, g, b) <= 8; }), 'ink pages carry no colour');
  // The colour looks keep a colour palette and no black-ink words.
  for (const id of ['friendly-anime', 'adventure-comic']) {
    const text = Object.values(drawingBodies(id).bodies).map(promptOf).join('\n') + Object.values(checkerBodies(id)).map(promptOf).join('\n');
    for (const word of ['BLACK INK ONLY', 'Colour set: ink', 'every garment is drawn without colour', 'black ink only']) assert.ok(!text.includes(word), `${id}: ${word}`);
    assert.match(drawingBodies(id).bodies.poster.prompt, /a palette that suits this topic and world/);
  }
});

test('the original Project lines stay byte for byte; each chosen look adapts only listed lines, with reasons', () => {
  assert.equal(posterSourceUsesFor(null), posterSourceUses); assert.equal(projectPosterSource(null), projectPosterSource());
  assert.match(projectPosterSource(), /middle grade graphic novel like Smile/, 'older looks keep the reviewed original quote');
  for (const id of chosen) {
    const look = ownLookFor(id), uses = posterSourceUsesFor(look), source = projectPosterSource(look);
    assert.deepEqual(look, { id, label: pictureStyleOptionFor(id).label, monochrome: id === 'diary-doodles' });
    assert.equal(uses.length, posterSourceUses.length);
    for (const [index, use] of uses.entries()) {
      assert.deepEqual([use.file, use.line], [posterSourceUses[index].file, posterSourceUses[index].line]);
      let expected = projectSourceLine(use.file, use.line);
      for (const [find, replace] of use.changes ?? []) { assert.ok(expected.includes(find), `${use.file} ${use.line}: ${find}`); expected = expected.replace(find, replace); }
      assert.ok(source.includes(expected.replace(/^- /, '').trim()), `${use.file} ${use.line} is quoted with only its listed changes`);
      if (use.changes?.length) assert.ok(use.why?.trim(), `${use.file} ${use.line} names its reason`);
    }
    const changed = uses.filter((use, index) => use !== posterSourceUses[index]).map(use => `${use.file}:${use.line}`);
    assert.deepEqual(changed, id === 'diary-doodles' ? ['STYLE.txt:5', 'STYLE.txt:9', 'PROJECT-INSTRUCTIONS.txt:20'] : ['STYLE.txt:5', 'PROJECT-INSTRUCTIONS.txt:20']);
    assert.ok(!source.includes('Smile') && !source.includes('Baby Sitters'));
    assert.match(source, new RegExp(`Drawn in ${look.label}\\.`));
  }
  assert.match(projectPosterSource(ownLookFor('adventure-comic')), /new world, new colour set, new hero picture, rich and colourful/);
  assert.match(projectPosterSource(ownLookFor('diary-doodles')), /new world, new hero picture, rich in drawn detail, hand drawn in black ink/);
});

// One offline reply per checker. The hoodie is drawn in black ink: a colour-only
// difference. The striped t-shirt is a real wrong garment.
const hoodie = 'green hoodie with a yellow lightning patch';
function reply(observed, evidence) {
  const person = publicCast(family)[0], row = castObservation(person);
  row.clothing = row.clothing.map(item => item.expected === hoodie ? { ...item, observed, matches: false, evidence } : item);
  row.appearance = row.appearance.map(item => /dark hair/.test(item.expected) ? { ...item, observed: item.expected.replace('dark hair', 'hair left as paper white'), matches: false, evidence: 'The hair is uncoloured.' } : item);
  const outfit = { outfitMismatch: true, outfitObservations: [{ item: 'hoodie', kind: 'clothing', visible: true, differs: true, expected: hoodie, observed, evidence }] };
  return { row, outfit };
}
const transportFor = answer => ({ recordRejection() {}, recordVerdict() {}, async call() { return { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] }; } });
async function judged(id, observed, evidence) {
  const record = { ...family, pictureStyleId: id }, { row, outfit } = reply(observed, evidence), boxes = [{ id: 'bubble', text: 'A small try.' }];
  const picture = await checkPicture(transportFor({ ...pictureCheckAnswer(), ...outfit, evidence: { ...pictureCheckAnswer().evidence, outfitMismatch: evidence }, castObservations: [row] }), record, moves[0], '', png);
  const panel = await checkWords(transportFor({ ...wordCheckAnswer(boxes), ...outfit, evidence: { ...wordCheckAnswer(boxes).evidence, outfitMismatch: evidence }, castObservations: [row] }), record, moves[0], '', png, boxes, { panel: { line: 'A small try.', scene: 'The grown-up listens.', speakerId: 'child' } });
  const cast = await checkCast(transportFor({ pictures: [{ id: 'panel-2', castObservations: [row] }] }), record, moves[0], '', [{ id: 'panel-2', data: png, expectedVisibleCast: publicCast(record) }], []);
  return { picture, panel, cast };
}

test('ink colour is not an outfit fault; clothing and likeness concerns are retained for parent review', async () => {
  assert.equal(colourOnlyDifference(hoodie, 'hoodie with a lightning patch drawn in black ink'), true);
  assert.equal(colourOnlyDifference('blue sweater', 'sweater in solid black'), true);
  assert.equal(colourOnlyDifference('blue sweater', 'striped sweater'), false);
  assert.equal(colourOnlyDifference('blue striped sweater', 'sweater drawn in black ink'), false, 'a missing pattern is not colour');
  assert.equal(colourOnlyDifference(hoodie, 'striped t-shirt'), false);
  const inkAnswer = { ...pictureCheckAnswer(), ...reply('hoodie with a lightning patch drawn in black ink', 'The hoodie is black ink, not green.').outfit };
  inkAnswer.evidence = { ...inkAnswer.evidence, outfitMismatch: 'The hoodie is black ink, not green.' };
  assert.deepEqual(supportedFaults(inkAnswer, pictureCheckKeys, { monochrome: true }).faults, []);
  assert.deepEqual(supportedFaults(inkAnswer, pictureCheckKeys).faults, ['outfitMismatch']);

  const ink = await judged('diary-doodles', 'hoodie with a lightning patch drawn in black ink', 'The hoodie and patch are black ink, not green and yellow.');
  for (const [name, result] of Object.entries(ink)) {
    assert.deepEqual(result.faults, [], name);
    assert.ok(result.reviewFlags.some(flag => flag.key === 'cast_colour_in_ink_look'), name);
  }
  // A colour difference in a colour look remains visible to the parent.
  const colour = await judged('adventure-comic', 'hoodie with a lightning patch drawn in black ink', 'The hoodie and patch are black ink, not green and yellow.');
  for (const [name, result] of Object.entries(colour)) { assert.equal(result.ready, true, name); assert.ok(result.reviewFlags.some(flag => /clothing_mismatch|outfitMismatch|appearance_mismatch/.test(flag.key)), name); }
  // A different garment is still wrong in black ink.
  const wrong = await judged('diary-doodles', 'striped t-shirt', 'A striped t-shirt instead of the hoodie.');
  for (const [name, result] of Object.entries(wrong)) { assert.equal(result.ready, true, name); assert.ok(result.reviewFlags.some(flag => /confirmed_cast_clothing_mismatch/.test(flag.key)), name); }
  // The outfit flag itself is only a review note in this app; in black ink a colour-only claim is set aside entirely.
  assert.ok(wrong.picture.reviewFlags.some(flag => flag.key === 'outfitMismatch'));
  assert.ok(ink.picture.ignoredFaults.some(item => item.key === 'outfitMismatch') && !ink.picture.reviewFlags.some(flag => flag.key === 'outfitMismatch'));
  // A different person is still wrong in black ink.
  const person = publicCast(family)[0], stranger = { ...castObservation(person), identityMatches: false, identityEvidence: 'A bald bearded grown man, not the boy in the reference.' };
  const other = await checkPicture(transportFor({ ...pictureCheckAnswer(), castObservations: [stranger] }), { ...family, pictureStyleId: 'diary-doodles' }, moves[0], '', png);
  assert.equal(other.ready, true); assert.ok(other.reviewFlags.some(flag => /confirmed_identity_mismatch/.test(flag.key)));
});

test('setup, People and help name the chosen looks from the catalogue; the help line matches the current video', () => {
  const help = readFileSync(new URL('../app/GuideHelp.jsx', import.meta.url), 'utf8'), main = readFileSync(new URL('../app/main.jsx', import.meta.url), 'utf8');
  assert.match(help, /Add your people and choose Friendly anime, Adventure comic or Diary doodles\./);
  assert.match(help, /Read the story and explore all five pages together\./);
  assert.ok(!help.includes('This video shows the earlier setup'));
  for (const stale of ['Heritage', 'Bold ink comic', 'Anime comic']) { assert.ok(!help.includes(stale), stale); assert.ok(!main.includes(`in ${stale}`), stale); }
  assert.ok(!readFileSync(new URL('../server/app-server.mjs', import.meta.url), 'utf8').includes('Bold is only a placeholder'));
});
