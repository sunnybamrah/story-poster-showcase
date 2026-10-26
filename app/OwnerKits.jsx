import { OwnerAccessRequests } from './FamilyAccess';
import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';

export default function OwnerKits({ api, accessRequestsEnabled = false }) {
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [suggestions, setSuggestions] = useState([]), [suggestionError, setSuggestionError] = useState('');
  const [kits, setKits] = useState([]), [accounts, setAccounts] = useState([]), [error, setError] = useState(''), [loading, setLoading] = useState(true), [saving, setSaving] = useState(null);
  useEffect(() => {
    let live = true;
    api('owner/suggestions').then(data => { if (live) setSuggestions(data.suggestions ?? []); }).catch(err => { if (live && err.code !== 'STALE_OWNER') setSuggestionError('Feedback could not be opened. Reload to try again.'); }).finally(() => { if (live) setSuggestionsLoading(false); });
    Promise.all([api('owner/kits'), api('owner/accounts')]).then(([finished, families]) => { if (live) { setKits(finished.kits); setAccounts(families.accounts); } }).catch(err => { if (live && err.code !== 'STALE_OWNER') setError(err.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);
  const change = async account => {
    setSaving(account.id); setError('');
    try { await api('owner/accounts/' + account.id, { creationEnabled: !account.creationEnabled }, 'PATCH'); const next = await api('owner/accounts'); setAccounts(next.accounts); }
    catch (err) { if (err.code !== 'STALE_OWNER') setError(err.message); }
    finally { setSaving(null); }
  };
  return <Stack spacing={3}>
    <Typography variant="h1" component="h1" data-heading>{accessRequestsEnabled ? 'Families and stories' : 'Finished kits'}</Typography>
    {accessRequestsEnabled && <><OwnerAccessRequests api={api} /><Typography variant="h2" component="h2">Finished kits</Typography></>}
    <Typography>Review finished stories and posters here. Original notes, uploaded photos and unfinished work are not shown.</Typography>
    {error && <Alert severity="error">{error}</Alert>}{loading && <Typography role="status">Opening finished kits…</Typography>}
    {!loading && !kits.length && <Typography>No finished kits yet.</Typography>}
    <Box className="kit-grid">{kits.map(kit => { const base = '/api/owner/kits/' + encodeURIComponent(kit.id) + '/files/'; return <Box className="kit-card" key={kit.id}>
      <Box component="img" className="kit-cover" src={base + 'poster.png'} alt={'Finished poster: ' + (kit.result?.chapterTitle ?? 'Story')} />
      <Stack spacing={1.5}><Typography component="h2" variant="h2">{kit.result?.chapterTitle ?? 'Finished story'}</Typography><Typography variant="body2">{new Date(kit.createdAt).toLocaleDateString()}</Typography><Button component="a" href={base + 'kit_final.pdf'} target="_blank" rel="noreferrer" variant="outlined">Read or download kit</Button><Button component="a" href={base + 'poster.pdf'} target="_blank" rel="noreferrer">Open poster</Button></Stack>
    </Box>; })}</Box>
    <Box component="section" id="suggestions" aria-label="Suggested changes"><Typography component="h2" variant="h2">Suggested changes</Typography>
      {suggestionError && <Alert severity="warning">{suggestionError}</Alert>}
      {suggestionsLoading && <Typography variant="body2" role="status">Opening suggestions…</Typography>}
      {!suggestionsLoading && !suggestions.length && !suggestionError && <Typography variant="body2">No suggestions yet.</Typography>}
      <Stack spacing={2} sx={{ mt: 2 }}>{suggestions.map(item => <Box key={item.id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}>
        <Typography fontWeight={700}>{item.page ? `Page ${item.page}` : 'Whole kit'}</Typography>
        <Typography sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.note}</Typography>
        <Typography variant="body2" color="text.secondary">{new Date(item.createdAt).toLocaleString()}</Typography>
        <Button component="a" href={'/api/owner/kits/' + encodeURIComponent(item.jobId) + '/files/kit_final.pdf'} target="_blank" rel="noreferrer">Open this kit</Button>
      </Box>)}</Stack>
    </Box>
    <Typography component="h2" variant="h2">New-story access</Typography>
    <Typography variant="body2">Turning this off stops new stories. Sign-in, password recovery, saved reading and downloads remain available.</Typography>
    {accounts.map(account => <Box key={account.id} className="owner-account"><Stack spacing={1}><Typography fontWeight={700}>{account.email ?? account.username}</Typography><Typography variant="body2">{account.creationEnabled ? 'New stories allowed' : 'New stories turned off'}</Typography><Button variant="outlined" disabled={saving !== null} onClick={() => change(account)}>{account.creationEnabled ? 'Turn off new stories' : 'Allow new stories'}</Button></Stack></Box>)}
  </Stack>;
}
