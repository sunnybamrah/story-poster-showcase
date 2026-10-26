import { pictureStyleFor, pictureStyleReferenceFor } from '../server/graphic-style.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { prepareReadingArt, parseReadingArtCheck, readingArtGuidePNG, confirmedReadingArtFaults, readingArtVersion, readingArtLayoutVersion, normalizeReadingArtLayout, readingArtGeometryOnly } from '../server/reading-art.js';
import { setupRecord } from '../server/app-data.js';
import { assertNoFamilyText } from '../server/requests.js';
import { createTransport } from '../server/transport.js';
import { createAppBudget } from '../server/app-budget.js';
import { templateGuidePNG } from '../server/poster-template.js';
import { root, readJSON, saveJSON } from '../server/files.js';
const hash = value => createHash('sha256').update(value).digest('hex');
const solid = (width, height, red = 40) => sharp({ create: { width, height, channels: 3, background: { r: red, g: 120, b: 80 } } }).png().toBuffer();
const output = value => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] });
const styleOptions = { styleProfile: pictureStyleFor('classic-comic') };
const good = (cells, styleId = 'classic-comic') => ({ styleId, matchesSelectedStyle: true, photographicTexture: styleId === 'detailed-comic', sourceContentIntact: true, flatInkStyle: styleId !== 'animated-film', styleEvidence: 'Synthetic fixture only: fake flat ink observation.', gridCorrect: true, uncertain: false, words: [], cells: cells.map(cell => ({ column: cell.column, row: cell.row, personId: cell.personId, peopleCount: cell.personId ? 1 : 0, identityMatches: true, outfitMatches: true, fullyInsideCell: true, neutralPose: true, certainty: 'confirmed', evidence: 'Synthetic fixture only: fake observed cell.' })) });
async function fixture(t) {
  const base = join(root, 'context/reading-art-tests'); mkdirSync(base, { recursive: true });
  const familyDirectory = mkdtempSync(join(base, 'family-')); t.after(() => rmSync(familyDirectory, { recursive: true, force: true }));
  const record = setupRecord({ real: false, pictureStyleId: 'classic-comic', nickname: 'Pip', age: 10, pronouns: 'he/him', loves: ['comics', 'space', 'kites'], presetId: 'comet', familyContext: 'A fictional private household.', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] });
  for (const [index, person] of record.cast.entries()) {
    const bytes = await solid(40, 60, 30 + index), path = join(familyDirectory, `reference-${index}.png`); writeFileSync(path, bytes);
    Object.assign(person, { referenceSource: 'photo', portraitCandidateId: `fictional-choice-${index}`, referencePath: path, referenceHash: hash(bytes), referenceStyleId: pictureStyleFor(record).id, referenceStyleVersion: pictureStyleFor(record).version });
  }
  const bytes = await solid(1536, 1024), calls = [], options = { directory: join(familyDirectory, 'kit-one'), cacheDirectory: join(familyDirectory, 'reading-art') };
  const transport = { call: async request => { calls.push(request); assertNoFamilyText(request.body, request.privacy); if (request.stage === 'reading-art') { const count = calls.filter(call => call.stage === 'reading-art').length; const drawing = count === 1 ? bytes : await solid(1536, 1024, 40 + count); return { data: [{ b64_json: drawing.toString('base64') }] }; } return output(good(JSON.parse(request.body.input[0].content[0].text).expectedCells, JSON.parse(request.body.input[0].content[0].text).selectedStyle.id)); } };
  return { familyDirectory, record, bytes, calls, options, transport };
}

test('a parent-review pack is private, complete and reused without another generation', async t => {
  const f = await fixture(t), manifest = await prepareReadingArt(f.transport, f.record, f.options);
  assert.equal(manifest.ready, true, JSON.stringify(manifest)); assert.equal(manifest.verified, false); assert.equal(manifest.status, 'parent-review'); assert.equal(manifest.cells.length, 6);
  assert.deepEqual(manifest.cells.filter(cell => !cell.personId).map(cell => [cell.column, cell.row]), [[2, 0], [2, 1]]);
  assert.equal(manifest.width / 3, manifest.height / 2); assert.equal(hash(readFileSync(manifest.file)), manifest.sha256);
  assert.deepEqual(f.calls.map(call => call.stage), ['reading-art']);
  const [draw] = f.calls;
  assert.equal(draw.path, '/v1/images/edits'); assert.equal(draw.body.image.length, 3);
  assert.ok(!draw.body.image.includes(pictureStyleReferenceFor(f.record)?.data));
  assert.doesNotMatch(draw.body.prompt, /Pip|private household|kites|Dad/);
  assert.ok(draw.body.prompt.includes(pictureStyleFor(f.record).rule)); assert.match(draw.body.prompt, /No lettering/);
  const changedNote = structuredClone(f.record); changedNote.familyContext = 'Another fictional private note.';
  const options = { ...f.options, directory: join(f.familyDirectory, 'kit-two') };
  const [reuse, parallel] = await Promise.all([prepareReadingArt(f.transport, changedNote, options), prepareReadingArt(f.transport, changedNote, options)]);
  assert.equal(reuse.cacheKey, manifest.cacheKey); assert.equal(parallel.sha256, manifest.sha256); assert.equal(f.calls.length, 1);
  const state = readJSON(join(f.options.cacheDirectory, manifest.cacheKey, 'state.json')); assert.equal(state.attempts.length, 1);
  assert.doesNotMatch(JSON.stringify(state), /Pip|private household|base64/);
});

test('only a real reference or locked outfit change makes a different pack key', async t => {
  const f = await fixture(t), first = await prepareReadingArt(f.transport, f.record, f.options);
  f.record.cast[0].outfit = ['plain orange shirt'];
  const outfit = await prepareReadingArt(f.transport, f.record, f.options); assert.equal(outfit.ready, true); assert.notEqual(outfit.cacheKey, first.cacheKey);
  const bytes = await solid(40, 60, 200); writeFileSync(f.record.cast[0].referencePath, bytes); f.record.cast[0].referenceHash = hash(bytes);
  const reference = await prepareReadingArt(f.transport, f.record, f.options); assert.equal(reference.ready, true); assert.notEqual(reference.cacheKey, outfit.cacheKey);
  assert.equal(f.calls.length, 3);
});

test('legacy, wrong-family and changed references are omitted before any provider call', async t => {
  for (const mode of ['legacy', 'cross-family', 'changed']) {
    const f = await fixture(t);
    if (mode === 'legacy') delete f.record.cast[0].referenceSource;
    if (mode === 'cross-family') { const other = await fixture(t); f.record.cast[0].referencePath = other.record.cast[0].referencePath; }
    if (mode === 'changed') writeFileSync(f.record.cast[0].referencePath, await solid(40, 60, 200));
    const result = await prepareReadingArt(f.transport, f.record, f.options);
    assert.equal(result.ready, false); assert.equal(result.verified, false); assert.equal(f.calls.length, 0);
    assert.equal(readJSON(join(f.options.directory, 'reading-art.json')).status, 'omitted');
  }
});

test('every cell, flat style, no words, likeness and certainty are hard acceptance requirements', async t => {
  const f = await fixture(t), result = await prepareReadingArt(f.transport, f.record, f.options), expected = result.cells;
  for (const change of [answer => { answer.flatInkStyle = false; }, answer => { answer.gridCorrect = false; }, answer => { answer.uncertain = true; }, answer => { answer.words = ['HELLO']; }, answer => { answer.cells[0].identityMatches = false; }, answer => { answer.cells[0].outfitMatches = false; }, answer => { answer.cells[0].fullyInsideCell = false; }, answer => { answer.cells[0].neutralPose = false; }, answer => { answer.cells[0].certainty = 'uncertain'; }, answer => { answer.cells[0].personId = 'grown-up-one'; }, answer => { answer.cells[2].peopleCount = 1; }, answer => { answer.cells[5] = answer.cells[0]; }]) {
    const answer = good(expected); change(answer); assert.equal(parseReadingArtCheck(answer, expected, styleOptions), false);
  }
});

test('a drawing is shown for parent review without subjective checker redraws', async t => {
  const f = await fixture(t), original = f.transport.call;
  f.transport.call = async request => { assert.equal(request.stage, 'reading-art'); return original(request); };
  const first = await prepareReadingArt(f.transport, f.record, f.options);
  assert.equal(first.ready, true); assert.equal(first.verified, false); assert.equal(first.status, 'parent-review');
  const again = await prepareReadingArt(f.transport, f.record, f.options);
  assert.equal(again.sha256, first.sha256); assert.equal(f.calls.length, 1);
  const state = readJSON(join(f.options.cacheDirectory, first.cacheKey, 'state.json')); assert.equal(state.attempts.length, 1);
});

test('a saved parent-review drawing is reused without a checker or replacement', async t => {
  const f = await fixture(t), first = await prepareReadingArt(f.transport, f.record, f.options);
  f.transport.call = async () => { throw Error('No further model call is needed'); };
  const next = await prepareReadingArt(f.transport, f.record, { ...f.options, directory: join(f.familyDirectory, 'another-kit') });
  assert.equal(next.ready, true); assert.equal(next.verified, false); assert.equal(next.sha256, first.sha256);
  assert.equal(f.calls.length, 1);
});

test('preflight draw stops spend no attempts; unknown failures retain each of the three attempts', async t => {
  for (const marker of [true, false]) {
    const f = await fixture(t); let sends = 0;
    f.transport.call = async () => { sends++; throw Object.assign(Error('Fixture stopped.'), { preflight: marker }); };
    let result; for (let index = 0; index < 4; index++) result = await prepareReadingArt(f.transport, f.record, f.options);
    assert.equal(result.ready, false); assert.equal(result.attempts, marker ? 0 : 3); assert.equal(sends, marker ? 4 : 3);
  }
});

test('corrupted checked art is not reused or silently replaced', async t => {
  const f = await fixture(t), result = await prepareReadingArt(f.transport, f.record, f.options);
  writeFileSync(result.file, await solid(1536, 1024, 200));
  const next = await prepareReadingArt(f.transport, f.record, f.options); assert.equal(next.ready, false); assert.equal(f.calls.length, 1); assert.match(next.detail, /changed/);
});

test('real transport rejects revoked photo permission and zero budget without sending', async t => {
  const f = await fixture(t), originalFetch = globalThis.fetch; let wires = 0;
  globalThis.fetch = async () => { wires++; throw Error('This test cannot send.'); }; t.after(() => { globalThis.fetch = originalFetch; });
  const permission = createTransport({ keys: { openai: 'fictional-key' }, maxCalls: 76, logFile: join(f.familyDirectory, 'permission.jsonl'), familyRecordFor: () => f.record });
  const noConsent = await prepareReadingArt(permission, f.record, f.options); assert.equal(noConsent.ready, false); assert.equal(noConsent.attempts, 0); assert.equal(wires, 0);
  const capped = createTransport({ keys: { openai: 'fictional-key' }, maxCalls: 76, allowSyntheticPortraits: true, logFile: join(f.familyDirectory, 'budget.jsonl'), familyRecordFor: () => f.record, budget: createAppBudget(join(f.familyDirectory, 'budget.json'), { limit: 0 }) });
  const noBudget = await prepareReadingArt(capped, f.record, f.options); assert.equal(noBudget.ready, false); assert.equal(noBudget.attempts, 0); assert.equal(wires, 0);
});

test('the actual transport admits the selected draw and checker with live permission and private image logging', async t => {
  const f = await fixture(t), originalFetch = globalThis.fetch; let wires = 0, permissions = 0;
  const usage = { input_tokens: 10, output_tokens: 10, input_tokens_details: { text_tokens: 5, image_tokens: 5, cached_tokens: 0 } };
  globalThis.fetch = async (url, options) => {
    wires++;
    if (url.endsWith('/images/edits')) {
      assert.ok(options.body instanceof FormData); assert.equal(options.body.getAll('image[]').length, 3);
      return new Response(JSON.stringify({ data: [{ b64_json: f.bytes.toString('base64') }], usage }));
    }
    assert.ok(url.endsWith('/responses')); const body = JSON.parse(options.body);
    assert.equal(body.store, false); assert.equal(body.tools, undefined); assert.equal(body.reasoning.effort, 'medium');
    const payload = JSON.parse(body.input[0].content[0].text);
    return new Response(JSON.stringify({ ...output(good(payload.expectedCells)), usage }));
  }; t.after(() => { globalThis.fetch = originalFetch; });
  const logFile = join(f.familyDirectory, 'admitted.jsonl');
  const transport = createTransport({ keys: { openai: 'fictional-key' }, maxCalls: 76, allowSyntheticPortraits: true, logFile, familyRecordFor: () => { permissions++; return f.record; }, budget: createAppBudget(join(f.familyDirectory, 'admitted-budget.json'), { limit: 6 }) });
  const manifest = await prepareReadingArt(transport, f.record, f.options);
  assert.equal(manifest.ready, true, JSON.stringify(manifest)); assert.equal(wires, 1); assert.equal(permissions, 1);
  const log = readFileSync(logFile, 'utf8'); assert.doesNotMatch(log, /fictional-key|data:image\/png;base64/);
  assert.ok(!log.includes(f.bytes.toString('base64')), 'Generated pack pixels must be omitted from transport logs too.');
  for (const person of f.record.cast) assert.ok(!log.includes(readFileSync(person.referencePath).toString('base64')));
  await prepareReadingArt(transport, f.record, { ...f.options, directory: join(f.familyDirectory, 'kit-next') }); assert.equal(wires, 1);
});

test('v2 uses the poster engine and a last geometry-only guide with identical checker safe cells', async t => {
  const f = await fixture(t), manifest = await prepareReadingArt(f.transport, f.record, f.options);
  assert.equal(manifest.ready, true, JSON.stringify(manifest)); assert.equal(manifest.version, readingArtVersion);
  const [draw] = f.calls, selected = readJSON(new URL('../content/prices.json', import.meta.url)).selected;
  assert.equal(draw.body.model, selected.poster); assert.notEqual(draw.body.model, selected.hero);
  const guide = readingArtGuidePNG(), guideURL = `data:image/png;base64,${guide.toString('base64')}`;
  assert.equal(draw.body.image.at(-1), guideURL);
  assert.match(draw.body.prompt, /LAST reference image is ONLY a geometry guide/); assert.match(draw.body.prompt, /40 pixels of empty padding on ALL FOUR SIDES/);
  const cells = manifest.cells; assert.equal(f.calls.length, 1);
  const { data, info } = await sharp(guide).raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  assert.equal(info.width, 1536); assert.equal(info.height, 1024);
  for (const cell of cells) {
    assert.equal(cell.safeRect.x - cell.rect.x, 40); assert.equal(cell.safeRect.y - cell.rect.y, 40); assert.equal(cell.safeRect.width, 432); assert.equal(cell.safeRect.height, 432);
    assert.deepEqual(pixel(cell.safeRect.x, cell.safeRect.y), [13, 112, 104]);
    assert.deepEqual(pixel(cell.rect.x + 256, cell.rect.y + 256), [255, 255, 255]);
  }
  assert.deepEqual(pixel(512, 512), [255, 255, 255]);
  assert.equal(hash(templateGuidePNG()), 'afae3e969783b9746b50efc7cc74ecd3f8e1d6339bcb225cfc7d4440196e6d16', 'Existing poster guide stays byte-identical.');
});

test('saved opinions never trigger a redraw or enter later image prompts', async t => {
  const f = await fixture(t), first = await prepareReadingArt(f.transport, f.record, f.options);
  const file = join(f.options.cacheDirectory, first.cacheKey, 'state.json'), state = readJSON(file);
  state.attempts[0].answer = { uncertain: true, styleEvidence: 'Private fabricated detail must never enter a picture.' }; saveJSON(file, state);
  for (let index = 0; index < 3; index++) {
    const reused = await prepareReadingArt(f.transport, f.record, f.options);
    assert.equal(reused.ready, true); assert.equal(reused.sha256, first.sha256);
  }
  assert.equal(f.calls.length, 1); assert.doesNotMatch(f.calls[0].body.prompt, /Private fabricated/);
});

test('a new guided model contract leaves the old exhausted cache and its three paid receipts unchanged', async t => {
  const f = await fixture(t), old = join(f.options.cacheDirectory, 'previous-v1-exhausted'); mkdirSync(old, { recursive: true });
  const originalState = JSON.stringify({ version: 'family-comic-cells-v1', attempts: [1, 2, 3].map(number => ({ number, status: 'rejected', checkCalls: 1, paid: true })) });
  writeFileSync(join(old, 'state.json'), originalState); for (let number = 1; number <= 3; number++) writeFileSync(join(old, `drawing-${number}-receipt.json`), JSON.stringify({ fixture: true, spent: true, number }));
  const before = readdirSync(old).map(file => [file, hash(readFileSync(join(old, file)))]);
  const result = await prepareReadingArt(f.transport, f.record, f.options); assert.equal(result.ready, true); assert.equal(result.version, 'family-comic-cells-guide-v2');
  assert.deepEqual(readdirSync(old).map(file => [file, hash(readFileSync(join(old, file)))]), before);
  const state = readJSON(join(f.options.cacheDirectory, result.cacheKey, 'state.json')); assert.equal(state.attempts.length, 1); assert.equal(state.contract.imageModel, readJSON(new URL('../content/prices.json', import.meta.url)).selected.poster);
  await prepareReadingArt(f.transport, f.record, f.options); assert.equal(f.calls.length, 1);
});

test('layout normalization preserves each whole tile with one uniform transform and adds only empty padding', async t => {
  const f = await fixture(t), result = await prepareReadingArt(f.transport, f.record, f.options);
  const normalized = await normalizeReadingArtLayout(f.bytes, result.cells), receipt = normalized.receipt;
  assert.equal(receipt.version, readingArtLayoutVersion); assert.equal(receipt.sourceHash, hash(f.bytes)); assert.equal(receipt.sha256, hash(normalized.bytes)); assert.equal(receipt.transforms.length, 4);
  for (const transform of receipt.transforms) {
    assert.equal(transform.sourceRect.width, 512); assert.equal(transform.targetRect.width, 392);
    assert.equal(transform.scaleX, 392 / 512); assert.equal(transform.scaleY, transform.scaleX);
    assert.equal(transform.targetRect.x - transform.sourceRect.x, 60); assert.equal(transform.targetRect.y - transform.sourceRect.y, 60);
    const r = transform.sourceRect, d = transform.targetRect;
    const expected = await sharp(f.bytes).extract({ left: r.x, top: r.y, width: r.width, height: r.height }).resize(392, 392, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
    const placed = await sharp(normalized.bytes).extract({ left: d.x, top: d.y, width: d.width, height: d.height }).removeAlpha().raw().toBuffer();
    assert.deepEqual(placed, expected, 'Every scaled source pixel region is retained without repainting.');
  }
  const blank = await sharp(normalized.bytes).extract({ left: 1024, top: 0, width: 512, height: 1024 }).removeAlpha().raw().toBuffer();
  for (let at = 0; at < blank.length; at += 3) assert.deepEqual([...blank.subarray(at, at + 3)], [255, 249, 237]);
});

test('only the geometry-only saved candidate gets a new bounded check after all three draws are spent', async t => {
  const f = await fixture(t), initial = await prepareReadingArt(f.transport, f.record, f.options), cache = join(f.options.cacheDirectory, initial.cacheKey), statePath = join(cache, 'state.json'), state = readJSON(statePath);
  state.derivations = []; state.attempts = [];
  for (let number = 1; number <= 3; number++) {
    const bytes = await solid(1536, 1024, number * 30), answer = good(initial.cells);
    answer.flatInkStyle = number === 2; answer.gridCorrect = false;
    for (const cell of answer.cells) if (cell.personId) cell.fullyInsideCell = false;
    writeFileSync(join(cache, `pack-${number}.png`), bytes);
    saveJSON(join(cache, `check-${number}-1.json`), { fixture: true, answer });
    state.attempts.push({ number, status: 'rejected', checkCalls: 1, width: 1536, height: 1024, sha256: hash(bytes), answer });
  }
  saveJSON(statePath, state);
  const oldAttempts = JSON.stringify(state.attempts), oldFiles = readdirSync(cache).filter(name => /^(?:pack-|check-\d|drawing-)/.test(name)).map(name => [name, hash(readFileSync(join(cache, name)))]);
  assert.equal(readingArtGeometryOnly(state.attempts[0].answer, initial.cells, styleOptions), false); assert.equal(readingArtGeometryOnly(state.attempts[1].answer, initial.cells, styleOptions), true);
  for (const change of [a => { a.words = ['text']; }, a => { a.uncertain = true; }, a => { a.cells[0].identityMatches = false; }, a => { a.cells[0].outfitMatches = false; }, a => { a.cells[0].neutralPose = false; }, a => { a.cells[2].peopleCount = 1; }]) { const answer = structuredClone(state.attempts[1].answer); change(answer); assert.equal(readingArtGeometryOnly(answer, initial.cells, styleOptions), false); }
  f.calls.length = 0;
  const result = await prepareReadingArt(f.transport, f.record, f.options); assert.equal(result.ready, true, JSON.stringify(result));
  assert.deepEqual(f.calls.map(call => call.stage), ['reading-art-check']); assert.equal(result.derivation.sourceHash, state.attempts[1].sha256);
  const after = readJSON(statePath); assert.equal(JSON.stringify(after.attempts), oldAttempts); assert.equal(after.attempts.length, 3); assert.equal(after.derivations.length, 1); assert.equal(after.derivations[0].checkCalls, 1);
  for (const [name, before] of oldFiles) assert.equal(hash(readFileSync(join(cache, name))), before);
  const check = f.calls[0]; assert.match(check.body.instructions, /Padding does not repair a cut-off head/); assert.match(check.body.instructions, /sourceContentIntact/);
  const input = JSON.parse(check.body.input[0].content[0].text); assert.equal(input.derivation.sourceHash, state.attempts[1].sha256); assert.equal(input.derivation.sha256, result.sha256);
  assert.equal(check.body.input[0].content.at(-2).image_url, `data:image/png;base64,${readFileSync(join(cache, 'pack-2.png')).toString('base64')}`);
  await prepareReadingArt(f.transport, f.record, f.options); assert.equal(f.calls.length, 1);
  // A later check must not treat padding as repair of a damaged source face.
  after.derivations[0].status = 'needs-check'; delete after.derivations[0].answer; after.derivations[0].checkCalls = 0; saveJSON(statePath, after);
  const original = f.transport.call;
  f.transport.call = async request => { const response = await original(request); return request.stage === 'reading-art-check' ? output({ ...good(initial.cells), sourceContentIntact: false }) : response; };
  const rejected = await prepareReadingArt(f.transport, f.record, f.options); assert.equal(rejected.ready, false); assert.equal(f.calls.filter(call => call.stage === 'reading-art').length, 0);
});

test('chosen styles bind separate caches and require their own evidence instead of a universal flat gate', async t => {
  const f = await fixture(t), keys = [];
  for (const pictureStyleId of ['classic-comic', 'animated-film', 'detailed-comic']) {
    f.record.pictureStyleId = pictureStyleId;
    for (const person of f.record.cast) { person.referenceStyleId = pictureStyleId; person.referenceStyleVersion = pictureStyleFor(f.record).version; }
    const result = await prepareReadingArt(f.transport, f.record, f.options); assert.equal(result.ready, true, JSON.stringify(result));
    keys.push(result.cacheKey); assert.equal(result.pictureStyleId, pictureStyleId); assert.equal(result.pictureStyleVersion, pictureStyleFor(f.record).version);
    const request = f.calls.at(-1);
    assert.equal(request.stage, 'reading-art'); assert.ok(request.body.prompt.includes(pictureStyleFor(pictureStyleId).rule));
    const answer = good(result.cells, pictureStyleId), opts = { styleProfile: pictureStyleFor(pictureStyleId) };
    assert.equal(parseReadingArtCheck(answer, result.cells, opts), true);
    assert.equal(parseReadingArtCheck({ ...answer, matchesSelectedStyle: false }, result.cells, opts), false);
    assert.equal(parseReadingArtCheck({ ...answer, styleId: 'another-style' }, result.cells, opts), false);
    assert.equal(parseReadingArtCheck({ ...answer, photographicTexture: true }, result.cells, opts), pictureStyleId === 'detailed-comic');
    assert.equal(parseReadingArtCheck({ ...answer, flatInkStyle: false }, result.cells, opts), !opts.styleProfile.requireFlatInk);
  }
  assert.equal(new Set(keys).size, 3); assert.equal(f.calls.length, 3);
  f.record.pictureStyleId = 'classic-comic';
  const mismatched = await prepareReadingArt(f.transport, f.record, f.options); assert.equal(mismatched.ready, false); assert.equal(f.calls.length, 3);
  const legacy = good([]); delete legacy.styleId; delete legacy.matchesSelectedStyle; delete legacy.photographicTexture;
  const six = Array.from({ length: 6 }, (_, index) => ({ personId: null, column: index % 3, row: Math.floor(index / 3) })); legacy.cells = good(six).cells;
  assert.equal(parseReadingArtCheck(legacy, six), false);
  assert.equal(parseReadingArtCheck(legacy, six, { legacyContract: { version: 'family-comic-cells-guide-v2', graphicStyleVersion: 'flat-ink-graphic-novel-v1' } }), true);
  assert.equal(parseReadingArtCheck(legacy, six, { styleProfile: pictureStyleFor('detailed-comic') }), false);
});

test('chosen description drawings can make reading art through real transport without pretending to be photos', async t => {
  const f = await fixture(t); for (const person of f.record.cast) person.referenceSource = 'description';
  const originalFetch = globalThis.fetch; let wires = 0;
  globalThis.fetch = async (url, options) => {
    wires++; const usage = { input_tokens: 10, output_tokens: 10, input_tokens_details: { text_tokens: 5, image_tokens: 5, cached_tokens: 0 } };
    if (url.endsWith('/images/edits')) return new Response(JSON.stringify({ data: [{ b64_json: f.bytes.toString('base64') }], usage }));
    const payload = JSON.parse(JSON.parse(options.body).input[0].content[0].text);
    return new Response(JSON.stringify({ ...output(good(payload.expectedCells, payload.selectedStyle.id)), usage }));
  }; t.after(() => { globalThis.fetch = originalFetch; });
  const transport = createTransport({ keys: { openai: 'fixture-key' }, maxCalls: 76, logFile: join(f.familyDirectory, 'description-art.jsonl'), familyRecordFor: () => f.record, budget: createAppBudget(join(f.familyDirectory, 'description-budget.json'), { limit: 6 }) });
  const result = await prepareReadingArt(transport, f.record, f.options); assert.equal(result.ready, true, JSON.stringify(result)); assert.equal(wires, 1);
  await prepareReadingArt(transport, f.record, f.options); assert.equal(wires, 1);
});


test('a saved subjective opinion cannot invalidate unchanged parent-review art', async t => {
  const f = await fixture(t), initial = await prepareReadingArt(f.transport, f.record, f.options);
  const statePath = join(f.options.cacheDirectory, initial.cacheKey, 'state.json'), state = readJSON(statePath);
  state.attempts[0].answer = { uncertain: true, identityMatches: false }; saveJSON(statePath, state);
  const result = await prepareReadingArt(f.transport, f.record, { ...f.options, directory: join(f.familyDirectory, 'next-kit') });
  assert.equal(result.ready, true); assert.equal(result.verified, false); assert.equal(result.sha256, initial.sha256);
  assert.equal(f.calls.length, 1); assert.equal(readJSON(statePath).attempts.length, 1);
});
