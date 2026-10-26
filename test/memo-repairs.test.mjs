import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { publicCast, assessCastObservations, castEvaluationVersion } from '../server/cast.js';
import { checkCast, parseCastCheck } from '../server/check-cast.js';
import { checkWords, parseWordCheck } from '../server/check-words.js';
import { checkPicture, parsePictureCheck } from '../server/check-picture.js';
import { readyKitArt, readyDrawnPage, imageHash } from '../server/picture.js';
import { measureLayout, fitPrintedText } from '../server/layout-fit.js';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { moves, readJSON, saveJSON } from '../server/files.js';
import { family } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { wordCheckAnswer, pictureCheckAnswer } from './checker-fixture.mjs';
import { posterBoxes } from '../server/format.js';
import { offlineTransport } from './offline-kit-fixture.mjs';
import { parentJobFailure } from '../server/job-failure.js';
const appearance = readJSON(new URL('./fixtures/fictional-theo-appearance.json', import.meta.url));
const fitted = readJSON(new URL('./fixtures/fictional-theo-exhausted-fit.json', import.meta.url));
const directoryFor = t => { const path = mkdtempSync(join(tmpdir(), 'memo-repair-')); t.after(() => rmSync(path, {recursive:true,force:true})); return path; };
const ids = appearance.answers.pictures.map(row => row.id);
const badRow = () => structuredClone(appearance.answers.pictures[2].castObservations[1]);
const cast = publicCast({ ...family, cast: appearance.cast });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('exact saved Theo answer fails only panel 2, with existing observations and no wire', () => {
  assert.equal(appearance.fixture, true);
  const check = parseCastCheck(JSON.stringify(appearance.answers), cast, ids);
  assert.equal(check.ready, false); assert.deepEqual(check.failedPictures, ['panel-2']);
  assert.equal(check.castEvaluationVersion, castEvaluationVersion);
  assert.match(check.faults[0], /confirmed_cast_appearance_mismatch: panel-2, grown-up-one/);
  for (const picture of appearance.answers.pictures.filter(p => p.id !== 'panel-2')) assert.deepEqual(assessCastObservations(picture.castObservations, cast, picture.id).faults, []);
});

test('photo and description appearance changes fail; hidden views, uncertainty and preset conflicts stay review-only', () => {
  for (const referenceSource of ['photo', 'description']) {
    const people = cast.map(person => ({ ...person, referenceSource }));
    for (const evidence of ['The chosen reference has no glasses; both eyes now have black frames.', 'The chosen reference wears glasses; this drawing removes them from the visible face.', 'The chosen reference has dark curls; visible hair is now straight and blond.', 'The chosen reference has a full beard; the visible chin is now bare.']) {
      const row = badRow(); row.appearance[0].basis = 'chosen-reference'; row.appearance[0].evidence = evidence;
      assert.equal(assessCastObservations([row], people).faults.length, 1);
      row.appearance[0].visible = false; assert.equal(assessCastObservations([row], people).faults.length, 0);
      row.appearance[0].visible = true; row.certainty = 'uncertain'; assert.equal(assessCastObservations([row], people).faults.length, 0);
    }
    for (const evidence of ['Chosen image has a full beard; panel chin is bare.', 'The portrait has no glasses although the generic preset mentions them; panel adds glasses.']) {
      const row = badRow(); row.appearance[0].evidence = evidence;
      assert.equal(assessCastObservations([row], people).faults.length, 1, 'Legacy supplied role belongs to the chosen drawing regardless of evidence wording.');
      row.appearance[0].basis = 'chosen-reference'; row.appearance[0].expected = 'full beard';
      assert.equal(assessCastObservations([row], people).faults.length, 1, 'Explicit reference basis never depends on evidence keywords.');
      row.appearance[0].basis = 'locked-description';
      assert.equal(assessCastObservations([row], people).faults.length, 0, 'A preset comparison cannot overrule the chosen image.');
    }
    const row = badRow(); row.appearance[0].expected = 'short dark hair'; row.appearance[0].evidence = 'The chosen reference and picture share long light hair; they differ from the generic preset.';
    assert.deepEqual(assessCastObservations([row], people).faults, []);
  }
});

test('reference, poster and panel parsers enforce the same chosen appearance rule', () => {
  const row = badRow(), move = moves[0], text = kitText(move);
  for (const boxes of [posterBoxes(move,text), [{id:'bubble',text:'A small try.'}]]) {
    const check = parseWordCheck(JSON.stringify({...wordCheckAnswer(boxes),castObservations:[row]}),boxes,{cast});
    assert.equal(check.ready,false); assert.match(check.faults.join(),/confirmed_cast_appearance_mismatch/);
  }
  assert.equal(parsePictureCheck(JSON.stringify({...pictureCheckAnswer(),castObservations:[row]}),{cast}).ready,false);
  const missing = {pictures: ids.map(id=>({id,castObservations:[]}))};
  assert.equal(parseCastCheck(JSON.stringify(missing),cast,ids).ready,false,'missing legacy evidence is not fresh approval');
});

test('fresh checks require comparison basis even when JSON schema fallback is used; saved parsers stay compatible', () => {
  const row = badRow(), boxes = [{ id: 'bubble', text: 'A small try.' }], word = { ...wordCheckAnswer(boxes), castObservations: [row] };
  assert.equal(parseWordCheck(JSON.stringify(word), boxes, { cast, requireAppearanceBasis: true }).ready, false);
  assert.equal(parsePictureCheck(JSON.stringify({ ...pictureCheckAnswer(), castObservations: [row] }), { cast, requireAppearanceBasis: true }).ready, false);
  assert.equal(parseCastCheck(JSON.stringify(appearance.answers), cast, ids, undefined, { requireAppearanceBasis: true }).ready, false);
  assert.equal(parseCastCheck(JSON.stringify(appearance.answers), cast, ids).needsRecheck, false);
  row.appearance[0].expected = 'full beard';
  assert.equal(assessCastObservations([row], cast).reviewFlags[0].key, 'cast_appearance_basis_unverified');
});

test('fresh image checks keep raw missing-basis answers after schema fallback without another opinion', async () => {
  const row = badRow(), record = { ...family, cast: appearance.cast }, boxes = [{ id: 'bubble', text: 'A small try.' }];
  const answer = value => ({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
  for (const kind of ['reference', 'panel', 'continuity']) {
    let calls = 0; const transport = { recordRejection() {}, recordVerdict() {}, async call(request) {
      calls++;
      if (request.body.text.format.type === 'json_schema') throw Object.assign(Error('Fixture strict schema rejection'), { schemaRejected: true });
      assert.equal(request.body.text.format.type, 'json_object');
      return answer(kind === 'reference' ? { ...pictureCheckAnswer(), castObservations: [row] } : kind === 'panel' ? { ...wordCheckAnswer(boxes), castObservations: [row] } : { pictures: [{ id: 'panel-2', castObservations: [row] }] });
    } };
    const run = kind === 'reference' ? () => checkPicture(transport, record, moves[0], '', 'data:image/png;base64,AA==') : kind === 'panel' ? () => checkWords(transport, record, moves[0], '', 'data:image/png;base64,AA==', boxes, { panel: { line: 'A small try.', scene: 'The grown-up listens.', speakerId: 'child' } }) : () => checkCast(transport, record, moves[0], '', [{ id: 'panel-2', data: 'data:image/png;base64,AA==', expectedVisibleCast: cast }], []);
    const result = await run();
    assert.equal(result.ready, true); assert.equal(result.needsRecheck, false);
    assert.ok(result.reviewFlags.length, 'Missing appearance evidence stays visible for review.');
    const savedRow = kind === 'continuity' ? result.answers.pictures[0].castObservations[0] : result.answers.castObservations[0];
    assert.deepEqual(savedRow, row); assert.equal(savedRow.appearance[0].basis, undefined);
    assert.equal(calls, 2, 'One schema rejection and one JSON reply. No extra checker or drawing.');
  }
});

test('saved whole-kit appearance observations cannot trigger a new check or redraw of accepted art', async t => {
  const directory = directoryFor(t), record = {...family,cast:appearance.cast}, calls = [];
  const transport = {call: async request => {calls.push(request);assert.fail('No wire allowed');}};
  await assert.rejects(readyKitArt(transport,record,moves[0],'',kitText(moves[0]),{directory,saved:{'cast-continuity':{ready:true,checks:[{ready:true,answers:appearance.answers}]}}}),/checked reference/);
  const image = new URL('./fixtures/offline-art.png',import.meta.url).pathname;
  record.cast = record.cast.map(person=>({...person,referencePath:image,referenceHash:imageHash(image)})); record.hero={...record.hero,heroPicturePath:image};
  const references = record.cast.map(person => ({ characterId: person.id, hash: imageHash(image) }));
  const candidate = () => ({ ready: true, path: image, hash: imageHash(image), referenceHash: imageHash(image), castReferenceHashes: references });
  const prior = {ready:true,checks:[{ready:true,answers:structuredClone(appearance.answers)}]};
  const saved = {poster:candidate(),...Object.fromEntries([1,2,3,4].map(i=>['panel-'+i,candidate()])), 'cast-continuity':prior};
  const before = hash(saved);
  let continuity;
  const art = await readyKitArt(transport,record,moves[0],'',kitText(moves[0]),{directory,saved,saveStage(name,value){if(name==='cast-continuity')continuity=value;}});
  assert.equal(art.ready,true); assert.deepEqual(calls,[]); assert.equal(hash(saved),before);
  assert.equal(art.poster.hash,imageHash(image)); assert.ok(art.panels.every(panel=>panel.hash===imageHash(image)));
  assert.deepEqual(art.continuityChecks,[]); assert.equal(continuity.reviewStatus,'parent-review'); assert.equal(continuity.verified,false);
});

test('saved panel appearance evidence stays a review note without changing accepted bytes', async t => {
  const directory=directoryFor(t),record=structuredClone(family),image=new URL('./fixtures/offline-art.png',import.meta.url).pathname;
  record.cast=appearance.cast.map(person=>({...person,referencePath:image,referenceHash:imageHash(image)}));record.hero.heroPicturePath=image;
  const text=kitText(moves[0]), boxes=[{id:'bubble',text:text.panelLines[1].line}];
  const raw={...wordCheckAnswer(boxes),castObservations:[badRow()]};
  const candidate={ready:true,path:image,hash:imageHash(image),referenceHash:imageHash(image),castReferenceHashes:record.cast.map(person=>({characterId:person.id,hash:imageHash(image)})),expectedBoxes:boxes,checks:[{ready:true,checkerAttempt:1,answers:raw}]};
  let calls=0;
  const result=await readyDrawnPage({call:async()=>{calls++;assert.fail('No wire allowed');}},record,moves[0],'',text,{directory,panelIndex:1,savedCandidate:candidate});
  assert.equal(calls,0); assert.equal(result.ready,true); assert.equal(result.hash,candidate.hash);
  const check=result.checks.at(-1); assert.equal(check.verified,false); assert.deepEqual(check.answers,raw);
  assert.ok(check.reviewFlags.some(flag=>flag.key.startsWith('confirmed_cast_appearance_mismatch')));
});

test('exact exhausted Theo story gets one measured free revision and reuses it after reload', async t => {
  const directory=directoryFor(t),checkpoint=structuredClone(fitted.checkpoint),before=hash(checkpoint.stages.text),attempts=structuredClone(checkpoint.fitAttempts);
  saveJSON(join(directory,'checkpoint.json'),checkpoint);
  const memory=createMemory(join(directory,'family.json'));memory.store(checkpoint.recordAtStart);
  const transport=offlineTransport(t,directory,()=>assert.fail('Exact saved fit needs zero provider calls'));
  const run=()=>createKit(transport,memory,checkpoint.tonight,{kit:checkpoint.kit,directory,resume:true,stopBeforePictures:true,exports:{measureLayout}});
  const result=await run();assert.equal(result.layoutFit.ready,true);assert.equal(result.layoutFit.pages.length,5);
  const after=readJSON(join(directory,'checkpoint.json'));
  assert.deepEqual(after.fitAttempts,attempts);assert.equal(hash(after.stages.text),before);assert.equal(after.savedLayoutRevision.status,'fitted');
  const revision=readJSON(join(after.savedLayoutRevision.directory,'text-layout-fit.json'));
  assert.equal(revision.originalReceipt.ready,false);assert.match(revision.originalReceipt.faults.join(),/10.96/);
  assert.equal(revision.receipt.fitting.changes.find(row=>row.paragraphJoins)?.paragraphJoins,1);
  assert.equal(hash(readJSON(join(after.savedLayoutRevision.directory,'checkpoint-before.json')).stages.text),before);
  for(const theme of ['light','dark']){
    const receipt=await measureLayout(join(directory,'text-fit','kit_final.html'),{theme});assert.equal(receipt.ready,true,receipt.faults.join());
    for(const page of receipt.pages.filter(p=>p.page.startsWith('story'))){assert.ok(Math.abs(page.storyTypography.bodyPoints-13)<.001);assert.equal(page.storyTypography.panelHeightPoints,180);assert.equal(page.footerOverflowPoints,0);}
  }
  await run();assert.deepEqual(transport.calls,[]);assert.equal(readdirSync(join(directory,'layout-revisions')).length,1);
  assert.equal(hash(readJSON(join(directory,'checkpoint.json')).stages.text),before);
});

test('a measured reflow that still fails becomes terminal without renewing attempts', async t => {
  const directory=directoryFor(t),checkpoint=structuredClone(fitted.checkpoint);saveJSON(join(directory,'checkpoint.json'),checkpoint);
  const memory=createMemory(join(directory,'family.json'));memory.store(checkpoint.recordAtStart);
  const transport=offlineTransport(t,directory,()=>assert.fail('No provider calls'));
  let measures=0;const measure=async()=>{measures++;return {measured:true,ready:false,faults:['still overflows'],pages:[]};};
  const run=()=>createKit(transport,memory,checkpoint.tonight,{kit:checkpoint.kit,directory,resume:true,stopBeforePictures:true,exports:{measureLayout:measure}});
  await assert.rejects(run(),/printed_layout_review_required/);const count=measures;
  await assert.rejects(run(),/printed_layout_review_required/);assert.equal(measures,count);
  assert.deepEqual(readJSON(join(directory,'checkpoint.json')).fitAttempts,checkpoint.fitAttempts);assert.deepEqual(transport.calls,[]);
});

test('known terminal and stage errors expose safe, useful messages',()=>{
  const hidden='private child note provider body sk-secret';
  for(const stage of ['story-check','panel-2-word-check','kit-pdf']) {const failure=parentJobFailure(Error(hidden),stage);assert.doesNotMatch(failure.message,/private|sk-secret|provider/);assert.equal(failure.canResume,true);}
  assert.equal(parentJobFailure(Object.assign(Error(hidden),{code:'saved_appearance_review_required'})).canResume,false);
  assert.equal(parentJobFailure(Object.assign(Error(hidden),{code:'printed_layout_review_required'})).canResume,false);
});
