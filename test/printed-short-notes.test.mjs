import test from 'node:test';
import assert from 'node:assert/strict';
import { moves } from '../server/files.js';
import { previewPages, verifyOwnedWords, printedText, visibleText } from '../server/layout.js';
import { sourceReaderLimitation, guideReaderLimitation, guideReaderClaim } from '../app/reader-notes.js';
import { scienceFor } from '../server/format.js';
import { createPreparedLibrary } from '../server/library-prepared.js';
import legacyNotes from './fixtures/printed-notes-v1.json' with { type: 'json' };

const naming = moves.find(move => move.id === 'name-it-exactly');
const print = move => printedText(previewPages(move)['for-you.html']);

test('the naming guide prints the approved short note while parent details keep the full record', () => {
  const pages = previewPages(naming), page = pages['for-you.html'], ink = printedText(page), details = visibleText(page.split('<aside class="parent-notes">')[1]);
  for (const line of [
    'When you are both calm, ask: “What feeling fits?” Listen. Then choose one small thing to try together.',
    'Use your familiar reminder when a new hard moment comes along.',
    'In some studies with adults, naming feelings helped people feel less upset. That does not tell us whether this story helps children.',
    'Sources and study details are in the app. Torre and Lieberman, 2018.',
  ]) assert.ok(ink.includes(line), line);
  assert.ok(ink.includes('Name it to tame it:'));
  assert.ok(!ink.includes(sourceReaderLimitation(naming.sources[3])));
  assert.ok(details.includes(guideReaderLimitation(naming.id, naming.science.limitation)));
  for (const source of naming.sources) {
    assert.ok(details.includes(source.people));
    assert.ok(details.includes(sourceReaderLimitation(source)));
  }
  assert.equal(verifyOwnedWords(pages, naming), true);
});

test('other guides print their own research finding, limits and study link without borrowing the naming finding', t => {
  const others = [moves.find(move => move.id === 'long-breath-out'), moves.find(move => move.id === 'cool-off-break')];
  for (const move of others) {
    const ink = print(move);
    assert.ok(ink.includes('Try together: When you are both calm, try this together:'));
    assert.ok(ink.includes(scienceFor(move).result || guideReaderClaim(move.id, scienceFor(move).claim)));
    assert.ok(ink.includes(guideReaderLimitation(move.id, scienceFor(move).limitation)));
    assert.ok(!ink.includes('Evidence type:'));
    assert.match(previewPages(move)['for-you.html'], /data-short-note="3"[^]*?<a href="https?:\/\//);
    assert.ok(!ink.includes('In some studies with adults, naming feelings'));
    assert.ok(!ink.includes('Torre and Lieberman, 2018.'));
  }
});

test('the comparison parent page prints the actual finding and a traceable PubMed link', () => {
  const move = moves.find(move => move.id === 'compare-with-past-me');
  const page = previewPages(move)['for-you.html'], ink = printedText(page);
  assert.ok(ink.includes(scienceFor(move).result));
  assert.ok(ink.includes(guideReaderLimitation(move.id, scienceFor(move).limitation)));
  assert.ok(ink.includes('Gürel and others, 2020.'));
  assert.ok(ink.includes('PubMed 31944812'));
  assert.ok(page.includes('href="https://pubmed.ncbi.nlm.nih.gov/31944812/"'));
  assert.throws(() => verifyOwnedWords({ ...previewPages(move), 'for-you.html': page.replace('PubMed 31944812', 'PubMed 999') }, move));
});

test('the adult finding needs the exact guide and evidence record', () => {
  const anotherGuide = structuredClone(moves.find(move => move.id === 'long-breath-out'));
  anotherGuide.science = structuredClone(naming.science);
  anotherGuide.sources = structuredClone(naming.sources);
  anotherGuide.library = { printSourceIds: ['10.1177/1754073917742706'] };
  assert.ok(!print(anotherGuide).includes('In some studies with adults, naming feelings'));
  for (const change of [
    move => { move.science.claim += ' Changed.'; },
    move => { move.science.limitation += ' Changed.'; },
    move => { move.sources.find(source => source.doi === '10.1177/1754073917742706').limitation += ' Changed.'; },
  ]) {
    const altered = structuredClone(naming);
    change(altered);
    const ink = print(altered);
    assert.ok(!ink.includes('In some studies with adults, naming feelings'));
  }
});

test('compact notes fail closed on tampering, including a removed version marker', () => {
  const pages = previewPages(naming), html = pages['for-you.html'];
  for (const changed of [
    html.replace('That does not tell us whether this story helps children.', 'This story helps every child.'),
    html.replace('Torre and Lieberman, 2018.', 'Unknown source.'),
    html.replace('data-short-notes="exact-v2"', 'data-short-notes="changed"'),
    html.replace(/<p data-short-note="2">[\s\S]*?<\/p>/, ''),
    html.replace(/<section data-source-notes="exact-groups-v1" data-source-section="parent">[\s\S]*?<\/section>/, ''),
  ]) assert.throws(() => verifyOwnedWords({ ...pages, 'for-you.html': changed }, naming));
});

test('historical exact-v1 notes retain their original strict verification', () => {
  for (const [id, section] of Object.entries(legacyNotes.notes)) {
    const move = moves.find(m => m.id === id), pages = previewPages(move);
    pages['for-you.html'] = pages['for-you.html'].replace(/<section data-short-notes="exact-v2">[\s\S]*?<\/section>/, section);
    assert.equal(verifyOwnedWords(pages, move), true);
    const regenerated = previewPages(move, { printedNotesVersion: 'exact-v1' })['for-you.html'];
    assert.equal(regenerated.match(/<section data-short-notes="exact-v1">[\s\S]*?<\/section>/)[0], section);
    assert.throws(() => verifyOwnedWords({ ...pages, 'for-you.html': pages['for-you.html'].replace(section, section.replace('What research says:', 'Unverified advice:')) }, move));
  }
});
