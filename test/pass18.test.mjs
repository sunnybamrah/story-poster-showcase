import { expectReview } from './review-assertions.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJSON, saveJSON, moves } from '../server/files.js';
import { buildStoryRequest, buildStoryCheckRequest, buildPosterRequest, privacyFor } from '../server/requests.js';
import { createTransport, readLog } from '../server/transport.js';
import { config } from '../server/config.js';
import { textModels, responseText } from '../server/text-models.js';
import { readKeys } from '../server/keys.js';
import { calculateCost } from '../server/cost.js';
import { checkModels } from '../content/check-models.mjs';
import { createMemory } from '../server/memory.js';
import { createKit } from '../server/kit.js';
import { readyStory, writeStory } from '../server/story.js';
import { withKitEvidence } from '../server/kit-evidence.js';
import { chooseRhyme, selectedRhymeFor } from '../server/rhyme.js';
import { parseStoryCheck } from '../server/check-story.js';
import { parseWordCheck } from '../server/check-words.js';
import { geometryAnswer, storyCheckAnswer } from './checker-fixture.mjs';
import { validateGeometryReceipt, posterTemplate } from '../server/poster-template.js';
import { visualJokeDirection } from '../server/visual-direction.js';
import { visibleText } from '../server/layout.js';
import { family, sentences } from './fixture.mjs';
import { offlineTransport, offlineExports, textAnswer, run5 } from './offline-kit-fixture.mjs';
import { offlinePrices } from './offline-prices.mjs';

const temp = t => { const path = mkdtempSync(join(tmpdir(), 'pass18-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; };
const move = moves.find(move => move.id === run5.moveId);
// Historical comparison keys remain fixture data, never production gates.
const rhymeComparisonRules = ['plainWords', 'statesMove', 'reasonWhenPossible', 'twoHalves', 'atMostTenWords', 'sharesTitleWord', 'naturalRhyme', 'noStoryReferences'];
const comparison = (fresh, better = false) => ({
  fresh: { text: fresh, rules: Object.fromEntries(rhymeComparisonRules.map(key => [key, { passes: true, evidence: fresh }])) },
  approved: { text: selectedRhymeFor(move).tagline, rules: Object.fromEntries(rhymeComparisonRules.map(key => [key, { passes: true, evidence: selectedRhymeFor(move).tagline }])) },
  freshBetter: better, reason: better ? 'The fresh rhyme uses a clearer action cue.' : 'The approved rhyme is shorter and equally clear.',
});
const checked = (fresh, review = comparison(fresh)) => {
  const answer = { ...storyCheckAnswer(fresh), rhymeComparison: review };
  return parseStoryCheck(JSON.stringify(answer), { story: { ...run5, tagline: fresh }, move });
};

test('writer and judge use distinct selected OpenAI models, Responses JSON, high effort and no storage', () => {
  const writer = buildStoryRequest(family, sentences[0]), judge = buildStoryCheckRequest(run5, move);
  assert.equal(writer.model, offlinePrices.selected.story); assert.equal(judge.model, offlinePrices.selected.storyCheck);
  for (const body of [writer, judge]) {
    assert.equal(body.store, false); assert.deepEqual(body.reasoning, { effort: 'medium' });
    assert.equal(body.max_output_tokens, body === writer ? 24000 : 8192); assert.equal(body.text.format.type, 'json_schema'); assert.equal(body.text.format.strict, true);
    assert.equal(typeof body.instructions, 'string'); assert.equal(body.input[0].role, 'user');
    assert.ok(!['messages', 'system', 'thinking', 'output_config', 'max_tokens'].some(key => Object.hasOwn(body, key)));
  }
  const payload = JSON.parse(writer.input[0].content);
  assert.equal(payload.tonight, sentences[0]); assert.equal(payload.hero.nickname, family.hero.nickname); assert.equal(payload.familyContext, family.familyContext);
  assert.ok(payload.topicReminders.some(rhyme => rhyme.moveId === move.id));
  const catalog = structuredClone(offlinePrices); catalog.selected.storyCheck = catalog.selected.story;
  assert.throws(() => textModels(catalog), /two different/);
});

test('Responses extraction reads only completed output_text and rejects partial or refused answers', () => {
  const response = textAnswer({ answer: 1 }); response.output.unshift({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Not the answer.' }] });
  assert.equal(responseText(response), '{"answer":1}');
  assert.throws(() => responseText({ ...response, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }), /max_output_tokens/);
  assert.throws(() => responseText({ status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'No' }] }] }), /no text/);
});

test('runtime accepts family text only on the selected text routes and still guards every picture route', async t => {
  const directory = temp(t), calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return new Response(JSON.stringify({ ...textAnswer(run5), usage: { input_tokens: 10, output_tokens: 20 } })); });
  const transport = createTransport({ keys: { openai: 'offline-key' }, logFile: join(directory, 'wire.jsonl'), costCatalog: offlinePrices });
  await transport.call({ provider: 'openai', path: '/v1/responses', stage: 'story', familyRecord: { real: false }, body: buildStoryRequest(family, sentences[0]) });
  await transport.call({ provider: 'openai', path: '/v1/responses', stage: 'story-check', familyRecord: { real: false }, body: buildStoryCheckRequest({ ...run5, story: family.familyContext }, move) });
  for (const [path, stage] of [['/v1/images/generations', 'hero'], ['/v1/images/edits', 'poster'], ['/v1/responses', 'poster-word-check'], ['/v1/responses', 'panel-1-word-check'], ['/v1/responses', 'hero-check']]) {
    await assert.rejects(transport.call({ provider: 'openai', path, stage, body: { prompt: family.hero.nickname }, privacy: privacyFor(family, sentences[0]) }), /nickname/);
  }
  await assert.rejects(transport.call({ provider: 'openai', path: '/v1/images/generations', stage: 'story', body: buildStoryRequest(family, sentences[0]), familyRecord: { real: false } }), /only in the selected/);
  await assert.rejects(transport.call({ provider: 'anthropic', path: '/v1/messages', body: {} }), /Only OpenAI/);
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.url === 'https://api.openai.com/v1/responses'));
  assert.ok(readLog(join(directory, 'wire.jsonl')).filter(row => row.event === 'response').every(row => row.cost.usd > 0));
});

test('real marker survives memory and refuses the kit before model calls or evidence unless approved', async t => {
  const directory = temp(t), memory = createMemory(join(directory, 'family.json'));
  memory.store({ ...family, real: true, config: { zeroRetentionApproved: true } });
  assert.equal(memory.exportRecord().real, true); assert.equal(config.zeroRetentionApproved, false);
  const transport = offlineTransport(t, directory);
  await assert.rejects(createKit(transport, memory, sentences[0], { directory: join(directory, 'kit'), exports: offlineExports() }), /Real family details need your permission/);
  await assert.rejects(writeStory(transport, memory.exportRecord(), sentences[0]), /Real family details need your permission/);
  assert.equal(transport.calls.length, 0); assert.equal(existsSync(join(directory, 'kit')), false);
});

test('approved runtime config permits a fictional test record marked real through the text send boundary', async t => {
  const directory = temp(t); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(JSON.stringify({ ...textAnswer(run5), usage: { input_tokens: 0, output_tokens: 0 } })); });
  const request = { provider: 'openai', path: '/v1/responses', stage: 'story', body: buildStoryRequest(family, sentences[0]), familyRecord: { real: true } };
  const denied = createTransport({ keys: { openai: 'offline-key' }, logFile: join(directory, 'denied.jsonl'), costCatalog: offlinePrices });
  await assert.rejects(denied.call(request), /Real family details need your permission/); assert.equal(existsSync(join(directory, 'denied.jsonl')), false);
  const allowed = createTransport({ keys: { openai: 'offline-key' }, logFile: join(directory, 'allowed.jsonl'), costCatalog: offlinePrices, config: { zeroRetentionApproved: true } });
  await allowed.call(request); assert.equal(calls, 1);
});

test('only OPENAI_API_KEY is read and no Anthropic credential is required', t => {
  const previous = process.env.OPENAI_API_KEY;
  t.after(() => { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; });
  process.env.OPENAI_API_KEY = ' offline-test-key ';
  const keys = readKeys(); assert.deepEqual(keys, { openai: 'offline-test-key', status: { openaiPresent: true } });
});

test('model preflight requires writer, judge and all three image roles without writing the real prices file', async t => {
  const directory = temp(t), path = join(directory, 'prices.json');
  for (const missing of [null, 'story', 'storyCheck']) {
    saveJSON(path, offlinePrices);
    const transport = { async call(request) { assert.equal(request.method, 'GET'); return { data: Object.values(offlinePrices.selected).filter(id => !missing || id !== offlinePrices.selected[missing]).map(id => ({ id })) }; } };
    if (missing) await assert.rejects(checkModels(transport, { path }), /absent/);
    else assert.equal(Object.keys((await checkModels(transport, { path })).liveModelAvailability).length, new Set(Object.values(offlinePrices.selected)).size);
  }
});

test('unknown text prices remain unknown, including zero-token test-shaped responses', () => {
  const model = offlinePrices.selected.story, catalog = structuredClone(offlinePrices);
  catalog.models[model].input = null;
  assert.equal(calculateCost(model, { input_tokens: 0, output_tokens: 0 }, catalog).usd, null);
  assert.equal(calculateCost(model, { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 200 } }, offlinePrices).usd, .00264);
});

test('missing model prices stop before the call counter, network and request log', async t => {
  const directory = temp(t), catalog = structuredClone(offlinePrices);
  catalog.models[catalog.selected.story].input = null;
  t.mock.method(globalThis, 'fetch', () => assert.fail('No call without a known price'));
  const logFile = join(directory, 'wire.jsonl');
  const transport = createTransport({ keys: { openai: 'offline-key' }, logFile, costCatalog: catalog });
  await assert.rejects(transport.call({ provider: 'openai', path: '/v1/responses', stage: 'story', familyRecord: { real: false }, body: buildStoryRequest(family, sentences[0]) }), /Cannot start a paid call: Missing or invalid model price/);
  assert.equal(existsSync(logFile), false);
});

test('legacy saved-rhyme helper preserves its historical fallback for old comparison records', () => {
  const fresh = run5.tagline;
  for (const review of [undefined, comparison(fresh), { ...comparison(fresh, true), reason: '' }]) {
    const check = checked(fresh, review); if (review === undefined) delete check.answers.rhymeComparison;
    assert.equal(chooseRhyme(fresh, move, check).source, 'approved');
  }
});

test('legacy saved-rhyme helper ignores unsupported historical comparison preferences', () => {
  const fresh = run5.tagline;
  assert.equal(chooseRhyme(fresh, move, checked(fresh, comparison(fresh, true))).source, 'approved');
  for (const rule of rhymeComparisonRules) for (const mutation of ['fail', 'empty', 'invented']) {
    const review = comparison(fresh, true);
    if (mutation === 'fail') review.fresh.rules[rule].passes = false;
    else review.fresh.rules[rule].evidence = mutation === 'empty' ? '' : 'Words absent from the rhyme';
    assert.equal(chooseRhyme(fresh, move, checked(fresh, review)).source, 'approved', `${rule}: ${mutation}`);
  }
  const long = 'Name the feeling with these many words and keep it really near.';
  assert.equal(chooseRhyme(long, move, checked(long, comparison(long, true))).source, 'approved');
});

test('full offline kit keeps its saved topic reminder on the poster and replay card', async t => {
  const directory = temp(t), memory = createMemory(join(directory, 'family.json')); memory.store(family);
  const transport = offlineTransport(t, directory);
  const result = await createKit(transport, memory, sentences[0], { directory, exports: offlineExports() });
  const chosen = selectedRhymeFor(move).tagline;
  assert.equal(result.complete, true); assert.equal(result.tagline, chosen); assert.equal(result.rhymeSelection.source, 'topic');
  assert.ok(visibleText(result.pages['for-you.html']).includes(chosen));
  for (const name of ['story.html', 'story-2.html', 'try.html']) assert.doesNotMatch(result.pages[name], /class="kit-rhyme"|class="review-label"/);
  assert.equal(result.art.poster.expectedBoxes.find(box => box.id === 'tagline').text, chosen);
  assert.equal(readJSON(join(directory, 'rhyme-selection-1.json')).tagline, chosen);
  assert.equal(statSync(join(directory, 'rhyme-selection-1.json')).mode & 0o777, 0o600);
  assert.match(readFileSync(join(directory, 'kit-log.md'), 'utf8'), /topic rhyme printed/);
  assert.ok(transport.calls.every(call => call.provider === 'openai'));
});

test('legacy comparison extras cannot replace the current checked kit rhyme', async t => {
  const directory = temp(t), fresh = { ...run5, tagline: 'Name it clear, keep it near.' };
  const transport = offlineTransport(t, directory, request => request.stage === 'story' ? textAnswer(fresh) : request.stage === 'story-check' ? textAnswer({ ...storyCheckAnswer(fresh.tagline), rhymeComparison: comparison(fresh.tagline, true) }) : undefined);
  const result = await readyStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.equal(result.tagline, selectedRhymeFor(move).tagline); assert.equal(result.story, run5.story); assert.equal(result.rhymeSelection.source, 'topic');
  assert.equal(result.rhymeSelection.ownerApproved, true); assert.equal(result.tagline, selectedRhymeFor(move).tagline);
  assert.deepEqual(transport.calls.map(call => call.stage), ['story', 'story-check']);
  assert.equal(readJSON(join(directory, 'kit-text-final.json')).tagline, result.tagline);
});

test('an approved rhyme quoted in the chapter stays verbatim with validated pages', async t => {
  const directory = temp(t), original = { ...run5, story: run5.story.replace('The backpack goes thud.', `The backpack goes thud. ${run5.tagline}`) };
  const transport = offlineTransport(t, directory, request => request.stage === 'story' ? textAnswer(original) : undefined);
  const result = await readyStory(withKitEvidence(transport, directory), family, sentences[0]);
  assert.ok(result.story.includes(selectedRhymeFor(move).tagline)); assert.ok(result.story.includes(run5.tagline));
  assert.equal(result.story, original.story.replace(run5.tagline, result.tagline));
  assert.ok(result.pagination.pages.join('\n').includes(result.tagline));
  assert.equal(transport.calls.filter(call => call.stage.startsWith('story') && call.stage !== 'story-check').length, 1);
});

test('run 10 needs writable-row evidence without inventing a filled blank or discarding extra words', () => {
  const expected = readJSON(new URL('./fixtures/run10-approved-words.json', import.meta.url)).boxes;
  for (const n of [1, 3]) {
    const answer = readJSON(new URL(`./fixtures/run10-poster-${n}-answer.json`, import.meta.url));
    const check = parseWordCheck(JSON.stringify(answer), expected);
    assert.equal(check.ready, false); assert.equal(check.needsRecheck, true); assert.equal(check.geometry.writingAssessment.verified, false);
    if (n === 3) assert.ok(check.observations.some(row => row.key === 'innerSubBoxContact'));
  }
  const filled = readJSON(new URL('./fixtures/run10-poster-2-answer.json', import.meta.url));
  assert.ok(!parseWordCheck(JSON.stringify(filled), expected).faults.includes('filledBlank'));
  assert.ok(parseWordCheck(JSON.stringify(filled), expected).ignoredFaults.some(row => row.key === 'filledBlank'));
  const lettered = readJSON(new URL('./fixtures/run10-poster-2-recheck-answer.json', import.meta.url));
  const check = parseWordCheck(JSON.stringify(lettered), expected);
  assert.match([...check.faults, ...check.reviewFlags.map(flag => flag.evidence)].join('; '), /extra_words_outside_boxes/);
});

test('hero and card drift are reported while measured overlapping words still fail', () => {
  const hero = geometryAnswer(posterTemplate.version); hero.observed.find(box => box.id === 'hero').h += 70;
  const result = validateGeometryReceipt(hero);
  const residual = result.fit.residuals.find(row => row.id === 'hero');
  assert.ok(Math.abs(residual.pageFraction.h) > .08 && Math.abs(residual.pageFraction.h) < .15);
  assert.ok(!result.observations.some(row => row.evidence.startsWith('geometry_deviation_hero')));
  const card = geometryAnswer(posterTemplate.version); card.observed.find(box => box.id === 'source').h += 80;
  assert.ok(validateGeometryReceipt(card).observations.some(row => row.evidence.startsWith('geometry_deviation_source')));
  const contact = geometryAnswer(posterTemplate.version); contact.observed.find(box => box.id === 'plan.handwriting').h += 20;
  assert.equal(validateGeometryReceipt(contact).ready, true);
  const bodyLine = contact.textLines.find(line => line.boxId === 'plan.body'), backupLine = contact.textLines.find(line => line.boxId === 'plan.backup');
  backupLine.y = bodyLine.y;
  assert.ok(validateGeometryReceipt(contact).faults.some(fault => fault.startsWith('text_lines_overlap')));
});

test('the drawer receives a visual fragment rather than the run 10 joke sentence', () => {
  const prose = "The pencil in the fox's sketchbook has a tiny tool belt.";
  const direction = visualJokeDirection(prose);
  assert.match(direction, /Draw: pencil in the fox's sketchbook with a tiny tool belt; no words/);
  assert.ok(!direction.includes(prose));
  const request = buildPosterRequest(family, move, sentences[0], { ...run5, jokeIdea: prose });
  assert.ok(request.prompt.includes(direction)); assert.ok(!request.prompt.includes(prose));
});
