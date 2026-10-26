import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { projectSourceFiles, projectSourceLine, posterSourceUses, projectPosterSource, originalStyleLine, originalPosterCheck } from '../server/project-source.js';
import { buildPosterRequest, buildWordCheckRequest } from '../server/requests.js';
import { comicFaceRule } from '../server/graphic-style.js';
import { moves } from '../server/files.js';
import { family } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';

// The owner asked for his original ChatGPT Project files to be the request source,
// not a rewritten substitute. Exact lines go out; every change is listed with a reason.
const directory = new URL('../war-room/research/chatgpt-growth-project/project-files/', import.meta.url);
const privateWords = /Sunny|CHARACTER-SHEET|FAMILY-FACTS|POSTER-REFERENCE/;

test('the four shared original files are byte for byte the sanitized public source files; private ones are never shared', () => {
  for (const [file, hash] of Object.entries(projectSourceFiles)) assert.equal(createHash('sha256').update(readFileSync(new URL(file, directory))).digest('hex'), hash, file);
  assert.deepEqual(Object.keys(projectSourceFiles).sort(), ['FORMAT.txt', 'POSTER-CHECK.txt', 'PROJECT-INSTRUCTIONS.txt', 'STYLE.txt']);
  for (const file of ['CHARACTER-SHEET.txt', 'FAMILY-FACTS.txt', 'SKILL-MAP.txt']) assert.throws(() => projectSourceLine(file, 1), /not a shared original/);
});

test('each quoted line is the original line, changed only where a listed reason says so', () => {
  const sent = projectPosterSource().split('\n').slice(1);
  assert.equal(sent.length, posterSourceUses.length);
  for (const [index, use] of posterSourceUses.entries()) {
    const original = projectSourceLine(use.file, use.line).replace(/^- /, '').trim();
    if (!use.changes?.length) assert.equal(sent[index], original, `${use.file} ${use.line}`);
    else { assert.ok(use.why, `${use.file} ${use.line} has a reason`); assert.notEqual(sent[index], original); for (const [, replacement] of use.changes) if (replacement) assert.ok(sent[index].includes(replacement)); }
  }
  // The old "same boxes, same places" and "top third" positions are the owner's explicit override.
  assert.doesNotMatch(projectPosterSource(), /same boxes, same places|top third|four cards/);
  assert.match(projectPosterSource(), /THIS IS A DRAWING, NOT A LAYOUT/); assert.match(projectPosterSource(), /middle grade graphic novel like Smile or The Baby Sitters Club/);
  assert.doesNotMatch(projectPosterSource(), privateWords);
});

test('the poster request, the word checker and the comic-face rule carry the original text', () => {
  const body = buildPosterRequest({ ...family, pictureStyleId: 'bold-ink-comic' }, moves[0], '', kitText(), { referenceImages: [{ characterId: 'child', data: 'data:image/png;base64,AA==' }] });
  const source = body.prompt.indexOf(projectPosterSource()), amendments = body.prompt.indexOf('CURRENT OWNER AMENDMENTS');
  assert.ok(source > 0 && amendments > source, 'original files first, then the owner amendments that override them');
  assert.doesNotMatch(body.prompt, privateWords);
  const payload = JSON.parse(buildWordCheckRequest(family, moves[0], '', 'data:image/png;base64,AA==').input[0].content[0].text);
  assert.deepEqual(payload.originalPosterCheck, originalPosterCheck()); assert.match(payload.originalPosterCheck[0], /^1\. LIST every word you can see in the drawn poster/);
  assert.ok(comicFaceRule.includes(originalStyleLine())); assert.equal(originalStyleLine(), projectSourceLine('STYLE.txt', 5).slice(2));
});
