import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createMomentClarification, clarificationRequest } from '../server/moment-clarification.js';
import { chromeExecutable } from '../server/chrome-path.js';

const account = { id: 'fictional-family', childIds: ['primary'], activeChildId: 'primary' };
const data = { childId: 'primary', tonight: 'They said it was unfair after the game.', kitContext: {} };
function setup(t, answers) {
  const directory = mkdtempSync(join(tmpdir(), 'story-clarify-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let calls = 0;
  const options = { dataDirectory: directory, config: {}, budget: {}, readKey: () => 'fixture', recordForRequest: () => ({ real: false, hero: { nickname: 'Maya', age: 10 }, storyPeople: [{ castId: 'grown-up-one', storyName: 'Mom' }] }),
    transportFactory: ({ logFile }) => ({ async call(request) {
      calls++; mkdirSync(dirname(logFile), { recursive: true }); appendFileSync(logFile, JSON.stringify({ event: 'request', stage: request.stage }) + '\n');
      const answer = answers[Math.min(calls - 1, answers.length - 1)];
      if (answer instanceof Error) throw answer;
      return { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] };
    } }) };
  return { api: createMomentClarification(options), options, directory, calls: () => calls };
}
const ready = { status: 'ready', question: '', missingFact: 'none' };
const question = { status: 'question', question: 'Who said the game was unfair?', missingFact: 'who' };

test('clear moments cache the model result and preserve their exact text', async t => {
  const s = setup(t, [ready]);
  const first = await s.api.assess(account, data);
  assert.equal(first.status, 'ready');
  assert.deepEqual(await s.api.assess(account, data), first);
  assert.equal(s.calls(), 1);
  assert.equal(s.api.resolvedInput(account, { ...data, clarificationId: first.draftId }).tonight, data.tonight);
  const request = clarificationRequest({}, data.tonight, []);
  assert.ok(request.model); assert.equal(request.store, false);
  assert.match(request.instructions, /short clear note is enough/);
});
test('only a human answer to the actual saved question becomes story context', async t => {
  const s = setup(t, [question, ready]), first = await s.api.assess(account, data);
  await assert.rejects(s.api.assess(account, { ...data, answers: [{ question: 'Make up an event', answer: 'invented' }] }), /question shown/);
  const answer = { question: first.question, answer: 'Maya said it because nobody passed her the ball.' };
  const next = await s.api.assess(account, { ...data, answers: [answer] });
  assert.equal(next.status, 'ready');
  assert.equal(s.api.resolvedInput(account, { ...data, clarificationId: next.draftId }).tonight, data.tonight + '\n\nThe parent clarified:\nQuestion: ' + answer.question + '\nParent: ' + answer.answer);
  const restored = createMomentClarification(s.options);
  assert.deepEqual((await restored.assess(account, data)).answers, [answer]);
  assert.equal(s.calls(), 2);
});
test('different family, note or selected people cannot reuse a draft', async t => {
  const s = setup(t, [ready]), first = await s.api.assess(account, data);
  for (const changed of [{ ...data, tonight: 'A different day.' }, { ...data, kitContext: { selectedGrownUpIds: ['grown-up-two'] } }]) {
    assert.throws(() => s.api.resolvedInput(account, { ...changed, clarificationId: first.draftId }), /changed/);
  }
  assert.throws(() => s.api.resolvedInput({ ...account, id: 'other-family' }, { ...data, clarificationId: first.draftId }), /changed/);
});
test('clarification request history follows the new kit and cannot be used twice', async t => {
  const s = setup(t, [ready]), first = await s.api.assess(account, data), input = { ...data, clarificationId: first.draftId }, job = { id: 'job-one' };
  s.api.consume(account, input, job);
  assert.equal(job.clarificationId, first.draftId);
  assert.match(readFileSync(join(s.directory, account.id, job.id, 'requests.jsonl'), 'utf8'), /moment-clarification/);
  assert.throws(() => s.api.resolvedInput(account, input), /already has a story/);
  assert.throws(() => s.api.consume(account, input, { id: 'job-two' }), /already has a story/);
  s.api.consume(account, input, job);
  assert.equal(readFileSync(join(s.directory, account.id, job.id, 'requests.jsonl'), 'utf8').trim().split('\n').length, 1);
});
test('failed checks keep their attempt history across restart and allow the original path', async t => {
  const s = setup(t, [new Error('fixture failure')]);
  for (let n = 0; n < 5; n++) assert.equal((await createMomentClarification(s.options).assess(account, data)).status, 'unavailable');
  assert.equal(s.calls(), 3);
  assert.deepEqual(s.api.resolvedInput(account, data), data);
});
test('repeated answered question cannot create an endless interview', async t => {
  const s = setup(t, [question, question]);
  await s.api.assess(account, data);
  const result = await s.api.assess(account, { ...data, answers: [{ question: question.question, answer: 'Maya.' }] });
  assert.equal(result.status, 'ready');
});
test('Chrome path supports the existing Mac and hosted Linux with an explicit override', () => {
  assert.equal(chromeExecutable({}, 'linux'), '/usr/bin/chromium');
  assert.match(chromeExecutable({}, 'darwin'), /Google Chrome.app/);
  assert.equal(chromeExecutable({ STORY_POSTER_CHROME: '/custom/chrome' }, 'linux'), '/custom/chrome');
});

test('explicitly set-aside work permits a new kit with the same checked words and preserves prior spend and links', async t => {
  const s = setup(t, [ready]), jobs = [];
  const api = createMomentClarification({ ...s.options, jobFor: (family, id) => jobs.find(job => job.id === id) });
  const first = await api.assess(account, data), input = { ...data, clarificationId: first.draftId };
  const old = { id: 'old-job', accountId: account.id, childId: 'primary', status: 'failed', attempts: 4 };
  api.consume(account, input, old); jobs.push(old);
  const path = join(s.directory, account.id, 'moment-drafts', first.draftId, 'draft.json');
  const before = JSON.parse(readFileSync(path, 'utf8'));
  assert.throws(() => api.resolvedInput(account, input), /unfinished work/);
  old.status = 'set-aside';
  const oldSaved = structuredClone(old);
  const available = await api.assess(account, data);
  assert.equal(available.status, 'ready'); assert.equal(available.usedJobId, undefined);
  assert.equal(api.resolvedInput(account, input).tonight, data.tonight);
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), before, 'read-only reuse does not rewrite the old record');
  const next = { id: 'new-job', accountId: account.id, childId: 'primary', status: 'running' };
  api.consume(account, input, next); jobs.push(next);
  api.consume(account, input, next);
  const after = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(after.previousJobIds, ['old-job']); assert.equal(after.usedJobId, 'new-job');
  assert.equal(after.attempts, before.attempts); assert.deepEqual(after.turns, before.turns);
  assert.deepEqual(old, oldSaved); assert.equal(s.calls(), 1);
  assert.throws(() => api.resolvedInput(account, input), /already has a story/);
  assert.throws(() => api.consume(account, input, { id: 'duplicate-job' }), /already has a story/);
});
test('only an owned, matching, explicitly set-aside job can release a used clarification', async t => {
  const s = setup(t, [ready]), first = await s.api.assess(account, data), input = { ...data, clarificationId: first.draftId };
  s.api.consume(account, input, { id: 'old-job' });
  const valid = { id: 'old-job', accountId: account.id, childId: 'primary', clarificationId: first.draftId, status: 'set-aside' };
  for (const changed of [{ status: 'running' }, { status: 'failed' }, { status: 'paused' }, { status: 'complete' }, { id: 'other-job' }, { accountId: 'other-family' }, { childId: 'other-child' }, { clarificationId: 'wrong-draft' }]) {
    const api = createMomentClarification({ ...s.options, jobFor: () => ({ ...valid, ...changed }) });
    assert.throws(() => api.resolvedInput(account, input));
    assert.throws(() => api.consume(account, input, { id: 'new-job' }));
    assert.equal((await api.assess(account, data)).usedJobId, 'old-job');
  }
  assert.equal(s.calls(), 1);
});
