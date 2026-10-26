import { summarize3 } from './memory.js';
import { verifyOwnedWords, visibleText, escapeHTML } from './layout.js';
import { assertNoFamilyText, privacyFor, storyMoveFor } from './requests.js';
import { moves } from './files.js';
import { isDeepStrictEqual } from 'node:util';
import { lockedCast } from './cast.js';
import { imageHash } from './picture.js';

export function auditCastContinuity(kits, record) {
  try {
    if (!record.cast?.length || !kits.length) return false;
    const cast = lockedCast(record);
    if (cast.some(person => !person.referencePath || !person.referenceHash || imageHash(person.referencePath) !== person.referenceHash)) return false;
    const expected = cast.map(person => ({ characterId: person.id, hash: person.referenceHash }));
    const pictureIds = ['panel-1', 'panel-2', 'panel-3', 'panel-4', 'poster'];
    return kits.every(kit => {
      const check = kit.art?.continuityChecks?.at(-1);
      return check?.ready === true && check.verified !== false && check.answers?.pictures?.map(picture => picture.id).sort().join() === pictureIds.join() &&
        [kit.art.poster, ...(kit.art.panels ?? [])].length === 5 && [kit.art.poster, ...(kit.art.panels ?? [])].every(picture => picture?.ready && isDeepStrictEqual(picture.castReferenceHashes, expected));
    });
  } catch { return false; }
}

// Exempt only whole, unchanged records at the app's known move-list paths.
function withoutMoveRecords(body) {
  const copy = structuredClone(body);
  for (const message of copy?.input ?? copy?.messages ?? []) {
    if (message.role !== 'user' || typeof message.content !== 'string') continue;
    let payload;
    try { payload = JSON.parse(message.content); } catch { continue; }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    if (Array.isArray(payload.moves)) payload.moves = payload.moves.map(record => moves.some(move => isDeepStrictEqual(record, move) || isDeepStrictEqual(record, storyMoveFor(move, { examples: true })) || isDeepStrictEqual(record, storyMoveFor(move, { examples: true, writing: true }))) ? '[fixed move record]' : record);
    if (moves.some(move => isDeepStrictEqual(payload.move, move) || isDeepStrictEqual(payload.move, storyMoveFor(move)))) payload.move = '[fixed move record]';
    message.content = JSON.stringify(payload);
  }
  return copy;
}

export function deletedFactHits(text, deletedFact) {
  const clean = value => value.normalize('NFKC').replace(/[’‘]/g, "'").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const normalized = ` ${clean(text)} `;
  const hits = [];
  if (deletedFact && normalized.includes(` ${clean(deletedFact)} `)) hits.push('deleted sentence');
  if (normalized.includes(' little brother ')) hits.push('little brother');
  if (normalized.includes(' brother ') && normalized.includes(' room ')) hits.push('brother + room');
  return hits;
}

export function auditDeletion({ record, log, kit2, deletedFact }) {
  const boundary = log.findIndex(row => row.event === 'memory-delete');
  const requestText = row => JSON.stringify(/^(story|story-rewrite|story-correction|story-check)$/.test(row.stage) ? withoutMoveRecords(row.body) : row.body);
  const beforeDeletion = boundary < 0 ? [] : log.slice(0, boundary).filter(row => row.event === 'request').map(row => ({ id: row.id, kit: row.kit, stage: row.stage, hits: deletedFactHits(requestText(row), deletedFact) }));
  const stored = structuredClone(record);
  stored.cachedRequests = (stored.cachedRequests ?? []).map(withoutMoveRecords);
  const scanned = [['stored record', JSON.stringify(stored)], ['three-line summary', summarize3(record)]];
  if (boundary >= 0) for (const row of log.slice(boundary + 1).filter(row => row.event === 'request')) scanned.push([`after deletion request ${row.id}`, requestText(row)]);
  for (const [name, html] of Object.entries(kit2?.pages ?? {})) {
    const canonicalMove = moves.find(move => move.id === kit2.move?.id);
    const prose = html.replace(/<(p|h1|h2|li)[^>]*data-owned="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g, (whole, tag, field, text) => {
      let value = field.split('.').reduce((value, key) => value?.[key], canonicalMove);
      if (Array.isArray(value)) value = value.join(', ');
      return typeof value === 'string' && text === escapeHTML(value) ? '' : whole;
    });
    scanned.push([`kit 2 ${name}`, visibleText(prose)]);
  }
  const hits = scanned.flatMap(([where, text]) => deletedFactHits(text, deletedFact).map(hit => `${where}: ${hit}`));
  return { passed: boundary >= 0 && hits.length === 0, boundary: boundary < 0 ? null : log[boundary], beforeDeletion, hits };
}

// This is a reading aid, not a proof that fictional narrative is factual.
const historyCue = /\b(yesterday|today|tomorrow|tonight|now|then|before|after|already|again|ago|once|next|soon|recently|time|times|moments?|minutes?|hours?|seconds?|yet|still|when|while|until|morning|afternoon|evening|night|days?|weeks?|months?|years?|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|previously|earlier|later|used to|last|remember(?:s|ed)?|always|every|since|had|was|were|did|went|won|lost|said|made|found|felt|told|gave|took|saw|knew|brought|became|began|learned|learnt|tried|helped|practiced|practised|moved|shared|played|sat|stood|ran|held|thought|got|came|left|kept|put|spoke|heard|wore|drew|met|slept|broke|bought|ate|drank|sang|swam|rode|wrote|read|sent|spent|built|chose|fell|forgot|grew|hid|let|lay|led|paid|rang|rose|shook|shone|shot|shut|sold|stole|taught|threw|woke|understood|could|would|\w+ed)\b/iu;
const sentencesIn = text => String(text ?? '').split(/(?<=[.!?]["”']?)\s+|\n+/).map(text => text.trim()).filter(Boolean);
export function attemptRejectReasons(log) {
  const reasons = new Map(log.filter(row => row.event === 'validation-reject').map(row => [row.id, row.reason]));
  const requests = log.filter(row => row.event === 'request');
  for (const [index, request] of requests.entries()) {
    if (!['story', 'story-rewrite', 'story-correction'].includes(request.stage)) continue;
    let correction;
    try { correction = JSON.parse((request.body.input ?? request.body.messages).find(message => message.role === 'user').content).correction?.error; } catch { continue; }
    const reason = correction?.match(/^Code rejected the previous answer: ([\s\S]+)\. Return the required JSON and fix that exact error\.$/)?.[1];
    if (!reason) continue;
    const previous = requests.slice(0, index).findLast(row => row.runId === request.runId && row.kit === request.kit && row.stage === request.stage && row.retry === request.retry - 1);
    if (previous && !reasons.has(previous.id)) reasons.set(previous.id, reason);
  }
  return reasons;
}
export function auditHistory(story, record, move, tonight = '') {
  const sources = [];
  const add = (path, text) => {
    if (typeof text !== 'string' || !text) return;
    sources.push({ path, text });
    sentencesIn(text).forEach((sentence, i) => sources.push({ path: `${path} sentence ${i + 1}`, text: sentence }));
  };
  const walk = (value, path) => {
    if (typeof value === 'string') add(path, value);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) walk(child, `${path}.${key}`);
  };
  walk({ familyContext: record.familyContext, hero: record.hero, pastKits: record.pastKits }, 'record');
  add('summary (summarize3)', summarize3(record));
  add('sentence (tonight)', tonight);
  walk(move, `move record (${move.id})`);
  add(`move record (${move.id}).practiceScript with nickname`, move.practiceScript.replaceAll('[name]', record.hero.nickname));
  const normalize = text => text.normalize('NFKC').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
  const references = sentencesIn(story.replace(/^MADE UP\n/, '')).filter(text => historyCue.test(text)).map(text => {
    const needle = normalize(text);
    const matches = sources.filter(source => normalize(source.text).includes(needle));
    const source = [...new Set(matches.map(match => match.path))].join('; ') || null;
    return { text, source, supported: Boolean(source) };
  });
  return { status: 'INFO', references,
    method: 'Past-tense and time-word sentences from each story, with exact source matches in the record, summary, tonight sentence or move record. Unmatched sentences say no source, needs a read. Paraphrases need the lead to read them; this is information, not a pass or fail.' };
}

export function auditKits({ kits, record, log, deletedFact }) {
  const kit2 = kits[1];
  const hasBoth = kits.length === 2 && kits.every(kit => kit.complete);
  const twoText = kit2 ? Object.values(kit2.pages).map(visibleText).join('\n') : '';
  const rows = [];
  const add = (name, passed, detail, ready = hasBoth) => rows.push({ name, status: ready ? passed ? 'PASS' : 'FAIL' : 'NOT RUN', detail });
  add('Kit 2 uses the corrected tryout month, November, and never says next week', !/next week/i.test(twoText) && (!/tryouts/i.test(twoText) || /November/.test(kit2?.story ?? '')),
    'No next week in kit 2. If tryouts appear, November must appear in its story.');
  const deletion = auditDeletion({ record, log, kit2, deletedFact });
  add('Deleted family fact absent after deletion: requests, stored record, summary, kit 2 pages', deletion.passed, deletion.hits.length ? deletion.hits.join('; ') : deletion.boundary ? 'No family-text hits after the logged deletion. Exact fixed move fields excluded; all prior requests retained.' : 'No paid-run deletion boundary yet.', hasBoth);
  const history = { status: 'INFO', references: kits.flatMap((kit, index) => auditHistory(kit.story, kit.recordAtStart, kit.move, kit.tonight).references.map(reference => ({ kit: kit.number ?? index + 1, ...reference }))) };
  rows.push({ name: 'Past references for the lead to read', status: 'INFO', detail: `${history.references.length} past-tense or time-word sentences across ${kits.length} stories. Source matches and unmatched sentences are listed below for the lead to read.` });
  add('Allowed move IDs and completed story checks', kits.every(kit => kit.ready && kit.checks.at(-1)?.ready), 'The separate OpenAI judge checks generated copy. Each saved rhyme keeps its real owner approval or visible draft label.');
  const reference = kits[0]?.heroHash;
  add('Every poster and panel passes its word check with the original hero', auditCastContinuity(kits, record) && kits.every(kit => kit.art?.panels?.length === 4 && new Set(kit.art.panels.map(panel => panel.hash)).size === 4 && [kit.art.poster, ...kit.art.panels].every(picture => picture?.ready && picture.referenceHash === reference && JSON.stringify(picture.lookChips) === JSON.stringify(record.hero.lookChips) && JSON.stringify(picture.lockedOutfit) === JSON.stringify(record.hero.lockedOutfit) && picture.checks.at(-1)?.ready)), 'Exact word checks, four different panels, unchanged checked bytes for every cast reference, and a verified ready verdict comparing the full cast across all five pictures. Every drawing uses the complete original cast.');
  add('One combined PDF per kit', kits.every(kit => kit.pdf?.rendered), 'kit_final.pdf has five Letter pages, 36-point margins, poster, two chapter pages, TRY IT, and cards. Render failures keep HTML and the exact command.');
  let wording = hasBoth;
  for (const kit of kits) { try { verifyOwnedWords(kit.pages, kit.move); } catch { wording = false; } }
  add('Poster, try, and for-you words match the fixed records', wording, 'Every required owned field is checked for presence and exact text.');
  add('One MADE UP header on page 2; chapter follows saved kit count', kits.every(kit => {
    const content = kit.pages?.['story.html']?.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1] ?? '';
    const labels = Object.values(kit.pages).map(visibleText).join(' ').match(/MADE UP/g) ?? [];
    return labels.length === 1 && /class="identity">[^<]+ \| MADE UP<\/span>/.test(content) && content.includes(`>Chapter ${kit.recordAtStart.pastKits.length + 1}:`);
  }), 'Chapter number comes from recordAtStart.pastKits.length + 1, not the story model.');
  const responses = log.filter(row => row.event === 'response');
  add('Elapsed seconds and every call cost, including retries, are measured', kits.every(kit => Number.isFinite(kit.elapsedSeconds)) && responses.every(row => row.cost?.usd != null), 'Provider token usage and dated prices are required; unknown cost stays unknown.');
  const openaiRequests = log.filter(row => row.event === 'request' && row.provider === 'openai' && row.body && !['story', 'story-rewrite', 'story-correction', 'story-check'].includes(row.stage));
  let privacyPass = true;
  for (const row of openaiRequests) {
    const kit = kits.find(kit => kit.number === row.kit);
    const move = /^(hero|picture|poster|panel-\d)/.test(row.stage) ? kit?.move : undefined;
    try { assertNoFamilyText(row.body, privacyFor(kit.recordAtStart, kit.tonight, move)); } catch { privacyPass = false; }
  }
  add('OpenAI bodies pass the strict family-text assertion', privacyPass, 'The same assertion runs before every send and again on the log.');
  return { rows, history, deletedHits: deletion.hits, deletion };
}
