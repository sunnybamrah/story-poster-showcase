import test from 'node:test';
import assert from 'node:assert/strict';
import { parseERICRecord, validateSourceReceipt, evidenceSourceURL, fetchEvidenceSource, searchEvidenceSources, validateSearchReceipt, sourceBody } from '../server/library-sources.js';
import { libraryHarness, librarySettled, libraryAnswer, libraryDraft, libraryReview } from './library-fixture.mjs';
import { printedSourcesFor } from '../server/kit-editorial.js';
import { buildInteractiveContent } from '../server/interactive-assets.js';

const url = 'https://eric.ed.gov/?id=EJ999999';
const record = () => ({ id: 'EJ999999', title: 'Fictional education source', author: ['Fixture Researcher'], source: 'Fixture Education Journal', publicationdateyear: '2020', description: 'Fictional fixture only. Naming emotions was linked with clearer descriptions. This record describes an association and did not test teaching the home activity.', peerreviewed: 'T', educationlevel: ['Elementary Education'], publicationtype: ['Journal Articles'] });
const source = () => parseERICRecord(record(), url, '2026-10-17T00:00:00Z');
const response = docs => new Response(JSON.stringify({ response: { docs } }), { headers: { 'content-type': 'application/json' } });

test('ERIC receipts preserve actual record scope and reject changed metadata, body or identity', () => {
  const saved = source();
  assert.equal(validateSourceReceipt(saved), saved);
  assert.equal(saved.abstract, undefined);
  assert.equal(saved.pubmed, undefined);
  assert.equal(sourceBody(saved), record().description);
  assert.equal(saved.sourceType, 'abstract-record');
  for (const edit of [s => { s.bodyText += ' invented'; }, s => { s.educationLevel = ['Adult Education']; }, s => { s.sourceType = 'full-paper'; }, s => { s.id = 'EJ888888'; }]) {
    const changed = structuredClone(saved); edit(changed); assert.throws(() => validateSourceReceipt(changed));
  }
  assert.throws(() => parseERICRecord({ ...record(), id: 'ED999999' }, url), /different/);
  for (const bad of ['http://eric.ed.gov/?id=EJ999999', 'https://eric.ed.gov/?id=EJ999999&redirect=http://127.0.0.1', 'https://127.0.0.1/?id=EJ999999', 'https://eric.ed.gov:444/?id=EJ999999']) assert.throws(() => evidenceSourceURL(bad));
});

test('ERIC retrieval uses only fixed API routes and does not follow record links', async () => {
  const calls = [];
  const fetched = await fetchEvidenceSource(url, { fetchImpl: async (endpoint, options) => { calls.push({ endpoint, options }); return response([{ ...record(), url: 'http://127.0.0.1/private' }]); } });
  assert.equal(fetched.url, url); assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint.origin, 'https://api.ies.ed.gov');
  assert.equal(calls[0].endpoint.searchParams.get('search'), 'id:EJ999999');
  assert.equal(calls[0].options.redirect, 'error');
});

test('one failed provider does not erase the other source search and failures remain explicit', async () => {
  const receipt = await searchEvidenceSources('recognizing feelings', { terms: ['emotional awareness'], scheduler: { request: async () => { throw Error('Fixture PubMed unavailable'); } }, fetchImpl: async () => response([{ id: 'EJ999999' }]) });
  assert.equal(validateSearchReceipt(receipt), receipt);
  assert.deepEqual(receipt.urls, [url]);
  assert.equal(receipt.failures[0].provider, 'PubMed');
  assert.match(receipt.failures[0].reason, /unavailable/);
});

test('ERIC evidence reaches draft, review, saved source and printed source selection without a fake PMID', async t => {
  const draft = libraryDraft(); draft.evidence[0].sourceId = 'EJ999999';
  const review = libraryReview(); review.claims[0].sourceId = 'EJ999999';
  const h = libraryHarness(t, {
    searchSources: async () => ({ provider: 'PubMed and ERIC', urls: [url], searchedAt: '2026-10-17T00:00:00Z' }),
    fetchSource: async value => { if (value !== url) throw Error('Fixture seed unavailable'); return source(); },
    override: request => request.stage === 'library-research' ? libraryAnswer({ sourceUrls: [url], noRelevantSource: false }) : request.stage === 'library-draft' ? libraryAnswer(draft) : request.stage === 'library-review' ? libraryAnswer(review) : undefined,
  });
  const job = h.service.start(h.account, 'primary', 'A made-up afternoon had a small setback.');
  const done = await librarySettled(h.service, h.account, job.id);
  assert.equal(done.status, 'complete', JSON.stringify(done));
  const document = h.service.list()[0], printed = printedSourcesFor(document.move);
  assert.equal(printed[0].eric, 'EJ999999');
  assert.equal(printed[0].pubmed, undefined);
  assert.match(printed[0].contentScope, /ERIC metadata abstract/);
  assert.equal(document.sourceReceipts[0].bodyText, undefined);
  const interactive = buildInteractiveContent({ move: document.move, kit: { tagline: 'Name it, claim it.' }, version: 1 });
  assert.equal(interactive.sections.source.studyUrl, url);
  assert.equal(interactive.sections.science.studyUrl, url);
  for (const call of h.calls.filter(call => ['library-draft', 'library-review'].includes(call.stage))) {
    assert.match(JSON.stringify(call.body), /ERIC metadata abstract/);
    assert.doesNotMatch(JSON.stringify(call.body), /ACTUAL fetched PubMed abstracts/);
  }
});
