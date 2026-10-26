import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';

export default function KitFeedback({ api, jobId, page, open, onClose }) {
  const [note, setNote] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [error, setError] = useState('');
  const sequence = useRef(0), sending = useRef(false), request = useRef(null);
  useEffect(() => {
    sequence.current++; sending.current = false; request.current = null;
    setNote(''); setError(''); setSaved(false); setBusy(false);
    return () => { sequence.current++; };
  }, [open, jobId, page]);
  const ownedKit = typeof jobId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(jobId);
  const send = async event => {
    event.preventDefault(); if (!ownedKit || sending.current || !note.trim()) return;
    const ticket = sequence.current, value = note.trim(), targetPage = page ?? null;
    if (!request.current || request.current.note !== value || request.current.page !== targetPage) request.current = { requestId: crypto.randomUUID(), note: value, page: targetPage };
    sending.current = true; setBusy(true); setError('');
    try {
      const result = await api('jobs/' + encodeURIComponent(jobId) + '/suggestions', request.current);
      if (ticket !== sequence.current) return;
      if (result.saved !== true) throw Error('Feedback was not confirmed. Please try again.');
      setSaved(true);
    } catch (err) { if (ticket === sequence.current && err.code !== 'STALE_OWNER') setError(err.message || 'Please try again. Your note is still here.'); }
    finally { if (ticket === sequence.current) { sending.current = false; setBusy(false); } }
  };
  return <Dialog open={Boolean(open)} onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="kit-feedback-title">
    <DialogTitle id="kit-feedback-title">Suggest a change</DialogTitle>
    <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>
      {!ownedKit ? <Typography>Sign in and open one of your saved kits to send feedback.</Typography> : saved ? <Alert severity="success" role="status">Feedback saved. Thank you.</Alert> : <>
        <Typography variant="body2">{page ? `Page ${page}` : 'This kit'}. Your note goes to the app owner. It will not change or redraw your kit.</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField autoFocus fullWidth multiline minRows={3} label="What would you like us to improve?" value={note} disabled={busy} onChange={event => setNote(event.target.value)} slotProps={{ htmlInput: { maxLength: 500 } }} helperText={`${note.length} of 500 characters. Leave out names or private details you do not want to share.`} />
      </>}
    </Stack></DialogContent>
    <DialogActions><Button onClick={onClose}>{saved ? 'Done' : 'Close'}</Button>{ownedKit && !saved && <Button variant="contained" disabled={busy || !note.trim()} onClick={send}>{busy ? 'Saving…' : 'Send feedback'}</Button>}</DialogActions>
  </Dialog>;
}
