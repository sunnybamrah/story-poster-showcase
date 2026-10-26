import test from 'node:test';
import assert from 'node:assert/strict';
import { moves, readJSON } from '../server/files.js';
import { selectedRhymeFor, rhymeRuleFaults, rhymeWords, rhymeNeedsRefresh, chooseRhyme } from '../server/rhyme.js';
import { parseStoryCheck } from '../server/check-story.js';
import { storyCheckAnswer, markFault } from './checker-fixture.mjs';
import { STORY_RULES, POSTER_QUALITY_RULES, buildPosterRequest } from '../server/requests.js';
import { validateStory } from '../server/story.js';
import { makePages, printedText } from '../server/layout.js';
import { rhymeReviewLabelFor, needsTellingPanel } from '../server/format.js';
import { printedSourcesFor } from '../server/kit-editorial.js';
import { family } from './fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';

const recordFor = (moveId, lines) => ({ moveId, lines, author: 'OpenAI writer', approval: { status: 'pending', by: null },
  selection: { by: 'independent model review', authority: 'Sunny authorized reusable teaching library', ownerApproval: false } });

test('a fresh rhyme keeps the same meaning checks as the story, while saved wording stays historical', () => {
  const move = moves[0], story = { ...kitText(move), tagline: 'Point and stare, mock their hair.' };
  for (const key of ['jokeAtPerson', 'secondMoveTaught', 'adviceOutsideRecord', 'feelingGoesAwayPromise']) {
    const answer = markFault(storyCheckAnswer(story.tagline), key, story.tagline, ['tagline']);
    const check = parseStoryCheck(JSON.stringify(answer), { story, move, record: family, generation: true });
    const result = chooseRhyme(story.tagline, move, check, { freshForKit: true });
    assert.equal(result.ready, false, key);
    assert.ok(result.issues.some(issue => issue.includes(key)));
    assert.equal(chooseRhyme(story.tagline, move, check).tagline, selectedRhymeFor(move).tagline);
  }
});

test('fresh rhymes reject three and eight words, accept four through seven, and count contractions and hyphens once', () => {
  assert.match(rhymeRuleFaults('Name one feeling.').join(' '), /3 words/);
  assert.match(rhymeRuleFaults('Name what you feel, say what is real.').join(' '), /8 words/);
  assert.deepEqual(rhymeRuleFaults('Name it to tame it'), []);
  assert.deepEqual(rhymeRuleFaults('Pause a bit. Come back to it.'), []);
  assert.equal(rhymeWords("Don't stop. A grown-up can help.").length, 6);
  assert.equal(rhymeWords('Don’t stop. A grown‑up can help.').length, 6);
});

test('current selections retain exact owner approvals and saved topic instructions', () => {
  for (const move of moves) {
    const selected = selectedRhymeFor(move), count = rhymeWords(selected.tagline).length;
    assert.ok(count >= 4 && count <= 7, move.id);
    assert.equal(selected.approved, ['name-it-exactly', 'compare-with-past-me', 'good-enough-is-done', 'make-it-right', 'check-my-battery'].includes(move.id));
  }
  assert.equal(selectedRhymeFor(moves[0]).tagline, 'Name it to tame it');
  assert.match(STORY_RULES, /Copy the exact tagline in topicReminders/);
  assert.match(POSTER_QUALITY_RULES, /4 to 7 words TOTAL/);
  assert.doesNotMatch(STORY_RULES + POSTER_QUALITY_RULES, /5 to 10 words|3 to 14 words/);
});

test('runtime lessons use attached validated rhyme records and cannot bypass limits or claim owner approval', () => {
  const move = { id: 'runtime-kind-words', rhymeRecord: recordFor('runtime-kind-words', ['Kind words inside.', 'Be your own guide.']) };
  assert.equal(selectedRhymeFor(move).tagline, 'Kind words inside. Be your own guide.');
  assert.equal(selectedRhymeFor(move).source, 'move.rhymeRecord');
  assert.equal(rhymeReviewLabelFor(move, selectedRhymeFor(move).tagline), "FOR SUNNY'S READ");
  for (const lines of [['Name one', 'feeling.'], ['Name what you feel,', 'say what is real.']]) assert.throws(() => selectedRhymeFor({ ...move, rhymeRecord: recordFor(move.id, lines) }), /rhyme_word_count/);
  for (const mutate of [record => { record.moveId = 'another-lesson'; }, record => { delete record.author; }, record => { delete record.selection; }, record => { record.selection.ownerApproval = true; }, record => { record.approval = { status: 'approved', by: 'Sunny', text: record.lines.join(' ') }; }]) {
    const invalid = structuredClone(move); mutate(invalid.rhymeRecord);
    assert.throws(() => selectedRhymeFor(invalid), /approved_rhyme_invalid/);
  }
});

test('saved story wording remains readable and Resume preserves it', () => {
  const move = moves.find(move => move.id === 'cool-off-break'), text = kitText(move);
  const saved = 'A saved reminder from an earlier story.';
  text.tagline = saved;
  text.pagination = validateStory(text).pagination;
  const pages = makePages(move, text);
  assert.ok(printedText(pages['for-you.html']).includes(saved));
  assert.equal(text.tagline, saved);
  assert.equal(rhymeNeedsRefresh(text, move), false);
  assert.doesNotThrow(() => buildPosterRequest(family, move, '', text));
  text.tagline = selectedRhymeFor(move).tagline;
  assert.equal(rhymeNeedsRefresh(text, move), false);
  assert.doesNotThrow(() => buildPosterRequest(family, move, '', text));
});

test('runtime lessons inherit action-only telling rules and explicitly selected actual source records', () => {
  const base = moves.find(move => move.id === 'one-brave-step');
  const source = base.sources[0], id = source.doi ?? source.pubmed;
  const move = { ...base, id: 'runtime-stage-fright', library: { actionBaseMoveId: base.id, printSourceIds: [id] } };
  assert.equal(needsTellingPanel(move), true);
  assert.equal(printedSourcesFor(move)[0].recordIndex, 0);
  assert.throws(() => printedSourcesFor({ ...move, library: { ...move.library, printSourceIds: [undefined] } }), /print_sources_invalid/);
  assert.throws(() => printedSourcesFor({ ...move, library: { ...move.library, printSourceIds: ['not-in-this-lesson'] } }), /print_source_missing/);
});
