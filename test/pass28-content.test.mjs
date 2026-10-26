import { sourceReaderLimitation, guideReaderLimitation, guideReaderClaim } from '../app/reader-notes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { moves, readJSON, words } from '../server/files.js';
import { approvedRhymeFor, selectedRhymeFor, chooseRhyme, rhymeEditorialRule } from '../server/rhyme.js';
import { scienceFor, posterScienceClaimFor, backupActionFor, backupFor, tinyTryOptionsFor, posterBoxes, boxText } from '../server/format.js';
import { makePages, visibleText, printedText } from '../server/layout.js';
import { kitText } from './kit-text-fixture.mjs';
import { validateStory } from '../server/story.js';

const rhymes = readJSON(new URL('../content/rhymes-draft.json', import.meta.url));
const proposals = [
  'Name it to tame it', 'Breathe out slow, let it flow.', 'Talk kind inside, be your own guide.',
  'Think it through: what could I do?', 'Pause a bit. Come back to it.', 'Ask for a hand, together we stand.',
  'Start small today. Find your own way.', 'Then and now: what changed, and how?', 'Show you care. Say sorry and repair.',
  'One check, then done, no second run.', 'In private, say, "Are you okay?"', 'Nerves can mean ready, take it steady.',
  'Worry, take a seat, later we’ll meet.', 'Sleep, stretch, or thirst? Body check first.',
];

test('class 5: owner approval and author are explicit; saved proposals cannot approve themselves', () => {
  assert.match(rhymeEditorialRule, /Two short beats.*4 to 7 words TOTAL.*true spoken rhyme.*no promised/);
  for (const [index, move] of moves.entries()) {
    const selected = selectedRhymeFor(move, rhymes);
    assert.equal(selected.tagline, proposals[index]);
    assert.ok(words(selected.tagline).length >= 4 && words(selected.tagline).length <= 7, move.id);
    assert.equal(selected.lines.length, 2);
    if (index === 0) assert.equal(selected.author, 'Sunny');
    else assert.match(selected.author, /Codex/);
    assert.equal(selected.selection.ownerApproval, false);
    assert.equal(selected.approved, index === 0);
    assert.equal(selected.reviewLabel, index === 0 ? '' : "FOR SUNNY'S READ");
    assert.equal(chooseRhyme('An unapproved replacement.', move, {}).source, selectedRhymeFor(move).approved ? 'approved' : 'draft');
    assert.equal(chooseRhyme('An unapproved replacement.', move, {}).tagline, selectedRhymeFor(move).tagline);
    if (index === 0) assert.equal(approvedRhymeFor(move, rhymes).author, 'Sunny');
    else assert.throws(() => approvedRhymeFor(move, rhymes), /approved_rhyme_unapproved/);
  }
  const missingApproval = structuredClone(rhymes); delete missingApproval[0].approval;
  assert.throws(() => selectedRhymeFor(moves[0], missingApproval), /explicit approval/);
  const changedWords = structuredClone(rhymes); changedWords[0].lines = ['Name it', 'then blame it'];
  assert.throws(() => selectedRhymeFor(moves[0], changedWords), /approval must name these exact words/);
  const selfApproval = structuredClone(rhymes); selfApproval[1].approval = { status: 'approved', by: 'ChatGPT' };
  assert.throws(() => selectedRhymeFor(moves[1], selfApproval), /Only Sunny/);
});

test('class 5: review labels stay in parent notes and evidence, outside the printed rhyme', () => {
  for (const move of moves) {
    const text = kitText(move); text.pagination = validateStory(text).pagination;
    const selected = selectedRhymeFor(move), box = posterBoxes(move, text).find(box => box.id === 'tagline');
    assert.equal(box.text, selected.tagline);
    const pages = makePages(move, text);
    assert.ok(printedText(pages['for-you.html']).includes(selected.tagline));
    for (const html of Object.values(pages)) assert.ok(!printedText(html).includes("FOR SUNNY'S READ"));
    assert.ok(visibleText(pages['for-you.html']).includes("FOR SUNNY'S READ"));
    assert.equal(text.tagline, selected.tagline);
  }
});

test('class 6: science claim and limit stay paired in parent notes', () => {
  for (const move of moves) {
    const science = scienceFor(move);
    assert.equal(science.approval.status, 'pending'); assert.equal(science.reviewLabel, "FOR SUNNY'S READ");
    assert.equal(posterBoxes(move).find(box => box.id === 'science').text, posterScienceClaimFor(move));
    const text = kitText(move); text.pagination = validateStory(text).pagination;
    const pages = makePages(move, text);
    const notes = visibleText(pages['for-you.html'].split('<aside class="parent-notes">')[1]);
    assert.ok(notes.includes(guideReaderClaim(move.id, science.claim)), move.id);
    assert.ok(notes.includes(guideReaderLimitation(move.id, science.limitation)), move.id);
    assert.ok(!printedText(pages['try.html']).includes(science.claim), move.id);
  }
  const brave = scienceFor(moves.find(move => move.id === 'one-brave-step'));
  assert.match(brave.claim, /was linked with/); assert.doesNotMatch(brave.claim, /therapy|got better more when/);
  assert.match(brave.limitation, /cannot show.*caused.*one small step at home/);
});

test('class 7: backups fit any concern, tiny tries use distinct parts of the move, practice stays exact', () => {
  for (const move of moves) {
    assert.ok(move.practiceScript.trim());
    const backup = backupActionFor(move), options = tinyTryOptionsFor(move);
    assert.equal(backup, backupFor(move).tryItDraft.backupAction);
    assert.doesNotMatch(backup, /first test question|homework|pencil|tryouts|supplied|rehearse/i, move.id);
    assert.equal(options.length, 3); assert.equal(new Set(options.map(row => row.text)).size, 3);
    assert.deepEqual(options.map(row => row.seconds), [30, 60, 90]);
    assert.ok(options.every(row => row.offScreen === true));
    assert.doesNotMatch(options.map(row => row.text).join(' '), /supplied|record|rehearse|template|algorithm/i);
    assert.equal(move.tryItDraft.approval.status, 'pending');
    assert.equal(move.tryItDraft.reviewLabel, "FOR SUNNY'S READ");
  }
  const naming = tinyTryOptionsFor(moves[0]).map(option => option.text);
  assert.match(naming[0], /Mad, sad or another word is okay/); assert.match(naming[1], /two feeling words/); assert.match(naming[2], /number/);
  const brave = tinyTryOptionsFor(moves.find(move => move.id === 'one-brave-step')).map(option => option.text);
  assert.match(brave[0], /smaller/); assert.match(brave[1], /guess/); assert.match(brave[2], /compare/);
});


test('class 1 content: current picture actions match the human cast without a competing adult outfit', () => {
  for (const move of moves) {
    assert.match(move.actionLine, /^The human child/);
    assert.doesNotMatch(move.actionLine, /fox|paw|tan coat|gray trousers/iu);
  }
});
