import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app-server.mjs';
import { offlineSample } from './offline-kit-fixture.mjs';

test('phone reading receives both exact story parts, all four scene captions and approved blank poster text', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'nightly-reader-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sample = await offlineSample(join(directory, 'sample'));
  const app = createApp({ dataDirectory: join(directory, 'accounts'), sample, sampleOnly: true, keyReader: () => assert.fail('No credential reads') });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/sample`);
  const result = await response.json();
  assert.equal(result.storyPages.length, 2);
  const words = text => text.trim().split(/\s+/u);
  assert.deepEqual(words(result.storyPages.join(' ')), words(sample.text.story.replace(/^(?:MADE UP|REAL)\s*\n/u, '')));
  assert.deepEqual(result.panels.map(panel => panel.line), sample.text.panelLines.map(panel => panel.line));
  assert.deepEqual(result.panels.map(panel => panel.urlName), ['panel-1.png', 'panel-2.png', 'panel-3.png', 'panel-4.png']);
  assert.match(result.posterSections.find(section => section.id === 'move').text, /When I notice ______,\nI ______\./);
  assert.equal(result.sample, true);
});
