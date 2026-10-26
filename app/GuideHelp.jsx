import React, { useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';

export default function GuideHelp({ compact = false, requiresInvitation = false }) {
  const [open, setOpen] = useState(false), [failed, setFailed] = useState(false);
  const video = useRef(null);
  const close = () => { video.current?.pause(); setOpen(false); };
  return <>
    <Button size={compact ? 'small' : 'medium'} onClick={() => { setFailed(false); setOpen(true); }} aria-label={compact ? 'Help: watch the short guide' : undefined}>{compact ? 'Help' : 'Watch the short guide'}</Button>
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby={compact ? 'help-guide-title' : 'welcome-guide-title'}>
      <DialogTitle id={compact ? 'help-guide-title' : 'welcome-guide-title'}>A quick guide to Story Poster</DialogTitle>
      <DialogContent><Stack spacing={2}>
        <Box component="details"><Box component="summary" sx={{ cursor: 'pointer', fontWeight: 800 }}>Read the steps</Box><Box component="ol" sx={{ pl: 2.5, fontSize: '.95rem', '& li': { mb: .75 } }}>
          <li>{requiresInvitation ? 'Request access, then use your approved email link to join.' : 'Sign in or create your family account.'}</li>
          <li>Add your people and choose Friendly anime, Adventure comic or Diary doodles.</li>
          <li>Tell us one moment and pick a drawing style.</li>
          <li>Tap Create our story; your progress stays saved if you leave.</li>
          <li>Read the story and explore all five pages together.</li>
          <li>Download the kit or find it later in saved stories.</li>
        </Box></Box>
        {open && <Box component="video" ref={video} controls playsInline preload="none" poster="/videos/story-poster-how-to.png" aria-label="Story Poster guide with spoken instructions and captions" src="/videos/story-poster-how-to.mp4" onError={() => setFailed(true)} sx={{ width: '100%', maxHeight: '60dvh', objectFit: 'contain', backgroundColor: '#111', borderRadius: 2 }} />}
        {failed && <Alert severity="info">The video did not load. You can read the steps above.</Alert>}
      </Stack></DialogContent>
      <DialogActions><Button onClick={close}>Close guide</Button></DialogActions>
    </Dialog>
  </>;
}
