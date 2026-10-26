import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { moves, readJSON, saveJSON, extractJSON, root } from '../server/files.js';
import { validateStory, applyFieldCorrection } from '../server/story.js';
import { parseStoryCheck } from '../server/check-story.js';
import { parsePictureCheck } from '../server/check-picture.js';
import { parseCastCheck } from '../server/check-cast.js';
import { publicCast } from '../server/cast.js';
import { parseWordCheck } from '../server/check-words.js';
import { validateGeometryReceipt } from '../server/poster-template.js';
import { compareBoxWords } from '../server/word-comparison.js';
import { scrubWriterImageText } from '../server/writer-image-text.js';
import { normalizeKitText } from '../server/writing-guidance.js';
import { privacyFor } from '../server/requests.js';
import { assessCheck, reviewNote } from '../server/stop-policy.js';
import { family, sentences } from './fixture.mjs';

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const walkFiles = directory => /(?:^|\/)render-check(?:\/|$)/.test(directory) ? [] : existsSync(directory) ? readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walkFiles(join(directory, entry.name)) : [join(directory, entry.name)]) : [];
const historicalRun = path => Number(path.match(/run(\d+)/)?.[1]) || ({ '20-36': 6, '20-52': 7, '21-17': 8, '21-34': 8, '22-01': 9, '22-18': 10, '22-41': 11, '23-02': 12, '23-33': 13, '01-08': 14 }[path.match(/T(\d+-\d+)/)?.[1]]);
const fixturePath = name => join(root, 'test/fixtures', name);
function originalStory(path, before = Infinity) {
  const directory = dirname(path);
  if (before === Infinity && existsSync(join(directory, 'kit-text-final.json'))) return readJSON(join(directory, 'kit-text-final.json'));
  const attempts = walkFiles(directory).filter(file => dirname(file) === directory && /story-attempt-\d+\.json$/.test(file) && Number(file.match(/attempt-(\d+)/)[1]) < before).sort((a, b) => Number(a.match(/attempt-(\d+)/)[1]) - Number(b.match(/attempt-(\d+)/)[1]));
  let previous;
  for (const file of attempts) {
    const value = readJSON(file);
    if (value.moveId) previous = value;
    else if (previous && typeof value.story === 'string') previous = applyFieldCorrection(previous, value, Object.keys(value).filter(key => key !== 'story'));
  }
  if (previous) return previous;
  const run = historicalRun(path);
  for (const name of [`run${run}-story.json`, `run${run}-story-1.json`]) if (existsSync(fixturePath(name))) return readJSON(fixturePath(name));
}
function approvedBoxes(path, saved) {
  // The old picture must be compared to the words actually ordered then, never today's edited records.
  if (saved?.wordVerdicts?.length) return saved.wordVerdicts.map(row => ({ id: row.id, text: row.approvedText }));
  const run = historicalRun(path), file = fixturePath(`run${run}-approved-words.json`);
  if (existsSync(file)) return readJSON(file).boxes;
  return null;
}
function castInputs(file) {
  const load = path => existsSync(path) ? readJSON(path) : null;
  const record = load(join(dirname(file), '../family.json'));
  const checkpoint = load(join(dirname(file), 'checkpoint.json'));
  const castRecord = [record, checkpoint?.recordAtStart].find(record => Array.isArray(record?.cast) && record.cast.length);
  const pictureIds = checkpoint?.stages?.['cast-continuity']?.pictureHashes?.map(picture => picture.id);
  const reasons = [];
  if (!castRecord) reasons.push('Original cast is missing from saved family.json and checkpoint.json.');
  if (!pictureIds?.length || pictureIds.some(id => typeof id !== 'string' || !id)) reasons.push('Original picture ids are missing from the saved checkpoint cast-continuity stage.');
  return { cast: castRecord ? publicCast(castRecord) : null, pictureIds, reasons };
}
const classify = parsed => { const check = assessCheck(parsed, { final: true }); return ({ verdict: check.verified === false && check.ready ? 'REVIEW' : check.ready ? 'PASS' : 'FAIL',
  reasons: [...(check.verified === false ? check.reviewFlags.filter(row => ['checker_unverified', 'narrative_checks_unverified'].includes(row.key)).map(row => row.evidence) : []), ...(check.faults ?? []), ...(check.measurementFaults ?? []), ...(check.qualityCoverage === 'legacy-unverified' ? ['Legacy answer lacks current evidence and quality fields.'] : [])],
  reviewFlags: [...(check.reviewFlags ?? []), ...(check.observations ?? [])].filter(row => row.reportOnly).map(row => row.key),
  ignored: (check.ignoredFaults ?? []).map(row => row.key) }); };

export function replaySaved({ directories = [join(root, 'test/out'), join(root, 'test/fixtures')] } = {}) {
  const rows = [], files = directories.flatMap(walkFiles).filter(path => /\.json$|story-attempt-\d+\.raw\.txt$|(?:run14-)?kit-log\.md$/.test(path) && !/chrome-|\/replay-saved\.|\/replay-expectations\./.test(path)).sort();
  const add = (file, pointer, kind, value, verdict) => rows.push({ id: relative(root, file) + (pointer ? '#' + pointer : ''), kind, sha256: hash(value), ...verdict });
  for (const file of files) {
    const contents = readFileSync(file, 'utf8');
    if (/kit-log\.md$/.test(file)) {
      if (!file.includes('run14') && !file.includes('01-08-54-958Z')) continue;
      add(file, '', 'evidence-log', contents, { verdict: 'PASS', reasons: [], note: 'Historical ledger retained. Its old code rejection is not replayed as a current verdict.' }); continue;
    }
    if (/\.raw\.txt$/.test(file)) {
      try { extractJSON(contents); add(file, '', 'raw-answer', contents, { verdict: 'PASS', reasons: [] }); }
      catch { add(file, '', 'raw-answer', contents, { verdict: 'RECHECK', reasons: ['Incomplete or malformed saved answer; no complete JSON object.'] }); }
      continue;
    }
    let saved; try { saved = JSON.parse(contents); } catch { continue; }
    const recordPath = join(dirname(file), '../family.json');
    const record = existsSync(recordPath) ? readJSON(recordPath) : family;
    const privacy = privacyFor(record, sentences[0]);
    let story, castAnswers;
    const getStory = () => story ??= originalStory(file);
    const castRawText = value => {
      // Checkpoints and result files repeat answers; re-use their original raw evidence.
      castAnswers ??= readdirSync(dirname(file)).filter(name => /^picture-check-cast-continuity-\d+\.json$/.test(name)).map(name => readJSON(join(dirname(file), name)));
      return castAnswers.find(saved => hash(saved.answer) === hash(value))?.rawText;
    };
    const visit = (value, pointer = '', parent) => {
      if ((!pointer && /^picture-check-cast-continuity-\d+\.json$/.test(basename(file))) || Array.isArray(value?.pictures)) {
        let inputs, rawText;
        try {
          inputs = castInputs(file);
          rawText = value?.rawText ?? parent?.rawText ?? (Array.isArray(value?.pictures) ? castRawText(value) : undefined);
        }
        catch (error) { inputs = { reasons: ['Cannot recover original cast-check inputs: ' + error.message] }; }
        const reasons = [...inputs.reasons];
        if (typeof rawText !== 'string') reasons.push('Original rawText is missing from this saved cast answer.');
        add(file, pointer, 'cast-check', value, reasons.length ? { verdict: 'REVIEW', reasons } : classify(parseCastCheck(rawText, inputs.cast, inputs.pictureIds)));
        return;
      }
      if (value?.key === 'taglineEndWords' && Array.isArray(value.checkerEndWords)) {
        add(file, pointer, 'retired-code-receipt', value, { verdict: 'PASS', reasons: [], note: 'Retained as evidence only. Code no longer derives a rhyming pair or overrides the judge sound opinion.' }); return;
      }
      if (!value || typeof value !== 'object' || value.type && (value.properties || value.type === 'boolean')) return;
      if (Object.hasOwn(value, 'story') && typeof value.story === 'string' && (value.moveId || /story-(?:attempt-\d+|2)\.json$/.test(file) && !pointer)) {
        let candidate = value;
        try {
          if (!candidate.moveId) {
            const prior = basename(file).startsWith('run') ? readJSON(file.replace('-2.json', '-1.json')) : originalStory(file, Number(file.match(/attempt-(\d+)/)[1]));
            candidate = applyFieldCorrection(prior, value, Object.keys(value).filter(key => key !== 'story'));
          }
          candidate = normalizeKitText(scrubWriterImageText(candidate, privacy).text);
          const result = validateStory(candidate, { nickname: record.hero.nickname, parentLabel: record.parentLabel, privacy });
          add(file, pointer, 'story', value, { verdict: 'PASS', reasons: [], guidance: result.guidance.filter(row => row.outsideRange), note: 'Current local scrub and validation; semantic quality and browser fit still require their own checks.' });
        } catch (error) { add(file, pointer, 'story', value, { verdict: basename(file) === 'result.json' && !value.panelLines ? 'RECHECK' : 'FAIL', reasons: error.failures?.map(row => row.code + ': ' + row.field) ?? [error.message] }); }
      }
      if ('secondMoveTaught' in value) {
        const original = getStory();
        const move = moves.find(move => move.id === original?.moveId);
        add(file, pointer, 'story-check', value, classify(parseStoryCheck(JSON.stringify(value), { story: original, move })));
        return;
      }
      if ('lettersPresent' in value && !('boxes' in value)) { add(file, pointer, 'picture-check', value, classify(parsePictureCheck(JSON.stringify(value)))); return; }
      if (value.placement && value.exported && (value.coordinateSpace || Array.isArray(value.fit?.residuals))) {
        add(file, pointer, 'geometry-fit-receipt', value, { verdict: 'REVIEW', reasons: ['Derived placement receipt retained. Original checker measurements need their own replay; this receipt cannot replace them.'] }); return;
      }
      if (Array.isArray(value.boxes) && ('extraText' in value || 'keyWordUnreadable' in value)) {
        const boxes = approvedBoxes(file, parent?.check ?? parent);
        if (!boxes) throw new Error(`Replay has no original approved word list: ${file}#${pointer}`);
        const check = parseWordCheck(JSON.stringify(value), boxes, { subBoxesRechecked: /recheck|poster-[234]/.test(file) });
        add(file, pointer, 'word-check', value, classify(check));
        if (value.geometry) add(file, pointer + '/geometry', 'geometry', value.geometry, classify(validateGeometryReceipt(value.geometry, { wordVerdicts: check.wordVerdicts, readback: value.boxes, subBoxesRechecked: /recheck|poster-[234]/.test(file) })));
        return;
      }
      if (value.templateVersion && Array.isArray(value.observed)) { add(file, pointer, 'geometry', value, classify(validateGeometryReceipt(value))); return; }
      if (Array.isArray(value.readback) && 'leftoverList' in value) {
        const boxes = approvedBoxes(file, value);
        if (!boxes) throw new Error(`Replay has no original transcription words: ${file}`);
        const diffs = boxes.map(box => compareBoxWords(box, value.readback.find(row => row.id === box.id)?.text ?? ''));
        const reasons = diffs.filter(diff => !diff.matches).map(diff => 'words_differ: ' + diff.id);
        for (const box of value.readback) if (!boxes.some(expected => expected.id === box.id)) reasons.push('extra_box: ' + box.id);
        if (value.leftoverList.length) reasons.push('extra_words_outside_boxes: ' + JSON.stringify(value.leftoverList));
        add(file, pointer, 'transcription', value, { verdict: reasons.length ? 'REVIEW' : 'PASS', reasons, reviewFlags: reasons.map(reason => reviewNote('transcription', reason)) }); return;
      }
      // Parse the raw saved answer once, not its repeated copy in check.answers.
      if ('answer' in value) {
        const before = rows.length;
        if (value.answer && typeof value.answer === 'object') visit(value.answer, pointer + '/answer', value);
        if (rows.length === before) {
          const hasRaw = typeof value.rawText === 'string';
          add(file, pointer, 'raw-checker-answer', value, { verdict: hasRaw ? 'RECHECK' : 'REVIEW', reasons: [hasRaw
            ? 'Incomplete or malformed saved checker answer; no recognized parsed checker object. Original rawText retained for recheck.'
            : 'Parsed checker answer and original rawText are missing; replay remains unverified.'] });
        }
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (['response', 'rawText', 'pages', 'recordAtStart', 'move'].includes(key)) continue;
        visit(child, pointer + '/' + key, value);
      }
    };
    visit(saved);
  }
  return rows;
}
export function replaySummary(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.kind + ':' + row.sha256;
    if (!groups.has(key)) groups.set(key, { ...row, copies: [] });
    groups.get(key).copies.push(row.id);
  }
  return [...groups.values()];
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const rows = replaySaved();
  saveJSON(join(root, 'test/out/replay-saved.json'), { note: 'Offline parser replay. No model calls or image reinspection. Historical words compared to historical orders. REVIEW means retained unverified checker evidence after the permitted recheck, or review-only text differences. RECHECK marks malformed raw writer evidence. No missing verdict is invented.', rows });
  for (const row of replaySummary(rows)) console.log(`${row.verdict} ${row.id} (${row.copies.length} saved copies): ${row.reasons.join('; ') || 'Current rules pass.'}`);
  console.log(`${rows.length} saved inputs replayed; ${replaySummary(rows).length} distinct inputs.`);
}
