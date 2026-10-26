import React, { useState } from 'react';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';

export default function AccountRecovery({ api, token = '', kind = 'forgot', onBack, onDone }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const submit = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = kind === 'verify' ? await api('auth/verify', { token }) : kind === 'reset' ? await api('auth/reset-password', { token, password }) : await api('auth/forgot-password', { email });
      setPassword(''); setMessage(response.message ?? (kind === 'forgot' ? 'If this email has an account, a recovery link will be sent. Check your inbox and spam folder.' : kind === 'verify' ? 'Your email is checked. You can continue.' : 'Your password is changed. Sign in to return to your saved stories.'));
      if (kind === 'verify') onDone?.(response);
    } catch (err) { if (err.code !== 'STALE_OWNER') setError(err.message); }
    finally { setBusy(false); }
  };
  return <Stack component="form" spacing={2.5} onSubmit={submit}>
    <Typography component="h1" variant="h1" data-heading>{kind === 'verify' ? 'Check your email address' : kind === 'reset' ? 'Choose a new password' : 'Get back to your stories'}</Typography>
    <Typography>{kind === 'verify' ? 'Use the button below to finish checking your email.' : 'Recovery keeps your same family, drawings and saved stories.'}</Typography>
    {error && <Alert severity="error">{error}</Alert>}{message && <Alert severity="success">{message}</Alert>}
    {kind === 'forgot' && <TextField required type="email" label="Your email address" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} />}
    {kind === 'reset' && !message && <TextField required type="password" label="New password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} helperText="At least 8 characters." slotProps={{ htmlInput: { minLength: 8, maxLength: 128 } }} />}
    {!message && <Button type="submit" variant="contained" disabled={busy}>{kind === 'verify' ? 'Check my email' : kind === 'reset' ? 'Save new password' : 'Send recovery link'}</Button>}
    <Button type="button" onClick={onBack}>{kind === 'verify' ? 'Continue' : 'Back to sign in'}</Button>
  </Stack>;
}
