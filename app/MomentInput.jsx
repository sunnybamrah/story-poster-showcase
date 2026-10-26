import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Stack, TextField, Typography } from '@mui/material';
import { createSpeechInput } from './speech-input.js';

export default function MomentInput({ value, onChange, owner, disabled = false, onListeningChange }) {
  const latest = useRef({ value, onChange, owner }); latest.current = { value, onChange, owner };
  const [speech, setSpeech] = useState({ state: 'idle', message: '', interim: '' });
  const control = useRef(null);
  useEffect(() => {
    const engine = createSpeechInput({
      Recognition: window.SpeechRecognition ?? window.webkitSpeechRecognition,
      requestMicrophone: navigator.mediaDevices?.getUserMedia ? () => navigator.mediaDevices.getUserMedia({ audio: true }) : undefined,
      getOwner: () => latest.current.owner, getText: () => latest.current.value,
      onText: text => { latest.current.value = text; latest.current.onChange(text); },
      onState: state => setSpeech(state),
    });
    control.current = engine; setSpeech({ state: 'idle', message: '', interim: '' });
    const stop = () => engine.stop();
    const hidden = () => { if (document.hidden) engine.stop(); };
    window.addEventListener('pagehide', stop); document.addEventListener('visibilitychange', hidden);
    return () => { engine.cancel(); window.removeEventListener('pagehide', stop); document.removeEventListener('visibilitychange', hidden); };
  }, [owner]);
  useEffect(() => { onListeningChange?.(speech.state === 'listening'); }, [speech.state, onListeningChange]);
  useEffect(() => { if (disabled) control.current?.stop(); }, [disabled]);
  return <Stack spacing={1.5} className="moment-input">
    <TextField required label="What stayed with you today?" multiline minRows={4} value={value} onChange={event => { control.current?.stop(); onChange(event.target.value); }} placeholder="They felt left out at lunch. What happened, and what would you like to learn together?" helperText="Tell one moment in your own words. You can edit anything you say." slotProps={{ htmlInput: { maxLength: 2000 } }} />
    <Box className="speech-control"><Button variant="outlined" type="button" disabled={disabled || speech.state === 'checking'} aria-pressed={speech.state === 'listening'} onClick={() => speech.state === 'listening' ? control.current?.stop() : control.current?.start()}>{speech.state === 'listening' ? 'Stop talking' : 'Talk'}</Button></Box>
    <Typography className="speech-notice" variant="body2" color="text.secondary">Talk uses your browser’s speech service, which may send audio to its provider. Typing always works.</Typography>
    {['not-allowed', 'service-not-allowed', 'audio-capture'].includes(speech.reason) && <Box><Button disabled={disabled || speech.state === 'checking'} onClick={() => control.current?.checkMicrophone()}>Check microphone access</Button><Typography variant="body2">On iPhone, the page menu has Website Settings and Microphone. If speech is unavailable, tap this text box and use the microphone on your keyboard.</Typography></Box>}
    <Box role="status" aria-live="polite">{speech.message && <Typography variant="body2">{speech.message}</Typography>}{speech.interim && <Typography variant="body2">Hearing: {speech.interim}</Typography>}</Box>
  </Stack>;
}
