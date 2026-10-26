import React from 'react';
import { Box, Typography, LinearProgress } from '@mui/material';

// The server owns queue and worker facts. Older replies get a modest fallback,
// never a guessed queue position, percentage or finish time.
export function savedProgress(job) {
  const progress = job?.progress;
  if (typeof progress?.message === 'string' && progress.message.trim()) return { message: progress.message, active: job.status === 'running' && progress.state === 'working' && progress.active === true, state: progress.state };
  if (job?.status === 'complete') return { message: 'Your story is ready.', active: false, state: 'complete' };
  if (job?.status === 'running') return { message: 'Your story request is saved.', active: false, state: 'saved' };
  return { message: job?.message || 'Your work is saved.', active: false, state: job?.status ?? 'saved' };
}

export function WorkingStatus({ message, active, state = active ? 'working' : 'saved', children }) {
  return <Box className="saved-job-progress" data-progress-state={state} data-active={active} aria-busy={active}>
    <Typography component="p" role="status" aria-live="polite" aria-atomic="true">{message}</Typography>
    {active && <LinearProgress className="working-bar" aria-label="Work in progress" />}
    {children}
  </Box>;
}

export default function JobProgress({ job }) {
  return <WorkingStatus {...savedProgress(job)} />;
}
