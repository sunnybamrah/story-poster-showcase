import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, ButtonBase, Card, CardContent, Chip, CircularProgress, FormControl, FormControlLabel, FormLabel, MenuItem, RadioGroup, Radio, TextField, LinearProgress, Stack, Typography, Tabs, Tab, Accordion, AccordionSummary, AccordionDetails } from '@mui/material';
import { appearanceDraftData, appearanceDraftBase } from './appearance';
import { WorkingStatus } from './JobProgress';
import DataPolicyConsent from './DataPolicyConsent';
import PortraitViewer from './PortraitViewer';
import { preparePhoto, photoAccept } from './photo-input.js';
import { hasCurrentDataConsent, needsChildDataProtection } from './data-policy.js';
import { pictureStyleOptionFor, pictureStyleOptions } from './picture-styles.js';

// The current first-setup looks, named from the shared list: "A, B and C".

const readPhoto = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(new Error('This photo could not be opened. Try another photo.'));
  reader.readAsDataURL(file);
});

export default function FamilyPortraits({ api, session, config, onSaved, pictureStyleId, onStyleChange, draftFamily, draftPeople, renderDetails, ensureSaved, inputMemory, onActivity }) {
  const [people, setPeople] = useState([]), [loading, setLoading] = useState(true), [look, setLook] = useState(null);
  const [files, setFiles] = useState(inputMemory?.current.files ?? {}), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [photoViews, setPhotoViews] = useState({}), [photoPreparing, setPhotoPreparing] = useState('');
  const photoURLs = useRef(new Map()), photoSequence = useRef(0);
  const clearPhoto = id => { if (inputMemory?.current.kept) delete inputMemory.current.kept[id]; const url = photoURLs.current.get(id); if (url) URL.revokeObjectURL(url); photoURLs.current.delete(id); setFiles(previous => { const next = { ...previous }; delete next[id]; return next; }); setPhotoViews(previous => { const next = { ...previous }; delete next[id]; return next; }); };
  const draftBases = useRef(inputMemory?.current.descriptionBases ?? {});
  if (inputMemory) inputMemory.current.descriptionBases = draftBases.current;
  const [inputModes, setInputModes] = useState(inputMemory?.current.inputModes ?? {}), [descriptions, setDescriptions] = useState(inputMemory?.current.descriptions ?? {});
  if (inputMemory) Object.assign(inputMemory.current, { files, inputModes, descriptions });
  const [activePerson, setActivePerson] = useState(''), [notice, setNotice] = useState('');
  const [viewing, setViewing] = useState(null), [waitEstimate, setWaitEstimate] = useState({});
  const [expandedPeople, setExpandedPeople] = useState({});
  const alive = useRef(true);
  const childId = session?.childId ?? 'primary';
  const savedSession = useRef(session); if (session?.record) savedSession.current = session;
  const record = draftFamily ? { real: draftFamily.real, hero: { age: draftFamily.age }, dataPolicyConsent: draftFamily.dataPolicyConsent ?? session?.record?.dataPolicyConsent } : session.record;
  const hasRecord = Boolean(session?.record);
  const visiblePeople = draftPeople ? draftPeople.map(person => ({ ...people.find(saved => saved.id === person.id), ...person })) : people;
  const currentStyle = useRef(pictureStyleId); currentStyle.current = pictureStyleId;
  const synthetic = config.syntheticPortraits && record.real === false;
  const pictureStyle = pictureStyleOptionFor(pictureStyleId ?? look?.pictureStyleId ?? session?.record);
  const scope = pictureStyleId ? { pictureStyleId } : {};
  const styleQuery = pictureStyleId ? '&pictureStyleId=' + encodeURIComponent(pictureStyleId) : '';
  // New families: the first person is drawn in three looks. Once a family has
  // its look, every new drawing is one drawing in it. Older three-choice
  // batches stay readable.
  const pending = !hasRecord || look?.pending === true;
  const olderBatch = person => person.job?.kind === 'legacy-variations';
  const waitingFor = person => pending && look?.comparison && (look.comparison.personId !== person.id || look.comparison.childId !== childId) ? look.comparison : null;
  const show = data => { setPeople(data.people); setActivePerson(previous => data.people.some(person => person.id === previous) ? previous : data.people.find(person => !person.selectedUrl)?.id ?? data.people[0]?.id ?? ''); setLook(data.look ?? null); setWaitEstimate(data.waitEstimate ?? {}); };
  const photoAllowed = !config.sampleOnly && (config.zeroRetentionApproved || config.standardDataPolicyAllowed && hasCurrentDataConsent(record, config.dataPolicyVersion) && !needsChildDataProtection(record, config.generationRoute) || synthetic);
  const descriptionAllowed = !config.sampleOnly && (record.real !== true || config.zeroRetentionApproved || config.standardDataPolicyAllowed && hasCurrentDataConsent(record, config.dataPolicyVersion) && !needsChildDataProtection(record, config.generationRoute));
  const modeFor = person => inputModes[person.id] ?? (person.draft ? 'description' : undefined) ?? person.job?.inputMode ?? person.inputMode ?? 'photo';
  const descriptionFor = person => descriptions[person.id] ?? person.draft?.description ?? (typeof person.job?.description === 'string' ? person.job.description : typeof person.description === 'string' ? person.description : '');
  const allowedFor = person => modeFor(person) === 'description' ? descriptionAllowed : photoAllowed;
  const sameJobMode = person => (person.job?.inputMode ?? 'photo') === modeFor(person);
  const update = async () => {
    if (!savedSession.current?.record) return;
    const data = await api('portraits?childId=' + encodeURIComponent(savedSession.current.childId ?? childId) + styleQuery);
    if (alive.current && currentStyle.current === pictureStyleId) show(data);
  };
  useEffect(() => {
    alive.current = true;
    if (inputMemory) { const views = {}; for (const [id, file] of Object.entries(inputMemory.current.files ?? {})) { const url = URL.createObjectURL(file); photoURLs.current.set(id, url); views[id] = { url, kept: inputMemory.current.kept?.[id] === true }; } setPhotoViews(views); }
    return () => { alive.current = false; photoSequence.current++; for (const url of photoURLs.current.values()) URL.revokeObjectURL(url); photoURLs.current.clear(); };
  }, [childId]);
  useEffect(() => {
    let current = true; setLoading(true);
    update().catch(err => { if (alive.current && current) setError(err.message); }).finally(() => { if (alive.current && current) setLoading(false); });
    return () => { current = false; };
  }, [childId, pictureStyleId, hasRecord, session?.record]);
  const workingPerson = people.find(person => ['running', 'queued'].includes(person.job?.status));
  const running = Boolean(workingPerson);
  const reportActivity = useRef(onActivity); reportActivity.current = onActivity;
  const activityText = workingPerson ? 'Drawing ' + workingPerson.label + '’s pictures. ' + workingPerson.job.completed + ' of ' + workingPerson.job.expected + ' ready.' : '';
  useEffect(() => { reportActivity.current?.(activityText ? { message: activityText, active: workingPerson.job.status === 'running' } : null); }, [activityText, workingPerson?.job?.status]);
  useEffect(() => () => reportActivity.current?.(null), []);
  useEffect(() => {
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try { await update(); } catch (err) { if (alive.current) setError(err.message); } finally { pending = false; }
    };
    const timer = running ? setInterval(poll, 2000) : null;
    const visible = () => { if (!document.hidden) poll(); };
    document.addEventListener('visibilitychange', visible);
    return () => { if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [running, childId, pictureStyleId]);
  const run = async (id, action) => {
    setBusy(id); setError(''); setNotice('');
    try { if (!alive.current) return; await action(); if (alive.current) await update(); }
    catch (err) { if (alive.current && err.code !== 'STALE_OWNER') setError(err.message); }
    finally { if (alive.current) setBusy(''); }
  };
  const readyPerson = async person => {
    if (!ensureSaved) return { person, childId };
    const saved = await ensureSaved(); savedSession.current = saved;
    const data = await api('portraits?childId=' + encodeURIComponent(saved.childId) + styleQuery);
    if (alive.current) show(data);
    const current = data.people.find(item => item.id === person.id);
    if (!current || current.label !== person.label) throw new Error('This person changed. Check their name before saving.');
    if (modeFor(person) === 'description') appearanceDraftData(current, descriptionFor(person), draftBases.current[person.id] ?? { personIdentity: person.personIdentity, revision: person.draft?.revision ?? 0 });
    return { person: current, childId: saved.childId };
  };
  const storeDescription = async (person, ready) => {
    const target = ready ?? await readyPerson(person);
    const base = draftBases.current[person.id] ?? { personIdentity: person.personIdentity, revision: person.draft?.revision ?? 0 };
    const data = await api('portraits/' + encodeURIComponent(person.id) + '/draft', { childId: target.childId, ...scope, ...appearanceDraftData(target.person, descriptionFor(person), base) }, 'PATCH');
    const savedPerson = data.people.find(item => item.id === person.id); draftBases.current[person.id] = { personIdentity: savedPerson.personIdentity, revision: savedPerson.draft.revision };
    if (alive.current) { show(data); setDescriptions(previous => ({ ...previous, [person.id]: data.people.find(item => item.id === person.id)?.draft?.description ?? '' })); setNotice('Description saved. Make drawings when you are ready.'); }
  };
  const draw = (person, { another = false, redraw = false, compareStyles = false } = {}) => run(person.id, async () => {
    setExpandedPeople(previous => ({ ...previous, [person.id]: true }));
    const inputMode = modeFor(person); let input;
    const ready = await readyPerson(person);
    person = { ...ready.person, label: person.label };
    if (inputMode === 'description') {
      const description = descriptionFor(person).trim();
      if (!description) throw new Error('Describe how this person looks first.');
      if (description !== person.draft?.description) await storeDescription(person, ready);
      input = { inputMode, description };
    } else {
      const file = files[person.id]; if (!file) throw new Error('Choose a photo first.');
      input = { inputMode: 'photo', photo: { mime: file.type, base64: await readPhoto(file) } };
    }
    if (!alive.current) return;
    const matchingKind = person.job?.kind === (pending || compareStyles ? 'style-comparison' : 'selected-style');
    let started;
    try { started = await api('portraits/' + encodeURIComponent(person.id), { childId: ready.childId, ...scope, ...input, ...(compareStyles ? { compareStyles: true } : {}), ...(redraw ? { redraw: true } : {}), ...(another ? { another: true, anotherJobId: person.job.id } : !redraw && matchingKind && sameJobMode(person) && person.job?.canRestart && !olderBatch(person) ? { restartJobId: person.job.id } : {}) }); }
    catch (error) { if (error.status === 400 && inputMode === 'photo' && alive.current) clearPhoto(person.id); throw error; }
    if (alive.current) show(started);
    if (alive.current) clearPhoto(person.id);
  });
  const keepPhoto = person => { if (inputMemory) inputMemory.current.kept = { ...inputMemory.current.kept, [person.id]: true }; setPhotoViews(previous => ({ ...previous, [person.id]: { ...previous[person.id], kept: true } })); };
  const choose = (person, candidate) => run(person.id, async () => {
    const ready = await readyPerson(person);
    if (ready.person.job?.id !== person.job.id || !ready.person.candidates.some(item => item.id === candidate.id)) throw new Error('These details changed. Make a new drawing before choosing it.');
    setExpandedPeople(previous => ({ ...previous, [person.id]: true }));
    const selected = await api('portraits/' + encodeURIComponent(person.id) + '/select', { childId: ready.childId, ...scope, ...(!pending && candidate.pictureStyleId ? { pictureStyleId: candidate.pictureStyleId } : {}), jobId: person.job.id, candidateId: candidate.id, ...(person.job.kind === 'style-comparison' ? { lookRevision: look.revision } : {}) });
    if (alive.current) { show(selected); setNotice(person.label + '’s drawing is saved.'); setActivePerson(selected.people.find(item => !item.selectedUrl)?.id ?? person.id); }
    if (alive.current && !pending && candidate.pictureStyleId) onStyleChange?.(candidate.pictureStyleId);
    if (alive.current) await onSaved?.();
  });
  const acceptedNotice = hasCurrentDataConsent(record, config.dataPolicyVersion) && !needsChildDataProtection(record, config.generationRoute);
  const consent = !draftFamily && <DataPolicyConsent api={api} session={session} config={config} onSaved={onSaved} />;
  const chosen = people.filter(person => person.selectedUrl).length;
  const replacements = people.filter(person => person.selectedUrl && person.job && (person.job.status !== 'complete' || !(person.candidates ?? []).some(candidate => candidate.selected)));
  const nextPerson = people.find(person => !person.selectedUrl) ?? replacements[0];
  const openNextPerson = () => {
    if (!nextPerson) return;
    setActivePerson(nextPerson.id); setExpandedPeople(previous => ({ ...previous, [nextPerson.id]: true }));
    document.getElementById('portrait-person-' + nextPerson.id)?.focus({ preventScroll: true });
    document.getElementById('portrait-person-' + nextPerson.id)?.scrollIntoView({ block: 'start', behavior: 'instant' });
  };
  return <Stack spacing={2.5} className="people-workflow">
    {!loading && <Typography fontWeight={800}>{chosen} of {visiblePeople.length} people have a saved drawing.</Typography>}
    {!draftPeople && people.length > 0 && <Tabs value={activePerson || people[0].id} onChange={(_, value) => { setActivePerson(value); setError(''); setNotice(''); }} variant="fullWidth" aria-label="Choose a person" className="person-tabs">{people.map(person => <Tab key={person.id} value={person.id} label={person.label + (person.selectedUrl ? ' ✓' : '')} />)}</Tabs>}
    {!pending && onStyleChange && <Accordion className="compact-disclosure"><AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}><Typography variant="body2">Story look: {pictureStyle.label}</Typography></AccordionSummary><AccordionDetails><TextField select fullWidth label="Look to view or redraw" value={pictureStyle.id} disabled={Boolean(busy) || running} onChange={event => onStyleChange(event.target.value)}>{[...pictureStyleOptions, ...(!pictureStyleOptions.some(style => style.id === pictureStyle.id) ? [pictureStyle] : [])].map(style => <MenuItem key={style.id} value={style.id}>{style.label}</MenuItem>)}</TextField></AccordionDetails></Accordion>}
    {!draftFamily && !photoAllowed && !needsChildDataProtection(record, config.generationRoute) && <Alert severity="info">Read the data notice before using photos or real family details.</Alert>}
    {!acceptedNotice && consent}
    {synthetic && <Alert severity="warning">Test preview: use generated photos of made-up people only. Real family photos are not allowed here.</Alert>}
    {notice && <Alert severity="success" role="status">{notice}</Alert>}
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    {loading && <CircularProgress aria-label="Opening your story people" />}
    {visiblePeople.filter(person => draftPeople || person.id === (activePerson || people[0]?.id)).map(person => <Card key={person.id} className="portrait-card person-panel"><CardContent><Stack spacing={3}>
      {renderDetails?.(person)}
      <Box id={'portrait-person-' + person.id} className="portrait-head" tabIndex={-1}>
        {person.selectedUrl && <Box component="img" src={person.selectedUrl} alt={'Chosen story drawing of ' + person.label} />}
        <Box><Typography component="h3" variant="h2">{renderDetails ? (person.role === 'child' ? 'Child’s picture' : 'Grown-up’s picture') : person.label}</Typography><Typography variant="body2">{person.selectedUrl ? 'Drawing saved. Change it only if you want to.' : 'Choose a photo or describe how they look.'}</Typography></Box>
      </Box>
      <Stack spacing={2.5} id={'portrait-choices-' + person.id}>
      {['running', 'queued'].includes(person.job?.status) && <WorkingStatus active={person.job.status === 'running'} state={person.job.status} message={(person.job.kind === 'style-comparison' ? 'Drawing three looks. ' : 'Making their drawing. ') + person.job.completed + ' of ' + person.job.expected + ' ready.'}><Typography variant="body2">{person.job.timing?.elapsedText} You can close this page and come back.</Typography></WorkingStatus>}
      {person.job?.message && person.job.status !== 'running' && <Alert role="status" severity={person.job.status === 'failed' ? 'warning' : 'info'}>{person.job.message}</Alert>}
      {waitingFor(person) && <Typography variant="body2">First finish choosing your family look with {waitingFor(person).label ?? 'the first person'}. Then {person.label} gets a drawing in that look.</Typography>}
      <>
      <Tabs value={modeFor(person)} onChange={(_, value) => { setInputModes(previous => ({ ...previous, [person.id]: value })); setError(''); setNotice(''); }} variant="fullWidth" aria-label={'Photo or description for ' + person.label} className="input-tabs"><Tab value="photo" label="Upload photo" disabled={Boolean(busy)} /><Tab value="description" label="Describe person" disabled={Boolean(busy)} /></Tabs>
      {modeFor(person) === 'description' ? <Stack spacing={1.5}><TextField label={'Appearance for ' + person.label} multiline minRows={3} value={descriptionFor(person)} disabled={(!draftFamily && !descriptionAllowed) || (hasRecord && loading) || Boolean(busy)} onChange={event => { draftBases.current[person.id] = appearanceDraftBase(draftBases.current[person.id], person); setDescriptions(previous => ({ ...previous, [person.id]: event.target.value })); }} slotProps={{ inputLabel: { shrink: true }, htmlInput: { maxLength: config.portraitDescriptionMaxLength ?? 600 } }} placeholder={person.role === 'child' ? 'For example: brown eyes, long black hair, round glasses.' : 'For example: brown eyes, a blue turban and a long beard.'} helperText="Describe only what fits this person. You can mention hair, headwear, eyes or glasses." /><Button variant="outlined" disabled={Boolean(busy) || (!descriptionFor(person).trim() && !person.draft) || descriptionFor(person).trim() === person.draft?.description} onClick={() => run(person.id, () => storeDescription(person))}>{descriptionFor(person).trim() === person.draft?.description ? 'Description saved' : 'Save description'}</Button></Stack> : <Stack spacing={1.5}>
        {photoViews[person.id] && <Box><ButtonBase className="source-photo-choice" aria-label={'Keep selected photo for ' + person.label} aria-pressed={photoViews[person.id].kept} disabled={Boolean(busy)} onClick={() => keepPhoto(person)}><Box component="img" src={photoViews[person.id].url} alt={'Photo selected for ' + person.label} sx={{ width: '100%', maxHeight: { xs: 180, sm: 260 }, objectFit: 'contain', borderRadius: 2 }} /></ButtonBase>{photoViews[person.id].kept && <Typography variant="body2" fontWeight={800}>✓ Photo selected</Typography>}<Typography variant="body2">This is the photo you picked. It stays on your device until you start the drawing.</Typography></Box>}
        {photoPreparing === person.id && <Typography role="status">Opening and preparing your photo…</Typography>}
        <Stack direction="row" spacing={1.5}>
          {photoViews[person.id] && <Button variant="contained" disabled={Boolean(busy) || photoViews[person.id].kept} onClick={() => keepPhoto(person)}>{photoViews[person.id].kept ? 'Photo chosen' : 'Keep this photo'}</Button>}
          <Button component="label" variant="outlined" disabled={(!draftFamily && !photoAllowed) || Boolean(busy) || Boolean(photoPreparing)}>
            {photoViews[person.id] ? 'Change photo' : 'Choose a photo'}
            <input hidden type="file" accept={photoAccept} onChange={async event => {
              const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
              const ticket = ++photoSequence.current; clearPhoto(person.id); setPhotoPreparing(person.id); setError('');
              try {
                const prepared = await preparePhoto(file);
                if (!alive.current || ticket !== photoSequence.current) return;
                const url = URL.createObjectURL(prepared); photoURLs.current.set(person.id, url);
                setFiles(previous => ({ ...previous, [person.id]: prepared })); setPhotoViews(previous => ({ ...previous, [person.id]: { url, kept: false } }));
              } catch (error) { if (alive.current && ticket === photoSequence.current) setError(error.message); }
              finally { if (alive.current && ticket === photoSequence.current) setPhotoPreparing(''); }
            }} />
          </Button>
        </Stack>
      </Stack>}

      {workingPerson && workingPerson.id !== person.id && <Alert severity="info">We are drawing {workingPerson.label} first. {person.label} can start after those drawings are ready{pending ? ' and you choose a look' : ''}.</Alert>}
      {(modeFor(person) === 'description' ? descriptionFor(person).trim() : files[person.id] && photoViews[person.id]?.kept) && <>
        {!pending && <Button variant={person.hasStyleComparison ? 'outlined' : 'contained'} disabled={!allowedFor(person) || Boolean(busy) || running || Boolean(waitingFor(person))} onClick={() => draw(person, { compareStyles: true })}>See {person.label} in three looks</Button>}
        <Box component={pending ? 'div' : 'details'}>{!pending && <Box component="summary">Other drawing options</Box>}
        <Button variant={!pending && !person.hasStyleComparison ? 'outlined' : 'contained'} disabled={!allowedFor(person) || Boolean(busy) || running || Boolean(waitingFor(person))} onClick={() => draw(person, { redraw: Boolean(person.selectedUrl) && (!person.job || person.job.status === 'complete') })}>{busy === person.id ? 'Starting…' : pending ? `See ${person.label} in three looks` : person.job?.kind === 'style-comparison' ? person.selectedUrl && person.job.status === 'complete' ? 'Redraw this look' : 'Draw only this look' : olderBatch(person) || !sameJobMode(person) ? 'Make their story drawing' : person.job?.canRestart ? 'Start a fresh attempt for missing choices' : ['needs-photo', 'needs-input'].includes(person.job?.status) ? modeFor(person) === 'photo' ? 'Continue saved choices with this photo' : 'Continue saved choices' : person.selectedUrl ? 'Redraw this look' : 'Draw only this look'}</Button></Box>
        <Typography variant="body2" color="text.secondary">{waitEstimate[pending || !person.hasStyleComparison ? 'comparison' : 'single'] ?? 'Allow a few minutes for drawings. We will show your progress here.'} Once drawing starts, you can close this page and return to Family.</Typography>
      </>}
      </>
      {person.candidates?.length > 0 && <Accordion className="drawing-choices" expanded={expandedPeople[person.id] ?? !person.selectedUrl} onChange={(_, expanded) => setExpandedPeople(previous => ({ ...previous, [person.id]: expanded }))}><AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}><Typography>Drawing choices ({person.candidates.length})</Typography></AccordionSummary><AccordionDetails>
      {person.job?.kind === 'style-comparison' && person.candidates?.length > 0 && <Box className="portrait-candidates">
        {person.candidates.map(candidate => <Stack key={candidate.id} spacing={1} className="portrait-candidate" data-selected={candidate.selected}>
          <Typography component="h4" variant="h3" noWrap>{candidate.styleLabel}</Typography>
          <ButtonBase aria-label={`Select the ${candidate.styleLabel} picture for ${person.label}`} aria-pressed={candidate.selected} disabled={Boolean(busy) || running || person.job.status !== 'complete'} onClick={() => choose(person, candidate)} sx={{ borderRadius: 1 }}><Box component="img" src={candidate.url} alt={`${person.label} in the ${candidate.styleLabel} look`} /></ButtonBase><Button aria-label={`View the ${candidate.styleLabel} look for ${person.label}`} onClick={() => setViewing({ url: candidate.url, title: `${candidate.styleLabel} look for ${person.label}` })}>View larger</Button>{candidate.selected && <Chip label="✓ Selected" color="success" size="small" />}
          {candidate.recommended && <Chip label="Recommended" size="small" color="primary" sx={{ alignSelf: 'flex-start', transition: 'none' }} />}
          {candidate.checkNote && <Typography variant="body2" color="text.secondary">{candidate.checkNote}</Typography>}
          {pending || pictureStyleId ? <Button variant="contained" aria-label={pending ? `Use the ${candidate.styleLabel} look for our family` : `Choose the ${candidate.styleLabel} drawing for ${person.label}`} disabled={Boolean(busy) || running || person.job.status !== 'complete'} onClick={() => choose(person, candidate)}>{candidate.selected ? 'Saved drawing' : 'Save this drawing'}</Button>
            : candidate.selected ? <Chip label="Your family look" color="success" size="small" /> : <Typography variant="body2" color="text.secondary">Not chosen</Typography>}
        </Stack>)}
      </Box>}
      {person.job?.kind !== 'style-comparison' && person.candidates?.length > 0 && <Box className="portrait-candidates">
        {person.candidates.map((candidate, index) => <Stack key={candidate.id} spacing={1} className="portrait-candidate" data-selected={candidate.selected}>
          <ButtonBase aria-label={`Select picture ${index + 1} for ${person.label}`} aria-pressed={candidate.selected} disabled={Boolean(busy) || running} onClick={() => choose(person, candidate)} sx={{ borderRadius: 1 }}><Box component="img" src={candidate.url} alt={`${person.label}, drawing choice ${index + 1}`} /></ButtonBase><Button aria-label={`View drawing ${index + 1} for ${person.label}`} onClick={() => setViewing({ url: candidate.url, title: `Drawing ${index + 1} for ${person.label}` })}>View larger</Button>
          {candidate.checkNote && <Typography variant="body2" color="text.secondary">{candidate.checkNote}</Typography>}
          {candidate.selected && <Chip label="✓ Selected" color="success" size="small" />}
          <Button variant={candidate.selected ? 'outlined' : 'contained'} aria-label={`Choose drawing ${index + 1} for ${person.label}`} disabled={Boolean(busy) || running} onClick={() => choose(person, candidate)}>{candidate.selected ? 'Saved drawing' : 'Save this drawing'}</Button>
        </Stack>)}
      </Box>}
      {!pictureStyleId && person.job?.canDrawAnother && sameJobMode(person) && <>
        <Button variant="outlined" disabled={Boolean(busy) || running || !(modeFor(person) === 'description' ? descriptionFor(person).trim() : files[person.id])} onClick={() => draw(person, { another: true })}>{busy === person.id ? 'Starting…' : 'Try another drawing'}</Button>
        {modeFor(person) === 'photo' && !files[person.id] && <Typography variant="body2" color="text.secondary">To try another drawing, choose the same photo again. The app does not keep photos.</Typography>}
      </>}
      {person.selectedUrl && <Typography variant="body2">To redraw this look, add a photo again or use a description. The app does not keep photos. Your chosen drawing stays until you choose a new one.</Typography>}
      </AccordionDetails></Accordion>}
      </Stack>
    </Stack></CardContent></Card>)}
    {!draftPeople && nextPerson && nextPerson.id !== activePerson && <Button variant="outlined" onClick={openNextPerson}>Continue with {nextPerson.label}</Button>}
    <Box component="details" className="portrait-privacy"><Box component="summary">Photo and story privacy</Box><Stack spacing={2} sx={{ pt: 2 }}>{acceptedNotice && consent}<Typography variant="body2" color="text.secondary">The original photo is used for these choices and is not saved by this app. Hidden photo details are removed first. You can choose a new drawing later.</Typography><Typography variant="body2" color="text.secondary">Each story uses one look. A new drawing replaces the chosen one only after you choose it. Earlier stories stay the same.</Typography></Stack></Box>
    <PortraitViewer viewing={viewing} setViewing={setViewing} />
  </Stack>;
}
