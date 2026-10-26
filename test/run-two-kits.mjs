import { accountSavedAttempts } from '../server/charge-accounting.js';
import { readRunReviewFlags } from '../server/kit-evidence.js';
import { formatReviewFlags } from '../server/story-review.js';
import { mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, moves, readJSON, saveJSON } from '../server/files.js';
import { checkMoves } from '../content/check-moves.mjs';
import { checkSources } from '../content/check-sources.mjs';
import { createKit } from '../server/kit.js';
import { checkModels } from '../content/check-models.mjs';
import { createMemory } from '../server/memory.js';
import { readKeys } from '../server/keys.js';
import { route } from '../server/route.js';
import { createTransport, readLog } from '../server/transport.js';
import { adventureLine } from '../server/story.js';
import { previewPages, verifyOwnedWords } from '../server/layout.js';
import { buildPictureRequest, buildPictureCheckRequest, buildStoryRequest } from '../server/requests.js';
import { auditKits, deletedFactHits } from '../server/audit.js';
import { posterWordReport } from '../server/format.js';
import { printedCapacity } from '../server/printed-capacity.js';
import { family, sentences, oldFact, newFact, deletedFact } from './fixture.mjs';

const out = join(root, 'test/out');
const reportOnly = process.argv.includes('--report-only');
const localOnly = reportOnly || process.argv.includes('--local-only');
const capIndex = process.argv.indexOf('--max-calls');
const maxCalls = capIndex < 0 ? 24 : Number(process.argv[capIndex + 1]);
const timestamp = new Date().toISOString();
const oneKit = process.argv.includes('--one-kit');
const stopBeforePictures = process.argv.includes('--stop-before-pictures');
const resumeIndex = process.argv.indexOf('--resume');
const resumeFolder = resumeIndex < 0 ? null : process.argv[resumeIndex + 1];
if (resumeIndex >= 0 && (!resumeFolder || resumeFolder.startsWith('--'))) throw new Error('--resume needs a saved run folder.');
const runFolder = resumeFolder ? resolve(resumeFolder) : join(out, `pass9-${timestamp.replace(/[:.]/g, '-')}`);
const statePath = join(runFolder, 'run-state.json');
const runState = resumeFolder ? readJSON(statePath) : { version: 1, oneKit, stopBeforePictures, sentences, completedKits: [], nextKit: 1 };
if (runState.version !== 1) throw new Error('Unknown saved run version.');
const targetKitCount = runState.oneKit || oneKit || stopBeforePictures ? 1 : 2;
if (resumeFolder && Array.from({ length: targetKitCount }, (_, index) => index + 1).every(number => runState.completedKits.includes(number))) {
  console.log(`ALREADY COMPLETE: ${runFolder}`);
  process.exit(0);
}
mkdirSync(runFolder, { recursive: true });
// Each run gets its own memory file. Earlier state and request logs remain intact.
const memory = createMemory(join(runFolder, 'family.json'));
const kits = [], attempts = [];
const counts = moves.map(move => posterWordReport(move, undefined, { nickname: family.hero.nickname }));
let stopped = '', unitPass = false, unitCount = 0, contentPass = false, localMemoryPass = false, routePass = false, gatePass = false, layoutPass = false, runId = null;
const paidCommand = `node test/run-two-kits.mjs${oneKit || runState.oneKit ? ' --one-kit' : ''} --max-calls 76`;

function localChecks() {
  checkMoves(); checkSources(); contentPass = true;
  saveJSON(join(runFolder, 'poster-word-counts.json'), counts);
  console.table(counts.map(({ id, count, status, slots }) => ({ id, ...slots, total: count, status })));
  const files = readdirSync(join(root, 'test')).filter(name => name.endsWith('.test.mjs')).map(name => join(root, 'test', name));
  const retained = reportOnly ? readFileSync(join(out, 'unit-tests.tap'), 'utf8') : '';
  const result = reportOnly ? { status: /^# fail 0$/m.test(retained) ? 0 : 1, stdout: retained, stderr: '' } : spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { encoding: 'utf8', cwd: root });
  const output = (result.stdout ?? '') + (result.stderr ?? '');
  writeFileSync(join(out, 'unit-tests.tap'), output);
  unitPass = result.status === 0; unitCount = Number(output.match(/^# tests (\d+)/m)?.[1] ?? 0);
  if (!unitPass) throw new Error('Local unit tests failed.');
  routePass = sentences.every(sentence => route(sentence) === 'move');
  if (!routePass) throw new Error('A supplied sentence did not route to move.');
  const checkMemory = createMemory(join(runFolder, 'local-check-family.json'));
  checkMemory.store(family);
  const handle = checkMemory.cacheRequest(buildStoryRequest(checkMemory.exportRecord(), sentences[0]));
  checkMemory.editFact(oldFact, newFact); checkMemory.deleteFact(deletedFact);
  const saved = checkMemory.exportRecord();
  localMemoryPass = saved.familyContext.includes(newFact) && !/next week/i.test(JSON.stringify(saved)) && deletedFactHits(JSON.stringify(saved) + checkMemory.summarize3(), deletedFact).length === 0 && checkMemory.summarize3().split('\n').length === 3;
  try { checkMemory.getCachedRequest(handle); localMemoryPass = false; } catch { /* Old cache must be invalid. */ }
  if (!localMemoryPass) throw new Error('Local edit, delete or cache check failed.');
  buildPictureRequest(family, moves[0], sentences[0], { hero: true });
  buildPictureCheckRequest(family, moves[0], sentences[0], 'data:image/png;base64,AA==');
  gatePass = true;
  for (const move of moves) verifyOwnedWords(previewPages(move, { parentLabel: 'Dee' }), move);
  layoutPass = true;
}

async function buildKit(transport, number) {
  const start = performance.now(); const attempt = { number, complete: false }; attempts.push(attempt);
  try {
    const result = await createKit(transport, memory, runState.sentences[number - 1], { kit: number, directory: join(runFolder, `kit-${number}`), stopBeforePictures, resume: Boolean(resumeFolder && existsSync(join(runFolder, `kit-${number}`, 'checkpoint.json'))) });
    if (result.stoppedBeforePictures) {
      saveJSON(join(result.directory, 'text-result.json'), result);
      console.log(`Accepted story and kit text saved: ${result.directory}. Pictures not requested. Fit: ${result.layoutFit.measured ? result.layoutFit.ready ? 'PASS' : 'OVERFLOW' : 'UNVERIFIED'}.`);
      return result;
    }
    if (!result.ready) throw new Error(`Kit stopped: ${result.status}`);
    const kit = { number, tonight: runState.sentences[number - 1], ...result, elapsedSeconds: (performance.now() - start) / 1000 };
    Object.assign(attempt, { complete: kit.complete, elapsedSeconds: kit.elapsedSeconds }); kits.push(kit);
    saveJSON(join(kit.directory, 'result.json'), kit);
    if (!kit.complete) throw new Error(`PDF failed: ${kit.pdf.reason ?? kit.pdf.signal}`);
    return kit;
  } catch (error) { Object.assign(attempt, { elapsedSeconds: (performance.now() - start) / 1000, error: error.message }); throw error; }
}

function writeReport() {
  const record = existsSync(join(runFolder, 'family.json')) ? memory.exportRecord() : family;
  const runIds = new Set([...(runState.runIds ?? []), runId].filter(Boolean));
  const log = readLog().filter(row => runIds.has(row.runId));
  const requests = log.filter(row => row.event === 'request' && row.method !== 'GET');
  const responses = new Map(log.filter(row => row.event === 'response').map(row => [row.id, row]));
  const knownCost = requests.reduce((sum, row) => sum + (responses.get(row.id)?.cost?.usd ?? 0), 0);
  const accounting = accountSavedAttempts(log, readJSON(new URL('../content/prices.json', import.meta.url)));
  saveJSON(join(runFolder, 'charge-accounting.json'), accounting);
  const accountedCost = accounting.reduce((sum, row) => sum + row.accounting.usd, 0);
  const unknownCharges = requests.filter(row => responses.get(row.id)?.cost?.usd == null).length;
  const target = targetKitCount;
  const completed = [...new Set(runState.completedKits)].length;
  const textPath = join(runFolder, `kit-${runState.nextKit}`, 'text-result.json');
  const text = stopBeforePictures && existsSync(textPath) ? readJSON(textPath) : null;
  const audit = target === 2 && completed === 2 ? auditKits({ kits, record, log, deletedFact }) : null;
  const localPassed = unitPass && contentPass && localMemoryPass && routePass && gatePass && layoutPass;
  const outcome = localOnly && localPassed ? 'LOCAL PASS. Paid run not requested.' : stopped ? `STOPPED: ${stopped}` : text ? 'TEXT SAVED. No pictures requested. Resume uses the saved accepted text.' : completed === target ? `COMPLETE: ${completed} kit(s) exported for review.` : 'NOT COMPLETE: inspect the saved checks.';
  const reviewFlags = readRunReviewFlags(runFolder);
  const capacity = printedCapacity();
  const result = { timestamp, outcome, reviewFlags, printedCapacity: capacity, runFolder, mode: text ? 'text-only' : target === 1 ? 'one-kit' : 'two-kit', unitCount, unitPass, attempts, completedKits: runState.completedKits, layoutFit: text?.layoutFit ?? null, audit, maxCalls, paidCalls: requests.length, knownCost, accountedCost, unknownCharges };
  saveJSON(join(runFolder, 'run-report.json'), result);
  saveJSON(join(out, 'results.json'), result);
  const body = `# Slice 0 pass 31\n\n${outcome}\n\n${unitCount} local tests ${unitPass ? 'passed' : 'failed'}. Paid calls across this run and resumes: ${requests.length}. Known cost $${knownCost.toFixed(8)}; unknown charges ${unknownCharges}. Budget accounting including full ceilings for unknown charges: $${accountedCost.toFixed(8)}. A call allowance is not a dollar ceiling.\n\nRun folder: ${runFolder}\n\n${formatReviewFlags(reviewFlags)}\n\nAccepted text, raw answers, judge verdicts, picture readbacks, geometry review flags and layout measurements remain in each kit folder. Saved rhymes print verbatim; authorship and owner approval status stay in parent notes and kit-editorial.json. Poster counts are reports only. Editorial chapter target: ${capacity.story.targetWords} words, advisory ceiling ${capacity.story.ceilingWords}, with ${capacity.story.pages.join(" and ")} planned per page. Fresh browser fit is unverified until measured. Try It: ${capacity.try.totalWords} generated words. Cards: ${capacity["for-you"].totalWords} generated words. Each move also receives its writing budgets. ${capacity.ownerReview ?? ""} Measured page overflow asks for shorter generated prose at readable type. Counts alone never stop a run. No public or family-use approval is implied.\n\n${text ? `Text fit: ${text.layoutFit.measured ? text.layoutFit.ready ? 'PASS' : 'OVERFLOW' : 'UNVERIFIED'}.` : ''}\n\n${target === 1 ? "One-kit" : "Two-kit"} paid run:\n\n${paidCommand}\n\nResume without buying accepted stages again:\n\nnode test/run-two-kits.mjs --resume '${runFolder}' --max-calls 76\n\nFresh saved-content rendering (outside the sandbox):\n\nnode test/render-saved-kit.mjs\n\nOffline full failure list:\n\nnode test/replay-saved.mjs\n`;
  writeFileSync(join(runFolder, 'REPORT.md'), body);
  console.log(`${outcome}\n${unitCount} local tests. Paid calls: ${requests.length}.\nRun folder: ${runFolder}`);
  return stopped ? 2 : outcome.startsWith('COMPLETE') || text ? 0 : 1;
}

try {
  if (!Number.isInteger(maxCalls) || maxCalls < 0 || maxCalls > 76) throw new Error('Invalid --max-calls; allowed 0 to 76.');
  localChecks();
  if (localOnly) throw new Error('Paid test intentionally not run in this sandbox.');
  if (resumeFolder) {
    const previous = readLog().filter(row => (runState.runIds ?? []).includes(row.runId));
    // Historical usage stays unknown; charge each missing receipt at its saved
    // request bound so an interrupted call does not permanently forbid resume.
    saveJSON(join(runFolder, 'charge-accounting.json'), accountSavedAttempts(previous, readJSON(new URL('../content/prices.json', import.meta.url))));
  }
  const keys = readKeys();
  if (!keys.openai) throw new Error('Required OPENAI_API_KEY is absent. No paid test run.');
  const transport = createTransport({ keys, maxCalls }); runId = transport.runId;
  runState.runIds = [...(runState.runIds ?? []), runId];
  await checkModels(transport, { receiptPath: join(runFolder, 'model-availability.json') });
  if (!resumeFolder) memory.store(family);
  saveJSON(statePath, runState);
  for (const number of runState.completedKits) kits.push(readJSON(join(runFolder, `kit-${number}`, 'result.json')));
  const count = targetKitCount;
  for (let number = runState.nextKit; number <= count; number++) {
    const built = await buildKit(transport, number);
    if (built.stoppedBeforePictures) { runState.stoppedBeforePictures = true; saveJSON(statePath, runState); break; }
    if (!runState.completedKits.includes(number)) {
      const alreadySaved = memory.exportRecord().pastKits.find(row => row.chapterNumber === built.chapterNumber);
      if (alreadySaved && alreadySaved.moveId !== built.moveId) throw new Error('Saved chapter belongs to a different move.');
      if (!alreadySaved) memory.addKit({ date: timestamp.slice(0, 10), chapterNumber: built.chapterNumber, moveId: built.moveId, triedMove: 'yes', didItHelp: 'yes', adventureLine: adventureLine(built.story, family.hero.nickname), world: built.world, colourSet: built.colourSet });
      if (number === 1) {
        if (memory.exportRecord().familyContext.includes(oldFact)) memory.editFact(oldFact, newFact);
        if (memory.exportRecord().familyContext.includes(deletedFact)) { memory.deleteFact(deletedFact); transport.recordDeletion(memory.exportRecord().revision); }
      }
      runState.completedKits.push(number); runState.nextKit = number + 1; saveJSON(statePath, runState);
    }
  }

} catch (error) { stopped = error.message; }
process.exitCode = writeReport();
