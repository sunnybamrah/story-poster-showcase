import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { join } from 'node:path';
import { root, moves } from '../server/files.js';
import { sourceReaderLimitation } from '../app/reader-notes.js';
import { visibleText } from '../server/layout.js';

test('the real GuideSources component shows the exact plain note for raw and ID-less browser sources', async t => {
  const vite = await createServer({ configFile: false, root: join(root, 'app'), logLevel: 'error', server: { middlewareMode: true } });
  t.after(() => vite.close());
  const { GuideSources } = await vite.ssrLoadModule('/TeachingLibrary.jsx');
  const source = moves[0].sources.find(source => source.doi === '10.1177/1754073917742706');
  const expected = sourceReaderLimitation(source), before = structuredClone(source);
  assert.notEqual(expected, source.limitation);
  for (const record of [source, { title: source.title, url: source.url, limitation: source.limitation }]) {
    const html = renderToStaticMarkup(React.createElement(GuideSources, { sources: [record] }));
    assert.ok(visibleText(html).includes(expected));
    assert.ok(!visibleText(html).includes(source.limitation));
  }
  const changed = { ...source, limitation: source.limitation + ' A later note.' };
  const historical = renderToStaticMarkup(React.createElement(GuideSources, { sources: [changed] }));
  assert.ok(visibleText(historical).includes(changed.limitation));
  assert.deepEqual(source, before);
});

test('the real library groups equal notes but keeps each citation, audit and differing note', async t => {
  const vite = await createServer({ configFile: false, root: join(root, 'app'), logLevel: 'error', server: { middlewareMode: true } });
  t.after(() => vite.close());
  const { GuideSources } = await vite.ssrLoadModule('/TeachingLibrary.jsx');
  const sources = [0, 1, 2].map(index => ({
    sourceId: `source-${index}`, title: `Citation ${index}`, url: `https://example.test/${index}`,
    sourceType: 'official-guidance', people: `Author ${index}`, plainFit: 'Official guidance',
    contentScope: 'Selected excerpts about adolescents.', checkedOn: `2026-10-${10 + index}`,
    audit: { scope: `Audit ${index}` }, notices: [`Notice ${index}`],
    correctionDisposition: 'reviewed-incorporated', sourceState: 'pending',
    limitation: index === 2 ? 'Adolescents took part. This differs.' : 'Adolescents took part.',
  })), before = structuredClone(sources);
  const html = renderToStaticMarkup(React.createElement(GuideSources, { sources, definitionText: 'Adolescents took part.' })), text = visibleText(html);
  assert.equal((html.match(/>Adolescents took part\.<\/p>/g) ?? []).length, 1);
  assert.equal((html.match(/>Adolescents took part\. This differs\.<\/p>/g) ?? []).length, 1);
  assert.equal(text.split('Adolescents are young people growing from children into adults.').length - 1, 1);
  for (const source of sources) for (const value of [source.title, source.people, source.plainFit, source.contentScope, source.checkedOn, source.audit.scope, ...source.notices]) assert.ok(text.includes(value), value);
  assert.equal((text.match(/The source correction is included/g) ?? []).length, 3);
  assert.equal((text.match(/This source needs another review/g) ?? []).length, 3);
  for (const source of sources) assert.ok(html.includes(`href="${source.url}"`));
  assert.deepEqual(sources, before);
});
