import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fitDocument } from '../server/layout-fit.js';
import { makePages, printedText } from '../server/layout.js';
import { moves, saveJSON } from '../server/files.js';
import { splitStory, practiceFor } from '../server/format.js';
import { kitText } from './kit-text-fixture.mjs';
import { findSavedKit } from './render-saved-kit.mjs';

const temp = t => { const d = mkdtempSync(join(tmpdir(), 'priority-layout-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };
test('saved export validates original page integrity without imposing newer writer rules', () => {
  const move = moves[0], text = kitText(move);
  text.story = text.story.replace(practiceFor(move, 'Pip', 'Dad'), 'These are the older approved practice words.');
  text.pagination = splitStory(text.story, text.panelLines);
  const original = structuredClone(text);
  const pages = makePages(move, text, { savedRevision: true });
  assert.match(pages['story.html'], /data-saved-revision="true"/);
  assert.ok(printedText(pages['story.html']) + printedText(pages['story-2.html']));
  assert.deepEqual(text, original);
  text.pagination.pages[0] += ' Unauthorized change.';
  assert.throws(() => makePages(move, text, { savedRevision: true }), /pagination|Saved|saved|receipt|chapter/i);
});
test('measured saved paragraph packing keeps all words, hook lines and readable spacing', t => {
  const originalDocument = globalThis.document;
  t.after(() => { globalThis.document = originalDocument; });
  const body = { dataset: { savedRevision: 'true' }, children: [] };
  Object.defineProperty(body, 'textContent', { get: () => body.children.map(node => node.textContent).join('') });
  for (const text of ['Hook one.', 'Hook two.', 'Hook three.', 'The child says hello.', 'The parent replies.', 'A pencil rolls.', 'They both smile.']) {
    const node = { textContent: text, dataset: {}, remove() { body.children.splice(body.children.indexOf(node), 1); } }; body.children.push(node);
  }
  const before = body.children.map(node => node.textContent).join(' ');
  const sheet = { dataset: { page: 'story' }, querySelector: query => query === '.chapter-text' ? body : null };
  globalThis.document = { querySelectorAll: () => [sheet] };
  const measure = () => ({ measured: true, ready: body.children.length <= 4, faults: body.children.length <= 4 ? [] : ['overflow'], pages: [{ page: 'story', overflowPoints: body.children.length <= 4 ? 0 : 20, elements: [{ generated: 'story', text: before, overflowPoints: 0 }] }] });
  const result = fitDocument(measure);
  assert.equal(result.ready, true); assert.equal(body.children.length, 4);
  assert.deepEqual(body.children.slice(0, 3).map(node => node.textContent), ['Hook one.', 'Hook two.', 'Hook three.']);
  assert.equal(body.children.map(node => node.textContent).join(' '), before);
  assert.equal(result.fitting.typeShrunk, false); assert.equal(result.fitting.textHidden, false);
  assert.equal(result.fitting.changes.find(row => row.paragraphJoins)?.paragraphJoins, 3);
});
test('default saved rendering discovers current available evidence without a historical hardcoded path', t => {
  const directory = temp(t);
  assert.throws(() => findSavedKit(directory), /Pass a saved kit/);
  const kit = join(directory, 'pass9-2099-01-01', 'kit-1'); mkdirSync(kit, { recursive: true });
  saveJSON(join(kit, 'kit-text-final.json'), {}); saveJSON(join(kit, 'poster-fit.json'), {});
  assert.equal(findSavedKit(directory), kit);
});
const privateRunner = new URL('../war-room/results/slice0/run-pass.sh', import.meta.url);
test('runner keeps the actual exit status before date and requires ready true before paid work', { skip: !existsSync(privateRunner) && 'Needs the excluded file war-room/results/slice0/run-pass.sh from the private development runner.' }, t => {
  const directory = temp(t); mkdirSync(join(directory, 'results/slice0'), { recursive: true });
  const runner = readFileSync(new URL('../war-room/results/slice0/run-pass.sh', import.meta.url), 'utf8');
  const block = runner.slice(runner.indexOf('node test/render-saved-kit.mjs >'), runner.indexOf('[[ $PAID == none ]]'));
  for (const [ready, status, expected] of [['true', 0, 0], ['false', 0, 1], ['true', 9, 1]]) {
    const script = `WAR=$TEST_RENDER_ROOT; N=7; function node() { print '{"ready":${ready}}'; return ${status}; }\n` + block;
    const result = spawnSync('/bin/zsh', ['-c', script], { env: { ...process.env, TEST_RENDER_ROOT: directory }, encoding: 'utf8' });
    assert.equal(result.status, expected, result.stderr);
    assert.match(readFileSync(join(directory, '.war-room-alive.md'), 'utf8').trim().split('\n').at(-1), new RegExp(`exit ${status}, ready ${ready}`));
  }
});
