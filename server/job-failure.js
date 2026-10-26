import { appendFileSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { saveJSON } from './files.js';

export function savedLessonFitFailure(result = {}) {
  return Object.assign(Error('saved_lesson_fit_review_required: The saved lesson needs a fit review.'), {
    code: 'saved_lesson_fit_review_required', canResume: false,
    details: { status: result.status ?? null, reason: result.reason ?? 'selected-lesson-no-longer-fits',
      ...(result.status === 'parentResponse' ? { parentResponse: structuredClone(result) } : {}) },
  });
}

export function parentJobFailure(error, stage = '') {
  if ([error, error?.cause, error?.cause?.cause].some(item => item?.code === 'WORKER_UNAVAILABLE')) return { kind: 'worker-unavailable', canResume: true, message: 'The drawing computer is not connected. Your work is saved. Resume when it returns.' };
  if (error?.code === 'saved_lesson_fit_review_required' && error.details?.reason === 'writer-no-fitting-guide') return { kind: 'guide', canResume: false, message: 'This moment needs a different guide. Your note is saved. Keep this attempt and set it aside, then open Teaching guides to choose one or check a new topic.' };
  if (error?.code === 'guide_preparation_incomplete') return { kind: 'guide', canResume: error.canResume === true, message: error.message };
  if (error?.code === 'content_check_unverified') return { kind: 'review', canResume: error.canResume === true, message: error.canResume === true ? 'The content check could not finish. Your work is saved. Resume to check it again without replacing the finished work.' : 'The content check could not finish. Your work is saved, but it is not ready to print.' };
  if (error?.code === 'REQUEST_ALLOWANCE_SPENT') return { kind: 'limit', canResume: false, message: 'This kit has reached its request limit. Your saved work is safe. Keep it and set it aside to start another kit.' };
  const message = error?.message ?? '';
  if (message.startsWith('Daily budget reached.')) return { kind: 'budget', canResume: false, message: 'Today’s spending limit was reached. Your saved work is safe. Return tomorrow or open the sample.' };
  if (message.startsWith('Kit paused.')) return { kind: 'paused', canResume: true, message: 'Kit paused. Resume to keep the work already saved.' };
  if (message.startsWith('Missing OpenAI key in the Mac Keychain.')) return { kind: 'setup', canResume: false, message: 'The picture and story service is not set up. Your saved work is safe. Use the sample for now.' };
  if (message === 'real families wait for zero retention approval') return { kind: 'permission', canResume: false, message: 'This family needs the required data protection before work can continue. Your saved work is safe.' };
  if (/^(?:Real family details|Photo use) need(?:s)? your permission\./.test(message)) return { kind: 'permission', canResume: false, message: 'Open Family to update your data permission before continuing. Your saved work is safe.' };
  if (error?.code === 'printed_layout_review_required' || message.startsWith('printed_layout_review_required:')) return { kind: 'review', canResume: false, message: 'The saved story still does not fit the page. It needs a layout review. Keep it and set it aside to start another kit.' };
  if (error?.code === 'saved_appearance_review_required') return { kind: 'review', canResume: false, message: 'A picture needs a closer check of how someone looks. Keep this kit and set it aside to start another.' };
  if (error?.code === 'saved_lesson_fit_review_required') return { kind: 'review', canResume: false, message: error.details?.status === 'parentResponse'
    ? 'Check Tonight again for this moment’s parent guidance. Keep this kit and set it aside. Your saved work is safe.'
    : 'We could not match this saved lesson to the moment. Keep it and set it aside, then check Tonight again. Your saved work is safe.' };
  if (error?.canResume === false || /drawing allowance is spent|failed after two redraws|Saved .* (?:changed|no longer matches)|already attempted with the current checker rules/.test(message)) return { kind: 'review', canResume: false, message: 'The saved pictures need review before this kit can continue. Keep the work and set it aside to start another kit.' };
  const part = /layout|export|pdf/.test(stage) ? 'The printable pages could not finish.' : /cast|picture|panel|poster|reading-art/.test(stage) ? 'The picture step could not finish.' : /story|text|rhyme/.test(stage) ? 'The story step could not finish.' : 'The kit could not finish.';
  return { kind: 'retry', canResume: true, message: part + ' Your finished steps are saved. Resume to continue from them.' };
}
export const parentJobError = (error, stage) => parentJobFailure(error, stage).message;

export function jobDiagnostics(directory, job, secrets = []) {
  const redact = value => {
    if (typeof value === 'string') return secrets.filter(Boolean).reduce((text, key) => text.split(key).join('[redacted]'), value);
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /authorization|api[-_]?key|password/i.test(key) ? '[redacted]' : redact(item)]));
    return value;
  };
  const event = (type, details = {}) => {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, 'job-events.jsonl');
    appendFileSync(file, JSON.stringify(redact({ at: new Date().toISOString(), attempt: job.attempt, jobId: job.id, event: type, stage: job.privateStage ?? job.stage, ...details })) + '\n', { mode: 0o600 });
    chmodSync(file, 0o600);
  };
  return {
    event,
    failure(error) {
      const describe = (value, depth = 0) => value && depth < 5 ? { name: value.name ?? 'Error', message: value.message ?? String(value), stack: value.stack ?? null, ...(value.code ? { code: value.code } : {}), ...(value.details ? { details: value.details } : {}), ...(value.violations ? { violations: value.violations } : {}), ...(value.cause ? { cause: describe(value.cause, depth + 1) } : {}) } : null;
      const failure = redact({ at: new Date().toISOString(), jobId: job.id, attempt: job.attempt, stage: job.privateStage ?? job.stage, error: describe(error) });
      const file = `failure-${String(job.attempt).padStart(3, '0')}.json`;
      // accounts.json is the private fallback if writing the kit directory fails.
      job.lastFailure = { file, ...failure };
      saveJSON(join(directory, file), failure);
      saveJSON(join(directory, 'failure.json'), failure);
      event('failed', { failureFile: file, error: failure.error });
      return failure;
    },
  };
}

export function requireCompleteKit(result) {
  if (['noMatch', 'parentResponse'].includes(result?.status)) throw savedLessonFitFailure(result);
  if (result?.complete) return;
  const details = { status: result?.status ?? null, faults: result?.faults ?? [], reason: result?.reason ?? null,
    exports: Object.fromEntries(['render', 'posterPDF', 'pdf'].filter(key => result?.[key]).map(key => [key, result[key]])) };
  const reasons = [details.reason, ...details.faults, ...Object.values(details.exports).filter(value => !value.rendered).map(value => value.reason)].filter(Boolean);
  throw Object.assign(new Error(reasons.join('; ') || `Kit did not finish (${details.status ?? 'no completion receipt'}).`), { details });
}
