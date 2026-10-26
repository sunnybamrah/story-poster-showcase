import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, FormControl, FormControlLabel, FormLabel, Link, Radio, RadioGroup, Stack, Typography } from '@mui/material';

const download = url => url + (url.includes('?') ? '&' : '?') + 'download=1';
export default function PrintOptions({ api, jobId, assetsBase, sample = false, sampleCopy }) {
  const [mode, setMode] = useState('colour'), [copy, setCopy] = useState(sample && sampleCopy?.status === 'ready' ? sampleCopy : { status: sample ? 'unavailable' : 'loading', message: sample ? 'Black-and-white printing is not ready for this sample. The colour PDF is available.' : '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), path = 'jobs/' + encodeURIComponent(jobId) + '/print-copy';
  const check = async () => {
    try { const reply = await api(path); if (alive.current) { setCopy(reply); setError(''); } }
    catch (err) { if (alive.current && err.code !== 'STALE_OWNER') { setError(err.message); setCopy(previous => previous.status === 'loading' ? { status: 'unknown' } : previous); } }
  };
  useEffect(() => { alive.current = true; if (!sample) check(); return () => { alive.current = false; }; }, [jobId, sample]);
  useEffect(() => {
    if (copy.status !== 'preparing') return;
    let pending = false;
    const poll = async () => { if (pending || document.hidden) return; pending = true; try { await check(); } finally { pending = false; } };
    const timer = setInterval(poll, 2000); document.addEventListener('visibilitychange', poll);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', poll); };
  }, [copy.status, jobId]);
  const prepare = async () => {
    setBusy(true); setError('');
    try { const reply = await api(path, {}); if (alive.current) setCopy(reply); }
    catch (err) { if (alive.current && err.code !== 'STALE_OWNER') setError(err.message); }
    finally { if (alive.current) setBusy(false); }
  };
  const savedCopy = Boolean(copy.assets?.kitPdf);
  const ready = mode === 'colour' || savedCopy;
  const refreshStatus = copy.refresh?.status ?? copy.status;
  const kit = mode === 'colour' ? assetsBase + 'kit_final.pdf' : copy.assets?.kitPdf;
  const poster = mode === 'colour' ? assetsBase + 'poster.pdf' : copy.assets?.posterPdf;
  return <Stack spacing={2} className="print-options">
    <Typography component="h3" variant="h3">Print or save</Typography>
    <FormControl><FormLabel id="print-colour-label">Print colour</FormLabel><RadioGroup row aria-labelledby="print-colour-label" value={mode} onChange={event => setMode(event.target.value)}><FormControlLabel value="colour" control={<Radio />} label="Colour" /><FormControlLabel value="bw" control={<Radio disabled={['loading', 'unknown', 'unavailable'].includes(copy.status)} />} label="Black and white" /></RadioGroup></FormControl>
    {copy.status === 'unavailable' && <Typography variant="body2" color="text.secondary">{copy.message}</Typography>}
    {error && <Alert severity="warning">{error}<Box><Button onClick={check} disabled={busy}>Check print choices again</Button></Box></Alert>}
    {mode === 'bw' && <Typography variant="body2">The same saved story and pictures on white paper. No new drawing is made.</Typography>}
    {mode === 'bw' && copy.status !== 'ready' && <>
      {copy.status === 'preparing' || busy ? <Typography role="status">{copy.message || 'Preparing your black-and-white PDF. The colour copy is still here.'}</Typography> : <Button variant="contained" disabled={busy} onClick={prepare}>{savedCopy ? refreshStatus === 'failed' ? 'Try the clearer copy again' : 'Make a clearer copy' : copy.status === 'failed' ? 'Try the black-and-white copy again' : 'Prepare black-and-white copy'}</Button>}
      {refreshStatus === 'failed' && (copy.refresh?.message || copy.message) && <Alert severity="warning">{copy.refresh?.message || copy.message}</Alert>}
    </>}
    {ready && kit && <>
      <Button variant="outlined" component="a" href={download(kit)} download={mode === 'colour' ? 'tonights-five-page-kit.pdf' : 'tonights-five-page-kit-bw.pdf'}>{mode === 'colour' ? 'Download full five-page PDF' : 'Download black-and-white PDF'}</Button>
      <Link href={kit} target="_blank" rel="noreferrer">{mode === 'colour' ? 'Open full kit to print' : 'Open black-and-white kit to print'}</Link>
      {mode === 'bw' && poster && <Link href={poster} target="_blank" rel="noreferrer">Open black-and-white poster</Link>}
    </>}
    <Typography variant="body2" color="text.secondary">Your browser may save the file or open it. On a phone, use Share to save it to Files or print.</Typography>
  </Stack>;
}
