import { randomUUID } from 'node:crypto';
import { centralDay } from './app-budget.js';

export const suggestionMaxLength = 500;
export const suggestionsPerDay = 20;
const fail = (message, status = 400) => Object.assign(Error(message), { status });
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// Suggestions are private account records, separate from learning feedback.
export function createKitSuggestions({ db, persist, queue, delivery = () => null, now = () => new Date() }) {
  db.kitSuggestions ??= [];
  function save(account, job, input) {
    if (!account || !db.accounts.includes(account) || !job || !db.jobs.includes(job) || job.accountId !== account.id) throw fail('That kit is not on your shelf.', 404);
    if (job.status !== 'complete') throw fail('Finish this kit before sending feedback.', 409);
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['requestId', 'note', 'page'].includes(key)) || typeof input.requestId !== 'string' || !uuid.test(input.requestId)) throw fail('Please try sending this feedback again.');
    if (typeof input.note !== 'string' || !input.note.trim() || input.note.length > suggestionMaxLength || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(input.note)) throw fail('Write a short note of 500 characters or fewer.');
    const page = input.page ?? null, note = input.note.trim();
    if (page !== null && (!Number.isInteger(page) || page < 1 || page > 5)) throw fail('Choose a page from 1 to 5.');
    let row = db.kitSuggestions.find(item => item.accountId === account.id && item.requestId === input.requestId);
    if (row && (row.jobId !== job.id || row.page !== page || row.note !== note)) throw fail('This feedback request already saved a different note.', 409);
    row ??= db.kitSuggestions.find(item => item.accountId === account.id && item.jobId === job.id && item.page === page && item.note === note);
    const duplicate = Boolean(row);
    if (!row) {
      const day = centralDay(now());
      if (db.kitSuggestions.filter(item => item.accountId === account.id && centralDay(new Date(item.createdAt)) === day).length >= suggestionsPerDay) throw fail('You have sent several suggestions today. Please try again tomorrow.', 429);
      row = { id: randomUUID(), requestId: input.requestId, accountId: account.id, childId: job.childId, jobId: job.id, page, note, createdAt: now().toISOString() };
      db.kitSuggestions.push(row); persist();
    }
    queue(row);
    return { id: row.id, saved: true, duplicate, message: 'Feedback saved. Thank you.' };
  }
  const list = () => db.kitSuggestions.filter(row => db.accounts.some(account => account.id === row.accountId) && db.jobs.some(job => job.id === row.jobId && job.accountId === row.accountId)).map(({ requestId, ...row }) => ({ ...row, notification: delivery(row.id) })).reverse();
  function remove(accountId, jobId) {
    const ids = new Set(db.kitSuggestions.filter(row => row.accountId === accountId && (!jobId || row.jobId === jobId)).map(row => row.id));
    db.kitSuggestions = db.kitSuggestions.filter(row => !ids.has(row.id));
    db.accessDeliveries = (db.accessDeliveries ?? []).filter(row => row.kind !== 'kit-suggestion' || !ids.has(row.subjectId));
  }
  return { save, list, remove };
}
