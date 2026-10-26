import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readerLimitation, sourceReaderLimitation, guideReaderLimitation, sourceNoteGroups } from '../app/reader-notes.js';
import { moves, root, readJSON } from '../server/files.js';
import { previewPages, verifyOwnedWords, visibleText, printedText, escapeHTML } from '../server/layout.js';
import { printedSourcesFor } from '../server/kit-editorial.js';
import { evidenceLabelFor, printedReplayRule, replayQuietNight, parentGuidance } from '../server/format.js';
import { buildInteractiveContent, interactiveContentHash, validateInteractiveContent } from '../server/interactive-assets.js';
import { renderInteractiveHTML } from '../server/interactive-view.js';
import { posterTemplate } from '../server/poster-template.js';
import { kitText } from './kit-text-fixture.mjs';
import { buildStoryRequest, buildStoryCheckRequest } from '../server/requests.js';
import { family } from './fixture.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const rows = readJSON(new URL('../content/source-reader-notes.json', import.meta.url));
const allMoves = () => moves.filter(move => !move.library);
const sourceSections = html => [...html.matchAll(/<section data-source-notes="exact-groups-v1" data-source-section="([^"]+)">([\s\S]*?)<\/section>/g)];
const occurrences = (text, words) => text.split(words).length - 1;

test('source notes group exact displayed equals only and define visible words once', () => {
  const sources = [
    { sourceId: 'one', limitation: 'Adolescents took part.' },
    { sourceId: 'two', limitation: 'Adolescents took part. ' },
    { sourceId: 'three', limitation: 'Adolescents took part.' },
    { sourceId: 'four', limitation: 'Adolescents did not take part.' },
  ], before = structuredClone(sources);
  const grouped = sourceNoteGroups(sources);
  assert.deepEqual(grouped.groups.map(group => group.sources.map(member => member.index)), [[0, 2], [1], [3]]);
  assert.equal(grouped.definitions.length, 1);
  assert.deepEqual(sourceNoteGroups([{ limitation: 'A short note.', contentScope: 'Randomized trial.' }]).definitions, [], 'Hidden source metadata cannot add print definitions.');
  assert.equal(sourceNoteGroups(sources, { definitionText: 'Adolescents took part.' }).definitions.length, 1);
  assert.deepEqual(sourceNoteGroups([{ limitation: 'The activity is for adolescents, young people growing into adults.' }]).definitions, [], 'An exact inline explanation needs no second definition.');
  assert.deepEqual(sources, before);
});

test('all 14 public guide templates preserve each citation and exact attached note', t => {
  const catalog = allMoves(), length = moves.length;
  t.after(() => { moves.length = length; });
  for (const move of catalog) if (!moves.some(saved => saved.id === move.id)) moves.push(move);
  assert.equal(catalog.length, 14);
  for (const move of catalog) {
    const before = structuredClone(move), pages = previewPages(move), sections = sourceSections(pages['for-you.html']);
    assert.equal(verifyOwnedWords(pages, move), true, move.id);
    assert.equal(sections.length, 1, move.id);
    for (const section of sections) {
      const sources = section[1] === 'printed' ? printedSourcesFor(move) : move.sources;
      const expected = sourceNoteGroups(sources).groups;
      assert.equal((section[2].match(/data-source-group=/g) ?? []).length, expected.length, move.id);
      assert.equal((section[2].match(/<p data-source=/g) ?? []).length, sources.length, move.id);
      for (const group of expected) assert.equal(occurrences(visibleText(section[2]), visibleText(escapeHTML(group.limitation))), 1, `${move.id}: ${section[1]} note once`);
    }
    assert.ok(printedText(pages['for-you.html']).includes('Sources and study details are in the app.'));
    assert.doesNotMatch(printedText(pages['for-you.html']), /What the studies tell us|Official guidance\. Official guidance\./);
    assert.deepEqual(move, before);
  }
});

test('hosted adaptation source groups remain covered only with the omitted source bundle', { skip: 'Needs the excluded file content/adaptation-library/bundle.json with the hosted adaptation source groups.' }, t => {
  const move = allMoves().find(move => move.id === 'lib-8b233c68232efc8645479298'), length = moves.length;
  if (!moves.some(saved => saved.id === move.id)) moves.push(move);
  t.after(() => { moves.length = length; });
  const pages = previewPages(move), html = pages['for-you.html'];
  assert.equal(verifyOwnedWords(pages, move), true);
  const parent = sourceSections(html).find(section => section[1] === 'parent')[2];
  assert.match(parent, /data-source-group="sources\.0\.limitation sources\.1\.limitation"/);
  assert.match(parent, /data-owned="sources\.0\.limitation" data-owned-shared="sources\.1\.limitation"/);
  assert.equal(occurrences(visibleText(parent), sourceReaderLimitation(move.sources[0])), 1);
  assert.doesNotMatch(visibleText(parent), /Adolescents are young people/);
  const changes = [
    ['note wording', html.replace(escapeHTML(sourceReaderLimitation(move.sources[0])), 'Changed limitation.')],
    ['shared member removed', html.replace(' data-owned-shared="sources.1.limitation"', '')],
    ['wrong member', html.replace('data-owned-shared="sources.1.limitation"', 'data-owned-shared="sources.2.limitation"')],
    ['wrong source', html.replace('data-source="1"', 'data-source="2"')],
    ['wrong identity', html.replace('data-source-id="cdc-connecting-2024"', 'data-source-id="unicef-listening-2025"')],
    ['wrong classification', html.replace('data-evidence-fit="GUIDANCE"', 'data-evidence-fit="DIRECT"')],
    ['citation removed', html.replace(/<p data-source="1"[^>]*>[\s\S]*?<\/p>/, '')],
    ['group removed', html.replace(/<div class="source" data-source-group="[^"]*">[\s\S]*?<\/div>/, '')],
    ['parent section removed', html.replace(/<section data-source-notes="exact-groups-v1" data-source-section="parent">[\s\S]*?<\/section>/, '')],
  ];
  for (const [label, changed] of changes) {
    assert.notEqual(changed, html, label);
    assert.throws(() => verifyOwnedWords({ ...pages, 'for-you.html': changed }, move), /Record words|Source note group/, label);
  }
  // A later source wording is a distinct limitation, even when it differs only
  // by trailing space. An old shared group must not approve the changed record.
  const changedMove = structuredClone(move);
  changedMove.sources[1].limitation += ' ';
  assert.throws(() => verifyOwnedWords(pages, changedMove), /Source note group/, 'Never share a third wording.');

  // Historical exports had one owned span per source and no group markers.
  const legacy = html.replace(/<section data-source-notes="exact-groups-v1" data-source-section="([^"]+)">[\s\S]*?<\/section>/g, (_, section) => {
    const sources = section === 'printed' ? printedSourcesFor(move) : move.sources;
    return sources.map((source, index) => `<div class="source" data-source="${source.recordIndex ?? index}" data-evidence-fit="${source.fitLabel}"><p>${escapeHTML([evidenceLabelFor(source.fitLabel), section === 'printed' && /,| and /u.test(source.people) ? source.people.split(/,| and /u)[0] + ' and others' : source.people, source.year ?? source.dateLabel, source.title].join('. '))}</p><span data-owned="sources.${source.recordIndex ?? index}.limitation">${escapeHTML(sourceReaderLimitation(source))}</span></div>`).join('');
  }).replace(/<section data-short-notes="exact-v[12]">[\s\S]*?<\/section>/, printedSourcesFor(move).map(source => `<div class="source" data-source="${source.recordIndex}" data-evidence-fit="${source.fitLabel}"><p>${escapeHTML([evidenceLabelFor(source.fitLabel), /,| and /u.test(source.people) ? source.people.split(/,| and /u)[0] + ' and others' : source.people, source.year ?? source.dateLabel, source.doi ? `DOI ${source.doi}` : `PubMed ${source.pubmed}`].join('. '))}</p><span data-owned="sources.${source.recordIndex}.limitation">${escapeHTML(sourceReaderLimitation(source))}</span></div>`).join('') + [printedReplayRule, replayQuietNight, parentGuidance].map(line => `<p>${escapeHTML(line)}</p>`).join(''));
  assert.equal(verifyOwnedWords({ ...pages, 'for-you.html': legacy }, move), true);
  assert.throws(() => verifyOwnedWords({ ...pages, 'for-you.html': legacy.replace('data-owned="sources.1.limitation"', 'data-owned="sources.9.limitation"') }, move), /Record words/);
});

test('the exact data has a real independent review and still matches all saved source and guide limits', () => {
  const receipt = readJSON(new URL('../content/source-reader-notes-review.json', import.meta.url));
  assert.equal(receipt.status, 'PASS'); assert.equal(receipt.reviewerModel, 'gpt-6.1-sol');
  assert.equal(hash(readFileSync(new URL('../content/source-reader-notes.json', import.meta.url))), receipt.sha256);
  assert.equal(rows.length, receipt.totalRows);
  assert.equal(new Set(rows.map(row => JSON.stringify([row.kind, row.sourceId, row.originalSHA256]))).size, rows.length);
  for (const row of rows) assert.equal(hash(row.originalLimitation), row.originalSHA256);
  for (const move of allMoves()) {
    assert.ok(rows.some(row => row.kind === 'guide-limit' && row.sourceId === move.id && row.originalLimitation === move.science.limitation));
    for (const source of move.sources) assert.ok(rows.some(row => row.kind === 'source-limit' && row.sourceId === (source.sourceId ?? source.pubmed ?? source.doi) && row.originalLimitation === source.limitation));
  }
});

test('only exact kind, source and wording match; missing or ambiguous notes stay unchanged', () => {
  const row = { kind: 'source-limit', sourceId: 'a', originalLimitation: 'Original note.', plainLimitation: 'Plain note.' };
  assert.equal(readerLimitation('source-limit', 'a', 'Original note.', [row]), 'Plain note.');
  for (const [kind, id, text] of [['guide-limit', 'a', 'Original note.'], ['source-limit', 'b', 'Original note.'], ['source-limit', 'a', 'Original note. '], ['source-limit', 1, 'Original note.'], ['source-limit', 'a', undefined]]) assert.equal(readerLimitation(kind, id, text, [row]), text);
  assert.equal(readerLimitation('source-limit', 'a', row.originalLimitation, [row, row]), row.originalLimitation);
  assert.equal(readerLimitation('source-limit', undefined, row.originalLimitation, [row, { ...row, sourceId: 'b' }]), row.plainLimitation);
  assert.equal(readerLimitation('source-limit', undefined, row.originalLimitation, [row, { ...row, sourceId: 'b', plainLimitation: 'Different.' }]), row.originalLimitation);
  assert.equal(readerLimitation('guide-limit', undefined, row.originalLimitation, [{ ...row, kind: 'guide-limit' }]), row.originalLimitation);
});

test('new parent pages display reviewed notes but retain source facts, writer/checker input and strict owned-word checks', () => {
  const move = moves[0], before = structuredClone(move), sourceFiles = ['moves.json', 'source-row-audit.json'];
  const bytes = sourceFiles.map(file => readFileSync(new URL('../content/' + file, import.meta.url)));
  const storyBefore = buildStoryRequest(family, 'My child felt sad after a game.'), checkBefore = buildStoryCheckRequest(kitText(move), move, { record: family });
  const pages = previewPages(move);
  assert.equal(verifyOwnedWords(pages, move), true);
  assert.ok(visibleText(pages['for-you.html']).includes(guideReaderLimitation(move.id, move.science.limitation)));
  for (const source of printedSourcesFor(move)) assert.ok(visibleText(pages['for-you.html']).includes(sourceReaderLimitation(source)));
  const limit = guideReaderLimitation(move.id, move.science.limitation);
  assert.throws(() => verifyOwnedWords({ ...pages, 'for-you.html': pages['for-you.html'].replace(escapeHTML(limit), 'Unreviewed words.') }, move), /Record words changed/);
  assert.deepEqual(move, before);
  assert.deepEqual(buildStoryRequest(family, 'My child felt sad after a game.'), storyBefore);
  assert.deepEqual(buildStoryCheckRequest(kitText(move), move, { record: family }), checkBefore);
  sourceFiles.forEach((file, index) => assert.deepEqual(readFileSync(new URL('../content/' + file, import.meta.url)), bytes[index]));
  // A labelled legacy-page fixture keeps raw owned text without a new marker.
  const legacy = Object.fromEntries(Object.entries(pages).map(([name, html]) => [name, html.replace(/ data-source-(?:notes|section|group)="[^"]*"/g, '').replaceAll(' data-reader-notes="exact-v1"', '').replaceAll(escapeHTML(limit), escapeHTML(move.science.limitation))]));
  for (const source of move.sources) legacy['for-you.html'] = legacy['for-you.html'].replaceAll(escapeHTML(sourceReaderLimitation(source)), escapeHTML(source.limitation));
  assert.equal(verifyOwnedWords(legacy, move), true);
});

test('new interactive notes keep raw sourceText and are included in approval hashes; historical content is read unchanged', () => {
  const move = moves[0], content = buildInteractiveContent({ move, kit: kitText(move), version: 'reader-note-test' });
  assert.equal(content.sourceText.limitation, move.science.limitation);
  assert.deepEqual(content.sourceRecords, move.sources);
  assert.equal(content.sections.science.limitation, guideReaderLimitation(move.id, move.science.limitation));
  assert.equal(content.readerNotes.guideLimit.originalSHA256, hash(move.science.limitation));
  const stamp = interactiveContentHash(content), changed = structuredClone(content);
  changed.sections.science.limitation += ' Changed';
  assert.notEqual(interactiveContentHash(changed), stamp);
  assert.match(validateInteractiveContent(changed, { requireApproval: false }).faults.join(';'), /reader notes must preserve/);
  const legacy = structuredClone(content); delete legacy.readerNotes; delete legacy.sections.science.readerClaim; delete legacy.sections.science.printedClaim; legacy.sections.science.limitation = legacy.sourceText.limitation;
  legacy.printed.find(box => box.id === 'science').text = legacy.sections.science.claim;
  legacy.writtenByCodex = legacy.writtenByCodex.filter(field => !['sections.science.readerClaim', 'sections.science.printedClaim'].includes(field));
  legacy.approval = { approved: true, reviewedBy: 'Synthetic unit-test fixture only', reference: 'Not an approval for a real kit', sha256: interactiveContentHash(legacy) };
  const before = JSON.stringify(legacy);
  const bundle = { content: legacy, version: legacy.version, image: { url: 'poster.png' }, pdf: { url: 'poster.pdf' }, map: { canvas: posterTemplate.canvas, regions: posterTemplate.regions } };
  const html = renderInteractiveHTML(bundle, { preview: true });
  assert.ok(visibleText(html).includes(move.science.limitation));
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(interactiveContentHash(legacy), legacy.approval.sha256);
  assert.ok(!validateInteractiveContent(legacy).faults.some(fault => /approval tied|reader notes must/.test(fault)));
  const currentHTML = renderInteractiveHTML({ ...bundle, content }, { preview: true });
  assert.ok(visibleText(currentHTML).includes(content.sections.science.limitation));
});
