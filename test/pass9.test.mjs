import { geometryAnswer, wordCheckAnswer, storyCheckAnswer, markFault } from './checker-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { posterTemplate, currentPosterTemplateVersion, cardIds, regionIds, geometryRects, geometryBooleanKeys, validateGeometryReceipt, templateGuidePNG, templatePrompt, makePosterMap, containTransform, drawingTransform, comparisonHTML, overlaps } from '../server/poster-template.js';
import { visibleWords, approvedPosterWords, posterWordCount, boxText, assertPosterWordCap } from '../server/format.js';
import { buildWordCheckRequest, buildPosterRequest } from '../server/requests.js';
import { parseWordCheck } from '../server/check-words.js';
import { moves } from '../server/files.js';
import { family } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
import { validatePosterPDFText } from '../server/check-pdf.js';

// These receipts replay an older saved kit made with the fixed photo layout.
const receipt = () => geometryAnswer(posterTemplate.version);

test('photo template fixes two wide columns, a full-width source, gutters and independent icon heading slots', () => {
  const t = posterTemplate;
  assert.equal(cardIds.length, 5);
  assert.deepEqual(new Set(Object.keys(t.regions)), new Set(regionIds));
  assert.equal(t.safeMargin, 36); assert.equal(t.gutter, 12); assert.equal(t.padding, 12);
  assert.equal(t.canvas.width, 612); assert.equal(t.canvas.height, 792);
  const regions = Object.values(t.regions);
  for (let i=0;i<regions.length;i++) for(let j=i+1;j<regions.length;j++) assert.equal(overlaps(regions[i],regions[j]),false);
  assert.equal(t.regions.science.x-t.regions.tinyTry.x-t.regions.tinyTry.w,12);
  assert.equal(t.regions.remember.x-t.regions.plan.x-t.regions.plan.w,12);
  assert.equal(t.regions.plan.y-t.regions.tinyTry.y-t.regions.tinyTry.h,12);
  assert.equal(t.regions.source.w,540);
  assert.equal(t.regions.hero.y-t.regions.tagline.y-t.regions.tagline.h,12);
  for(const id of cardIds){
    const r=t.regions[id], s=t.slots[id];
    assert.equal(r.w,id === 'source' ? 540 : 264); assert.equal(s.icon.x-r.x,12); assert.equal(s.body.x-r.x,12);
    assert.equal(overlaps(s.icon,s.heading),false); assert.equal(overlaps(s.icon,s.body),false);
  }
  assert.throws(()=>{t.regions.plan.x=5;}, TypeError);
});

test('displaced boxes are reviewed while content collisions and missing measurements still fail', () => {
  assert.equal(validateGeometryReceipt(receipt()).ready,true);
  for(const id of ['plan','keyword','science.heading','source.body']){
    const r=receipt(), box=r.observed.find(item=>item.id===id);
    if(id==='source.body') box.y-=80; else box.x+=id==='plan'?80:-80;
    const result = validateGeometryReceipt(r);
    assert.ok(result.observations.some(row => row.key.startsWith('geometry_')), id);
    if (!result.ready) assert.ok(result.faults.every(fault => /text_|handwriting/.test(fault)), result.faults.join('; '));
  }
  for(const key of geometryBooleanKeys){const r=receipt();markFault(r,key,'Visible layout conflict');assert.equal(validateGeometryReceipt(r).ready,true,key);}
  for(const r of [null,{}, {...receipt(),templateVersion:'old'}, {...receipt(),observed:[]}]) assert.equal(validateGeometryReceipt(r).ready,false);
  const smaller=receipt();smaller.observed.find(item=>item.id==='keyword').w-=80;
  assert.ok(validateGeometryReceipt(smaller).observations.some(row => row.evidence.startsWith('geometry_deviation_keyword')));
});

test('drawing guide, source letterboxing and published map share Letter coordinates', () => {
  const png=templateGuidePNG(); assert.equal(png.readUInt32BE(16),1024); assert.equal(png.readUInt32BE(20),1536);
  assert.deepEqual(containTransform(posterTemplate.canvas,{width:1024,height:1536}),drawingTransform);
  const map=makePosterMap('v9','a'.repeat(64));assert.deepEqual(map.regions,posterTemplate.regions);
  assert.equal(map.canvas.width,612);assert.equal(map.templateVersion,posterTemplate.version);
  const html=comparisonHTML('poster.png');assert.match(html, /<svg/);assert.match(html,/translate\(0 63\)/);
  const prompt=templatePrompt();for(const phrase of ['12-point equal gutters','two lines','Clip inner fills','stepping foot','selected picture style','badge and ALL rays']) assert.ok(prompt.includes(phrase));
});

test('whole approved word list includes footer, repeated rhyme and headings but not blank rules', () => {
  const kit=kitText();const list=approvedPosterWords(moves[0],kit,{nickname:'Captain Pip'});
  assert.equal(list.at(-1).text,"Captain Pip's Confidence Guide");
  assert.equal(list.filter(box=>box.card).length,5);
  assert.deepEqual(visibleWords("Don't fill ______, I ______. Let's go."),["Don't",'fill','I',"Let's",'go']);
  assert.equal(posterWordCount(moves[0],kit,{nickname:'Captain Pip'}),list.reduce((n,box)=>n+visibleWords(boxText(box)).length,0));
  assert.equal(assertPosterWordCap(109).status,'PASS');assert.equal(assertPosterWordCap(110).status,'WARN');
});

test('word checker gets actual drawing and outline guide and rejects shifted geometry after exact OCR', () => {
  const kit=kitText();const request=buildWordCheckRequest({...family,familyContext:''},moves[0],'','data:image/png;base64,AA==');
  // A new composed poster is checked without any guide; a saved fixed-layout poster keeps its guide.
  assert.equal(request.input[0].content.filter(c=>c.type==='input_image').length,2);
  assert.equal(buildWordCheckRequest({...family,familyContext:''},moves[0],'','data:image/png;base64,AA==',{templateVersion:posterTemplate.version}).input[0].content.filter(c=>c.type==='input_image').length,3);
  assert.ok(request.text.format.schema.required.includes('geometry'));
  const boxes=approvedPosterWords(moves[0],kit).map(box=>box.id==='footer'?{...box,text:''}:box);
  const answer=wordCheckAnswer(boxes);
  assert.equal(parseWordCheck(JSON.stringify(answer),boxes).ready,true);
  answer.geometry.observed.find(r=>r.id==='plan').x-=80;
  assert.equal(parseWordCheck(JSON.stringify(answer),boxes).ready,false);
  const drawn=buildPosterRequest({...family,familyContext:''},moves[0],'',kit);
  assert.ok(drawn.prompt.includes(currentPosterTemplateVersion));assert.ok(!drawn.prompt.includes(posterTemplate.version));assert.ok(!drawn.prompt.includes(family.hero.nickname));
});

test('frozen poster PDF inspection excludes extra pages, editor text and preview notices', () => {
  assert.equal(validatePosterPDFText("Pip's Confidence Guide\f").pages,1);
  for(const text of ["Pip's Confidence Guide\fAnother page\f", "Pip's Confidence Guide Read larger", "Pip's Confidence Guide Save on this device", "Pip's Confidence Guide Layout preview only"] )assert.throws(()=>validatePosterPDFText(text));
});
