import { sourceReaderLimitation, guideReaderLimitation } from '../app/reader-notes.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { moves, root, readJSON, saveJSON } from '../server/files.js';
import { route, parentResponse } from '../server/route.js';
import { eligibleMoves, preparePick } from '../server/picker.js';
import { positiveActionFor, posterBoxes, posterWordReport } from '../server/format.js';
import { buildPosterRequest, buildStoryRequest, buildStoryCheckRequest } from '../server/requests.js';
import { STORY_SCIENCE_RULES } from '../server/story-rules.js';
import { validateStory, writeStory } from '../server/story.js';
import { previewPages, visibleText } from '../server/layout.js';
import { advanceJobStage, kitWaitEstimate } from '../server/job-progress.js';
import { createApp } from '../server/app-server.mjs';
import { appJobClient, waitAppJob } from './app-job-client.mjs';
import { setupRecord } from '../server/app-data.js';
import { createMemory } from '../server/memory.js';
import { withKitEvidence } from '../server/kit-evidence.js';
import { offlineTransport, textAnswer } from './offline-kit-fixture.mjs';
import { kitText } from './kit-text-fixture.mjs';
const out = join(root, 'context/pass36-tests'); mkdirSync(out, { recursive: true });
const temp = () => mkdtempSync(join(out, 'case-'));
const family = (nickname = 'Pip') => ({ real: false, nickname, age: 10, pronouns: 'they/them', loves: ['comics', 'space', 'puzzles'], presetId: 'comet', familyContext: '', parents: [{ label: 'Nana', pronouns: 'she/her', hair: 'short grey hair' }] });
const ids = text => eligibleMoves({ pastKits: [] }, text).map(item => item.move.id);
async function start(t, options = {}) {
  const directory = options.dataDirectory ?? temp(); let keys = 0;
  const app = createApp({ dataDirectory: directory, sample: null, sampleOnly: false, keyReader: () => { keys++; return 'offline-key'; }, transportFactory: () => ({ call() { assert.fail('No provider calls in this test'); } }), ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  return { ...app, directory, request: appJobClient(`http://127.0.0.1:${app.server.address().port}`), keys: () => keys };
}
const signup = (request, nickname = 'Pip') => request('signup', { username: 'fictional_family', password: 'fictional-password', family: family(nickname) });
const wait = (request, id) => waitAppJob(request, id, { interval: 10, maxPolls: 500 });

test('danger paraphrases stop before everyday fear matching, without blocking ordinary sibling fights', () => {
  for (const text of [
    'An older child has been threatening Jordan every day and today shoved them against a locker. Jordan is safe at home with us now but is scared to go back to school tomorrow.',
    'An older child makes daily threats and shoved Jordan into a locker. They are safe at home but afraid of tomorrow.',
    'There are threats every day at school. My child is afraid to go back.',
    'They are being threatened tomorrow.',
    'A child pushed mine against a wall by the lockers.',
    'An older kid keeps shoving them every day.',
    'My child has been bullied at school and is safe at home.',
    'My child wants to kill herself.', 'There is a weapon at school.',
  ]) assert.notEqual(route(text), 'move', text);
  assert.equal(route('There are daily threats at school.'), 'stop');
  for (const text of ['Jordan shoved their brother after he broke the robot.', 'He hit his sister.', 'My child is nervous about a maths test tomorrow.']) assert.equal(route(text), 'move', text);
});

test('roles and task matter: self criticism, target, bystander, test nerves and sibling fight', () => {
  for (const text of ['Eli called himself stupid after struggling with reading.', 'She says she is stupid when reading is hard.', 'Eli says he is stupid and cannot stop thinking about it.', "I am stupid, my child said after homework."]) {
    assert.equal(ids(text)[0], 'bring-in-my-person', text); assert.ok(!ids(text).includes('coach-voice'));
  }
  for (const text of ['Nia was left out of a group chat by her friends.', 'They excluded my child from the group chat.', 'The chat was about her.']) assert.ok(!ids(text).includes('dont-feed-the-fire'), text);
  assert.equal(ids('She saw a group chat piling on another child.')[0], 'dont-feed-the-fire');
  for (const text of ['Jordan is worried about a maths test and cannot sleep.', 'A nervous child has a math test tomorrow.']) assert.equal(ids(text)[0], 'long-breath-out', text);
  for (const text of ['Jordan shoved their brother after he broke a robot.', 'My child pushed their sister after an argument.']) { assert.equal(ids(text)[0], 'cool-off-break'); assert.ok(!ids(text).includes('make-it-right')); }
  const unknown = preparePick({ pastKits: [] }, 'A purple comet.');
  assert.equal(unknown.status, 'eligible');
  assert.deepEqual(new Set(unknown.eligible.filter(item => !item.move.library).map(item => item.move.id)), new Set(moves.filter(move => !move.library).map(move => move.id)));
});

test('local first response works without setup, links serious-harm help, and never reads a key', async t => {
  const app = await start(t);
  for (const tonight of ['Eli called himself stupid after reading.', 'Daily threats at school, but my child is home now.', 'My child is being bullied.', 'I snapped at my child.']) {
    const reply = await app.request('quick-pick', { tonight }); assert.equal(reply.status, 200);
    if (/threats|bullied/.test(tonight)) { assert.equal(reply.data.status, 'parentResponse'); assert.match(reply.data.guidance.lines.join(' '), /safe with you now/); assert.match(reply.data.guidance.lines.join(' '), /teacher, school counselor or principal/); assert.equal(reply.data.guidance.reviewLabel, "FOR SUNNY'S READ"); assert.ok(reply.data.guidance.resources.every(item => new URL(item.url).hostname === 'www.stopbullying.gov')); }
  }
  assert.equal((await app.request('jobs', { tonight: 'Homework felt hard.', moveId: 'name-it-exactly' })).status, 401);
  assert.equal(app.keys(), 0); assert.deepEqual(readJSON(join(app.directory, 'accounts.json')).jobs, []);
  assert.equal((await app.request('session')).data.record, null);
  await signup(app.request);
  const prepared = await app.request('pick', { tonight: 'Still fuming and replaying a fight with a friend.', requestedMoveId: 'coach-voice' });
  assert.equal(prepared.data.suggestions[0].id, 'coach-voice');
  assert.match(prepared.data.suggestions[0].practiceScript, /Why did Pip feel/);
  assert.doesNotMatch(prepared.data.suggestions[0].practiceScript, /\[name\]/);
  assert.equal(app.keys(), 0);
});

test('own-name examples lose their sample identity on every presentation, without changing records or practice', () => {
  const move = moves.find(move => move.id === 'coach-voice'), before = structuredClone(move), record = setupRecord(family('Nova'));
  for (const sampleName of ['Sam', 'Alex', 'Renée']) {
    const other = { ...move, positiveAction: `Use your name: '${sampleName}, that was hard. Try the first question.'` };
    assert.equal(positiveActionFor(other), "Use your name: 'That was hard. Try the first question.'");
    assert.equal(posterBoxes(other).find(box => box.id === 'tiny').text, positiveActionFor(other));
  }
  const request = buildPosterRequest(record, move, '', kitText(move, { nickname: 'Nova' }));
  assert.doesNotMatch(JSON.stringify(request), /\bSam\b|\bNova\b/);
  const writer = JSON.parse(buildStoryRequest(record, 'Homework felt hard.', { lockedMoveId: move.id }).input[0].content);
  assert.equal(writer.moves[0].positiveAction, positiveActionFor(move)); assert.equal(writer.moves[0].practiceScript, move.practiceScript);
  assert.deepEqual(move, before); assert.equal(posterWordReport(move, kitText(move)).reportOnly, true);
});

test('detached methods become prose notes while modest science and parent research notes stay intact', () => {
  const record = setupRecord(family()), move = moves[0];
  for (const lecture of ['In a study, eighty-nine college students used their own names.', 'A review of adult studies found that naming sometimes helped.', 'The participants aged eight to thirteen had a task.', 'This meta-analysis had a sample size.', 'Children ages 8 to 13 were not tested here.']) {
    const text = kitText(move); text.story += '\n' + lecture;
    const before = text.story, checked = validateStory(text, { rejectResearchLecture: true });
    assert.ok(checked.reviewFlags.some(flag => flag.key === 'narrativeEssay'), lecture);
    assert.equal(text.story, before);
    // Existing bought stories remain evidence, not silently rewritten.
    assert.doesNotThrow(() => validateStory(text));
  }
  const text = kitText(move); text.story += '\n"For adults, naming feelings sometimes eased the upset. We do not know if it will help here," said Nana.';
  assert.doesNotThrow(() => validateStory(text, { rejectResearchLecture: true }));
  for (const request of [buildStoryRequest(record, 'Homework felt hard.'), buildStoryCheckRequest(text, move, { record })]) {
    assert.ok(request.instructions.includes(STORY_SCIENCE_RULES)); assert.match(request.instructions, /parent notes/); assert.equal(request.store, false);
  }
  assert.match(buildStoryRequest(record, 'Homework felt hard.').instructions, /supplied people, names and pronouns/);
  const notes = visibleText(previewPages(move)['for-you.html'].split('<aside class="parent-notes">')[1]);
  assert.ok(notes.includes(guideReaderLimitation(move.id, move.science.limitation)));
});


test('a fresh lecture remains saved with its prose note and buys no rewrite', async t => {
  const directory = temp(), good = kitText(), bad = { ...good, story: good.story + '\nA review of adult studies found that naming sometimes eased upset.' };
  const transport = offlineTransport(t, directory, request => {
    assert.ok(request.body.instructions.includes(STORY_SCIENCE_RULES));
    return textAnswer(bad);
  });
  const record = setupRecord(family());
  const result = await writeStory(withKitEvidence(transport, directory), record, 'Homework felt hard.');
  assert.equal(result.story, bad.story); assert.equal(transport.calls.length, 1);
  assert.ok(result.reviewFlags.some(flag => flag.key === 'narrativeEssay'));
  assert.equal(readJSON(join(directory, 'story-attempt-1.json')).story, bad.story);
  assert.equal(existsSync(join(directory, 'story-attempt-2.json')), false);
  assert.match(readFileSync(join(directory, 'kit-log.md'), 'utf8'), /narrativeEssay/);
});

test('long titles and identities keep complete words and wrapping constraints on both chapter pages', () => {
  const title = 'A Long Chapter Heading About A Very Difficult Afternoon';
  const pages = previewPages(moves[0], { nickname: 'A Rather Long Fictional Nickname' });
  for (const name of ['story.html', 'story-2.html']) {
    const html = pages[name].replace('Chapter title pending', title);
    assert.ok(visibleText(html).includes(title));
    assert.match(html, /\.page-heading \.identity\{font-size:10pt;white-space:normal;overflow-wrap:anywhere;max-width:35%;text-align:right;flex:none\}/);
    assert.match(html, /\.page-heading h1\{flex:1;max-width:100%\}/);
    assert.doesNotMatch(html, /text-overflow:ellipsis/);
  }
});

test('progress never retreats when picture checks, retries and text repairs are interleaved', () => {
  let stage = 'writing'; const seen = [];
  for (const internal of ['preflight', 'story', 'story-check', 'layout-fit', 'picture-preflight', 'hero-check', 'poster-word-check', 'panel-1', 'panel-1-word-check', 'story-rewrite', 'panel-2', 'poster-export', 'poster-pdf', 'kit-pdf', 'panel-4-word-check']) { stage = advanceJobStage(stage, internal); seen.push(stage); }
  assert.deepEqual(seen.slice(0, 4), Array(4).fill('writing'));
  assert.ok(seen.slice(4, 11).every(value => value === 'drawing'));
  assert.ok(seen.slice(11).every(value => value === 'checking'));
  assert.equal(advanceJobStage('checking', 'preflight'), 'checking');
  assert.match(kitWaitEstimate, /work is saved.*close.*return/);
  assert.doesNotMatch(kitWaitEstimate, /\d+\s*minutes|percent|%/);
});

for (const reviewPeriod of [false, true]) test('one login keeps child memory, chapters, feedback and background completion separate ' + (reviewPeriod ? 'during unlimited review' : 'before review'), async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(reviewPeriod ? '2026-10-25T16:00:00Z' : '2026-10-20T16:00:00Z') });
  let release, entered; const gate = new Promise(resolve => { release = resolve; }); const started = new Promise(resolve => { entered = resolve; });
  let runs = 0;
  const app = await start(t, { runKit: async (transport, memory, tonight, options) => {
    const record = memory.exportRecord(); runs++;
    if (runs === 1) { entered(); await gate; }
    for (const stage of ['story', 'story-check', 'picture-preflight', 'panel-1-word-check', 'panel-2', 'poster-export']) transport.onStage(stage);
    // Synthetic exports: this tests ownership/persistence, not fresh rendering.
    mkdirSync(options.directory, { recursive: true });
    for (const [target, fixture] of [['poster.png', 'offline-export.png'], ['poster.pdf', 'offline-poster.pdf'], ['kit_final.pdf', 'offline-kit.pdf']]) copyFileSync(new URL('./fixtures/' + fixture, import.meta.url), join(options.directory, target));
    if (!record.hero.heroPicturePath) memory.setHeroPicture(join(options.directory, 'poster.png'));
    else {
      assert.throws(() => memory.setHeroPicture(join(options.directory, 'poster.png')), /chosen drawing changed/, 'A later kit cannot replace its saved reference.');
      assert.equal(memory.exportRecord().hero.heroPicturePath, record.hero.heroPicturePath);
    }
    const move = moves.find(item => item.id === options.chosenMoveId);
    return { ...kitText(move, { nickname: record.hero.nickname }), recordAtStart: record, complete: true, move, world: 'comic strip', colourSet: 'warm' };
  } });
  const first = await signup(app.request); assert.equal(first.data.childId, 'primary');
  const a = await app.request('jobs', { tonight: 'Homework felt hard.', moveId: 'name-it-exactly', childId: 'primary' }); assert.equal(a.status, 202); await started;
  const second = await app.request('children', { family: family('Nova') }); assert.equal(second.status, 200); const secondId = second.data.childId;
  assert.equal(second.data.otherRunningChild.id, 'primary');
  assert.equal(second.data.children.length, 2); assert.deepEqual(second.data.jobs, []); assert.deepEqual(second.data.record.pastKits, []);
  assert.equal((await app.request('jobs', { tonight: 'Homework felt hard.', moveId: 'name-it-exactly', childId: 'primary' })).status, 400);
  release(); assert.equal((await wait(app.request, a.data.id)).result.nickname, 'Pip');
  assert.deepEqual((await app.request('session')).data.record.pastKits, []);
  const b = await app.request('jobs', { tonight: 'Homework felt hard.', moveId: 'name-it-exactly', childId: secondId }); assert.equal(b.status, 202); assert.equal(b.data.chapterNumber, 1);
  const completed = await wait(app.request, b.data.id); assert.equal(completed.result.nickname, 'Nova');
  await app.request('jobs/' + a.data.id + '/feedback', { triedMove: 'yes', didItHelp: 'yes', wallChoice: 'Keep it off the wall' });
  assert.equal((await app.request('session')).data.record.pastKits[0].didItHelp, 'unanswered');
  const switched = await app.request('children/current', { childId: 'primary' }, { method: 'PATCH' });
  assert.equal(switched.data.record.pastKits[0].didItHelp, 'yes'); assert.deepEqual(switched.data.jobs.map(item => item.id), [a.data.id]);
  assert.equal((await app.request('children/current', { childId: '../other' }, { method: 'PATCH' })).status, 400);
  const third = await app.request('jobs', { tonight: 'Homework felt hard.', moveId: 'name-it-exactly', childId: 'primary', allowRepeat: true }); assert.equal(third.status, 202); assert.equal((await wait(app.request, third.data.id)).status, 'complete');
  await app.request('children/current', { childId: secondId }, { method: 'PATCH' });
  const fourth = await app.request('jobs', { tonight: 'Homework felt hard.', moveId: 'name-it-exactly', childId: secondId, allowRepeat: true });
  // The ordinary cap spans siblings; the review window lifts it without changing ownership.
  assert.equal(fourth.status, reviewPeriod ? 202 : 429);
  if (reviewPeriod) assert.equal((await wait(app.request, fourth.data.id)).status, 'complete');
  const state = readJSON(join(app.directory, 'accounts.json')), account = state.accounts[0];
  const primaryRecord = readJSON(join(app.directory, account.id, 'family.json')); assert.equal(primaryRecord.hero.nickname, 'Pip'); assert.ok(primaryRecord.hero.heroPicturePath.includes(a.data.id), 'Later stories reuse the first saved reference.');
  const primaryReferences = state.jobs.filter(job => job.childId === 'primary').map(job => job.referenceSnapshot.cast.find(person => person.id === 'child').referencePath);
  assert.deepEqual(primaryReferences, [primaryRecord.hero.heroPicturePath, primaryRecord.hero.heroPicturePath], 'Both primary-child jobs own the same retained reference.');
  const otherRecord = readJSON(join(app.directory, account.id, 'children', secondId, 'family.json')); assert.equal(otherRecord.hero.nickname, 'Nova'); assert.ok(otherRecord.hero.heroPicturePath.includes(b.data.id));
  assert.notEqual(otherRecord.hero.heroPicturePath, primaryRecord.hero.heroPicturePath);
  assert.equal(state.jobs.find(job => job.id === b.data.id).referenceSnapshot.cast.find(person => person.id === 'child').referencePath, otherRecord.hero.heroPicturePath, 'Sibling job keeps its own reference.');
  assert.equal((await app.request('children', { family: { ...family('Real'), real: true } })).status, 400);
  assert.equal((await app.request('session')).data.children.length, 2);
  assert.equal((await app.request('family', {}, { method: 'DELETE' })).status, 200); assert.equal(existsSync(join(app.directory, account.id)), false);
});

test('legacy family file, reference paths and unfinished jobs migrate in place and survive restart', async t => {
  const directory = temp(), accountId = 'legacy-account', jobId = 'a'.repeat(8) + '-aaaa-aaaa-aaaa-' + 'a'.repeat(12);
  const record = setupRecord(family()); record.hero.heroPicturePath = join(directory, 'old-reference.png');
  createMemory(join(directory, accountId, 'family.json')).store(record);
  saveJSON(join(directory, 'accounts.json'), { accounts: [{ id: accountId, username: 'legacy' }], sessions: [], jobs: [{ id: jobId, accountId, status: 'running', stage: 'drawing', moveId: 'name-it-exactly', chapterNumber: 4, createdAt: new Date().toISOString() }] });
  const app = await start(t, { dataDirectory: directory }); const state = readJSON(join(directory, 'accounts.json'));
  assert.deepEqual(state.accounts[0].childIds, ['primary']); assert.equal(state.jobs[0].childId, 'primary'); assert.equal(state.jobs[0].status, 'paused');
  assert.equal(readJSON(join(directory, accountId, 'family.json')).hero.heroPicturePath, record.hero.heroPicturePath);
  assert.equal(app.keys(), 0);
});
