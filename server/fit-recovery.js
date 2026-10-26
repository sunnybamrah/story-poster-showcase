import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readJSON } from './files.js';
import { assertRewriteLocks, kitTextKeys } from './story.js';
import { normalizeKitText } from './writing-guidance.js';
import { scrubWriterImageText } from './writer-image-text.js';
import { privacyFor } from './requests.js';
import { minimalFields, pathParts, fieldValue } from './validation-reason.js';

const onlyKit = text => Object.fromEntries(kitTextKeys.map(key => [key, text?.[key]]));
function maskAllowed(candidate, previous, fields) {
  const result = structuredClone(candidate);
  for (const field of minimalFields(fields)) {
    const parts = pathParts(field), key = parts.pop(), parent = parts.reduce((value, part) => value?.[part], result);
    if (!parent || !Object.hasOwn(parent, key)) throw new Error('Missing locked field.');
    parent[key] = structuredClone(fieldValue(previous, field));
  }
  return result;
}

// A refund needs three linked pieces of old evidence: the fit rejection, its
// one rejected writer answer, and a raw answer that preserved every lock.
// Replaying the old cleanup must reproduce the exact rejected field. Missing
// or ambiguous evidence earns no refund. Neither money nor old files change.
export function recoverFitAttempts(checkpoint, directory) {
  if (checkpoint.fitLockVersion === 3) return [];
  const recovered = [], ledgerPath = join(directory, 'kit-log.json');
  const ledger = existsSync(ledgerPath) ? readJSON(ledgerPath) : [];
  const previous = checkpoint.stages?.text;
  const privacy = checkpoint.recordAtStart ? privacyFor(checkpoint.recordAtStart, checkpoint.tonight) : {};
  let boundary = 0;
  for (let index = 0; index < ledger.length; index++) {
    const row = ledger[index];
    if (row.stage !== 'printed-fit') continue;
    const since = ledger.slice(boundary, index); boundary = index + 1;
    const receiptName = `printed-fit-${row.attempt}.json`, receiptPath = join(directory, receiptName);
    if (!previous || !existsSync(receiptPath)) continue;
    const saved = readJSON(receiptPath), receipt = saved.receipt ?? saved;
    const rejected = receipt.shorteningRejected?.match(/rewrite_changed_locked_field: (\w+)\./)?.[1];
    if (!rejected || !receipt.plan?.fields?.length || !receipt.plan.page) continue;
    const answers = since.filter(item => ['story-rewrite', 'story-correction', 'story'].includes(item.stage));
    if (answers.length !== 1 || answers[0].stage !== 'story-rewrite' || !answers[0].verdict?.startsWith(`rewrite_changed_locked_field: ${rejected}.`)) continue;
    const answerName = `story-attempt-${answers[0].attempt}.json`, answerPath = join(directory, answerName);
    if (!existsSync(answerPath)) continue;
    try {
      const raw = readJSON(answerPath), fields = receipt.plan.fields;
      // This stricter raw check prevents a genuinely changed field from being
      // excused just because an identity substitution happens to erase it.
      const rawLocked = normalizeKitText(onlyKit(previous));
      if (!isDeepStrictEqual(maskAllowed(normalizeKitText(onlyKit(raw)), rawLocked, fields), rawLocked)) continue;
      assertRewriteLocks(raw, previous, fields, privacy);
      const oldCandidate = normalizeKitText(scrubWriterImageText(onlyKit(raw), privacy).text);
      const oldMasked = maskAllowed(oldCandidate, onlyKit(previous), fields);
      const firstMismatch = kitTextKeys.find(key => !isDeepStrictEqual(oldMasked[key], previous[key]));
      if (firstMismatch !== rejected) continue;
      const page = receipt.plan.page;
      if (!Number.isSafeInteger(checkpoint.fitAttempts?.[page]) || checkpoint.fitAttempts[page] <= 0) continue;
      checkpoint.fitAttempts[page]--;
      recovered.push({ page, receipt: receiptName, answer: answerName, rejectedField: rejected, reason: 'Raw answer preserved all locks; replay reproduced the code cleanup rejection.' });
    } catch { /* Unprovable historical work keeps its spent allowance. */ }
  }
  checkpoint.fitLockVersion = 3;
  checkpoint.fitLockRecovery = { version: 1, recovered };
  return recovered;
}
