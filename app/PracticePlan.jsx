import React, { useEffect, useRef, useState } from 'react';
import { Accordion, AccordionSummary, AccordionDetails, Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';

const empty = { notice: '', action: '' };
const same = (left, right) => left.notice === right.notice && left.action === right.action;
export default function PracticePlan({ api, jobId }) {
  const [open, setOpen] = useState(false), [saved, setSaved] = useState(null), [answers, setAnswers] = useState(empty);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [conflict, setConflict] = useState(null);
  const alive = useRef(true), path = 'jobs/' + encodeURIComponent(jobId) + '/practice';
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const apply = result => { if (!alive.current) return; setSaved(result); setAnswers({ ...empty, ...result.answers }); setConflict(null); };
  const load = async () => {
    setLoading(true); setError('');
    try { const result = await api(path); apply(result); }
    catch (err) { if (alive.current && err.code !== 'STALE_OWNER') setError(err.message); }
    finally { if (alive.current) setLoading(false); }
  };
  const write = async (kind, revision = saved?.revision) => {
    if (!saved || saving) return; setSaving(true); setError(''); setNotice('');
    try {
      const result = await api(path, kind === 'clear' ? { revision } : { revision, answers: { ...answers } }, kind === 'clear' ? 'DELETE' : 'PUT');
      if (!alive.current) return; apply(result); setNotice(kind === 'clear' ? 'Your saved plan is cleared. The story stays the same.' : 'Your plan is saved with this story.');
    } catch (err) {
      if (!alive.current || err.code === 'STALE_OWNER') return;
      if (err.status === 409) {
        try { const latest = await api(path); if (alive.current) { setConflict({ kind, latest }); setError('This plan changed somewhere else. Your words are still here.'); } }
        catch (refreshError) { if (alive.current && refreshError.code !== 'STALE_OWNER') setError('Your words are still here. We could not check the saved plan. Try again.'); }
      } else setError(err.message);
    } finally { if (alive.current) setSaving(false); }
  };
  const dirty = saved && !same(answers, { ...empty, ...saved.answers });
  const hasWords = Boolean(answers.notice || answers.action || saved?.answers?.notice || saved?.answers?.action);
  return <Accordion className="practice-plan" expanded={open} onChange={(_event, next) => { setOpen(next); if (next && !saved && !loading) load(); }}>
    <AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}><Typography fontWeight={700}>Type our plan (optional)</Typography></AccordionSummary>
    <AccordionDetails><Stack spacing={2.5}>
      <Typography variant="body2">You can save your own words here, or leave this for paper. The original print pages stay blank.</Typography>
      {loading && <Typography role="status">Opening your saved plan…</Typography>}
      {error && <Alert severity="warning">{error}</Alert>}{notice && <Alert severity="success" role="status">{notice}</Alert>}
      {!loading && !saved && error && <Button onClick={load}>Try opening the plan again</Button>}
      {saved && <>
        {['notice', 'action'].map(key => <TextField key={key} label={saved.prompts[key]} multiline minRows={2} value={answers[key]} disabled={saving} onChange={event => { setAnswers(previous => ({ ...previous, [key]: event.target.value })); setNotice(''); }} slotProps={{ htmlInput: { maxLength: saved.maxLength } }} />)}
        {conflict ? <Box><Stack spacing={1.5}><Button disabled={saving} variant="contained" onClick={() => write(conflict.kind, conflict.latest.revision)}>{conflict.kind === 'clear' ? 'Clear the saved plan' : 'Save my words'}</Button><Button disabled={saving} variant="outlined" onClick={() => { apply(conflict.latest); setError(''); setNotice('The saved plan is shown.'); }}>Use the saved plan</Button></Stack></Box> : <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: 'wrap' }}><Button variant="contained" disabled={saving || !dirty} onClick={() => write('save')}>{saving ? 'Saving…' : 'Save our plan'}</Button><Button disabled={saving || !hasWords} onClick={() => write('clear')}>Clear our plan</Button></Stack>}
        {dirty && !saving && <Typography variant="body2" color="text.secondary">Your changes are not saved yet.</Typography>}
      </>}
    </Stack></AccordionDetails>
  </Accordion>;
}
