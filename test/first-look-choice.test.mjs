import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { createApp } from '../server/app-server.mjs';
import { comparisonTargets, personalLookFingerprint, portraitFingerprint, normalizePhoto, inkPortraitPipelineVersion, directRenderPipelineVersion } from '../server/portraits.js';
import { pictureStyleFor } from '../server/graphic-style.js';
import { setupRecord } from '../server/app-data.js';
import { createMemory } from '../server/memory.js';
import { lockedCast } from '../server/cast.js';
import { readJSON, saveJSON, root } from '../server/files.js';
import { lookFlowVersion, pictureStyleOptions, galleryPictureStyleOptions, pictureStyleOptionFor } from '../app/picture-styles.js';

// October 16 owner and root direction: a new family sees its first person drawn
// in three genuinely different looks, straight from the same photo, each checked
// before it is shown. One tap picks the look for everyone. Later people get one
// drawing in that look. Every reply here is an offline fixture; nothing is paid.
const fixtureRoot = join(root, 'context/portrait-tests'); mkdirSync(fixtureRoot, { recursive: true });
const picture = red => sharp({ create: { width: 40, height: 60, channels: 3, background: { r: red, g: 90, b: 160 } } }).png().toBuffer();
const family = (extra = {}) => ({ real: false, pictureStyleId: 'anime-comic', nickname: 'Juno', age: 11, pronouns: 'she/her', loves: ['maps', 'robots', 'swimming'], presetId: 'fern', familyContext: 'Fictional household.', parents: [{ label: 'Mom', pronouns: 'she/her', hair: 'curly brown hair' }, { label: 'Dad', pronouns: 'he/him', hair: 'short grey hair' }], ...extra });
const looks = /HERITAGE STORYBOOK|BOLD INK COMIC|ANIME COMIC|FRIENDLY ANIME|ADVENTURE COMIC|DIARY DOODLES/g;
// Offline stand-in for the selected picture checker. `verdict(request)` may
// return { matches, styleMatches, broken } to steer one answer.
const checkReply = (request, { matches = true, styleMatches = true, broken = false, certainty = 'confirmed' } = {}) => {
  if (broken) return { status: 'completed', output: [{ content: [{ type: 'output_text', text: 'not json' }] }] };
  const { characterId } = JSON.parse(request.body.input[0].content[0].text);
  const answer = { castObservations: [{ characterId, observedSpecies: 'human', identityMatches: matches, certainty, identityEvidence: matches ? 'Same face shape and hair as the reference.' : 'The drawing shows a bald bearded man; the reference has long curly hair.', appearance: [], clothing: [] }] };
  if (request.stage === 'portrait-render-check') answer.graphicStyle = { matchesSelectedStyle: styleMatches, flatInk: true, photographicTexture: false, toyShine: false, oversizedEyes: false, evidence: styleMatches ? 'Drawn in the expected look.' : 'Glossy digital painting, not the expected look.' };
  return { status: 'completed', usage: { input_tokens: 10, output_tokens: 10 }, output: [{ content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] };
};
async function harness(t, { dataDirectory, verdict = () => ({}) } = {}) {
  const directory = dataDirectory ?? mkdtempSync(join(fixtureRoot, 'first-look-'));
  if (!dataDirectory) t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls = [], inkBytes = await picture(141); let drawings = 0, kitRuns = 0;
  const app = createApp({ dataDirectory: directory, sample: null, sampleOnly: false, allowSyntheticPortraits: true, keyReader: () => 'fixture-key',
    runKit: async () => { kitRuns++; throw Error('Fixture stop before any kit work.'); },
    transportFactory: () => ({ call: async request => {
      calls.push(request);
      if (/check$/.test(request.stage)) return checkReply(request, verdict(request, calls));
      return { data: [{ b64_json: (request.stage === 'portrait-ink' ? inkBytes : await picture(10 + ++drawings)).toString('base64') }] };
    } }) });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.server.listening ? app.close() : undefined);
  const request = async (path, body, cookie, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: response.headers.get('content-type')?.includes('json') ? await response.json() : null };
  };
  const settle = async (cookie, personId) => {
    for (let i = 0; i < 200; i++) {
      const listed = (await request('portraits?childId=primary', undefined, cookie)).data;
      const person = listed.people.find(item => item.id === personId);
      if (person.job?.status !== 'running') return { listed, person };
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw Error('Fixture drawing did not settle');
  };
  return { ...app, directory, calls, inkBytes, request, settle, kitRuns: () => kitRuns, db: () => readJSON(join(directory, 'accounts.json')), stages: () => calls.map(item => item.stage) };
}
const photo = async red => ({ mime: 'image/png', base64: (await picture(red)).toString('base64') });
const newFamily = (h, username = 'first_look') => h.request('signup', { username, password: 'only-fictional-fixture', family: family(), lookFlow: lookFlowVersion });
async function compareFirstPerson(h, cookie, personId = 'child', source) {
  const started = await h.request(`portraits/${personId}`, { childId: 'primary', inputMode: 'photo', photo: source ?? await photo(30) }, cookie);
  assert.equal(started.status, 202, JSON.stringify(started.data));
  return h.settle(cookie, personId);
}
const threeLooks = ['portrait-render', 'portrait-render', 'portrait-render'];

test('a new family sees its first person drawn straight from the photo in three parent-choice looks; one tap saves look and drawing', async t => {
  const h = await harness(t), signed = await newFamily(h);
  assert.equal(signed.status, 200); const cookie = signed.cookie;
  // Adventure comic, the recommended look, is only a placeholder until the family chooses; the client's style is ignored.
  assert.deepEqual(signed.data.look, { flow: lookFlowVersion, pending: true, revision: 0 });
  assert.equal(signed.data.record.pictureStyleId, 'adventure-comic'); assert.equal(signed.data.canChangePictureStyle, false);
  assert.deepEqual(pictureStyleOptions.map(style => style.id), ['friendly-anime', 'adventure-comic', 'diary-doodles']);

  const source = await photo(30), { listed, person } = await compareFirstPerson(h, cookie, 'child', source);
  assert.equal(person.job.kind, 'style-comparison'); assert.equal(person.job.status, 'complete'); assert.equal(person.job.expected, 3);
  assert.deepEqual(h.stages(), threeLooks, 'three image calls, no extra checks or shared sketch');
  assert.deepEqual(person.candidates.map(candidate => [candidate.pictureStyleId, candidate.styleLabel, candidate.recommended]), [['friendly-anime', 'Friendly anime', false], ['adventure-comic', 'Adventure comic', true], ['diary-doodles', 'Diary doodles', false]]);
  assert.equal(listed.look.pending, true); assert.deepEqual(listed.look.comparison, { childId: 'primary', personId: 'child', label: 'Juno' });

  // Each look is drawn from the same original photo with its own look rule only.
  const normalized = `data:image/png;base64,${(await normalizePhoto(source)).toString('base64')}`;
  const renders = h.calls.filter(request => request.stage === 'portrait-render'), checks = h.calls.filter(request => request.stage === 'portrait-render-check');
  assert.deepEqual(renders.map(request => request.body.prompt.match(looks)), [['FRIENDLY ANIME'], ['ADVENTURE COMIC'], ['DIARY DOODLES']]);
  for (const request of renders) {
    assert.deepEqual(request.body.image, [normalized]); assert.equal(request.path, '/v1/images/edits');
    assert.match(request.body.prompt, /Draw this same person as a finished drawing in the selected look below, in this order of priority\. 1\) Keep them recognisable as this person/); assert.match(request.body.prompt, /FAMILY IDENTITY\. Keep each person recognisable from their OWN photo or appearance words/); assert.doesNotMatch(request.body.prompt, /COMIC FAMILY FACES|middle grade|Smile or The Baby|finished colour/); assert.match(request.body.prompt, /2\) Use the locked clothes, the neutral full-body pose and the plain light background/); assert.match(request.body.prompt, /3\) Draw every line, face, shade and surface the way the selected look draws them/); assert.doesNotMatch(request.body.prompt, /Change only the rendering/); assert.match(request.body.prompt, /Neutral full-body pose, plain light background/);
    assert.doesNotMatch(request.body.prompt, /INK IDENTITY BASE|NEUTRAL IDENTITY BASE|small natural expression variation|ink identity drawing/);
  }
  // Each check sees that drawing and the same photo, and the look it must match.
  for (const [index, request] of checks.entries()) {
    const images = request.body.input[0].content.filter(part => part.type === 'input_image').map(part => part.image_url), payload = JSON.parse(request.body.input[0].content[0].text);
    assert.equal(images.length, 2); assert.equal(images[1], normalized); assert.equal(payload.expectedPictureStyleId, pictureStyleOptions[index].id);
    assert.equal(request.body.model, readJSON(join(root, 'content/prices.json')).selected.pictureCheck); assert.equal(request.body.store, false);
  }
  const job = h.db().portraits[0];
  assert.equal(job.kind, 'style-comparison'); assert.equal(job.pipelineVersion, directRenderPipelineVersion); assert.equal(job.pictureStyleId, null);
  assert.equal(job.requestCount, 3); assert.equal(job.renderChecks, undefined); assert.equal(job.inkBase, undefined);
  assert.deepEqual(job.targets, comparisonTargets());
  assert.deepEqual(job.candidates.map(candidate => [candidate.slot, candidate.pictureStyleId, candidate.pictureStyleVersion, candidate.jobKind, candidate.renderCheck.status]), job.targets.map(target => [target.slot, target.pictureStyleId, target.pictureStyleVersion, 'style-comparison', 'parent-review']));
  assert.ok(person.candidates.every(candidate => candidate.checkNote === undefined), 'confirmed matches carry no note');
  assert.equal(existsSync(join(h.directory, job.accountId, 'portraits', job.id, 'render-check-2-1.json')), false);

  // A stale tab is refused; the real choice writes look and drawing together.
  const diary = person.candidates[2];
  const stale = await h.request('portraits/child/select', { childId: 'primary', jobId: person.job.id, candidateId: diary.id, lookRevision: 4 }, cookie);
  assert.equal(stale.status, 409); assert.match(stale.data.message, /another tab/);
  const chosen = await h.request('portraits/child/select', { childId: 'primary', jobId: person.job.id, candidateId: diary.id, lookRevision: 0 }, cookie);
  assert.equal(chosen.status, 200, JSON.stringify(chosen.data)); assert.equal(chosen.data.look.pending, false); assert.equal(chosen.data.look.pictureStyleId, 'diary-doodles');
  const session = (await h.request('session', undefined, cookie)).data;
  assert.equal(session.pictureStyleId, 'diary-doodles'); assert.equal(session.record.pictureStyleId, 'diary-doodles'); assert.deepEqual(session.look, { flow: lookFlowVersion, pending: false, revision: 1 });
  const saved = readJSON(join(h.directory, signed.data.accountId, 'family.json')).cast.find(item => item.id === 'child'), file = job.candidates[2];
  assert.deepEqual([saved.portraitCandidateId, saved.referenceHash, saved.referenceStyleId, saved.referenceStyleVersion], [file.id, file.hash, 'diary-doodles', pictureStyleFor('diary-doodles').version]);
  const account = h.db().accounts[0];
  assert.equal(account.lookChoice, 'chosen'); assert.equal(account.lookSelection, undefined); assert.equal(account.lookChosen.candidateId, file.id);

  // The same tap again changes nothing; another card cannot change the look.
  const familyBefore = readFileSync(join(h.directory, signed.data.accountId, 'family.json'));
  assert.equal((await h.request('portraits/child/select', { childId: 'primary', jobId: person.job.id, candidateId: diary.id, lookRevision: 0 }, cookie)).status, 200);
  const other = await h.request('portraits/child/select', { childId: 'primary', jobId: person.job.id, candidateId: person.candidates[0].id, lookRevision: 1 }, cookie);
  assert.equal(other.status, 409); assert.match(other.data.message, /already chosen/);
  assert.deepEqual(readFileSync(join(h.directory, signed.data.accountId, 'family.json')), familyBefore);
  // The same photo again hands back the saved looks without drawing.
  await compareFirstPerson(h, cookie, 'child', source);
  assert.equal(h.calls.length, 3);

  // After a restart the chosen look and the labelled comparison are still shown.
  await h.close(); const again = await harness(t, { dataDirectory: h.directory });
  const login = await again.request('login', { username: 'first_look', password: 'only-fictional-fixture' });
  assert.equal(login.data.pictureStyleId, 'diary-doodles'); assert.equal(login.data.look.pending, false);
  const reopened = (await again.request('portraits?childId=primary', undefined, login.cookie)).data.people.find(item => item.id === 'child');
  assert.equal(reopened.job.id, person.job.id); assert.deepEqual(reopened.candidates.map(candidate => candidate.selected), [false, false, true]); assert.ok(reopened.selectedUrl);
});

test('valid drawings stay visible for parent choice without a hidden opinion gate', async t => {
  const h = await harness(t, { verdict: () => { throw Error('No automatic portrait judge should run'); } });
  const { cookie } = await newFamily(h), source = await photo(33);
  const { person } = await compareFirstPerson(h, cookie, 'child', source);
  assert.equal(person.job.status, 'complete'); assert.equal(person.candidates.length, 3);
  assert.deepEqual(h.stages(), threeLooks);
  const job = h.db().portraits[0];
  assert.equal(job.requestCount, 3); assert.ok(job.candidates.every(item => item.renderCheck.status === 'parent-review'));
  assert.equal(job.rejectedRenders, undefined);
  await compareFirstPerson(h, cookie, 'child', source);
  assert.deepEqual(h.stages(), threeLooks, 'the same input reuses all three drawings');
});

test('a committed drawing is recovered after an interrupted index update without a new drawing or judge', async t => {
  const h = await harness(t), signed = await newFamily(h), source = await photo(35);
  const { person } = await compareFirstPerson(h, signed.cookie, 'child', source);
  const originalHash = h.db().portraits[0].candidates[0].hash;
  await h.close();
  const db = readJSON(join(h.directory, 'accounts.json')); db.portraits[0].candidates.shift(); saveJSON(join(h.directory, 'accounts.json'), db);
  const again = await harness(t, { dataDirectory: h.directory });
  const login = await again.request('login', { username: 'first_look', password: 'only-fictional-fixture' });
  const recovered = (await again.request('portraits?childId=primary', undefined, login.cookie)).data.people.find(item => item.id === 'child');
  assert.equal(recovered.candidates.length, 3); assert.equal(recovered.job.id, person.job.id);
  assert.ok(again.db().portraits[0].candidates.some(item => item.hash === originalHash)); assert.deepEqual(again.stages(), []);
});

test('parent-choice metadata never claims an automatic appearance approval', async t => {
  const h = await harness(t), { cookie } = await newFamily(h), { person } = await compareFirstPerson(h, cookie);
  assert.equal(person.job.status, 'complete'); assert.equal(person.candidates.length, 3);
  assert.deepEqual(person.candidates.map(item => item.checkNote ?? null), [null, null, null]);
  assert.ok(h.db().portraits[0].candidates.every(item => item.renderCheck.status === 'parent-review'));
  assert.equal((await h.request('portraits/child/select', { childId: 'primary', jobId: person.job.id, candidateId: person.candidates[2].id, lookRevision: 0 }, cookie)).status, 200);
});

test('after the choice each later person gets one checked drawing in the family look, more only on request and capped', async t => {
  const h = await harness(t), { cookie } = await newFamily(h);
  const { person } = await compareFirstPerson(h, cookie);
  assert.equal((await h.request('portraits/child/select', { childId: 'primary', jobId: person.job.id, candidateId: person.candidates[0].id, lookRevision: 0 }, cookie)).status, 200);
  h.calls.length = 0;
  // Words only: one neutral checked sketch, then one full redraw in the family look.
  const words = { childId: 'primary', inputMode: 'description', description: 'Short curly brown hair, warm brown skin and round glasses.' };
  await h.request('portraits/grown-up-one', words, cookie);
  let { person: mom } = await h.settle(cookie, 'grown-up-one');
  assert.equal(mom.job.kind, 'selected-style'); assert.equal(mom.job.status, 'complete'); assert.equal(mom.candidates.length, 1); assert.equal(mom.job.canDrawAnother, true);
  assert.deepEqual(h.stages(), ['portrait-ink', 'portrait-finish']);
  assert.match(h.calls[0].body.prompt, /NEUTRAL IDENTITY BASE/); assert.equal(h.calls[0].body.prompt.match(looks), null);
  assert.deepEqual(h.calls[1].body.prompt.match(looks), ['FRIENDLY ANIME']); assert.match(h.calls[1].body.prompt, /Redraw that SAME person fully/); assert.doesNotMatch(h.calls[1].body.prompt, /small natural expression variation/);
  let job = h.db().portraits.find(item => item.personId === 'grown-up-one');
  assert.deepEqual(job.targets, [{ slot: 0, pictureStyleId: 'friendly-anime', pictureStyleVersion: pictureStyleFor('friendly-anime').version }]); assert.equal(job.candidates[0].pictureStyleId, 'friendly-anime');
  // "Try another drawing" reuses the checked sketch: no new sketch, one check per drawing.
  for (const count of [2, 3]) {
    const more = await h.request('portraits/grown-up-one', { ...words, another: true, anotherJobId: mom.job.id }, cookie);
    assert.equal(more.status, 202, JSON.stringify(more.data));
    ({ person: mom } = await h.settle(cookie, 'grown-up-one'));
    assert.equal(mom.candidates.length, count);
  }
  assert.equal(mom.job.canDrawAnother, false);
  assert.equal((await h.request('portraits/grown-up-one', { ...words, another: true, anotherJobId: mom.job.id }, cookie)).status, 409);
  assert.deepEqual(h.stages().slice(2), ['portrait-finish', 'portrait-finish']);
  job = h.db().portraits.find(item => item.personId === 'grown-up-one');
  assert.equal(job.requestCount, 4); assert.equal(job.inkChecks, 0); assert.deepEqual(job.candidates.map(candidate => [candidate.slot, candidate.pictureStyleId]), [[0, 'friendly-anime'], [1, 'friendly-anime'], [2, 'friendly-anime']]);
  assert.equal((await h.request('portraits/grown-up-one/select', { childId: 'primary', jobId: mom.job.id, candidateId: mom.candidates[1].id }, cookie)).status, 200);
  // With a photo: one drawing straight from the photo, one check.
  h.calls.length = 0;
  await h.request('portraits/grown-up-two', { childId: 'primary', inputMode: 'photo', photo: await photo(60) }, cookie);
  const { person: dad } = await h.settle(cookie, 'grown-up-two');
  assert.deepEqual(h.stages(), ['portrait-render']); assert.deepEqual(h.calls[0].body.prompt.match(looks), ['FRIENDLY ANIME']);
  assert.equal(dad.candidates.length, 1); assert.equal(dad.job.canDrawAnother, true);
  // Another account cannot ask this job for more drawings.
  const stranger = await h.request('signup', { username: 'stranger', password: 'only-fictional-fixture', family: family(), lookFlow: lookFlowVersion });
  assert.equal((await h.request('portraits/grown-up-one', { ...words, another: true, anotherJobId: mom.job.id }, stranger.cookie)).status, 409);
});

test('while the look is open: no kit, no second comparison, no old style route, no choice over saved work', async t => {
  const h = await harness(t), signed = await newFamily(h), cookie = signed.cookie;
  const picked = await h.request('pick', { tonight: 'The homework felt hard.' }, cookie), moveId = picked.data.suggestions[0].id;
  const kit = await h.request('jobs', { tonight: 'The homework felt hard.', moveId }, cookie);
  assert.equal(kit.status, 409); assert.match(kit.data.message, /Choose your family’s look first/); assert.equal(h.kitRuns(), 0);
  const route = await h.request('family/style', { pictureStyleId: 'diary-doodles' }, cookie);
  assert.equal(route.status, 409); assert.equal((await h.request('session', undefined, cookie)).data.record.pictureStyleId, 'adventure-comic');
  const { person } = await compareFirstPerson(h, cookie);
  const second = await h.request('portraits/grown-up-two', { childId: 'primary', inputMode: 'photo', photo: await photo(40) }, cookie);
  assert.equal(second.status, 409); assert.match(second.data.message, /first person/); assert.equal(h.calls.length, 3);
  // Saved story work in the account blocks the choice before anything is written.
  await h.close();
  const db = readJSON(join(h.directory, 'accounts.json'));
  db.jobs.push({ id: '00000000-0000-4000-8000-000000000001', accountId: signed.data.accountId, childId: 'primary', status: 'complete', pictureStyleId: 'adventure-comic', createdAt: new Date().toISOString() });
  saveJSON(join(h.directory, 'accounts.json'), db);
  const again = await harness(t, { dataDirectory: h.directory });
  const login = await again.request('login', { username: 'first_look', password: 'only-fictional-fixture' });
  const familyBefore = readFileSync(join(h.directory, signed.data.accountId, 'family.json'));
  const blocked = await again.request('portraits/child/select', { childId: 'primary', jobId: person.job.id, candidateId: person.candidates[2].id, lookRevision: 0 }, login.cookie);
  assert.equal(blocked.status, 409); assert.match(blocked.data.message, /saved stories or drawings/);
  assert.deepEqual(readFileSync(join(h.directory, signed.data.accountId, 'family.json')), familyBefore);
  assert.equal(again.db().accounts[0].lookChoice, 'pending'); assert.equal(again.db().accounts[0].lookSelection, undefined);
});

test('a stop after the saved intent is finished at startup; a broken intent keeps the look open', async t => {
  const h = await harness(t), signed = await newFamily(h), cookie = signed.cookie;
  const { person } = await compareFirstPerson(h, cookie);
  await h.close();
  const job = readJSON(join(h.directory, 'accounts.json')).portraits[0], first = job.candidates[0];
  const intent = { childId: 'primary', personId: 'child', jobId: job.id, candidateId: first.id, pictureStyleId: first.pictureStyleId, pictureStyleVersion: first.pictureStyleVersion, revision: 1, createdAt: new Date().toISOString() };
  // Broken: the chosen file changed after the intent was written.
  const broken = mkdtempSync(join(fixtureRoot, 'first-look-broken-')); t.after(() => rmSync(broken, { recursive: true, force: true }));
  for (const name of ['accounts.json', 'daily-budget.json']) writeFileSync(join(broken, name), readFileSync(join(h.directory, name)));
  cpSync(join(h.directory, signed.data.accountId), join(broken, signed.data.accountId), { recursive: true });
  const brokenDb = readJSON(join(broken, 'accounts.json')); brokenDb.accounts[0].lookSelection = intent;
  for (const candidate of brokenDb.portraits[0].candidates) candidate.path = candidate.path.replace(h.directory, broken);
  saveJSON(join(broken, 'accounts.json'), brokenDb);
  writeFileSync(first.path.replace(h.directory, broken), await picture(250));
  const errors = [], original = console.error; console.error = message => errors.push(String(message)); t.after(() => { console.error = original; });
  const failed = await harness(t, { dataDirectory: broken });
  console.error = original;
  assert.equal(failed.db().accounts[0].lookChoice, 'pending'); assert.equal(failed.db().accounts[0].lookSelection, undefined); assert.match(errors.join('\n'), /was not finished/);
  assert.equal(readJSON(join(broken, signed.data.accountId, 'family.json')).pictureStyleId, 'adventure-comic');
  await failed.close();
  // Intact: the intent is finished before the server serves anything.
  const db = readJSON(join(h.directory, 'accounts.json')); db.accounts[0].lookSelection = intent; saveJSON(join(h.directory, 'accounts.json'), db);
  const again = await harness(t, { dataDirectory: h.directory });
  const account = again.db().accounts[0];
  assert.equal(account.lookChoice, 'chosen'); assert.equal(account.pictureStyleId, 'friendly-anime'); assert.equal(account.lookRevision, 1); assert.equal(account.lookSelection, undefined);
  const record = readJSON(join(h.directory, signed.data.accountId, 'family.json'));
  assert.equal(record.pictureStyleId, 'friendly-anime'); assert.equal(record.cast.find(item => item.id === 'child').portraitCandidateId, first.id);
  const login = await again.request('login', { username: 'first_look', password: 'only-fictional-fixture' });
  assert.equal(login.data.look.pending, false); assert.equal(person.candidates[0].id, first.id);
});

test('an earlier three-look set keeps its files, attempts and charges but is never offered, chosen or reused as proof', async t => {
  const h = await harness(t), signed = await newFamily(h), cookie = signed.cookie, source = await photo(30);
  await compareFirstPerson(h, cookie, 'child', source);
  await h.close();
  const db = readJSON(join(h.directory, 'accounts.json')), job = db.portraits[0];
  const record = createMemory(join(h.directory, signed.data.accountId, 'family.json')).exportRecord(), person = lockedCast(record).find(item => item.id === 'child');
  // As if drawn under the earlier Heritage, Bold and Anime offer, keyed correctly for its own looks.
  job.targets = ['heritage-storybook', 'bold-ink-comic', 'anime-comic'].map((id, slot) => ({ slot, pictureStyleId: id, pictureStyleVersion: pictureStyleFor(id).version }));
  for (const candidate of job.candidates) Object.assign(candidate, { pictureStyleId: job.targets[candidate.slot].pictureStyleId, pictureStyleVersion: job.targets[candidate.slot].pictureStyleVersion });
  job.personFingerprint = personalLookFingerprint(record, person, job);
  saveJSON(join(h.directory, 'accounts.json'), db);
  const again = await harness(t, { dataDirectory: h.directory }), login = await again.request('login', { username: 'first_look', password: 'only-fictional-fixture' });
  let listed = (await again.request('portraits?childId=primary', undefined, login.cookie)).data;
  assert.equal(listed.look.pending, true); assert.equal(listed.look.comparison, undefined);
  assert.deepEqual(listed.people.find(item => item.id === 'child').candidates, [], 'no Heritage, Bold or Anime drawing is offered as current');
  const bold = await again.request('portraits/child/select', { childId: 'primary', jobId: job.id, candidateId: job.candidates[1].id, lookRevision: 0 }, login.cookie);
  assert.notEqual(bold.status, 200); assert.equal(again.db().accounts[0].lookChoice, 'pending');
  // The same photo makes a fresh set in the owner's three looks; the earlier set stays saved as it was.
  assert.equal((await again.request('portraits/child', { childId: 'primary', inputMode: 'photo', photo: source }, login.cookie)).status, 202);
  ({ listed } = await again.settle(login.cookie, 'child'));
  const [earlier, fresh] = again.db().portraits;
  assert.deepEqual([earlier.id, earlier.requestCount, earlier.candidates.map(candidate => candidate.hash)], [job.id, job.requestCount, job.candidates.map(candidate => candidate.hash)]);
  assert.ok(earlier.candidates.every(candidate => existsSync(candidate.path)));
  assert.deepEqual(fresh.targets, comparisonTargets()); assert.deepEqual(again.stages(), threeLooks);
  assert.deepEqual(listed.people.find(item => item.id === 'child').candidates.map(candidate => candidate.pictureStyleId), ['friendly-anime', 'adventure-comic', 'diary-doodles']);
});

test('new-family keys ignore the family look; older families keep their look and labels and get one drawing', async t => {
  const record = setupRecord(family()), person = record.cast[0], targets = comparisonTargets();
  const keys = ['friendly-anime', 'adventure-comic', 'diary-doodles', 'heritage-storybook', 'bold-ink-comic', 'anime-comic', 'painted-comic'].map(id => personalLookFingerprint({ ...record, pictureStyleId: id }, person, { kind: 'style-comparison', inputMode: 'photo', targets }));
  assert.equal(new Set(keys).size, 1);
  assert.notEqual(personalLookFingerprint(record, person, { kind: 'style-comparison', inputMode: 'description', targets }), keys[0]);
  assert.notEqual(personalLookFingerprint(record, person, { kind: 'style-comparison', inputMode: 'photo', targets: targets.slice(0, 2) }), keys[0]);
  // A one-drawing job follows the family look, so changing an older family's look hides it.
  assert.notEqual(personalLookFingerprint({ ...record, pictureStyleId: 'bold-ink-comic' }, person, { kind: 'selected-style', inputMode: 'photo', targets: [targets[1]] }), personalLookFingerprint({ ...record, pictureStyleId: 'anime-comic' }, person, { kind: 'selected-style', inputMode: 'photo', targets: [targets[1]] }));
  assert.equal(personalLookFingerprint(record, person, { kind: 'selected-style', inputMode: 'photo', targets: [targets[1]] }), personalLookFingerprint(record, person, { kind: 'selected-style', inputMode: 'photo', targets: [targets[1], { ...targets[1], slot: 1 }] }), 'another drawing keeps the key');
  assert.notEqual(portraitFingerprint(record, person, { inputMode: 'photo', pipelineVersion: inkPortraitPipelineVersion }), keys[0]);
  // Painted stays a valid saved look with its label and example; Heritage has no made-up example picture.
  assert.equal(pictureStyleOptionFor('painted-comic').label, 'Painted comic'); assert.equal(pictureStyleFor('painted-comic').version.startsWith('painted-comic-v1:'), true);
  assert.deepEqual(galleryPictureStyleOptions.map(style => style.id), ['painted-comic', 'bold-ink-comic', 'anime-comic']);
  assert.equal(pictureStyleOptionFor('heritage-storybook').example, undefined); assert.equal(pictureStyleFor('heritage-storybook').version, 'heritage-storybook-v1'); assert.equal(pictureStyleFor('heritage-storybook').referenceHash, null);
  // A family set up before the new flow keeps its chosen look, and any new drawing is one checked drawing in it.
  const h = await harness(t), legacy = await h.request('signup', { username: 'older_flow', password: 'only-fictional-fixture', family: family() });
  assert.equal(legacy.data.record.pictureStyleId, 'anime-comic'); assert.deepEqual(legacy.data.look, { flow: null, pending: false, revision: 0 });
  await h.request('portraits/child', { childId: 'primary', inputMode: 'photo', photo: await photo(50) }, legacy.cookie);
  const { person: older } = await h.settle(legacy.cookie, 'child');
  assert.equal(older.job.kind, 'selected-style'); assert.equal(older.candidates.length, 1); assert.equal(older.job.canDrawAnother, true);
  assert.deepEqual(h.stages(), ['portrait-render']); assert.deepEqual(h.calls[0].body.prompt.match(looks), ['ANIME COMIC']);
  assert.deepEqual(h.db().portraits[0].targets, [{ slot: 0, pictureStyleId: 'anime-comic', pictureStyleVersion: pictureStyleFor('anime-comic').version }]);
  assert.equal((await h.request('signup', { username: 'odd_flow', password: 'only-fictional-fixture', family: family(), lookFlow: 'something-else' })).status, 400);
});
