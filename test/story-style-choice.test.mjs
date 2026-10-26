import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/app-server.mjs';
import { readJSON, saveJSON, root } from '../server/files.js';
import { lookFlowVersion, pictureStyleOptions } from '../app/picture-styles.js';

// Entirely fictional, offline replies. No provider call or likeness claim.
async function harness(t, { writeCast = false } = {}) {
  const parent = join(root, 'context/style-tests'); mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(join(parent, 'choice-'));
  let count = 0; const runs = [], state = { accounts: [], sessions: [], jobs: [] }, controls = { failAfter: Infinity };
  const image = async red => sharp({ create: { width: 32, height: 48, channels: 3, background: { r: red, g: 90, b: 130 } } }).png().toBuffer();
  const photo = { mime: 'image/png', base64: (await image(2)).toString('base64') };
  const app = createApp({ stateStore: { initialState: state, assertWritable() {}, save() {}, async flush() {} }, dataDirectory: directory, sample: null, sampleOnly: false, allowSyntheticPortraits: true, keyReader: () => 'fictional-fixture',
    transportFactory: () => ({ call: async () => { count++; if (count > controls.failAfter) return { data: [{ b64_json: Buffer.from('Offline invalid drawing').toString('base64') }] }; return { data: [{ b64_json: (await image(30 + count)).toString('base64') }] }; } }),
    runKit: async (_transport, memory, _tonight, options) => { runs.push(memory.exportRecord()); if (writeCast) memory.setCast(memory.exportRecord().cast); saveJSON(join(options.directory, 'checkpoint.json'), { fixture: true }); throw Error('Offline fixture stops here.'); },
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const request = async (path, body, cookie) => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: response.headers.get('content-type')?.includes('json') ? await response.json() : await response.arrayBuffer() };
  };
  const signup = async username => request('signup', { username, password: 'fictional-test-password', lookFlow: lookFlowVersion, family: { real: false, nickname: 'Robin', age: 10, pronouns: 'they/them', loves: ['maps'], presetId: 'fern', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] } });
  const settle = async (cookie, id, style, childId = 'primary') => {
    for (let n = 0; n < 200; n++) {
      const result = await request('portraits?childId=' + childId + (style ? '&pictureStyleId=' + style : ''), undefined, cookie);
      const person = result.data.people.find(person => person.id === id);
      if (person.job?.status !== 'running') return person;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw Error('Fixture did not settle');
  };
  return { request, signup, settle, photo, runs, state, controls, count: () => count, db: () => readJSON(join(directory, 'accounts.json')), directory };
}
async function setup(h, { legacy = false } = {}) {
  const signed = await h.signup('style-family'), cookie = signed.cookie;
  if (legacy) {
    // A historical outfit with no plain colour stays unchanged by the new outfit helper.
    const path = join(h.directory, signed.data.accountId, 'family.json'), record = readJSON(path);
    record.cast.forEach(person => { person.outfit = ['striped sweater', 'checked trousers']; });
    record.hero.lockedOutfit = ['striped sweater', 'checked trousers']; saveJSON(path, record);
  }
  await h.request('portraits/child', { childId: 'primary', photo: h.photo }, cookie);
  const first = await h.settle(cookie, 'child');
  const selected = await h.request('portraits/child/select', { childId: 'primary', jobId: first.job.id, candidateId: first.candidates[1].id, lookRevision: 0 }, cookie);
  assert.equal(selected.status, 200);
  return { cookie, first, accountId: signed.data.accountId };
}
const select = (h, cookie, person, style) => h.request('portraits/' + person.id + '/select', { childId: 'primary', pictureStyleId: style, jobId: person.job.id, candidateId: (person.candidates.find(candidate => candidate.pictureStyleId === style) ?? person.candidates.at(-1)).id }, cookie);

test('three personal previews survive scoped redraws; a style choice reuses pictures and one selected style draws only its missing person', async t => {
  const h = await harness(t), { cookie, first } = await setup(h);
  const previews = (await h.request('story-looks', undefined, cookie)).data.previews;
  assert.equal(h.count(), 3);
  assert.deepEqual(previews.map(item => item.id), pictureStyleOptions.map(item => item.id));
  assert.ok(previews.every(item => item.url));
  for (const style of pictureStyleOptions) {
    const person = await h.settle(cookie, 'child', style.id);
    assert.equal(person.candidates.length, 3);
    assert.equal((await select(h, cookie, person, style.id)).status, 200);
  }
  assert.equal(h.count(), 3, 'selecting any saved style sends no model call');
  const style = 'diary-doodles';
  const missing = await h.request('jobs', { childId: 'primary', tonight: 'Lost a game and felt upset.', kitContext: { pictureStyleId: style } }, cookie);
  assert.equal(missing.status, 409);
  await h.request('portraits/grown-up-one', { childId: 'primary', pictureStyleId: style, photo: h.photo }, cookie);
  const adult = await h.settle(cookie, 'grown-up-one', style);
  assert.equal(h.count(), 4); assert.equal(adult.candidates.length, 1);
  assert.equal((await select(h, cookie, adult, style)).status, 200);
  const before = await h.settle(cookie, 'child', style);
  const oldBytes = readFileSync(h.db().portraits[0].candidates[2].path);
  await h.request('portraits/child', { childId: 'primary', pictureStyleId: style, photo: h.photo, redraw: true }, cookie);
  const replacement = await h.settle(cookie, 'child', style);
  assert.equal(h.count(), 5); assert.equal(replacement.candidates.length, 1);
  assert.equal(replacement.selectedUrl, before.selectedUrl, 'old choice remains until selected');
  assert.equal((await select(h, cookie, replacement, style)).status, 200);
  assert.deepEqual((await h.request('story-looks', undefined, cookie)).data.previews, previews);
  assert.deepEqual(readFileSync(h.db().portraits[0].candidates[2].path), oldBytes);
  const other = await h.signup('other-family');
  assert.equal((await h.request(previews[0].url.replace('/api/', ''), undefined, other.cookie)).status, 404);
  const foreign = await h.request('portraits/child/select', { childId: 'primary', pictureStyleId: style, jobId: first.job.id, candidateId: first.candidates[2].id }, other.cookie);
  assert.equal(foreign.status, 404);
});

test('a later child compares all three personal looks without changing the first child, family look or saved story', async t => {
  const h = await harness(t), { cookie, first } = await setup(h);
  const oldPreviews = (await h.request('story-looks?childId=primary', undefined, cookie)).data.previews;
  const primaryFile = join(h.directory, h.db().accounts[0].id, 'family.json');
  const primaryBefore = readFileSync(primaryFile), familyStyle = h.state.accounts[0].pictureStyleId;
  const added = await h.request('children', { family: { real: false, nickname: 'Sky', age: 10, pronouns: 'she/her', loves: ['drawing'], presetId: 'fern', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] } }, cookie);
  assert.equal(added.status, 200);
  const childId = added.data.childId;
  assert.notEqual(childId, 'primary');
  const blank = (await h.request('story-looks', undefined, cookie)).data.previews;
  assert.equal(blank.length, 3); assert.ok(blank.every(p => !p.url), 'Never offer the first child as the added child.');
  await h.request('portraits/child', { childId, pictureStyleId: familyStyle, photo: h.photo }, cookie);
  const one = await h.settle(cookie, 'child', familyStyle, childId);
  assert.equal(one.candidates.length, 1);
  assert.equal((await h.request('portraits/child/select', { childId, pictureStyleId: familyStyle, jobId: one.job.id, candidateId: one.candidates[0].id }, cookie)).status, 200);
  const callsBefore = h.count();
  assert.equal((await h.request('portraits/child', { childId, compareStyles: true, pictureStyleId: familyStyle, photo: h.photo }, cookie)).status, 202);
  const three = await h.settle(cookie, 'child', familyStyle, childId);
  assert.equal(three.job.kind, 'style-comparison'); assert.equal(three.candidates.length, 3); assert.equal(three.hasStyleComparison, true);
  assert.equal(h.count(), callsBefore + 3);
  assert.equal(three.selectedUrl, one.candidates[0].url, 'Comparing never changes the current selection.');
  const expectedIds = pictureStyleOptions.map(s => s.id);
  assert.deepEqual(three.candidates.map(c => c.pictureStyleId), expectedIds);
  const previews = (await h.request('story-looks', undefined, cookie)).data.previews;
  assert.ok(previews.every(p => p.url && !oldPreviews.some(old => old.url === p.url)));
  for (const style of pictureStyleOptions) {
    const candidate = three.candidates.find(c => c.pictureStyleId === style.id);
    const childFile = join(h.directory, h.db().accounts[0].id, 'children', childId, 'family.json');
    const castBefore = readJSON(childFile).cast;
    const selected = await h.request('portraits/child/select', { childId, pictureStyleId: style.id, jobId: three.job.id, candidateId: candidate.id }, cookie);
    assert.equal(selected.status, 200); assert.equal(selected.data.people[0].selectedUrl, candidate.url);
    const castAfter = readJSON(childFile).cast;
    if (style.id === familyStyle) {
      assert.equal(castAfter.find(p => p.id === 'child').portraitCandidateId, candidate.id);
      assert.equal(castAfter.find(p => p.id === 'child').referenceStyleId, style.id);
      assert.deepEqual(castAfter.filter(p => p.id !== 'child'), castBefore.filter(p => p.id !== 'child'));
    } else assert.deepEqual(castAfter, castBefore, 'A different-look selection must not replace the default cast.');
  }
  const callsAfter = h.count();
  await h.request('portraits/child', { childId, compareStyles: true, pictureStyleId: familyStyle, photo: h.photo }, cookie);
  assert.equal(h.count(), callsAfter, 'The same complete comparison is reused.');
  assert.equal(h.state.accounts[0].pictureStyleId, familyStyle);
  assert.deepEqual(readFileSync(primaryFile), primaryBefore);
  assert.deepEqual((await h.request('story-looks?childId=primary', undefined, cookie)).data.previews, oldPreviews);
  assert.equal((await h.request('portraits/child/select', { childId, pictureStyleId: familyStyle, jobId: first.job.id, candidateId: first.candidates[1].id }, cookie)).status, 404);
  assert.equal((await h.request('portraits/child', { childId, compareStyles: true, redraw: true, photo: h.photo }, cookie)).status, 400);
  const stranger = await h.signup('unrelated-family');
  assert.equal((await h.request('story-looks?childId=' + childId, undefined, stranger.cookie)).status, 400);
});

test('an exhausted later-person comparison resumes only as a comparison and carries accepted drawings', async t => {
  const h = await harness(t), { cookie } = await setup(h);
  h.controls.failAfter = h.count() + 2;
  await h.request('portraits/grown-up-one', { childId: 'primary', compareStyles: true, photo: h.photo }, cookie);
  const firstStop = await h.settle(cookie, 'grown-up-one');
  assert.equal(firstStop.job.canRestart, false, 'The first failed slot still has its original second attempt.');
  await h.request('portraits/grown-up-one', { childId: 'primary', compareStyles: true, photo: h.photo }, cookie);
  const partial = await h.settle(cookie, 'grown-up-one');
  assert.equal(partial.job.kind, 'style-comparison'); assert.equal(partial.job.canRestart, true); assert.equal(partial.candidates.length, 2);
  const before = h.count();
  assert.equal((await h.request('portraits/grown-up-one', { childId: 'primary', photo: h.photo, restartJobId: partial.job.id }, cookie)).status, 409);
  assert.equal(h.count(), before, 'Wrong-kind restart sends no drawing request.');
  h.controls.failAfter = Infinity;
  assert.equal((await h.request('portraits/grown-up-one', { childId: 'primary', photo: h.photo, compareStyles: true, restartJobId: partial.job.id }, cookie)).status, 202);
  const complete = await h.settle(cookie, 'grown-up-one');
  assert.equal(complete.job.status, 'complete'); assert.equal(complete.candidates.length, 3);
  assert.deepEqual(complete.candidates.slice(0, 2).map(c => c.url), partial.candidates.map(c => c.url).map(url => url.replace(partial.job.id, complete.job.id)));
  assert.deepEqual(complete.candidates.slice(0, 2).map(c => c.id), partial.candidates.map(c => c.id));
  assert.equal(h.count(), before + 1);
  const old = h.db().portraits.find(p => p.id === partial.job.id);
  assert.equal(old.candidates.length, 2); assert.ok(old.requestCount >= 4);
});

for (const legacy of [false, true]) test((legacy ? 'older unfinished jobs keep their original style and references' : 'one new story uses its chosen style') + ' through replacement and Resume', async t => {
  const h = await harness(t, { writeCast: true }), { cookie } = await setup(h, { legacy }), style = legacy ? 'adventure-comic' : 'friendly-anime';
  assert.equal((await select(h, cookie, await h.settle(cookie, 'child', style), style)).status, 200);
  await h.request('portraits/grown-up-one', { childId: 'primary', pictureStyleId: style, photo: h.photo }, cookie);
  assert.equal((await select(h, cookie, await h.settle(cookie, 'grown-up-one', style), style)).status, 200);
  const masterBefore = readJSON(join(h.directory, h.db().accounts[0].id, 'family.json'));
  const made = await h.request('jobs', { childId: 'primary', tonight: 'Lost a game and felt upset.', kitContext: legacy ? {} : { pictureStyleId: style } }, cookie);
  assert.equal(made.status, 202, JSON.stringify(made.data));
  for (let n = 0; n < 100 && !h.runs.length; n++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.db().jobs.length, 1); assert.equal(h.runs[0].pictureStyleId, style);
  assert.ok(h.runs[0].cast.every(person => person.referenceStyleId === style));
  assert.deepEqual(readJSON(join(h.directory, h.db().accounts[0].id, 'family.json')).cast, masterBefore.cast, 'Kit writes leave the chosen family cast and outfits alone.');
  const frozen = structuredClone(h.db().jobs[0].referenceSnapshot);
  if (legacy) delete h.state.jobs[0].referenceSnapshot;
  await h.request('portraits/child', { childId: 'primary', pictureStyleId: style, photo: h.photo, redraw: true }, cookie);
  const replacement = await h.settle(cookie, 'child', style);
  assert.equal((await select(h, cookie, replacement, style)).status, 200);
  const saved = h.state.jobs[0].referenceSnapshot;
  saved.cast = saved.cast.map(person => Object.fromEntries(Object.entries(person).reverse()));
  h.state.jobs[0].referenceSnapshot = Object.fromEntries(Object.entries(saved).reverse());
  const resumed = await h.request('jobs/' + made.data.id + '/resume', {}, cookie);
  assert.equal(resumed.status, 202, JSON.stringify(resumed.data));
  for (let n = 0; n < 100 && h.runs.length < 2; n++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.runs.length, 2); assert.deepEqual(h.runs[1].cast, h.runs[0].cast);
  assert.deepEqual(h.db().jobs[0].referenceSnapshot, frozen);
  assert.equal(h.db().jobs.length, 1);
});
