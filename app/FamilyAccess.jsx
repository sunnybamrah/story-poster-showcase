import React, { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, Stack, TextField, Typography } from '@mui/material';

const deliveryWords = delivery => delivery?.status === 'pending' && !delivery.updatedAt && !delivery.attempts ? '' : ({ pending: 'The email is queued.', sending: 'Sending the email…', accepted: 'The email was sent. Delivery is not yet confirmed.', delivered: 'Delivery was confirmed.', failed: 'The email could not be sent. You can try again.' })[delivery?.status] ?? '';
const invitationWords = { 'pending-request': 'Waiting for the parent to request access', 'pending-review': 'Waiting for Sunny to review', approved: 'Approved', declined: 'Not approved', joined: 'Joined' };
function AccessHeading({ title, children }) { return <Box className="access-heading"><Typography className="eyebrow">A little time, together</Typography><Typography variant="h1" component="h1" data-heading tabIndex={-1}>{title}</Typography><Typography color="text.secondary">{children}</Typography></Box>; }

export function AccessRequest({ api, referralToken, enabled = true, onBack, onSignIn, onInvalid }) {
  const [email, setEmail] = useState(''), [adultName, setAdultName] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const alive = useRef(true); useEffect(() => () => { alive.current = false; }, []);
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { const reply = await api('access-requests', { email: email.trim(), ...(adultName.trim() ? { adultName: adultName.trim() } : {}), ...(referralToken ? { referralToken } : {}) }); if (alive.current) setMessage(reply.message ?? 'Sunny will review your request. If approved, you will get an email with a link to join.'); }
    catch (err) { if (alive.current && err.code !== 'STALE_OWNER') { setError(err.message); if (err.status === 410) onInvalid?.(); } }
    finally { if (alive.current) setBusy(false); }
  };
  return <Stack spacing={3} className="access-page">
    <AccessHeading title={message ? 'Thanks for asking' : 'A story night for your family'}>{message ? 'Your next step will come by email.' : 'Ask to try Story Poster with your family. Sunny reviews each request.'}</AccessHeading>
    <Box component="form" onSubmit={submit} className="access-form"><Stack spacing={2.5}>
      {message ? <Typography role="status">{message}</Typography> : <>
        {referralToken && <Alert severity="info">Use the email address your friend invited.</Alert>}
        {!enabled && <Alert severity="info">Requests are not open right now. Existing families can still sign in.</Alert>}
        {error && <Alert severity="error">{error}</Alert>}
        <TextField required type="email" label="Your email address" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} disabled={busy || !enabled} slotProps={{ htmlInput: { maxLength: 254 } }} />
        <TextField label="Your name (optional)" autoComplete="given-name" value={adultName} onChange={event => setAdultName(event.target.value)} disabled={busy || !enabled} slotProps={{ htmlInput: { maxLength: 80 } }} helperText="The grown-up’s name. No child’s details needed here." />
        <Button type="submit" variant="contained" disabled={busy || !enabled}>{busy ? 'Sending your request…' : 'Request access'}</Button>
        <Typography variant="body2" color="text.secondary">If approved, you will get a link by email to set your password.</Typography>
      </>}
      <Button onClick={onSignIn}>Already have an account? Sign in</Button>
      <Button onClick={onBack}>Back</Button>
    </Stack></Box>
  </Stack>;
}

export function ApprovedSignup({ api, token, onJoined, onRequest, onSignIn, onInvalid }) {
  const [invite, setInvite] = useState(null), [password, setPassword] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (!token) { setError('Open the invite link from your email to continue.'); setLoading(false); return () => { alive.current = false; }; }
    api('invitations/inspect', { token }).then(reply => { if (alive.current) setInvite(reply); }).catch(err => { if (alive.current && err.code !== 'STALE_OWNER') { setError(err.message); if (err.status === 410) onInvalid?.(); } }).finally(() => { if (alive.current) setLoading(false); });
    return () => { alive.current = false; };
  }, [token]);
  const submit = async event => {
    event.preventDefault(); if (!invite) return; setBusy(true); setError('');
    try { const saved = await api('signup', { email: invite.email, password, inviteToken: token }); if (alive.current) { setPassword(''); onJoined(saved); } }
    catch (err) { if (alive.current && err.code !== 'STALE_OWNER') { setError(err.message); if (err.status === 410) onInvalid?.(); } }
    finally { if (alive.current) setBusy(false); }
  };
  return <Stack spacing={3} className="access-page"><AccessHeading title="Your family is welcome here">Choose your password. Then add the people in your story.</AccessHeading><Box component="form" onSubmit={submit} className="access-form"><Stack spacing={2.5}>
    {loading && <Typography role="status">Checking your invite…</Typography>}
    {error && <Alert severity="error">{error}</Alert>}
    {invite && <><TextField label="Your email address" value={invite.email} slotProps={{ input: { readOnly: true } }} /><TextField required type="password" label="Choose a password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" helperText="At least 8 characters." disabled={busy} slotProps={{ htmlInput: { minLength: 8, maxLength: 128 } }} /><Button type="submit" variant="contained" disabled={busy}>{busy ? 'Saving your account…' : 'Continue to our people'}</Button></>}
    {!loading && !invite && <Button onClick={onRequest} variant="outlined">Request a new invite</Button>}
    <Button onClick={onSignIn}>Back to sign in</Button>
  </Stack></Box></Stack>;
}

export function FamilyInvites({ api, session, onBack }) {
  const [data, setData] = useState(null), [email, setEmail] = useState(''), [adultName, setAdultName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [shownLink, setShownLink] = useState('');
  const alive = useRef(true);
  const show = reply => { if (alive.current) setData(previous => ({ ...previous, ...reply, invitations: reply.invitations ?? [...(previous?.invitations ?? []).filter(item => item.id !== reply.invitation?.id), ...(reply.invitation ? [reply.invitation] : [])] })); };
  useEffect(() => { alive.current = true; api('invitations').then(show).catch(err => { if (alive.current && err.code !== 'STALE_OWNER') setError(err.message); }); return () => { alive.current = false; }; }, []);
  const run = async action => { setBusy(true); setError(''); setNotice(''); try { await action(); } catch (err) { if (alive.current && err.code !== 'STALE_OWNER') setError(err.message); } finally { if (alive.current) setBusy(false); } };
  const create = event => { event.preventDefault(); const delivery = event.nativeEvent.submitter?.value === 'email' ? 'email' : 'link'; run(async () => { const reply = await api('invitations', { email: email.trim(), ...(adultName.trim() ? { adultName: adultName.trim() } : {}), delivery }); if (!alive.current) return; show(reply); setEmail(''); setAdultName(''); if (delivery === 'link') setShownLink(reply.invitation?.link ?? ''); setNotice(delivery === 'link' ? 'Your invite link is ready. It is for this email address only.' : deliveryWords(reply.invitation?.emailDelivery) || 'The invitation email is queued.'); }); };
  const copy = async invitation => { setShownLink(invitation.link); setError(''); try { await navigator.clipboard.writeText(invitation.link); if (alive.current) setNotice('Invite link copied. Share it with this parent.'); } catch { if (alive.current) setNotice('The link is shown below so you can copy it.'); } };
  const canSend = data?.canSendInvitations ?? (session.creationEnabled !== false && session.emailVerified !== false);
  return <Stack spacing={3} className="access-page"><AccessHeading title="Invite a family">Know another parent who would enjoy a story night? Send them a personal invite.</AccessHeading>
    {error && <Alert severity="error">{error}</Alert>}{notice && <Alert severity="success" role="status">{notice}</Alert>}
    {!data && !error && <Typography role="status">Opening your invitations…</Typography>}
    {data && <><Box className="invitation-balance"><Typography component="h2" variant="h2">{data.remaining} of {data.limit} invitations left</Typography><Typography variant="body2">Each invite is for one parent. Sunny reviews their request before they join.</Typography></Box>
    {data.canInvite && data.remaining > 0 ? <Box component="form" className="access-form" onSubmit={create}><Stack spacing={2.5}>
      {!data.canInvite && <Alert severity="info">{data.canInviteReason || (data.remaining === 0 ? 'You have used your invitations. Your saved links are still below.' : 'New invitations are not available for this account right now.')}</Alert>}
      <TextField required type="email" label="Parent’s email address" autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} disabled={busy || !data.canInvite || data.remaining === 0} slotProps={{ htmlInput: { maxLength: 254 } }} />
      <TextField label="Parent’s name (optional)" value={adultName} onChange={event => setAdultName(event.target.value)} disabled={busy || !data.canInvite || data.remaining === 0} slotProps={{ htmlInput: { maxLength: 80 } }} />
      <Button type="submit" name="delivery" value="link" variant="contained" disabled={busy || !data.canInvite || data.remaining === 0}>Make invite link</Button>
      <Button type="submit" name="delivery" value="email" variant="outlined" disabled={busy || !data.canInvite || data.remaining === 0}>Email invitation to this parent</Button>
    </Stack></Box> : <Alert severity="info">{data.canInviteReason || 'New invitations are not available right now. Your saved links are still here.'}</Alert>}
    {shownLink && <TextField label="Invite link" value={shownLink} slotProps={{ input: { readOnly: true } }} helperText="This link is for the invited email address only." onFocus={event => event.target.select()} />}
    {data.invitations?.length > 0 && <Box><Typography component="h2" variant="h2" sx={{ mb: 2 }}>Your invitations</Typography><Stack spacing={2}>{data.invitations.map(invitation => <Box className="invitation-card" key={invitation.id}><Stack spacing={1.5}><Typography fontWeight={700}>{invitation.adultName || invitation.email}</Typography>{invitation.adultName && <Typography variant="body2">{invitation.email}</Typography>}<Typography variant="body2">{invitationWords[invitation.status] ?? 'Invite saved'}</Typography>{deliveryWords(invitation.emailDelivery) && <Typography variant="body2" color="text.secondary">{deliveryWords(invitation.emailDelivery)}</Typography>}{invitation.status !== 'joined' && <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>{invitation.link && <Button disabled={busy} onClick={() => copy(invitation)}>Copy invite link</Button>}<Button disabled={busy || !canSend} onClick={() => run(async () => { const reply = await api('invitations/' + invitation.id + '/send', {}); show(reply); if (alive.current) setNotice(reply.message ?? (deliveryWords(reply.invitation?.emailDelivery) || 'The invitation email is queued.')); })}>Email this invite</Button></Stack>}</Stack></Box>)}</Stack></Box>}
    </>}
    <Button onClick={onBack}>Back to family</Button>
  </Stack>;
}

export function OwnerAccessRequests({ api }) {
  const [requests, setRequests] = useState([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(''), [error, setError] = useState('');
  const alive = useRef(true);
  const reload = async () => { const reply = await api('owner/access-requests'); if (alive.current) setRequests(reply.requests ?? []); };
  useEffect(() => { alive.current = true; reload().catch(err => { if (alive.current && err.code !== 'STALE_OWNER') setError(err.message); }).finally(() => { if (alive.current) setLoading(false); }); return () => { alive.current = false; }; }, []);
  const decide = async (request, decision) => { setBusy(request.id); setError(''); try { await api('owner/access-requests/' + request.id + '/decision', { decision }); if (alive.current) await reload(); } catch (err) { if (alive.current && err.code !== 'STALE_OWNER') setError(err.message); } finally { if (alive.current) setBusy(''); } };
  return <Box className="owner-requests"><Stack spacing={2.5}><Box><Typography variant="h2" component="h2">Families asking to join</Typography><Typography variant="body2" color="text.secondary">Approve a parent to send their own one-use signup link.</Typography></Box>
    {error && <Alert severity="error">{error}</Alert>}{loading && <Typography role="status">Opening requests…</Typography>}
    {!loading && !requests.length && <Typography>No requests waiting.</Typography>}
    {requests.map(request => <Box className="owner-account" key={request.id}><Stack spacing={1.5}><Typography fontWeight={800}>{request.adultName || request.email}</Typography>{request.adultName && <Typography variant="body2">{request.email}</Typography>}<Chip size="small" label={request.joinedAt ? 'Joined' : request.status === 'approved' ? 'Approved' : request.status === 'declined' ? 'Declined' : 'Waiting for review'} sx={{ alignSelf: 'flex-start' }} />{request.referrerEmail && <Typography variant="body2">Invited by {request.referrerEmail}</Typography>}{request.invitationExpired && !request.joinedAt && <Typography variant="body2">That invite link has expired.</Typography>}{request.invitationEmail && <Typography variant="body2">{deliveryWords(request.invitationEmail)}</Typography>}{Object.values(request.notifications ?? {}).some(channel => channel.status === 'failed') && <Typography variant="body2">One owner notice could not be sent. The request is saved here.</Typography>}
      {request.status === 'approved' && !request.joinedAt && <Button variant="outlined" disabled={Boolean(busy)} onClick={() => decide(request, 'approve')}>Email invitation again</Button>}
      {request.status === 'pending' && <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}><Button variant="contained" disabled={Boolean(busy)} onClick={() => decide(request, 'approve')}>Approve and email invite</Button><Button variant="outlined" disabled={Boolean(busy)} onClick={() => decide(request, 'decline')}>Decline</Button></Stack>}
      {request.status === 'approved' && !request.joinedAt && (request.invitationExpired || request.invitationEmail?.status === 'failed') && <Button variant="outlined" disabled={Boolean(busy)} onClick={() => decide(request, 'approve')}>Send fresh link</Button>}
    </Stack></Box>)}
    <Button disabled={Boolean(busy) || loading} onClick={() => { setError(''); reload().catch(err => { if (alive.current && err.code !== 'STALE_OWNER') setError(err.message); }); }}>Refresh requests</Button>
  </Stack></Box>;
}
