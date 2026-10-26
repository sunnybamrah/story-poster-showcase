import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scout, preparePick, eligibleMoves } from '../server/picker.js';
import { parentResponse } from '../server/route.js';
import { createApp } from '../server/app-server.mjs';
import { writeStory } from '../server/story.js';
import { family } from './fixture.mjs';

// Exact notes from the memo's explicitly fictional parent tests.
const theo = 'Theo had a bad day. He was upset because he did not get another book from the library, because he forgot to return his old book.';
const lila = 'Lila had her sex education class today in 5th grade and she is comfortable.';
const planning = [theo,
  'He could not borrow a new library book because he forgot the old one at home.',
  'She keeps forgetting her lunchbox at home.',
  'He forgot to bring his permission slip. He wants to remember tomorrow.',
  'They want to remember to pack their school bag tonight.',
  'She left her library book on the kitchen counter again.',
  'A return reminder would help him remember his library book.',
  'She is comfortable and wants to remember to bring her permission slip.',
  'He did not remember to return his library book.',
  'Her library book was forgotten at home again.',
];
for (const note of planning) test(`practical remembering offers the supplied planning framework: ${note}`, () => {
  const result = scout(note);
  assert.equal(result.suggestions[0]?.moveId, 'snag-plan');
  assert.match(result.suggestions[0].reason, /may fit/);
  assert.match(result.suggestions[0].reason, /homework as an example/);
  assert.match(result.suggestions[0].reason, /did not test forgotten books/);
});

for (const note of [
  'Homework felt frustrating.',
  'Her homework feels difficult tonight.',
  'The schoolwork was hard.',
  'He was frustrated with his homework.',
  'She is struggling with the assignment.',
]) test(`homework difficulty has clear local support: ${note}`, () => {
  const result = scout(note);
  assert.equal(result.suggestions[0]?.moveId, 'name-it-exactly');
  assert.ok(result.suggestions.every(item => ['name-it-exactly', 'bring-in-my-person', 'long-breath-out'].includes(item.moveId)));
});

const unsupported = [lila, 'A purple comet.',
  'She is comfortable and curious about her science test tomorrow.',
  'He is happy after losing a game and wants to tell us about it.',
  'She is excited for her recital and proud of her trophy.',
  'They talked happily with a friend who said something about the performance.',
  'He is not nervous about the recital. He is comfortable and curious.',
  'She was not distracted during homework night.',
  'He did not forget his library book and wants to talk about the story.',
  'In the story a character said she was nervous before a recital.',
  'We read a book about a character who forgot to return his library book.',
  'Dad forgot to return her library book.',
  'The teacher forgot to bring the permission slip.',
  'I forgot to pack his lunchbox.',
  'He wants to remember to return a book, but his brother hid it.',
  'Her library book was stolen and she needs a return reminder.',
  'She lost her permission slip and cannot find it.',
  'The library book was not forgotten. She remembered it and was comfortable.',
  'The library book was never forgotten at home.',
  'The permission slip was not left at home.',
  'The library book was forgotten by Dad, not the child.',
  'Her permission slip was left at home by her teacher.',
  'Dad was the one who forgot to return the library book.',
  'She does not need a reminder for her library book.',
  'The class had a reminder about library hours.',
  'She is comfortable when plans change and is curious about tomorrow.',
  'He asked what if we visit the museum and was excited.',
  'She enjoyed playing without him and was happy.',
  'Homework felt comfortable and she was curious about the next part.',
  'Homework was not frustrating. She enjoyed it.',
  'She was not frustrated with her homework.',
  'She is not struggling with the assignment.',
  'The schoolwork was not difficult.',
];
for (const note of unsupported) test(`unsupported or denied goals stay a real no-match: ${note}`, () => {
  const helpfulHistory = { pastKits: [{ moveId: 'name-it-exactly', triedMove: 'yes', didItHelp: 'yes' }] };
  for (const record of [{ pastKits: [] }, helpfulHistory]) {
    const result = scout(note, record, { allowRepeat: true });
    assert.equal(result.status, 'noMatch'); assert.deepEqual(result.suggestions, []); assert.equal(result.canRepeat, false);
    assert.doesNotMatch(result.message, /sad|upset|scared|angry/);
  }
});

test('history informs the choice without a repeat gate, and rejected actions stay out of automatic selection', () => {
  const record = { pastKits: [{ moveId: 'snag-plan', triedMove: 'yes', didItHelp: 'a little' }] };
  const next = preparePick(record, theo); assert.equal(next.status, 'eligible');
  assert.ok(next.eligible.some(item => item.move.id === 'snag-plan' && item.repeated));
  record.pastKits.push({ moveId: 'snag-plan', triedMove: 'yes', didItHelp: 'not for us' });
  assert.ok(!preparePick(record, theo).eligible.some(item => item.move.id === 'snag-plan'));
  assert.equal(preparePick(record, theo, { chosenMoveId: 'snag-plan' }).eligible[0].move.id, 'snag-plan');
  assert.equal(eligibleMoves({ pastKits: [] }, theo)[0].move.id, 'snag-plan');
});

test('a hard task elsewhere in the note does not turn a positive event into a different problem', () => {
  const ids = eligibleMoves({ pastKits: [] }, 'She is proud of her trophy. Her homework felt hard.').map(item => item.move.id);
  assert.ok(ids.length); assert.ok(!ids.includes('compare-with-past-me')); assert.ok(!ids.includes('coach-voice'));
});

test('source-owned protective responses always run before the planning picker', () => {
  for (const note of [
    'He forgot his library book. Older children hit him every day on the bus.',
    'She wants a permission slip reminder. Her dog died today.',
    'He forgot his school bag. Just listen tonight.',
    'I yelled at my child because she forgot her lunchbox.',
    'He forgot his library book. My child said he wanted to die.',
  ]) assert.deepEqual(preparePick({ pastKits: [] }, note), parentResponse(note), note);
});

test('a note without matched keywords reaches the existing writer with the source bank', async () => {
  let calls = 0;
  await assert.rejects(writeStory({ call: async () => { calls++; throw Error('Fixture writer reached'); }, assertFamilyAllowed: () => {} }, { ...family, real: false }, lila, { kit: 'offline-no-keyword' }), /Fixture writer reached/);
  assert.equal(calls, 1);
});

test('HTTP quick pick and forged kit choices keep no-match free, private and child-bound', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'story-fit-'));
  let keys = 0, runs = 0;
  const app = createApp({ dataDirectory: directory, sample: null, sampleOnly: false,
    keyReader: () => { keys++; throw Error('No key lookup allowed.'); }, runKit: async () => { runs++; throw Error('No generation allowed.'); } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}/api/`;
  const request = async (path, data, cookie) => {
    const response = await fetch(base + path, { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const madeUpFamily = { real: false, nickname: 'Pip', age: 10, pronouns: 'they/them', loves: ['books', 'space', 'games'], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] };
  assert.equal((await request('quick-pick', { tonight: lila })).data.status, 'eligible');
  const owner = await request('signup', { username: 'fit_family', password: 'fictional-password', family: madeUpFamily });
  assert.equal(owner.status, 200);
  const picked = await request('pick', { tonight: lila, childId: 'primary' }, owner.cookie);
  assert.equal(picked.data.status, 'eligible'); assert.ok(picked.data.suggestions.length);
  for (const moveId of ['missing-guide', '']) {
    const forged = await request('jobs', { tonight: lila, childId: 'primary', moveId, allowRepeat: true }, owner.cookie);
    assert.ok([200, 400].includes(forged.status)); if (forged.status === 200) assert.equal(forged.data.status, 'noMatch');
  }
  const plan = await request('pick', { tonight: theo, childId: 'primary' }, owner.cookie);
  assert.equal(plan.data.suggestions[0].id, 'snag-plan');
  const sibling = await request('children', { family: { ...madeUpFamily, nickname: 'Lumi' } }, owner.cookie);
  assert.notEqual(sibling.data.childId, 'primary');
  assert.equal((await request('pick', { tonight: theo, childId: 'primary' }, owner.cookie)).status, 400);
  const current = await request('session', undefined, owner.cookie);
  assert.deepEqual(current.data.jobs, []); assert.deepEqual(current.data.record.pastKits, []);
  assert.equal(JSON.stringify(current.data).includes(theo), false); assert.equal(keys, 0); assert.equal(runs, 0);
});
