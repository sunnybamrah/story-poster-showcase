import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readerClarity, practiceReaderText, guideReaderClaim, guideReaderLimitation, sourceReaderLimitation } from '../app/reader-notes.js';
import { moves } from '../server/files.js';
import { positiveActionFor, practiceFor, tinyTryOptionsFor, posterScienceClaimFor } from '../server/format.js';
import { buildInteractiveContent, interactiveContentHash, validateInteractiveContent } from '../server/interactive-assets.js';
import { renderInteractiveHTML } from '../server/interactive-view.js';
import { posterTemplate } from '../server/poster-template.js';
import { PARENT_NOTE_LANGUAGE_RULES, STORY_RULES, JUDGE_STORY_RULES, guideLanguageInstructions, guideReaderLanguageVersion } from '../server/story-rules.js';
import { selectedRhymeFor } from '../server/rhyme.js';
import { libraryHarness, librarySettled } from './library-fixture.mjs';
import { familyContextHits } from '../server/family-privacy.js';
import { escapeHTML, previewPages, verifyOwnedWords } from '../server/layout.js';

const rows = JSON.parse(readFileSync(new URL('../content/guide-reader-clarity.json', import.meta.url)));
const hash = text => createHash('sha256').update(text).digest('hex');
const allMoves = () => moves.filter(move => !move.library);

test('owned action audit accepts only exact saved or current display words on unmarked pages', () => {
  for (const move of moves.filter(move => !move.library)) {
    const snapshot = structuredClone(move);
    const pages = previewPages(move);
    const actionPattern = /(<p\b[^>]*data-owned="positiveAction"[^>]*>)[\s\S]*?(<\/p>)/u;
    assert.match(pages['for-you.html'], actionPattern);
    const withAction = action => ({ ...pages, 'for-you.html': pages['for-you.html'].replace(actionPattern, (_, start, end) => start + escapeHTML(action) + end) });
    for (const action of [move.positiveAction, positiveActionFor(move)]) assert.equal(verifyOwnedWords(withAction(action), move), true);
    for (const action of [positiveActionFor(move) + ' ', 'This action has not been reviewed.']) assert.throws(() => verifyOwnedWords(withAction(action), move), /Record words changed: for-you\.html\/positiveAction/);
    const changedKeyword = { ...pages, 'for-you.html': pages['for-you.html'].replace(/(<[^>]+data-owned="keyWord"[^>]*>)[\s\S]*?(<\/[^>]+>)/u, '$1Unreviewed keyword$2') };
    assert.throws(() => verifyOwnedWords(changedKeyword, move), /Record words changed: for-you\.html\/keyWord/);
    assert.deepEqual(move, snapshot);
  }
});

test('clarity rows match exact saved claims and source limits without changing raw records or reviewed notes', () => {
  const files = ['moves.json', 'source-row-audit.json', 'source-reader-notes.json', 'source-reader-notes-review.json'];
  const before = files.map(file => readFileSync(new URL('../content/' + file, import.meta.url)));
  const originals = allMoves(), snapshot = structuredClone(originals);
  const guideIds = new Set(originals.map(move => move.id));
  const sourceIds = new Set(originals.flatMap(move => move.sources.map(source => source.sourceId ?? source.pubmed ?? source.doi ?? source.id)));
  const publicRows = rows.filter(row => row.kind === 'source-limit' ? sourceIds.has(row.sourceId) : guideIds.has(row.sourceId));
  assert.equal(originals.length, 14);
  assert.equal(new Set(publicRows.map(row => JSON.stringify([row.kind, row.sourceId, row.originalText]))).size, publicRows.length);
  for (const row of publicRows) {
    assert.equal(hash(row.originalText), row.originalSHA256);
    const found = row.kind === 'source-limit'
      ? originals.flatMap(move => move.sources).some(source => (source.sourceId ?? source.pubmed ?? source.doi ?? source.id) === row.sourceId && source.limitation === row.originalText)
      : originals.some(move => move.id === row.sourceId && (row.kind === 'guide-action' ? move.positiveAction === row.originalText : row.kind === 'guide-practice' ? move.practiceScript === row.originalText : row.kind === 'guide-try' ? move.tryItDraft.options.some(option => option.text === row.originalText) : move.science[['guide-claim', 'poster-claim'].includes(row.kind) ? 'claim' : 'limitation'] === row.originalText));
    assert.ok(found, `${row.kind} ${row.sourceId} must still name exact saved evidence`);
    assert.equal(readerClarity(row.kind, row.sourceId, row.originalText), row.plainText);
  }
  for (const move of originals) {
    guideReaderClaim(move.id, move.science.claim); guideReaderLimitation(move.id, move.science.limitation);
    move.sources.forEach(sourceReaderLimitation);
  }
  assert.deepEqual(originals, snapshot);
  files.forEach((file, i) => assert.deepEqual(readFileSync(new URL('../content/' + file, import.meta.url)), before[i]));
});

test('clarity refuses stale, wrong-kind, unknown and ambiguous matches; missing source IDs require unanimous exact words', () => {
  const row = rows.find(row => row.kind === 'source-limit');
  for (const [kind, id, text] of [['guide-claim', row.sourceId, row.originalText], [row.kind, 'unknown', row.originalText], [row.kind, row.sourceId, row.originalText + ' '], [row.kind, 2, row.originalText]]) {
    assert.equal(readerClarity(kind, id, text), text);
  }
  assert.equal(readerClarity(row.kind, row.sourceId, row.originalText, [row, row]), row.originalText);
  assert.equal(readerClarity(row.kind, undefined, row.originalText, [row, { ...row, sourceId: 'second' }]), row.plainText);
  assert.equal(readerClarity(row.kind, undefined, row.originalText, [row, { ...row, sourceId: 'second', plainText: 'Disagrees.' }]), row.originalText);
  const claim = rows.find(row => row.kind === 'guide-claim');
  assert.equal(readerClarity(claim.kind, undefined, claim.originalText), claim.originalText);
});

test('Name it keeps every age, study count and no-proof boundary in its current parent notes', () => {
  const move = moves.find(move => move.id === 'name-it-exactly');
  const notes = move.sources.map(sourceReaderLimitation).join(' ');
  for (const fact of ['143', '5 to 25', '233', '14 to 17', '8 to 13', 'Adults', 'brain', 'Depression is a health condition', 'does not prove']) assert.ok(notes.includes(fact), fact);
  assert.match(guideReaderLimitation(move.id, move.science.limitation), /do not show.*children aged 8 to 13/);
  assert.match(guideReaderLimitation(move.id, move.science.limitation), /do not show.*feel better right away/);
  assert.ok(!notes.includes('immediate relief'));
});

test('feeling practice accepts simple words and the poster snapshots its qualified claim without altering evidence', () => {
  const move = moves.find(move => move.id === 'name-it-exactly');
  const raw = JSON.stringify(move);
  assert.match(practiceFor(move), /Mad or sad can fit/);
  assert.match(positiveActionFor(move), /you each name/);
  assert.match(tinyTryOptionsFor(move)[0].text, /Mad, sad or another word is okay/);
  const content = buildInteractiveContent({ move, kit: { tagline: selectedRhymeFor(move).tagline }, version: 'qualified-poster-fixture' });
  assert.equal(content.printed.find(box => box.id === 'science').text, posterScienceClaimFor(move));
  assert.match(content.sections.science.printedClaim, /sometimes helped.*children aged 8 to 13/);
  assert.equal(content.sourceText.sourceAccount, move.science.claim);
  assert.equal(JSON.stringify(move), raw);
  assert.ok(!validateInteractiveContent(content, { requireApproval: false }).faults.some(fault => /reader notes|printed science/.test(fault)));
  const tampered = structuredClone(content);
  tampered.sections.science.printedClaim = tampered.printed.find(box => box.id === 'science').text = 'Always works.';
  assert.match(validateInteractiveContent(tampered, { requireApproval: false }).faults.join(' '), /reader notes/);
  const legacy = structuredClone(content);
  delete legacy.readerNotes.posterClaim;
  delete legacy.sections.science.printedClaim;
  legacy.printed.find(box => box.id === 'science').text = move.science.claim;
  const before = JSON.stringify(legacy);
  assert.ok(!validateInteractiveContent(legacy, { requireApproval: false }).faults.some(fault => /reader notes|printed science/.test(fault)));
  assert.equal(JSON.stringify(legacy), before);
});

test('the public catalog retains original base actions without importing hidden saved aliases', () => {
  const source = moves.find(move => move.id === 'name-it-exactly');
  assert.equal(allMoves().length, 14);
  assert.ok(practiceFor(source).trim());
  assert.ok(positiveActionFor(source).trim());
  assert.equal(practiceReaderText('guide-practice', source, source.practiceScript), practiceFor(source));
  assert.ok(!allMoves().some(move => move.id.startsWith('lib-')));
});

test('exact reviewed science ages pass picture privacy without exempting a family age elsewhere', () => {
  const context = { moveId: 'name-it-exactly', familyContext: 'The child is 8.', identityContext: 'Age 8.' };
  const claim = posterScienceClaimFor(moves.find(move => move.id === context.moveId));
  assert.deepEqual(familyContextHits(claim, context), []);
  assert.ok(familyContextHits(claim + ' The child is 8.', context).some(hit => hit.text === '8'));
  assert.ok(familyContextHits(claim.replace('sometimes', 'always'), context).some(hit => hit.text === '8'));
  assert.ok(familyContextHits(claim, { ...context, moveId: 'unknown' }).some(hit => hit.text === '8'));
});

test('interactive study panels snapshot plain claims and retain printed claims and sourceText', () => {
  const move = moves.find(move => move.id === 'name-it-exactly');
  const before = structuredClone(move);
  const content = buildInteractiveContent({ move, kit: { tagline: selectedRhymeFor(move).tagline }, version: 'synthetic-clarity-fixture' });
  assert.equal(content.sections.science.readerClaim ?? move.science.claim, guideReaderClaim(move.id, move.science.claim));
  assert.equal(content.sourceText.sourceAccount, move.science.claim);
  assert.equal(content.sections.science.claim, move.science.claim);
  assert.equal(content.printed.find(box => box.id === 'science').text, posterScienceClaimFor(move));
  assert.deepEqual(content.sourceRecords, move.sources);
  assert.deepEqual(move, before);
  assert.ok(!validateInteractiveContent(content, { requireApproval: false }).faults.some(fault => /reader notes|printed science/.test(fault)));
  const stamp = interactiveContentHash(content), changed = structuredClone(content);
  changed.sections.science.readerClaim += ' Changed.';
  assert.notEqual(interactiveContentHash(changed), stamp);
  assert.match(validateInteractiveContent(changed, { requireApproval: false }).faults.join(' '), /reader notes must/);
  const bundle = content => ({ content, version: content.version, image: { url: 'poster.png' }, pdf: { url: 'poster.pdf' }, map: { canvas: posterTemplate.canvas, regions: posterTemplate.regions } });
  assert.ok(renderInteractiveHTML(bundle(content), { preview: true }).includes(content.sections.science.readerClaim));
  const legacy = structuredClone(content);
  delete legacy.sections.science.readerClaim; delete legacy.readerNotes.guideClaim;
  const legacyBytes = JSON.stringify(legacy), legacyHash = interactiveContentHash(legacy);
  const html = renderInteractiveHTML(bundle(legacy), { preview: true });
  assert.ok(html.includes(move.science.claim));
  assert.ok(html.includes(move.science.claim));
  assert.equal(JSON.stringify(legacy), legacyBytes);
  assert.equal(interactiveContentHash(legacy), legacyHash);
});

test('future writer and reviewer share age-eight parent rules while older saved guide request wording stays exact', () => {
  assert.ok(STORY_RULES.includes(PARENT_NOTE_LANGUAGE_RULES));
  assert.ok(JUDGE_STORY_RULES.includes(PARENT_NOTE_LANGUAGE_RULES));
  const old = 'Write for a bright ten-year-old. Keep the evidence.';
  for (const stage of ['library-draft', 'library-review', 'library-wording-draft', 'library-wording-review']) {
    assert.equal(guideLanguageInstructions(stage, old, undefined), old);
    const current = guideLanguageInstructions(stage, old, guideReaderLanguageVersion);
    assert.match(current, /eight-year-old/); assert.ok(!current.includes('ten-year-old'));
    assert.ok(current.includes(PARENT_NOTE_LANGUAGE_RULES));
  }
  assert.equal(guideLanguageInstructions('library-research', old, guideReaderLanguageVersion), old);
});

test('a new guide job pins the age-eight rule and sends it to both actual draft and review envelopes', async t => {
  const h = libraryHarness(t);
  const job = h.service.start(h.account, 'primary', 'Help with a small disappointment.');
  await librarySettled(h.service, h.account, job.id);
  const calls = h.calls.filter(call => ['library-draft', 'library-review'].includes(call.stage));
  assert.ok(calls.some(call => call.stage === 'library-draft'));
  assert.ok(calls.some(call => call.stage === 'library-review'));
  for (const call of calls) assert.ok(call.body.instructions.includes(PARENT_NOTE_LANGUAGE_RULES));
  assert.equal(h.db.libraryJobs.find(row => row.id === job.id).readerLanguageVersion, guideReaderLanguageVersion);
});
