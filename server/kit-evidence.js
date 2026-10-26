import { formatReviewFlags } from './story-review.js';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractJSON, saveJSON } from './files.js';
import { visibleWords } from './format.js';

const textFrom = response => response?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n') ??
  (response?.output ?? []).flatMap(item => item.content ?? []).filter(block => block.type === 'output_text').map(block => block.text).join('\n');
const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const privateText = (path, text) => { writeFileSync(path, text, { mode: 0o600 }); chmodSync(path, 0o600); };

export function readRunReviewFlags(directory) {
  return readdirSync(directory).filter(name => /^kit-\d+$/.test(name)).flatMap(name => {
    const path = join(directory, name, 'review-flags.json');
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).reviewFlags.map(flag => ({ ...flag, kit: name })) : [];
  });
}

// Observe answers before any validator runs. Requests and keys never enter these files.
export function withKitEvidence(transport, directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const ledgerPath = join(directory, 'kit-log.json');
  const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : [];
  const responses = new WeakMap();
  const counters = new Map();
  const next = stem => {
    if (!counters.has(stem)) {
      const pattern = new RegExp(`^${stem}-(\\d+)\\.`);
      counters.set(stem, Math.max(0, ...readdirSync(directory).map(name => Number(name.match(pattern)?.[1] ?? 0))));
    }
    const number = counters.get(stem) + 1; counters.set(stem, number); return number;
  };
  const flush = () => {
    saveJSON(ledgerPath, ledger);
    privateText(join(directory, 'kit-log.md'), '# Kit log\n\nCost and call time come from the matching request-log response. UNKNOWN means no request-log receipt was available.\n\n| Stage | Attempt | Effort | Reasoning tokens | Seconds | USD | Verdict |\n| --- | ---: | --- | ---: | ---: | ---: | --- |\n' + ledger.map(row =>
      `| ${cell(row.stage)} | ${row.attempt} | ${row.reasoningEffort ?? 'n/a'} | ${row.reasoningTokens ?? 'UNKNOWN'} | ${row.elapsedSeconds?.toFixed(3) ?? 'UNKNOWN'} | ${row.cost?.usd == null ? 'UNKNOWN' : row.cost.usd.toFixed(8)} | ${cell(row.verdict + (row.fixture ? ' (export fixture)' : '') + (row.reviewFlags?.length ? '; ' + formatReviewFlags(row.reviewFlags) : '') + (row.observations?.length ? '; observations: ' + row.observations.map(item => item.key + ': ' + item.evidence).join('; ') : '') + (row.extraKeys?.length ? '; ignored extra keys: ' + row.extraKeys.join(', ') : '') + (row.ignoredFaults?.length ? '; ignored: ' + row.ignoredFaults.map(item => item.key + ': ' + item.reason).join('; ') : ''))} |`).join('\n') + '\n');
  };
  const saveAnswer = (request, response, fallbackVerdict) => {
    const receipt = transport.responseDetails?.(response);
    const stage = request.stage;
    const story = ['story', 'story-rewrite', 'story-correction'].includes(stage);
    const checker = stage === 'story-check' || stage.endsWith('-check');
    const kind = stage.replace(/-word-check$|-check$/g, '');
    const stem = story ? 'story-attempt' : stage === 'story-check' ? 'story-check' : checker ? `picture-check-${kind}` : stage;
    const attempt = next(stem);
    const row = { stage, attempt, reasoningEffort: receipt?.reasoningEffort ?? request.body?.reasoning?.effort ?? null, reasoningTokens: receipt?.reasoningTokens ?? response.usage?.output_tokens_details?.reasoning_tokens ?? null, requestId: receipt?.id ?? null, elapsedSeconds: receipt?.callElapsedSeconds ?? receipt?.elapsedSeconds ?? null,
      cost: receipt?.callCost ?? receipt?.cost ?? null, accounting: receipt?.callAccounting ?? receipt?.accounting ?? null, verdict: fallbackVerdict ?? 'PENDING' };
    ledger.push(row);
    const rawText = textFrom(response) || response?.malformedResponse || '';
    let answer = null;
    if (response?.malformedResponse === undefined) {
      try { answer = extractJSON(rawText); } catch { /* The raw answer remains evidence. */ }
    }
    const entry = { row, stem, attempt, response, rawText, answer, story, checker, kind };
    responses.set(response, entry);
    if (story) {
      if (answer !== null) saveJSON(join(directory, `${stem}-${attempt}.json`), answer);
      else privateText(join(directory, `${stem}-${attempt}.raw.txt`), rawText || JSON.stringify(response, null, 2));
      privateText(join(directory, `${stem}-${attempt}.reason.txt`), row.verdict + '\n');
    }
    if (checker) saveCheck(entry);
    flush();
    return entry;
  };
  function saveCheck(entry, check) {
    const { stem, attempt, response, rawText, answer, row, kind } = entry;
    saveJSON(join(directory, `${stem}-${attempt}.json`), { answer, rawText, response, verdict: row.verdict, ...(check ? { check } : {}) });
    if (kind === 'poster') saveJSON(join(directory, `poster-transcription-${attempt}.json`), {
      readback: answer?.boxes ?? null,
      words: Array.isArray(answer?.boxes) ? answer.boxes.map(box => ({ id: box?.id ?? null, words: typeof box?.text === 'string' ? visibleWords(box.text) : [] })) : null,
      leftoverList: answer?.extraText ?? null, verdict: row.verdict,
      ...(check ? { wordVerdicts: check.wordVerdicts, geometryFit: check.geometry?.fit, ...(check.geometry?.placement ? { geometryPlacement: check.geometry.placement } : {}), approvedWordCount: check.wordCap?.count, transcribedWordCount: check.transcriptionWordCap?.count } : {}),
    });
  }
  const wrapped = {
    ...transport,
    async call(request) {
      let response;
      try { response = await transport.call(request); }
      catch (error) {
        if (error.response && typeof error.response === 'object') saveAnswer(request, error.response, error.message);
        else {
          ledger.push({ stage: request.stage, attempt: next(request.stage), requestId: error.receipt?.id ?? null, elapsedSeconds: error.receipt?.elapsedSeconds ?? null, cost: error.receipt?.cost ?? null, accounting: error.receipt?.accounting ?? null, verdict: error.message }); flush();
        }
        throw error;
      }
      saveAnswer(request, response);
      return response;
    },
    recordVerdict(response, reason, check) {
      const entry = responses.get(response);
      if (!entry) throw new Error('Kit verdict has no saved answer.');
      entry.row.verdict = reason;
      if (check?.extraKeys?.length) entry.row.extraKeys = check.extraKeys;
      if (check?.reviewFlags?.length) {
        entry.row.reviewFlags = check.reviewFlags;
        const reviewFlags = ledger.flatMap(row => (row.reviewFlags ?? []).map(flag => ({ ...flag, stage: row.stage, attempt: row.attempt })));
        saveJSON(join(directory, 'review-flags.json'), { label: "FOR SUNNY'S READ", reviewFlags });
      }
      if (check?.observations?.length) entry.row.observations = check.observations;
      if (check?.ignoredFaults?.length) entry.row.ignoredFaults = check.ignoredFaults;
      if (entry.story) {
        privateText(join(directory, `${entry.stem}-${entry.attempt}.reason.txt`), reason + '\n');
        if (check) saveJSON(join(directory, `${entry.stem}-${entry.attempt}.verdict.json`), { verdict: reason, ...check });
        if (check?.failures) { saveJSON(join(directory, `${entry.stem}-${entry.attempt}.validation.json`), { failures: check.failures }); entry.row.failures = check.failures; }
      }
      if (entry.checker) saveCheck(entry, check);
      flush();
    },
    recordRejection(response, reason, details) {
      transport.recordRejection(response, reason, details);
      wrapped.recordVerdict(response, reason, details);
    },
    recordReviewFlags(stage, flags) {
      ledger.push({ stage, attempt: next(stage), cost: { usd: 0 }, elapsedSeconds: 0, verdict: "FOR SUNNY'S READ", reviewFlags: flags });
      saveJSON(join(directory, 'review-flags.json'), { label: "FOR SUNNY'S READ", reviewFlags: ledger.flatMap(row => (row.reviewFlags ?? []).map(flag => ({ ...flag, stage: row.stage, attempt: row.attempt }))) }); flush();
    },
    recordKitText(value) { saveJSON(join(directory, 'kit-text-final.json'), value); },
    recordLocalResult(stage, value, verdict = 'PASS') {
      if (!/^[a-z0-9-]+$/.test(stage)) throw new Error('Invalid local result name.');
      const attempt = next(stage);
      saveJSON(join(directory, `${stage}-${attempt}.json`), value);
      ledger.push({ stage, attempt, elapsedSeconds: 0, cost: { usd: 0, reason: 'Local saved-content selection; no model call.' }, verdict });
      flush();
    },
    async localStage(stage, run) {
      transport.onStage?.(stage);
      const start = performance.now();
      const row = { stage, attempt: next(stage), cost: { usd: 0, reason: 'Local stage, no model call.' }, verdict: 'PENDING' };
      ledger.push(row); flush();
      try {
        const result = await run();
        if (result?.fixture) { row.fixture = true; row.note = result.reason; }
        row.verdict = result?.measured === false ? `UNVERIFIED: ${result.reason ?? 'No browser measurements.'}` : result?.ready === false ? `FAIL: ${(result.faults ?? []).join('; ')}` : result?.rendered === false ? result.reason ?? 'Export failed.' : 'PASS';
        return result;
      } catch (error) { row.verdict = error.message; throw error; }
      finally { row.elapsedSeconds = (performance.now() - start) / 1000; flush(); }
    },
  };
  return wrapped;
}
