import React, { useEffect, useRef } from 'react';
import { Box, Button, Dialog, DialogTitle, DialogContent, DialogActions } from '@mui/material';

// One drawing viewer shared by setup, replacements and saved style previews.
export default function PortraitViewer({ viewing, setViewing }) {
  const zoomArea = useRef(null);
  useEffect(() => {
    const node = zoomArea.current;
    if (!node || !viewing) return;
    node.scrollTop = 0;
    node.scrollLeft = viewing.zoom ? (node.scrollWidth - node.clientWidth) / 2 : 0;
  }, [viewing?.url, viewing?.zoom]);
  return <Dialog open={Boolean(viewing)} onClose={() => setViewing(null)} fullWidth maxWidth="sm" aria-labelledby="portrait-view-title">
      <DialogTitle id="portrait-view-title">{viewing?.title}</DialogTitle>
      <DialogContent><Box ref={zoomArea} data-portrait-zoom sx={{ overflow: 'auto', maxHeight: '65vh' }}><Box component="img" src={viewing?.url} alt={viewing?.title ?? ''} sx={{ display: 'block', width: viewing?.zoom ? '200%' : '100%', maxWidth: viewing?.zoom ? 'none' : '100%', height: 'auto' }} /></Box></DialogContent>
      <DialogActions><Button aria-pressed={viewing?.zoom === true} onClick={() => setViewing(previous => ({ ...previous, zoom: !previous.zoom }))}>{viewing?.zoom ? 'Show whole drawing' : 'Zoom in'}</Button><Button onClick={() => setViewing(null)}>Close drawing</Button></DialogActions>
    </Dialog>;
}
