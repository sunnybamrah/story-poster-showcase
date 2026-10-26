import React, { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';

// Optional recording for the fictional public example only. Native controls give keyboard and
// phone play, pause and seek; preload none keeps the file unloaded until the reader presses play.
export default function SampleNarration({ src }) {
  const audio = useRef(null), [failed, setFailed] = useState(false);
  // Keep the element from setup: React has already cleared the ref when this cleanup runs.
  useEffect(() => { const node = audio.current; return () => { node?.pause(); node?.removeAttribute('src'); node?.load(); }; }, []);
  return <Box component="section" className="sample-narration" aria-labelledby="sample-narration-title" sx={{ display: 'grid', gap: 1 }}>
    <Typography id="sample-narration-title" component="h2" variant="h3">Listen to the story</Typography>
    <Typography variant="body2" color="text.secondary">Listen to this story with your child.</Typography>
    <Box component="audio" ref={audio} controls preload="none" src={src} aria-labelledby="sample-narration-title" onError={() => setFailed(true)} onPlaying={() => setFailed(false)} sx={{ width: '100%', maxWidth: 560, display: 'block' }} />
    {failed && <Typography role="status" variant="body2">The recording did not load. You can still read the story below.</Typography>}
  </Box>;
}
