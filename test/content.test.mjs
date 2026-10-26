import { hardStoryFaults } from '../server/stop-policy.js';
import { expectReview } from './review-assertions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkMoves } from '../content/check-moves.mjs';
import { moves, readJSON, words } from '../server/files.js';
import { validateStory } from '../server/story.js';
import { parseStoryCheck } from '../server/check-story.js';
import { parsePictureCheck } from '../server/check-picture.js';
import { previewPages, verifyOwnedWords, posterWordCount, posterSlotWordCounts, posterContent, blankFrame, assertBlankFrames, assertFriendTitle, storyContent } from '../server/layout.js';
import { calculateCost } from '../server/cost.js';
import { storyCheckKeys, pictureCheckKeys } from '../server/requests.js';
import { storyCheckAnswer, pictureCheckAnswer, markFault } from './checker-fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';

test('protected move words and poster draft originals match the supplied text', () => assert.equal(checkMoves().count, 14));
test('story word counts guide printed fitting and leave fixed wording for owner review', () => {
  const fixture = kitText();
  assert.equal(validateStory(fixture).id, moves[0].id);
  assert.throws(() => validateStory({ ...fixture, moveId: 'invented' }), /unknown_move_id/);
  assert.doesNotThrow(() => validateStory(fixture));
  const paraphrased = { ...fixture, story: fixture.story.replace(moves[0].practiceScript, 'test '.repeat(words(moves[0].practiceScript).length)) };
  assert.equal(validateStory(paraphrased).id, moves[0].id, 'source action can be paraphrased rather than recited');
  for (const wordCount of [499, 549, 550, 750, 751, 801]) assert.equal(validateStory(kitText(moves[0], { wordCount })).id, moves[0].id);
  expectReview(() => validateStory(fixture, { lastMoveId: moves[0].id }), /same_move/);
});
test('judge retains content checks, with generated faults blocking and approved-wording concerns reviewed', () => {
  const answer = storyCheckAnswer();
  assert.deepEqual(storyCheckKeys.slice(0, 6), ['secondMoveTaught', 'feelingGoesAwayPromise', 'adviceOutsideRecord', 'jokeAtPerson', 'effortOnlyPraise', 'filledWhenINotice']);
  assert.ok(storyCheckKeys.includes('screenOnlyPlace'));
  assert.equal(parseStoryCheck(JSON.stringify(answer)).ready, true);
  for (const key of storyCheckKeys) assert.equal(parseStoryCheck(JSON.stringify(markFault(structuredClone(answer), key, 'quoted test words'))).ready, !hardStoryFaults.has(key));
  for (const text of ['', '{}', 'null', '[]', JSON.stringify({ ...answer, secondMoveTaught: 'yes' })]) assert.equal(parseStoryCheck(text).ready, false);
});
test('hero checks still require all four booleans with the right directions', () => {
  const answer = pictureCheckAnswer();
  assert.equal(parsePictureCheck(JSON.stringify(answer)).ready, true);
  for (const key of pictureCheckKeys) assert.equal(parsePictureCheck(JSON.stringify(markFault(structuredClone(answer), key, 'Visible conflict'))).ready, true);
  for (const text of ['', '{}', 'null', '[]', JSON.stringify({ ...answer, lettersPresent: 'no' })]) assert.equal(parsePictureCheck(text).ready, false);
});
test('all five-page previews retain fixed source words and fail changed or missing fields', () => {
  for (const move of moves) {
    const pages = previewPages(move);
    assert.equal(verifyOwnedWords(pages, move), true);
    for (const field of ['keyWord', 'name', ...move.sources.map((_, i) => `sources.${i}.limitation`)]) {
      const altered = { ...pages, 'for-you.html': pages['for-you.html'].replace(`data-owned="${field}">`, `data-owned="${field}">Changed `) };
      assert.throws(() => verifyOwnedWords(altered, move), /changed/);
    }
    assert.equal(Object.values(posterSlotWordCounts(move)).reduce((sum, count) => sum + count, 0), posterWordCount(move));
    const main = posterContent(move);
    assert.match(main, /src="poster-art.png"/);
    assert.doesNotMatch(main, /<h[12]|<svg|<canvas|draft rhyme|warm-ink-frame/);
  }
});
test('blank frames reject filled, missing, extra and hidden answers; poster blank is checked in its image', () => {
  const pages = previewPages(moves[0]);
  assert.equal(assertBlankFrames(pages), true);
  for (const frame of ['', blankFrame.replace('>______</span>', '>anger</span>'), blankFrame.replace('</div></div>', '<span hidden>stay quiet</span></div></div>'), blankFrame + blankFrame]) {
    assert.throws(() => assertBlankFrames({ ...pages, 'try.html': pages['try.html'].replace(blankFrame, frame) }), /frame/);
  }
  for (const page of Object.keys(pages)) assert.equal(assertBlankFrames({ ...pages, [page]: pages[page] + '<p>When I notice anger, I shout.</p>' }), true);
  assert.throws(() => assertBlankFrames({ ...pages, 'for-you.html': pages['for-you.html'].replace('My move: ______', 'My move: shout') }), /Replay/);
});
test('friend test protects title and headline from tonight or a changed move name', () => {
  const move = moves[0];
  assert.equal(assertFriendTitle(move.name, move), true);
  assert.throws(() => assertFriendTitle('Pip slammed the door', move), /Friend test/);
  assert.throws(() => assertFriendTitle('Pip slammed the door', { ...move, name: 'Pip slammed the door' }), /Friend test/);
  const pages = previewPages(move);
  pages['poster.html'] = pages['poster.html'].replace(`<title>${move.name}</title>`, '<title>Pip slammed the door</title>');
  assert.throws(() => verifyOwnedWords(pages, move), /Friend test/);
});
test('story markup is escaped, MADE UP appears in the first header only, and chapters follow saved count', () => {
  const html = storyContent('MADE UP\n<script>bad()</script>', { kitCount: 1, pagination: { pages: ['<script>bad()</script>', 'other page'], panelPages: [0, 0, 1, 1] } });
  assert.match(html, /Chapter 2:/);
  assert.ok(html.includes('&lt;script&gt;bad()&lt;/script&gt;'));
  assert.match(html, /Pip \| MADE UP/);
  assert.equal((html.match(/MADE UP/g) ?? []).length, 1);
  assert.doesNotMatch(storyContent('Other page.', { kitCount: 1, pageIndex: 1, pagination: { pages: ['First page.', 'Other page.'], panelPages: [0, 0, 1, 1] } }), /MADE UP/);
  assert.throws(() => storyContent('No label'), /Saved chapter pages/);
  assert.throws(() => storyContent('', { preview: true, kitCount: -1 }), /count/);
  assert.match(previewPages(moves[0], { kitCount: 3 })['story.html'], /Chapter 4/);
});
test('all fourteen current rhymes preserve approval separately from edit history', () => {
  const rhymes = readJSON(new URL('../content/rhymes-draft.json', import.meta.url));
  assert.equal(rhymes.length, 14);
  assert.deepEqual(rhymes.map(r => r.moveId).sort(), moves.map(m => m.id).sort());
  for (const rhyme of rhymes) {
    assert.equal(rhyme.approval.status, rhyme.moveId === 'name-it-exactly' ? 'approved' : 'pending');
    assert.equal(rhyme.lines.length, 2);
    assert.ok(!Object.keys(rhyme).some(key => /Original|Before|WrittenByCodex|draftStatus/.test(key)));
    assert.ok(rhyme.lines.every(line => typeof line === 'string' && line.trim()));
    const text = rhyme.lines.join(' ');
    assert.ok(words(text).length <= 10);
    assert.doesNotMatch(text, /\b(food|eat|eating|meal|snack|hungry|weight|diet)\b/i);
    assert.doesNotMatch(text, /go(?:es)? away|feel better|no more|all gone|worries vanish/i);
  }
});
test('cost math includes text, image, output and cached tokens without guesses', () => {
  assert.equal(calculateCost('claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 100 }).usd, 0.00701);
  assert.equal(calculateCost('gpt-image-2.5-flare', { input_tokens: 300, output_tokens: 1000, input_tokens_details: { text_tokens: 100, image_tokens: 200 } }).usd, 0.0321);
  assert.equal(calculateCost('gpt-6-luna', { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 500 } }).usd, 0.000105);
  assert.equal(calculateCost('gpt-image-2.5-flare', { input_tokens: 300, output_tokens: 1000 }).usd, null);
  assert.equal(calculateCost('missing', {}).usd, null);
});
