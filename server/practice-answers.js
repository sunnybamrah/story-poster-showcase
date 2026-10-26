import { emptyMove } from './format.js';

export const practiceAnswerMaxLength = 500;
const prompts = Object.freeze(Object.fromEntries(emptyMove.split('______').slice(0, 2).map((text, index) => [index ? 'action' : 'notice', text.replace(/^[,\s]+|[,\s]+$/g, '')])));
const problem = (message, status = 400) => Object.assign(Error(message), { status });

// Private account data. Never merge these answers into a kit or model input.
export function createPracticeAnswers({ db, persist }) {
  db.practiceAnswers ??= [];
  const rowFor = job => db.practiceAnswers.find(row => row.accountId === job.accountId && row.jobId === job.id);
  const assertSupported = job => {
    if (job.status !== 'complete') throw problem('Finish this kit before saving a practice plan.', 409);
    const words = job.result?.posterSections?.find(section => section.id === 'move')?.text ?? '';
    if (!words.replace(/\s+/g, ' ').includes(emptyMove)) throw problem('This saved poster has no matching practice blanks.', 409);
  };
  const view = job => { assertSupported(job); const row = rowFor(job); return { prompts, answers: { notice: row?.notice ?? '', action: row?.action ?? '' }, revision: row?.revision ?? 0, maxLength: practiceAnswerMaxLength }; };
  function change(job, input, clear = false) {
    assertSupported(job);
    const old = rowFor(job);
    if (!Number.isSafeInteger(input.revision) || input.revision !== (old?.revision ?? 0)) throw problem('This plan changed in another tab. Reload it before saving.', 409);
    const answers = clear ? { notice: '', action: '' } : input.answers;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers) || Object.keys(answers).some(key => !['notice', 'action'].includes(key)) || ['notice', 'action'].some(key => typeof answers[key] !== 'string' || answers[key].length > practiceAnswerMaxLength || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(answers[key]))) throw problem('Keep each answer to 500 characters or fewer.');
    const row = old ?? { accountId: job.accountId, jobId: job.id, revision: 0 };
    row.notice = answers.notice; row.action = answers.action; row.revision++; row.updatedAt = new Date().toISOString();
    if (!old) db.practiceAnswers.push(row);
    persist(); return view(job);
  }
  return { view, change, remove: (accountId, jobId) => { db.practiceAnswers = db.practiceAnswers.filter(row => row.accountId !== accountId || jobId && row.jobId !== jobId); } };
}
