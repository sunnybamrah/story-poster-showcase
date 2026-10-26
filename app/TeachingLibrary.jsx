import React, { useEffect, useRef, useState } from 'react';
import { sourceNoteGroups, guideReaderLimitation, guideReaderClaim, practiceReaderText } from './reader-notes.js';
import { Accordion, AccordionSummary, AccordionDetails, Alert, Box, Button, Card, CardContent, Checkbox, FormControlLabel, LinearProgress, Link, Stack, TextField, Typography } from '@mui/material';

const legacyEntries = documents => documents.map(document => ({ id: document.id, kind: 'general', title: document.title, positiveAction: practiceReaderText('guide-action', document.move, document.move.positiveAction), practiceScript: practiceReaderText('guide-practice', document.move, document.move.practiceScript), science: document.move.science, sources: document.move.sources, review: { ownerApproved: document.review?.ownerApproved === true, scope: 'This guide has not been tested with families. Its research check used study summaries, not full papers.' }, canCheck: true }));

export function GuideSources({ sources = [], definitionText = '' }) {
  const { groups, definitions } = sourceNoteGroups(sources, { definitionText: [definitionText, ...sources.map(source => source.contentScope)].filter(Boolean).join(' ') });
  const citation = (source, index) => {
    const date = source.year ?? source.dateLabel, notices = source.notices ?? source.sourceStatus?.notices ?? [], disposition = source.correctionDisposition ?? source.sourceStatus?.correctionDisposition;
    const checked = source.checkedOn ?? source.audit?.checkedOn ?? source.sourceStatus?.checkedAt, state = source.sourceState ?? source.sourceStatus?.state;
    return <Box key={index}>
      <Link href={source.url} target="_blank" rel="noreferrer" sx={{ overflowWrap: 'anywhere' }}>{source.title || 'Source record'}{date ? ` (${date})` : source.dateNotStated ? ' (No publication date shown)' : ''}</Link>
      {source.sourceType && <Typography variant="body2">{source.sourceType === 'official-guidance' ? 'Official guide' : source.sourceType === 'full-paper' ? 'Full paper' : 'Source record'}</Typography>}
      {source.people && <Typography variant="body2">{source.people}</Typography>}
      {source.plainFit && <Typography variant="body2" sx={{ mt: .5 }}>{source.plainFit}</Typography>}
      {source.contentScope && <Typography variant="body2" color="text.secondary">{source.contentScope}</Typography>}
      {checked && <Typography variant="body2" color="text.secondary">Source note checked: {checked}.</Typography>}
      {source.audit?.scope && <Typography variant="body2" color="text.secondary">{source.audit.scope}</Typography>}
      {notices.map((notice, n) => <Alert key={n} severity="info" sx={{ mt: 1 }}>{typeof notice === 'string' ? notice : notice.title ?? notice.message ?? 'A source notice is recorded. Check the linked source.'}</Alert>)}
      {disposition === 'reviewed-no-impact' && <Typography variant="body2">{source.audit?.noticeReviewScope === 'source-note-only' ? 'The correction does not change this source note. A new use of the study still needs its own check.' : 'The source notice was reviewed. The checked action stayed the same.'}</Typography>}
      {disposition === 'reviewed-incorporated' && <Typography variant="body2">The source correction is included in this guide’s review.</Typography>}
      {state && state !== 'active' && <Alert severity="info" sx={{ mt: 1 }}>This source needs another review before the guide is used again. Saved kits stay available.</Alert>}
    </Box>;
  };
  return <>
    {groups.map((group, index) => <Box key={index}>
      {group.sources.map(({ source, index }) => citation(source, index))}
      {group.limitation && <Typography variant="body2">{group.limitation}</Typography>}
    </Box>)}
    {definitions.map(line => <Typography key={line} variant="body2">{line}</Typography>)}
  </>;
}

export default function TeachingLibrary({ api, session, config, kitContext, tonight, onTonightChange, allowRepeat, onAllowRepeatChange, allowBeyond = false, onPick, onParent, onRefresh, onEditFamily }) {
  const [job, setJob] = useState(() => session.libraryJobs?.find(item => item.status === 'running') ?? session.libraryJobs?.[0] ?? null);
  const [entries, setEntries] = useState([]), [query, setQuery] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [fit, setFit] = useState(null), [beyond, setBeyond] = useState(allowBeyond);
  const [matchIds, setMatchIds] = useState([]);
  const browseOnly = !allowBeyond;
  const alive = useRef(true);
  const currentContext = useRef(''); currentContext.current = tonight + '\u0000' + String(allowRepeat);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setFit(null); setMatchIds([]); setBeyond(allowBeyond); }, [tonight, allowBeyond]);
  const reload = async () => { const saved = await api('library'); if (alive.current) setEntries(saved.entries ?? legacyEntries(saved.documents ?? [])); };
  useEffect(() => { reload().catch(err => { if (alive.current && err.code !== 'STALE_OWNER') setError(err.message); }).finally(() => { if (alive.current) setLoading(false); }); }, []);
  useEffect(() => {
    if (job?.status !== 'running') return;
    let live = true, reading = false;
    const poll = async () => {
      if (!live || reading) return;
      reading = true;
      try {
        const next = await api('library/jobs/' + job.id);
        if (!live) return;
        setJob(next);
        if (next.status !== 'running') { await reload(); if (live && alive.current) await onRefresh(); }
      } catch (err) { if (live && err.code !== 'STALE_OWNER') setError(err.message); }
      finally { reading = false; }
    };
    const timer = setInterval(poll, 1800), visible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', visible); poll();
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [job?.id, job?.status]);
  const run = async action => {
    if (!alive.current) return;
    const startingContext = currentContext.current;
    setBusy(true); setError(''); setFit(null);
    try {
      const next = await action(); if (!alive.current || startingContext !== currentContext.current) return;
      if (next?.status === 'parentResponse') onParent(next);
      else if (next?.status === 'eligible') onPick(next);
      else if (next?.status === 'noMatch') { setFit(next); setBeyond(true); }
      else if (next?.id) setJob(next);
    } catch (err) { if (alive.current && startingContext === currentContext.current && err.code !== 'STALE_OWNER') setError(err.message); }
    finally { if (alive.current) setBusy(false); }
  };
  const context = { childId: session.childId, tonight, allowRepeat, kitContext };
  const matchSaved = async () => {
    const startingContext = currentContext.current; setBusy(true); setError(''); setMatchIds([]);
    try {
      const next = await api('pick', { ...context, allowRepeat: true });
      if (!alive.current || startingContext !== currentContext.current) return;
      if (next.status === 'parentResponse') onParent(next);
      else { setMatchIds((next.suggestions ?? []).map(item => item.id)); setFit(next); }
    } catch (err) { if (alive.current && err.code !== 'STALE_OWNER') setError(err.message); }
    finally { if (alive.current) setBusy(false); }
  };

  const needle = query.normalize('NFKC').toLocaleLowerCase().trim();
  const shown = entries.filter(entry => !needle || [entry.title, entry.positiveAction].filter(Boolean).join(' ').normalize('NFKC').toLocaleLowerCase().includes(needle)).sort((a, b) => (matchIds.includes(b.id) - matchIds.includes(a.id)) || a.title.localeCompare(b.title));
  return <Stack spacing={3}>
    {browseOnly ? <Box component="section" aria-label="Match a saved guide"><Stack spacing={1.5}>
      <Typography>Tell us a moment to find a saved guide, or browse the lessons below.</Typography>
      <TextField label="Tell us one moment (optional)" value={tonight} onChange={event => onTonightChange(event.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 2000 } }} />
      <Button variant="outlined" disabled={busy || !tonight.trim()} onClick={matchSaved} sx={{ alignSelf: 'flex-start' }}>Match saved guides</Button>
      {fit && <Typography role="status">{matchIds.length ? `${matchIds.length} matching guides are shown first.` : 'No saved guide matches yet; you can still read every lesson below.'}</Typography>}
    </Stack></Box> : <>
    <Box sx={{ p: { xs: 2.5, sm: 3 }, bgcolor: 'action.hover', borderRadius: 3 }}><Stack spacing={2}>
      <Typography component="h2" variant="h2">Our moment, for {session.record.hero.nickname}</Typography>
      <Typography variant="body2">This private note is separate from the shared guides. A guide still needs to fit your family and this moment.</Typography>
      <TextField label="Our moment" value={tonight} onChange={event => onTonightChange(event.target.value)} multiline minRows={3} slotProps={{ htmlInput: { maxLength: 2000 } }} helperText="Write one moment before checking a guide. Opening a guide below is free." />
      <FormControlLabel control={<Checkbox checked={allowRepeat} onChange={event => onAllowRepeatChange(event.target.checked)} />} label="It’s okay to revisit a move we’ve used" />
      <Button variant="contained" disabled={busy || job?.status === 'running' || !tonight.trim()} onClick={() => run(() => api('library/jobs', { ...context, preferPrepared: true }))}>Check this topic</Button>
      <Typography variant="body2" color="text.secondary">Checking prepared guides does not use the daily AI budget.</Typography>
      {fit && <Alert severity="info"><Typography>{fit.message}</Typography>{fit.canRepeat && <Typography variant="body2">You can choose to include moves you have used, then check again.</Typography>}</Alert>}
      {beyond && <Stack spacing={1}><Button variant="outlined" disabled={busy || job?.status === 'running' || !tonight.trim() || config?.sampleOnly} onClick={() => run(() => api('library/jobs', { ...context, preferPrepared: true, researchNewGoal: true }))}>Look beyond these guides</Button><Typography variant="body2" color="text.secondary">{config?.sampleOnly ? 'This preview opens saved guides. It does not buy new research.' : 'This starts a new source check using Sunny’s daily budget. Some topics need a person to review them. No new guide is promised.'}</Typography></Stack>}
    </Stack></Box>
    </>}
    {error && <Alert severity="error">{error}</Alert>}
    {!browseOnly && job && <Card className="content-panel tinted"><CardContent><Stack spacing={2}>
      <Typography className="eyebrow">Latest saved topic check</Typography>
      <Typography variant="h2" component="h2">{job.status === 'running' ? 'Looking for a useful guide' : job.status === 'complete' ? 'A general guide is ready' : 'Your topic check is saved'}</Typography>
      {job.status === 'running' && <LinearProgress aria-label="Checking this teaching topic" />}
      <Typography role="status">{job.message || 'You can leave this page and return. The work stays saved.'}</Typography>
      {job.topic && <Typography variant="body2">Topic: {job.topic}</Typography>}
      {job.status === 'complete' && <Button variant="contained" disabled={busy || !tonight.trim()} onClick={() => run(() => api('pick', { ...context, libraryJobId: job.id, requestedMoveId: job.moveId }))}>Use this guide for our story</Button>}
      {job.canResume && <Button variant="outlined" disabled={busy} onClick={() => run(() => api('library/jobs/' + job.id + '/resume', {}))}>Resume the saved check</Button>}
    </Stack></CardContent></Card>}
    <Box><Typography variant="h2" component="h2">Saved teaching guides</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Open a guide for its lesson, practice and sources.</Typography></Box>
    <TextField label="Find a teaching guide" value={query} onChange={event => setQuery(event.target.value)} helperText="Search guide titles and actions." />
    {query && <Button onClick={() => setQuery('')} sx={{ alignSelf: 'flex-start' }}>Clear guide search</Button>}
    {loading ? <Typography role="status">Opening the teaching guides…</Typography> : <Typography variant="body2" role="status">{shown.length} {shown.length === 1 ? 'guide' : 'guides'} shown.</Typography>}
    {!loading && !shown.length && <Typography>{entries.length ? 'No guides match this search. Clear the search to see them all.' : 'The guide list could not be opened yet. Your saved topic check stays above.'}</Typography>}
    <Box className="guide-grid">{shown.map(entry => <Accordion key={entry.id} className={"guide-row" + (matchIds.includes(entry.id) ? " guide-match" : "")}>
      <AccordionSummary aria-label={entry.title} expandIcon={<span aria-hidden="true">＋</span>}><Stack spacing={.75}><Typography fontWeight={800}>{entry.title}</Typography><Typography variant="body2" color="text.secondary">{entry.positiveAction}</Typography></Stack></AccordionSummary>
      <AccordionDetails><Stack spacing={2}>
        <Box><Typography component="h3" variant="h3">The lesson</Typography><Typography>{entry.positiveAction}</Typography></Box>
        <Box><Typography component="h3" variant="h3">Try it together</Typography><Typography sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{entry.practiceScript}</Typography>{entry.practiceScript?.includes('[name]') && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>[name] is a place for the child’s name.</Typography>}</Box>
        {entry.applicability?.label && <Typography variant="body2">{entry.applicability.label}{entry.applicability.reason ? ' ' + entry.applicability.reason : ''}</Typography>}
        {entry.applicability?.needsSchoolGrade && onEditFamily && <Button onClick={onEditFamily}>Add school grade in Family</Button>}
        <Button variant="outlined" disabled={busy || !tonight.trim() || entry.canCheck === false || entry.applicability?.eligible === false} onClick={() => run(() => api('pick', { ...context, requestedMoveId: entry.id }))}>Use this guide for our story</Button>
        <Accordion className="source-disclosure"><AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}><Typography variant="body2" fontWeight={800}>Sources and checks</Typography></AccordionSummary><AccordionDetails><Stack spacing={2}>
          {entry.science?.claim && <Typography>{guideReaderClaim(entry.id, entry.science.claim)}</Typography>}
          {entry.science?.limitation && <Typography variant="body2">{guideReaderLimitation(entry.id, entry.science.limitation)}</Typography>}
          {entry.science?.reviewLabel && <Typography variant="body2" color="text.secondary">{entry.science.reviewLabel}</Typography>}
          <Typography variant="body2">{entry.review?.ownerApproved === true || entry.science?.ownerApproved === true ? 'Owner wording review is recorded.' : 'Owner wording review is still pending.'}</Typography>
          {entry.review?.scope && <Typography variant="body2">{entry.review.scope}</Typography>}
          {(entry.notices ?? []).filter(notice => typeof notice === 'string').map((notice, index) => <Alert key={index} severity="info">{notice}</Alert>)}
          <GuideSources sources={entry.sources} definitionText={[guideReaderClaim(entry.id, entry.science?.claim), guideReaderLimitation(entry.id, entry.science?.limitation)].filter(Boolean).join(' ')} />
        </Stack></AccordionDetails></Accordion>
      </Stack></AccordionDetails>
    </Accordion>)}</Box>
  </Stack>;
}
