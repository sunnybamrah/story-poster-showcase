import React, { useEffect, useRef, useState } from 'react';
import { GuideSources } from './TeachingLibrary';
import { createReaderPageCache } from './reader-page-cache.js';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';

const pageTitles = ['Your poster', 'The story', 'The story, continued', 'Try it together', 'For you and your child'];

// Read the kit's approved printed words. No generated explanation is approved here.
export default function PosterReader({ result, assetsBase, openInitially = false, firstPage = 1, lastPage = 5, triggerLabel, onSuggestChange }) {
  const first = Number.isInteger(firstPage) ? Math.max(1, Math.min(5, firstPage)) : 1;
  const last = Number.isInteger(lastPage) ? Math.max(first, Math.min(5, lastPage)) : 5;
  const [section, setSection] = useState(null);
  const [open, setOpen] = useState(openInitially);
  const [page, setPage] = useState(first);
  const [imageState, setImageState] = useState('loading');
  const [retry, setRetry] = useState(0);
  const [pageImage, setPageImage] = useState(null);
  const pageCache = useRef(null);
  const touch = useRef(null), scroll = useRef(null);
  const viewportScale = () => window.visualViewport?.scale ?? 1;
  const sections = (result.posterSections ?? []).filter(item => item.id !== 'footer' && item.text);
  const pagesBase = assetsBase.replace(/files\/$/, 'pages/');
  const previewsBase = assetsBase.replace(/files\/$/, 'previews/');
  const getCache = () => {
    if (!pageCache.current) pageCache.current = createReaderPageCache(pagesBase);
    return pageCache.current;
  };
  const pageRange = () => Array.from({ length: last - first + 1 }, (_, index) => first + index);
  useEffect(() => {
    const cache = createReaderPageCache(pagesBase); pageCache.current = cache;
    if (!triggerLabel) cache.warm(pageRange());
    return () => { cache.dispose(); pageCache.current?.dispose(); pageCache.current = null; };
  }, [pagesBase, first, last, triggerLabel]);
  const closePages = () => { setOpen(false); pageCache.current?.dispose(); pageCache.current = null; setPageImage(null); };
  useEffect(() => {
    setPageImage(null);
    if (!open) return;
    let current = true;
    const cache = getCache();
    cache.warm(pageRange());
    setImageState('loading');
    cache.get(page).then(src => {
      if (!current) return;
      setPageImage({ page, src });

    }).catch(() => { if (current) setImageState('error'); });
    return () => { current = false; };
  }, [open, pagesBase, page, retry, last]);
  const showPage = next => { const bounded = Math.max(first, Math.min(last, next)); if (bounded !== page) { setPage(bounded); setImageState('loading'); } };
  useEffect(() => { if (scroll.current) scroll.current.scrollTo({ top: 0, left: 0 }); }, [page, open]);
  useEffect(() => { if (openInitially) setOpen(true); }, [openInitially]);
  const openPages = (number = first) => { showPage(Number.isInteger(number) ? number : first); setOpen(true); };
  return <>
    {triggerLabel ? <Button onClick={() => openPages()} aria-label={`Preview ${triggerLabel}`} sx={{ p: 0, minWidth: 0, display: 'inline', fontSize: 'inherit', fontWeight: 700, lineHeight: 'inherit', textDecoration: 'underline', verticalAlign: 'baseline', textAlign: 'left' }}>{triggerLabel}</Button> : <>
    <Box className="kit-page-links" role="group" aria-label="The five kit pages">{['Poster', 'Story page 1', 'Story page 2', 'Try it together', 'Grown-up notes'].map((label, index) => <Button key={label} variant="outlined" onClick={() => openPages(index + 1)}>{label}</Button>)}</Box>
    <Button className="poster-preview" aria-label="Open all five pages" onClick={() => openPages()} sx={{ p: 0, display: 'block', overflow: 'hidden', border: '1px solid', borderColor: 'divider', borderRadius: 3 }}>
      <Box component="img" src={previewsBase + 'poster.webp'} alt={`${result.nickname}’s ${result.move.name} poster. Tap to open all five pages.`} sx={{ display: 'block', width: '100%', height: 'auto' }} />
    </Button>
    <Typography variant="body2" color="text.secondary">Tap the poster, then swipe to turn the pages.</Typography>
    <Box component="details"><Box component="summary" sx={{ cursor: 'pointer', py: 1, fontWeight: 700 }}>Read the poster in larger type</Box>
      <Button onClick={() => setSection('all')}>Read all poster words</Button>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1 }}>
        {sections.filter(item => item.title).map(item => <Button key={item.id} variant="outlined" onClick={() => setSection(item.id)} sx={{ textAlign: 'left', fontSize: 15 }}>{item.title}</Button>)}
      </Box>
    </Box>
    </>}
    <Dialog open={open} onClose={closePages} fullScreen aria-labelledby="kit-reader-title"
      slotProps={{ paper: { sx: { height: '100dvh', maxHeight: '100dvh', m: 0, overflow: 'hidden', bgcolor: 'background.default', pt: 'env(safe-area-inset-top)', pb: 'env(safe-area-inset-bottom)' } } }}
      onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); showPage(page + (event.key === 'ArrowRight' ? 1 : -1)); } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, minHeight: 48, flexShrink: 0 }}>
        <Typography id="kit-reader-title" component="h2" sx={{ fontSize: 16, fontWeight: 700 }}>{pageTitles[page - 1]}</Typography>
        <Button aria-label="Close pages" onClick={closePages} sx={{ minWidth: 44, fontSize: 26, lineHeight: 1 }}>×</Button>
      </Box>
      <DialogContent ref={scroll} sx={{ p: 1, minHeight: 0, flex: '1 1 0', overflow: 'hidden', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'auto' }}
        onTouchStart={event => { touch.current = event.touches.length === 1 && viewportScale() <= 1.01 ? { x: event.touches[0].clientX, y: event.touches[0].clientY, scale: viewportScale() } : null; }}
        onTouchMove={event => { if (event.touches.length !== 1 || viewportScale() > 1.01) touch.current = null; }}
        onTouchCancel={() => { touch.current = null; }}
        onTouchEnd={event => {
          const start = touch.current, end = event.changedTouches[0]; touch.current = null;
          if (!start || !end || event.touches.length || viewportScale() > 1.01) return;
          const dx = end.clientX - start.x, dy = end.clientY - start.y;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) showPage(page + (dx < 0 ? 1 : -1));
        }}>
        {imageState === 'loading' && <Stack role="status" direction="row" spacing={1.5} sx={{ position: 'absolute', top: 8, left: 8, alignItems: 'center', bgcolor: 'background.paper', p: 1, borderRadius: 1 }}><CircularProgress size={20} /><Typography>Opening your saved page.</Typography></Stack>}
        {imageState === 'error' ? <Alert severity="warning" action={<Button onClick={() => { pageCache.current?.invalidate(page); setImageState('loading'); setRetry(value => value + 1); }}>Try again</Button>}>
          This page did not open. Your saved kit is safe. <a href={assetsBase + 'kit_final.pdf'} target="_blank" rel="noreferrer">Open the five-page PDF</a>.
        </Alert> : open && pageImage?.page === page && <Box component="img" key={`${page}-${retry}`} src={pageImage.src}
          className="kit-reader-page" onLoad={() => setImageState('ready')} onError={() => setImageState('error')}
          alt={`Page ${page} of 5. ${pageTitles[page - 1]}. The saved page with its pictures and words.`}
          sx={{ display: 'block', width: '100%', height: '100%', minHeight: 0, objectFit: 'contain', touchAction: 'auto' }} />}
      </DialogContent>
      <DialogActions sx={{ px: 1, py: .5, flexShrink: 0, justifyContent: 'space-between', gap: .5 }}>
        <Button disabled={page === first} onClick={() => showPage(page - 1)} aria-label="Previous page" sx={{ minWidth: 44, px: 1, flexShrink: 0 }}>←</Button>
        <Typography aria-live="polite" variant="body2" sx={{ whiteSpace: 'nowrap', fontSize: 14 }}>Page {page} of 5</Typography>
        {onSuggestChange && <Button size="small" sx={{ px: 1, minHeight: 44, fontSize: 13, lineHeight: 1.2 }} onClick={() => onSuggestChange(page)}>Suggest a change</Button>}
        <Button disabled={page === last} onClick={() => showPage(page + 1)} aria-label="Next page" sx={{ minWidth: 44, px: 1, flexShrink: 0 }}>→</Button>
      </DialogActions>
      {page === 5 && result.move?.sources?.length > 0 && <Box component="details" sx={{ px: 2, maxHeight: '30dvh', overflow: 'auto', flexShrink: 0 }}><Box component="summary" sx={{ cursor: 'pointer', py: 1 }}>Sources</Box><GuideSources sources={result.move.sources} /></Box>}
    </Dialog>
    <Dialog open={section !== null} onClose={() => setSection(null)} fullWidth maxWidth="sm" scroll="paper" aria-labelledby="poster-reader-title">
      <DialogTitle id="poster-reader-title" sx={{ fontFamily: '"Baloo 2"', fontSize: 28 }}>{section === 'all' ? result.move.name : sections.find(item => item.id === section)?.title ?? result.move.name}</DialogTitle>
      <DialogContent dividers><Stack spacing={3}>
        {sections.length ? sections.filter(item => (section === 'all' && item.id !== 'title') || item.id === section).map(item => <Box key={item.id}>
          {item.title && section === 'all' && <Typography component="h2" variant="h3" sx={{ mb: 1 }}>{item.title}</Typography>}
          <Typography sx={{ fontSize: 22, lineHeight: 1.65, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.text}</Typography>
        </Box>) : <><Box component="img" src={previewsBase + 'poster.webp'} alt="Full-size saved poster" sx={{ width: '100%', height: 'auto' }} /><Typography>This older sample has no separate text view. Open the printable poster to zoom in.</Typography></>}
      </Stack></DialogContent>
      <DialogActions><Button onClick={() => setSection(null)}>Back to our poster</Button></DialogActions>
    </Dialog>
  </>;
}
