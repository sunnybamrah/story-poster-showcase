import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { moves } from '../server/files.js';
import { combinedKitHTML, copyFonts, makePages, printedText } from '../server/layout.js';
import { launchMeasurementBrowser } from '../server/layout-fit.js';

test('the final story paragraph leaves no trailing gap that pushes a fitting footer off its page', async t => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/fictional-story-footer-fit.json', import.meta.url)));
  assert.equal(fixture.fixture, true);
  const { text } = fixture, original = structuredClone(text);
  const pages = makePages(moves.find(move => move.id === text.moveId), text, { nickname: 'Pip', parentLabel: 'Dad' });
  const current = combinedKitHTML(pages);
  // Reproduce the previous equal-specificity cascade with the exact saved text.
  const previous = current.replace('.chapter-text p:last-child{margin-bottom:0}', '');
  assert.equal(printedText(current), printedText(previous));
  assert.deepEqual(text, original);
  const directory = mkdtempSync(join(tmpdir(), 'story-footer-fit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true })); copyFonts(directory);
  const browser = await launchMeasurementBrowser(); t.after(() => browser.close());
  for (const theme of ['light', 'dark']) {
    const results = [];
    for (const [name, html] of [['previous', previous], ['current', current]]) {
      const path = join(directory, `${name}.html`); writeFileSync(path, html);
      const page = await browser.newPage();
      await page.goto(pathToFileURL(path).href + '?print=1&theme=' + theme);
      await page.waitForFunction(() => document.documentElement.dataset.fitted === 'true');
      results.push(await page.evaluate(() => ({
        fit: globalThis.storyPosterLayout,
        stories: [...document.querySelectorAll('.chapter-text')].map(body => ({
          paragraphs: [...body.children].map(node => { const r = node.getBoundingClientRect(), style = getComputedStyle(node); return { text: node.textContent, x: r.x, y: r.y, w: r.width, h: r.height, font: style.fontSize, lineHeight: style.lineHeight }; }),
          lastMargin: getComputedStyle(body.lastElementChild).marginBottom,
        })),
      })));
      await page.close();
    }
    const [before, after] = results;
    assert.equal(before.fit.ready, false);
    assert.ok(before.fit.faults.some(fault => /^story\.footer:/.test(fault)));
    assert.equal(after.fit.ready, true, after.fit.faults.join('; '));
    assert.equal(after.fit.pages.length, 5);
    for (let index = 0; index < 2; index++) {
      assert.deepEqual(after.stories[index].paragraphs, before.stories[index].paragraphs, 'No story words, positions, type sizes or paragraph gaps between paragraphs change.');
      assert.equal(after.stories[index].lastMargin, '0px');
    }
    for (const story of after.fit.pages.filter(page => page.page.startsWith('story'))) {
      assert.equal(story.footerOverflowPoints, 0);
      assert.ok(Math.abs(story.storyTypography.bodyPoints - 13) < .001);
      assert.ok(Math.abs(story.storyTypography.paragraphGapPoints - 6.5) < .001);
      assert.equal(story.storyTypography.panelHeightPoints, 180);
    }
  }
});
