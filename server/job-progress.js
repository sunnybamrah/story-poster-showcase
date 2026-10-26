// Drawing includes its interleaved picture checks. Only final export is the
// third stage. Retries and resumes keep the furthest stage already reached.
const order = ['writing', 'drawing', 'checking', 'ready'];
export const kitWaitEstimate = 'Your work is saved as we go. You can close this page and return to your shelf.';
export function advanceJobStage(current, internal) {
  const next = /^(?:poster-export|kit-export|kit-pdf|poster-pdf|final-export|export|pdf)/.test(internal) ? 'checking'
    : /picture|panel|poster|cast|reference/.test(internal) ? 'drawing' : 'writing';
  return order[Math.max(order.indexOf(current), order.indexOf(next), 0)];
}

// Only the caller's own pending receipt affects this view. There is no kit
// position: each model request joins the shared worker separately.
export function jobProgress(job, { requests = [], worker, libraryJobs = [] } = {}) {
  const view = (state, message, active = false) => ({ state, message, active });
  if (job.status === 'complete') return view('complete', 'Your kit is ready.');
  if (job.status === 'paused' || job.status === 'set-aside') return view('paused', job.status === 'set-aside' ? 'This unfinished kit is saved on your shelf.' : 'Your work is saved and paused.');
  if (job.status === 'failed' && job.failureKind === 'worker-unavailable' && worker?.online === false) return view('worker-unavailable', 'Story making is offline right now; your work is saved.');
  if (job.status === 'failed') return view('failed', job.message || 'This kit stopped, and its saved work is still here.');
  const workIds = new Set([job.id, ...libraryJobs.filter(row => row.accountId === job.accountId && row.parentJobId === job.id).map(row => row.id)]);
  const receipt = requests.findLast(row => row.owner?.accountId === job.accountId && workIds.has(row.owner?.workId) && ['waiting', 'running'].includes(row.status));
  if (receipt && worker?.mode === 'remote' && !worker.online) return view('worker-unavailable', 'Story making is offline right now; your work is saved.');
  if (receipt?.status === 'waiting') return view('queued', 'Your story is saved and waiting its turn.');
  const step = job.privateStage ?? '';
  let message = 'We are getting your saved work ready.';
  if (/^library/.test(step)) message = /review|check/.test(step) ? 'We are checking the guide for this story.' : 'We are finding a guide for this story.';
  else if (/export|pdf|completion/.test(step)) message = 'We are making the pages ready to read and print.';
  else if (/check|judge|review|continuity/.test(step)) message = /story|text/.test(step) ? 'We are checking the story.' : 'We are checking the pictures and their words.';
  else if (/reference|hero|cast/.test(step)) message = 'We are drawing the people for this story.';
  else if (/picture|panel|poster|comic|reading-art/.test(step)) message = 'We are drawing the story pictures.';
  else if (/story|text/.test(step)) message = 'We are writing the story.';
  return view('working', message, true);
}
