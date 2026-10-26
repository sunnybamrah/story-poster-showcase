import assert from 'node:assert/strict';
export function expectReview(run, pattern) {
  const result = run();
  const flags = result.reviewFlags ?? result.pagination?.reviewFlags ?? [];
  assert.ok(flags.length, 'Expected a saved review flag, not silent acceptance.');
  if (pattern) assert.match(flags.map(flag => flag.evidence + ' ' + flag.reason).join('\n'), pattern);
  return result;
}
export function validationFinding(run) {
  let result;
  try { result = run(); }
  catch (error) {
    if (!error.failures) return error;
    const extra = (error.reviewFlags ?? []).filter(row => row.failure).map(row => ({ ...row.failure, reason: row.evidence }));
    return { ...error, message: [error.message, ...extra.map(row => row.reason)].join('\n'), failures: [...error.failures, ...extra] };
  }
  const flags = [...(result.reviewFlags ?? [])].filter(row => row.failure);
  assert.ok(flags.length, 'Expected a named validation finding.');
  const failures = flags.map(row => ({ ...row.failure, reason: row.evidence }));
  return { reviewOnly: true, failure: failures[0], failures, message: failures.map(row => row.reason).join('\n') };
}
