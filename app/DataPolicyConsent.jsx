import React, { useState } from 'react';
import { Accordion, AccordionSummary, AccordionDetails, Alert, Button, Checkbox, FormControlLabel, Link, Stack, Typography } from '@mui/material';
import { dataPolicyVersion, dataPolicyNotice, dataPolicyConsentLabel, dataPolicyURL, hasCurrentDataConsent, needsChildDataProtection, childDataNotice, childDataPolicyURL } from './data-policy.js';

export function DataPolicyNotice({ config }) {
  return <Accordion><AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}><Typography fontWeight={800}>Your choice about family data</Typography></AccordionSummary><AccordionDetails><Typography variant="body2">{config.generationRoute === 'subscription' ? 'Story Poster removes original photos after processing. Photos and story text are handled under OpenAI’s data rules.' : config.dataPolicyNotice ?? dataPolicyNotice}</Typography><Link href={config.dataPolicyURL ?? dataPolicyURL} target="_blank" rel="noreferrer">Read OpenAI’s data rules</Link></AccordionDetails></Accordion>;
}

export default function DataPolicyConsent({ api, session, config, onSaved, settings = false }) {
  const [accepted, setAccepted] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (config.zeroRetentionApproved || config.syntheticPortraits && session.record.real === false) return null;
  const current = hasCurrentDataConsent(session.record, config.dataPolicyVersion);
  const childProtected = needsChildDataProtection(session.record, config.generationRoute);
  if (current && !settings) return null;
  async function save(value) {
    setBusy(true); setError('');
    try { const saved = await api('family/consent', { childId: session.childId, accepted: value, version: config.dataPolicyVersion ?? dataPolicyVersion }); setAccepted(false); await onSaved?.(saved); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  if (current) return <Accordion><AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}><Typography>Photo permission settings</Typography></AccordionSummary><AccordionDetails><Stack spacing={1.5}><Typography variant="body2">Permission is saved for this child. Removing it pauses new stories and drawings. Saved kits stay here.</Typography>{error && <Alert severity="error">{error}</Alert>}<Button disabled={busy} onClick={() => save(false)}>Remove permission</Button></Stack></AccordionDetails></Accordion>;
  return <Stack spacing={1.5}>
    <DataPolicyNotice config={config} />
    {childProtected && <Alert severity="info">{childDataNotice} <Link href={childDataPolicyURL} target="_blank" rel="noreferrer">Read OpenAI’s child data rules</Link></Alert>}
    {error && <Alert severity="error">{error}</Alert>}
    {!childProtected && <><FormControlLabel control={<Checkbox checked={accepted} onChange={event => setAccepted(event.target.checked)} />} label={dataPolicyConsentLabel} /><Button variant="contained" disabled={!accepted || busy || !config.standardDataPolicyAllowed} onClick={() => save(true)}>Allow photo use</Button></>}
  </Stack>;
}
