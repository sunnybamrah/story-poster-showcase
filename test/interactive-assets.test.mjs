import { geometryAnswer, wordCheckAnswer, storyCheckAnswer, markFault } from './checker-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { moves } from '../server/files.js';
import { practiceFor } from '../server/format.js';
import { buildInteractiveContent, evidenceExplanations, freezeInteractivePoster, interactiveContentHash, interactivePrintedWords, interactivePrintedWordsHash, interactiveRegionIds, validateInteractiveContent } from '../server/interactive-assets.js';
import { geometryBooleanKeys, geometryRects, makePosterMap, posterTemplate, validateGeometryReceipt } from '../server/poster-template.js';
import { kitText } from './kit-text-fixture.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// All acceptance records and asset bytes below are synthetic parser fixtures.
// They are never generated posters, source verification, print proof or paid evidence.
function fixture() {
  const move = { ...structuredClone(moves[0]), id: 'synthetic-test-only', name: 'Test move', science: undefined,
    positiveAction: 'Test action.', kidScienceLine: 'Test claim.', keyWord: 'TEST', bodyAction: 'Test gesture.',
    practiceScript: 'First test sentence. Second test sentence. Third test sentence.',
    actionLine: 'The test character does the test action.', whereItCameFromShort: 'Test people, test place, 2000.', searchPhrase: 'test phrase',
    parentReceipt: 'Synthetic receipt only.', whereItCameFrom: 'Synthetic account only.', source: { limitation: 'Synthetic limitation.' },
    sources: [{ title: 'Short test label', people: 'Test people', place: 'Test place', year: 2000, pubmed: '000000', fitLabel: 'ADJACENT' }] };
  const kit = { tagline: 'Test rhyme.', jokeIdea: 'A test prop in the scene.', feelFirst: ['Test validation.'], tinyTryOptions: [{ text: 'Test choice.' }] };
  const approvedDetails = { sections: {
    science: { tested: 'Test task.', participants: 'Test group.', ages: 'Test ages.', result: 'Test result.', evidenceLabel: 'ADJACENT' },
    source: { studyTitle: 'Full synthetic title for a parser test' },
    hero: { jokeCrop: { x: 480, y: 232, w: 80, h: 80 }, jokeExplanation: 'Synthetic joke connection.' },
    keyword: { meaning: 'Synthetic meaning.', example: 'Synthetic example.' }, tagline: { explanation: 'Synthetic rhyme explanation.' },
  }, writtenByCodex: ['sections.keyword.meaning', 'sections.keyword.example', 'sections.tagline.explanation', 'sections.hero.jokeExplanation'] };
  const content = buildInteractiveContent({ move, kit, nickname: 'Test', version: 'synthetic-v1', approvedDetails });
  content.approval = { approved: true, reviewedBy: 'Synthetic unit-test reviewer', reference: 'Synthetic unit-test receipt, not approval for a family', sha256: interactiveContentHash(content) };
  return { move, kit, approvedDetails, content };
}

function diskFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'poster-assets-unit-'));
  // A header is sufficient for the existing dimension reader; it is not a drawing.
  const image = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(image);
  Buffer.from('IHDR').copy(image, 12);
  image.writeUInt32BE(2550, 16); image.writeUInt32BE(3300, 20);
  const pdf = Buffer.from('%PDF-1.7\n% Synthetic parser fixture only.\n');
  const imagePath = join(directory, 'source.png'), pdfPath = join(directory, 'source.pdf');
  writeFileSync(imagePath, image); writeFileSync(pdfPath, pdf);
  const { content } = fixture();
  const map = makePosterMap(content.version, hash(image));
  const wordCount = validateInteractiveContent(content).wordCount;
  const acceptance = { approved: true, version: content.version, imageSha256: hash(image), pdfSha256: hash(pdf),
    wordCheck: { ready: true, approvedWordCount: wordCount, transcribedWordCount: wordCount, blankPlan: true,
      approvedWordsSha256: interactivePrintedWordsHash(content), transcription: interactivePrintedWords(content) },
    geometry: geometryAnswer(posterTemplate.version),
    print: { ready: true, blankPlan: true, letterSize: true } };
  return { directory, imagePath, pdfPath, profileId: 'profile-id', kitId: 'kit-id', content, map, acceptance };
}

test('content has eight stored sections and preserves approved practice without inventing missing research', () => {
  const before = JSON.stringify(moves[0]);
  const content = buildInteractiveContent({ move: moves[0], kit: kitText(moves[0]), version: 'draft-v1' });
  assert.deepEqual(Object.keys(content.sections).sort(), [...interactiveRegionIds].sort());
  assert.equal(content.sections.tinyTry.steps.join(' '), practiceFor(moves[0]));
  assert.deepEqual(content.sourceRecords, moves[0].sources);
  assert.equal(content.sections.science.tested, moves[0].science.tested);
  assert.equal(content.sections.science.evidenceLabel, moves[0].science.evidenceLabel);
  assert.equal(content.sections.source.studyTitle, null);
  assert.equal(content.approval.approved, false);
  assert.match(content.approval.issues.join(';'), /source.studyTitle needs checked text/);
  assert.match(content.approval.issues.join(';'), /science.participants needs checked text/);
  assert.equal(JSON.stringify(moves[0]), before);
  assert.equal(validateInteractiveContent(content).ready, false);
});

test('one claim gets its exact evidence explanation, not a kit-wide evidence grade', () => {
  const { content } = fixture();
  assert.equal(validateInteractiveContent(content).ready, true);
  assert.equal(content.evidenceLabel, undefined);
  assert.equal(content.sections.science.evidenceExplanation, evidenceExplanations.ADJACENT);
  content.sections.science.evidenceExplanation = 'This proves that the move works.';
  assert.match(validateInteractiveContent(content).faults.join(';'), /specific claim evidence label/);
});

test('an edited explanation invalidates its previous approval', () => {
  const { content } = fixture();
  const stamp = content.approval.sha256;
  content.sections.keyword.example = 'A different synthetic example.';
  assert.notEqual(interactiveContentHash(content), stamp);
  assert.match(validateInteractiveContent(content).faults.join(';'), /approval tied to these exact words/);
  assert.ok(content.writtenByCodex.includes('sections.keyword.meaning'));
  assert.ok(content.writtenByCodex.includes('sections.hero.moveSentence'));
});

test('empty-plan row wrapping is structural only and still needs approval of the exact changed bytes', () => {
  const { content } = fixture(), original = JSON.stringify(content), stamp = content.approval.sha256;
  assert.match(content.printed.find(box => box.id === 'move').text, /,\nI /);
  assert.equal(validateInteractiveContent(content).ready, true);
  const changed = structuredClone(content);
  changed.printed.find(box => box.id === 'move').text = changed.printed.find(box => box.id === 'move').text.replace(',\nI ', ', I ');
  const check = validateInteractiveContent(changed);
  assert.ok(!check.faults.some(fault => /both blanks/.test(fault)));
  assert.ok(check.faults.some(fault => /approval tied to these exact words/.test(fault)));
  assert.notEqual(interactiveContentHash(changed), stamp);
  assert.equal(JSON.stringify(content), original);
  changed.printed.find(box => box.id === 'move').text = changed.printed.find(box => box.id === 'move').text.replace('notice ______', 'notice angry');
  assert.ok(validateInteractiveContent(changed).faults.some(fault => /both blanks/.test(fault)));
});

test('a demonstration is optional and an unchecked demonstration prevents freezing', () => {
  const { content } = fixture();
  assert.equal(content.sections.remember.demonstration, undefined);
  content.sections.remember.demonstration = { checked: false, url: 'clip.mp4', caption: 'Test text.' };
  assert.match(validateInteractiveContent(content).faults.join(';'), /demonstration needs a checked file/);
});

test('printed content preserves all headings and empty plan, with report-only word counts', () => {
  const { content } = fixture();
  content.printed.find(box => box.id === 'move').text = 'When I notice a test, I complete it.';
  assert.match(validateInteractiveContent(content).faults.join(';'), /both blanks empty/);
  const long = fixture().content;
  long.printed.find(box => box.id === 'footer').text = Array(110).fill('test').join(' ');
  assert.equal(validateInteractiveContent(long).wordCountReport.status, 'WARN');
  assert.ok(!validateInteractiveContent(long).faults.some(fault => /words exceed/.test(fault)));
  const prefilled = fixture().content;
  prefilled.sections.plan.when = 'A saved answer must never enter the approved poster content.';
  assert.match(validateInteractiveContent(prefilled).faults.join(';'), /must not contain child answers/);
  prefilled.sections.tinyTry.title = 'A different title';
  assert.match(validateInteractiveContent(prefilled).faults.join(';'), /title must match its tapped element/);
});

test('freeze stores independent unchanged image/PDF bytes, text and map with matching versions and checksums', () => {
  const input = diskFixture();
  try {
    const sourceImage = readFileSync(input.imagePath), sourcePDF = readFileSync(input.pdfPath);
    const frozen = freezeInteractivePoster(input);
    assert.deepEqual(readFileSync(frozen.paths['poster.png']), sourceImage);
    assert.deepEqual(readFileSync(frozen.paths['poster.pdf']), sourcePDF);
    assert.deepEqual(readFileSync(input.imagePath), sourceImage);
    assert.deepEqual(readFileSync(input.pdfPath), sourcePDF);
    assert.equal(frozen.bundle.image.sha256, hash(sourceImage));
    assert.equal(frozen.bundle.pdf.sha256, hash(sourcePDF));
    assert.equal(frozen.bundle.map.imageSha256, frozen.bundle.image.sha256);
    assert.equal(validateInteractiveContent(frozen.bundle.content).ready, true);
    for (const type of ['image', 'pdf', 'map', 'content']) assert.equal(frozen.bundle[type].version, frozen.bundle.version);
    assert.deepEqual(JSON.parse(readFileSync(frozen.paths['content.json'], 'utf8')), input.content);
    assert.equal(statSync(frozen.paths['poster.pdf']).mode & 0o222, 0);
    assert.equal(statSync(frozen.paths['poster.png']).mode & 0o222, 0);
    assert.throws(() => freezeInteractivePoster(input), /EEXIST/);
    assert.deepEqual(readFileSync(frozen.paths['poster.pdf']), sourcePDF);
  } finally { rmSync(input.directory, { recursive: true, force: true }); }
});

test('reject a moved card even when asset names, versions and approval flags match', () => {
  const input = diskFixture();
  try {
    input.acceptance.geometry.observed.find(rect => rect.id === 'tinyTry').x += 12;
    assert.throws(() => freezeInteractivePoster(input), /drawing failed its geometry check|map does not match the approved drawing fit/);
  } finally { rmSync(input.directory, { recursive: true, force: true }); }
});

test('refuse a stale map, missing final export checks or changed asset bytes', () => {
  for (const [mutate, message] of [
    [input => { input.map.version = 'old'; }, /versions must match/],
    [input => { input.map.regions.source.x += 1; }, /map does not match/],
    [input => { input.acceptance.wordCheck.transcribedWordCount++; }, /word and blank-plan check/],
    [input => { input.acceptance.wordCheck.transcription[0].text = 'Wrong words'; }, /every approved printed word/],
    [input => { input.acceptance.wordCheck.approvedWordsSha256 = '0'.repeat(64); }, /every approved printed word/],
    [input => { input.acceptance.print.blankPlan = false; }, /Letter and blank-plan check/],
    [input => { writeFileSync(input.pdfPath, '%PDF-1.7\n%changed synthetic file'); }, /exact image and PDF files/],
    [input => { input.acceptance.imageSha256 = '0'.repeat(64); }, /exact image and PDF files/],
  ]) {
    const input = diskFixture();
    try { mutate(input); assert.throws(() => freezeInteractivePoster(input), message); }
    finally { rmSync(input.directory, { recursive: true, force: true }); }
  }
});

test('a reviewed map and hero crop can follow measured boxes within the fit allowance', () => {
  const input = diskFixture();
  try {
    input.acceptance.geometry.observed.find(rect => rect.id === 'keyword').x -= 5;
    const geometry = validateGeometryReceipt(input.acceptance.geometry);
    assert.equal(geometry.ready, true);
    input.map = makePosterMap(input.content.version, input.acceptance.imageSha256, geometry);
    input.content.layoutRegions = structuredClone(input.map.regions);
    input.content.sections.hero.crop = structuredClone(input.map.regions.hero);
    const hero = geometry.exported.hero;
    input.content.sections.hero.jokeCrop = { x: hero.x + 5, y: hero.y + 5, w: 40, h: 40 };
    input.content.approval.sha256 = interactiveContentHash(input.content);
    const result = freezeInteractivePoster(input);
    assert.deepEqual(result.bundle.map.regions.keyword, input.map.regions.keyword);
  } finally { rmSync(input.directory, { recursive: true, force: true }); }
});
