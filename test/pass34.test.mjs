import test from 'node:test';
import { expectReview } from './review-assertions.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createAppBudget, defaultDailyLimit, newKitAllowance, wireCeiling } from '../server/app-budget.js';
import { chargeAccounting, accountSavedAttempts } from '../server/charge-accounting.js';
import { createKit } from '../server/kit.js';
import { createMemory } from '../server/memory.js';
import { offlineTransport, offlineExports, offlineSample } from './offline-kit-fixture.mjs';
import { family as offlineFamily, sentences } from './fixture.mjs';
import { createTransport, readLog } from '../server/transport.js';
import { setupRecord, repairPresetConflict, heroPresets } from '../server/app-data.js';
import { childLooks, appearanceFrom } from '../app/appearance.js';
import { createApp } from '../server/app-server.mjs';
import { readJSON, saveJSON, root, moves } from '../server/files.js';
import { castObservation } from './checker-fixture.mjs';
import { publicCast, lockedCast, assessCastObservations } from '../server/cast.js';
import { buildPictureRequest, buildPictureCheckRequest, buildWordCheckRequest, buildCastCheckRequest, privacyFor } from '../server/requests.js';
import { validateStory } from '../server/story.js';
import { kitText } from './kit-text-fixture.mjs';
import { assertPDFTextMargins } from '../server/check-pdf.js';
import { fitDocument, shorteningPlan } from '../server/layout-fit.js';
import { isHardFault } from '../server/stop-policy.js';

const out = join(root, 'context/pass34-test-state'); mkdirSync(out, { recursive: true });
const temp = () => mkdtempSync(join(out, 'fixture-'));
const catalog = readJSON(new URL('../content/prices.json', import.meta.url));
const family = () => ({ real: false, nickname: 'Rin', age: 11, pronouns: 'she/her', loves: ['comics', 'soccer', 'space'], presetId: 'comet', appearance: { hair: 'long dark hair', skin: 'brown skin', glasses: 'no glasses' }, parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] });
const request = () => ({ provider: 'openai', path: '/v1/responses', stage: 'picture-check', privacy: privacyFor(setupRecord(family()), 'Homework felt hard.'), body: { model: catalog.selected.pictureCheck, max_output_tokens: 1000, store: false, input: [] } });

test('unknown and concurrent known charges settle without freezing either family', () => {
  const file = join(temp(), 'budget.json'), budget = createAppBudget(file, { limit: 2 });
  const first = budget.reserve(.5), other = budget.reserve(.4);
  assert.equal(budget.settle(first, null).basis, 'reserved-ceiling');
  assert.doesNotThrow(() => budget.settle(other, .1));
  assert.equal(budget.status().spent, .6); assert.equal(budget.status().reserved, 0); assert.equal(budget.status().uncertain, false);
  budget.settle(budget.reserve(.2), .02); assert.equal(budget.status().spent, .62);
  assert.equal(readJSON(file).days[other.day].settlements[first.id].usd, .5);
  assert.equal(chargeAccounting({ usd: null }, .5).usd, .5);
});

test('startup converts stale and legacy uncertain reservations exactly once on their own day', () => {
  const file = join(temp(), 'budget.json');
  saveJSON(file, { days: { '2026-10-14': { spent: .3, reserved: { lost: .7 }, uncertain: true }, '2026-10-15': { spent: .2, reserved: { interrupted: .5 }, uncertain: false } } });
  const budget = createAppBudget(file, { now: () => new Date('2026-10-15T12:00:00Z') });
  budget.recoverReservations(); budget.recoverReservations();
  assert.equal(budget.status().spent, .7); assert.equal(budget.status().reserved, 0); assert.equal(budget.status().uncertain, false);
  const data = readJSON(file); assert.equal(data.days['2026-10-14'].spent, 1); assert.equal(data.days['2026-10-14'].settlements.lost.basis, 'interrupted-reserved-ceiling');
});

for (const failure of [429, 500, 'ECONNRESET']) test(`usage-free ${failure} consumes a bound then retries and permits the next logical call`, async t => {
  const directory = temp(), logFile = join(directory, 'requests.jsonl'), budget = createAppBudget(join(directory, 'budget.json'), { limit: 2 });
  let calls = 0; const waits = [];
  t.mock.method(globalThis, 'fetch', async () => {
    calls++; assert.ok(budget.status().reserved > 0);
    if (calls === 1) {
      if (typeof failure === 'string') throw Object.assign(new Error('network interrupted'), { cause: { code: failure } });
      return new Response(JSON.stringify({ error: { message: 'temporary' } }), { status: failure });
    }
    return new Response(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 10 } }));
  });
  const transport = createTransport({ keys: { openai: 'fixture-never-sent' }, logFile, budget, wait: async ms => waits.push(ms) });
  await transport.call(request()); await transport.call(request());
  assert.equal(calls, 3); assert.deepEqual(waits, [2000]); assert.equal(budget.status().reserved, 0);
  const rows = readLog(logFile).filter(row => row.event === 'response');
  assert.equal(rows[0].cost.usd, null); assert.equal(rows[0].accounting.basis, 'reserved-ceiling');
  assert.equal(rows[0].accounting.usd, wireCeiling(request(), catalog));
  assert.ok(budget.status().spent > rows[0].accounting.usd);
});

test('a blocked picture with no usage does not poison the next request', async t => {
  const directory = temp(), budget = createAppBudget(join(directory, 'budget.json'));
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? new Response('{"error":{"message":"blocked"}}', { status: 400 }) : new Response('{"usage":{"input_tokens":1,"output_tokens":1}}'));
  const transport = createTransport({ keys: { openai: 'fixture-never-sent' }, logFile: join(directory, 'requests.jsonl'), budget });
  await assert.rejects(transport.call(request()), /HTTP 400/);
  await transport.call(request()); assert.equal(calls, 2); assert.equal(budget.status().uncertain, false);
});

test('legacy saved-run accounting retains missing bills and bounds requests with no receipt', () => {
  const body = request().body;
  const rows = [
    { event: 'request', id: 'lost', timestamp: '2026-10-15T12:00:00Z', method: 'POST', url: 'https://api.openai.com/v1/responses', body },
    { event: 'request', id: 'known', method: 'POST', url: 'https://api.openai.com/v1/responses', body },
    { event: 'response', id: 'known', cost: { usd: .001 } },
  ];
  const original = JSON.stringify(rows), accounted = accountSavedAttempts(rows, catalog);
  assert.equal(accounted[0].accounting.usd, wireCeiling(request(), catalog)); assert.equal(accounted[0].accounting.basis, 'reserved-ceiling');
  assert.equal(accounted[1].accounting.usd, .001); assert.equal(JSON.stringify(rows), original);
});

test('the default daily cap supports three measured kit costs while keeping conservative wire bounds', () => {
  const budget = createAppBudget(join(temp(), 'budget.json'));
  assert.equal(budget.status().limit, defaultDailyLimit);
  for (let kit = 0; kit < 3; kit++) {
    assert.ok(budget.status().limit - budget.status().spent >= newKitAllowance);
    for (let call = 0; call < 10; call++) budget.settle(budget.reserve(.9), .093);
  }
  assert.ok(Math.abs(budget.status().spent - 2.79) < 1e-9);
  assert.throws(() => budget.reserve(6), /Daily budget/);
});

test('every outfit respects the saved pronouns and explicit hair, skin and glasses', () => {
  for (const preset of heroPresets) for (const pronouns of ['he/him', 'she/her', 'they/them']) {
    const record = setupRecord({ ...family(), presetId: preset.id, pronouns });
    const child = publicCast(record)[0];
    assert.equal(child.pronouns, pronouns); assert.deepEqual(child.description.slice(1), ['long dark hair', 'brown skin', 'no glasses']);
    assert.match(child.description[0], pronouns === 'she/her' ? /girl/ : pronouns === 'he/him' ? /boy/ : /child/);
    const prompt = buildPictureRequest(record, moves[0], 'Homework felt hard.', { hero: true, character: child }).prompt;
    assert.ok(prompt.includes(pronouns)); assert.ok(prompt.includes('long dark hair')); assert.doesNotMatch(prompt, /round glasses/);
  }
  for (const [key, choices] of Object.entries(childLooks)) {
    assert.throws(() => setupRecord({ ...family(), appearance: { ...family().appearance, [key]: 'untrusted free text' } }), /hero hair/);
    assert.ok(choices.length > 1);
  }
});

test('every appearance choice survives editing without matching a shorter sibling', () => {
  for (const [key, choices] of Object.entries(childLooks)) for (const choice of choices) {
    const record = setupRecord({ ...family(), appearance: { ...family().appearance, [key]: choice } });
    assert.equal(appearanceFrom(record)[key], choice);
  }
});

test('legacy conflicting presets discard the child reference without changing completed evidence', () => {
  const record = setupRecord(family());
  record.hero.lookChips[0] = record.cast[0].description[0] = 'human boy';
  record.hero.heroPicturePath = record.cast[0].referencePath = 'old-reference.png'; record.cast[0].referenceHash = 'old-hash';
  record.pastKits = [{ chapterNumber: 1 }];
  assert.throws(() => lockedCast(record), /conflicts/);
  assert.equal(repairPresetConflict(record), true); assert.equal(repairPresetConflict(record), false);
  assert.equal(record.hero.heroPicturePath, ''); assert.equal(record.cast[0].referencePath, ''); assert.equal(record.cast[0].referenceHash, undefined);
  assert.equal(publicCast(record)[0].description[0], 'human girl'); assert.deepEqual(record.pastKits, [{ chapterNumber: 1 }]);
});

test('reference, word and whole-cast checks compare visible appearance with the written record', () => {
  const record = setupRecord(family()), cast = publicCast(record), image = 'data:image/png;base64,AAAA';
  for (const body of [buildPictureCheckRequest(record, moves[0], 'Homework felt hard.', image, { character: cast[0] }), buildWordCheckRequest(record, moves[0], 'Homework felt hard.', image, { panel: { scene: 'the child sits', line: 'A small try.' } }), buildCastCheckRequest(record, moves[0], 'Homework felt hard.', [{ id: 'poster', data: image }], [])]) assert.match(JSON.stringify(body), /reference can itself be wrong/);
  const row = castObservation(cast[0]); row.identityMatches = true;
  row.appearance[0] = { expected: cast[0].description[1], observed: 'short blond hair', visible: true, matches: false, evidence: 'The record requires long dark hair; the child has short blond hair.' };
  const checked = assessCastObservations([row], cast); assert.ok(checked.faults.some(fault => fault.startsWith('confirmed_cast_appearance_mismatch'))); assert.ok(isHardFault(checked.faults[0]));
  row.certainty = 'uncertain'; assert.equal(assessCastObservations([row], cast).faults.length, 0);
});

test('punctuation dashes remain named review notes in every field; ordinary word hyphens stay allowed', () => {
  for (const mutate of [value => { value.story += '\nA pause—then a try.'; }, value => { value.feelFirst[0] += ' – a hard night.'; }, value => { value.whereElse.line += ' - another try.'; }, value => { value.panelLines[0].scene += ' — a desk.'; }]) {
    const value = kitText(moves[0]); mutate(value); expectReview(() => validateStory(value), /no_dashes_as_punctuation/);
  }
  const value = kitText(moves[0]); value.chapterTitle = 'A well-timed try'; assert.doesNotThrow(() => validateStory(value));
});

async function start(t, options = {}) {
  const directory = temp(), app = createApp({ dataDirectory: directory, sampleOnly: false, ...options });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); t.after(() => app.close());
  let cookie;
  const call = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    cookie ??= response.headers.get('set-cookie')?.split(';')[0]; return { status: response.status, data: await response.json() };
  };
  await call('signup', { username: 'pass34_family', password: 'fictional-test-password', family: family() });
  return { ...app, directory, call };
}
const wait = async (call, id) => { for (let i = 0; i < 80; i++) { const job = (await call('jobs/' + id)).data; if (job.status !== 'running') return job; await new Promise(resolve => setTimeout(resolve, 10)); } throw Error('Fixture did not finish'); };

test('new-kit admission leaves a full-kit allowance before reading credentials', async t => {
  let keys = 0;
  const { call, budget } = await start(t, { dailyLimit: 2, keyReader: () => { keys++; throw Error('Must not read'); } });
  budget.settle(budget.reserve(.1), .1);
  const picked = await call('pick', { tonight: 'The homework felt hard.' });
  assert.equal((await call('jobs', { tonight: 'The homework felt hard.', moveId: picked.data.suggestions[0].id })).status, 429); assert.equal(keys, 0);
});

test('a failed job and its successor cannot share feedback or resume into one chapter', async t => {
  let runs = 0; const sample = await offlineSample(temp());
  const { call } = await start(t, { keyReader: () => 'fixture-never-sent', transportFactory: () => ({ call() { throw Error('No model work'); } }), runKit: async (transport, memory, tonight, options) => {
    if (++runs === 1) throw Error('failed before any checkpoint');
    mkdirSync(options.directory, { recursive: true });
    for (const name of ['poster.png', 'poster.pdf', 'kit_final.pdf']) copyFileSync(join(sample.directory, name), join(options.directory, name));
    const move = moves.find(move => move.id === options.chosenMoveId);
    return { ...kitText(move), recordAtStart: memory.exportRecord(), move, complete: true, world: 'comic strip', colourSet: 'warm' };
  } });
  const picked = await call('pick', { tonight: 'The homework felt hard.' }), data = { tonight: 'The homework felt hard.', moveId: picked.data.suggestions[0].id };
  const first = await call('jobs', data); assert.equal((await wait(call, first.data.id)).status, 'failed');
  const second = await call('jobs', data); const completed = await wait(call, second.data.id); assert.equal(completed.status, 'complete');
  assert.notEqual(first.data.chapterNumber, second.data.chapterNumber);
  assert.equal((await call('jobs/' + first.data.id + '/resume', {})).status, 409); assert.equal(runs, 2);
  const feedback = await call('jobs/' + second.data.id + '/feedback', { triedMove: 'yes', didItHelp: 'a little', wallChoice: 'Keep it off the wall' });
  assert.equal(feedback.status, 200); assert.equal(feedback.data.record.pastKits.length, 1); assert.equal(feedback.data.record.pastKits[0].chapterNumber, completed.chapterNumber); assert.equal(feedback.data.record.pastKits[0].didItHelp, 'a little');
});

test('PDF margin receipts name the page and handle signed off-page coordinates', () => {
  const bbox = (x, y) => `<page width="612" height="792"><word xMin="${x}" yMin="${y}" xMax="500" yMax="750">Chapter</word></page>`;
  assert.doesNotThrow(() => assertPDFTextMargins(bbox(36, 36)));
  assert.throws(() => assertPDFTextMargins(bbox(36, 32.553)), /page 1 extracted text box.*top 32.55pt/);
  assert.throws(() => assertPDFTextMargins(bbox(-2, 36)), /left -2.00pt/);
});

test('a fraction of a point of footer spill must recover or request a cut before PDF pagination', t => {
  const previous = globalThis.document; t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const sheet = { dataset: { page: 'story' }, querySelector: selector => selector === '.page-heading' ? {} : null };
  globalThis.document = { querySelectorAll: () => [sheet] };
  const measure = () => ({ measured: true, ready: Boolean(sheet.dataset.gapFit), faults: sheet.dataset.gapFit ? [] : ['footer 0.27pt'], pages: [{ page: 'story', footerOverflowPoints: sheet.dataset.gapFit ? 0 : .27, overflowPoints: .27, elements: [{ generated: 'story', text: 'Saved story.', overflowPoints: 0, bounds: { y: 200, h: 400 } }] }] });
  const fitted = fitDocument(measure); assert.equal(fitted.ready, true); assert.equal(sheet.dataset.gapFit, 'small');
  const receipt = { measured: true, ready: false, pages: [{ page: 'story', footerOverflowPoints: .27, overflowPoints: .27, elements: [{ generated: 'story', text: 'Saved story.', overflowPoints: 0, bounds: { y: 200, h: 400 } }] }] };
  assert.ok(shorteningPlan(receipt, { story: 'Saved story.', pagination: { pages: ['Saved story.', 'Other page.'] }, panelLines: [] }).some(plan => plan.fields.includes('story')));
});


test('assigned chapters survive gaps, printed pages and resume without borrowing another chapter', async t => {
  const directory = temp(), memory = createMemory(join(directory, 'family.json')); memory.store(offlineFamily);
  const transport = offlineTransport(t, directory);
  const kitDirectory = join(directory, 'kit');
  const options = { kit: 7, chapterNumber: 7, directory: kitDirectory, exports: offlineExports() };
  const result = await createKit(transport, memory, sentences[0], options);
  assert.equal(result.complete, true); assert.equal(result.chapterNumber, 7);
  assert.match(readFileSync(join(kitDirectory, 'story.html'), 'utf8'), /Chapter 7:/);
  assert.equal(readJSON(join(kitDirectory, 'checkpoint.json')).chapterNumber, 7);
  await assert.rejects(createKit(transport, memory, sentences[0], { ...options, chapterNumber: 8, resume: true }), /different chapter/);
});
