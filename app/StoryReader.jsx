import React, { useEffect, useRef, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';

export function storyParts(result) {
  return (result.storyPages ?? [result.story.replace(/^(?:MADE UP|REAL)\s*\n/, '')]).map(part => part.split(/\n+/).filter(Boolean));
}

export default function StoryReader({ result, assetsBase, savedPlace, textSize = 'standard', onSavePlace, isCurrent, onPoster, onShelf, planEditor }) {
  const parts = storyParts(result), anchors = parts.flatMap((paragraphs, page) => [`story-page-${page + 1}`, ...paragraphs.map((_, index) => `story-paragraph-${page + 1}-${index}`)]).concat('story-tiny-try');
  const initial = anchors.includes(savedPlace) ? savedPlace : null;
  const [size, setSize] = useState(textSize), [place, setPlace] = useState(initial), [storageOkay, setStorageOkay] = useState(true);
  const root = useRef(null), alive = useRef(true), tracking = useRef(false), sizeRef = useRef(size), resizeAnchor = useRef(null), selectedAnchor = useRef(null);
  sizeRef.current = size;
  const currentAnchor = () => {
    const nodes = [...(root.current?.querySelectorAll('[data-reading-anchor]') ?? [])];
    return nodes.filter(node => node.getBoundingClientRect().top <= 150).at(-1)?.id ?? anchors[0];
  };
  const save = anchor => {
    if (!alive.current || !isCurrent()) return;
    if (onSavePlace(anchor, sizeRef.current)) { setPlace(anchor); setStorageOkay(true); }
    else setStorageOkay(false);
  };
  const jump = (anchor, restoring = false) => {
    if (!alive.current || !isCurrent()) return;
    const node = root.current?.querySelector('#' + anchor);
    if (node) { if (!restoring) selectedAnchor.current = anchor; node.scrollIntoView({ block: 'start', behavior: 'instant' }); node.focus({ preventScroll: true }); save(anchor); }
  };
  useEffect(() => {
    alive.current = true; tracking.current = false; let timer;
    const ready = async () => {
      await document.fonts.ready;
      if (!alive.current || !isCurrent() || !root.current) return;
      await Promise.all([...root.current.querySelectorAll('img')].map(image => image.decode().catch(() => {})));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!alive.current || !isCurrent()) return;
      if (selectedAnchor.current) jump(selectedAnchor.current, true);
      else if (initial) jump(initial, true);
      else { window.scrollTo(0, 0); document.querySelector('[data-heading]')?.focus({ preventScroll: true }); }
      root.current.dataset.readerReady = 'true';
      tracking.current = true;
    };
    const track = () => { if (!tracking.current) return; clearTimeout(timer); timer = setTimeout(() => save(currentAnchor()), 180); };
    const hide = () => { if (document.hidden && tracking.current) save(currentAnchor()); };
    ready(); window.addEventListener('scroll', track, { passive: true }); document.addEventListener('visibilitychange', hide);
    return () => { alive.current = false; clearTimeout(timer); window.removeEventListener('scroll', track); document.removeEventListener('visibilitychange', hide); };
  }, []);
  useEffect(() => {
    const anchor = resizeAnchor.current; if (!anchor) return;
    resizeAnchor.current = null;
    const frame = requestAnimationFrame(() => jump(anchor));
    return () => cancelAnimationFrame(frame);
  }, [size]);
  const changeSize = next => { if (next === size) return; resizeAnchor.current = currentAnchor(); sizeRef.current = next; setSize(next); };
  const location = place === 'story-tiny-try' ? 'Notes and practice' : place?.startsWith('story-') ? 'Story page ' + place.split('-')[2] : null;
  return <Box ref={root} sx={{ '& .story-prose p': { fontSize: size === 'larger' ? '1.5rem' : '1.25rem' }, '& [data-reading-anchor]': { scrollMarginTop: '150px' } }}>
    <Box component="details" className="reading-options" sx={{ mb: 3 }}><Box component="summary">Reading options</Box><Stack spacing={2} sx={{ pt: 2 }} aria-label="Reading options">
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}><Button variant={size === 'standard' ? 'contained' : 'outlined'} aria-pressed={size === 'standard'} onClick={() => changeSize('standard')}>Standard text</Button><Button variant={size === 'larger' ? 'contained' : 'outlined'} aria-pressed={size === 'larger'} onClick={() => changeSize('larger')}>Larger text</Button></Stack>

      <Typography variant="body2" color="text.secondary" role="status">{!storageOkay ? 'This browser could not keep your place. You can still read and use Jump to.' : location ? `Saved place: ${location}. Kept in this browser tab.` : 'Your place will be kept in this browser tab.'}</Typography>
    </Stack></Box>
    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap', mb: 3 }} role="group" aria-label="Jump to a story section">{parts.map((_, index) => <Button key={index} variant="outlined" onClick={() => jump('story-page-' + (index + 1))}>Story page {index + 1}</Button>)}<Button variant="outlined" onClick={() => jump('story-tiny-try')}>Notes and practice</Button></Stack>
    <Box className="reader">{parts.map((paragraphs, pageIndex) => <Box key={pageIndex} className="story-part"><Typography id={'story-page-' + (pageIndex + 1)} data-reading-anchor tabIndex={-1} className="eyebrow">Story page {pageIndex + 1} of {parts.length}</Typography><Box className="story-scenes">{(result.storyPages ? [pageIndex * 2 + 1, pageIndex * 2 + 2] : [1, 2, 3, 4]).map(n => <Box key={n} component="img" src={assetsBase.replace(/files\/$/, 'previews/') + `panel-${n}.webp`} alt={result.panels?.[n - 1]?.line ?? `Story scene ${n}`} />)}</Box><Box className="story-prose">{paragraphs.map((paragraph, index) => <Typography key={index} id={`story-paragraph-${pageIndex + 1}-${index}`} data-reading-anchor tabIndex={-1}>{paragraph}</Typography>)}</Box></Box>)}<Stack spacing={3} className="reading-ending"><Box className="story-close"><Typography component="h2" variant="h2">A story to keep.</Typography><Typography color="text.secondary">You can leave it here tonight. The practice below is there if you want it.</Typography>{onShelf && <Button variant="contained" onClick={onShelf}>Done for tonight</Button>}</Box><Box id="story-tiny-try" data-reading-anchor tabIndex={-1}>{result.feelFirst?.length > 0 && <Stack spacing={2} sx={{ mb: 3 }}><Typography component="h2" variant="h2">Before trying anything</Typography>{result.feelFirst.map((line, index) => <Typography key={index}>{line}</Typography>)}</Stack>}<Typography variant="h2" component="h2">If you’d like to try it</Typography>{result.tinyTryOptions.map((option, index) => <Box key={index} className="reading-choice"><Typography>{option.text}</Typography></Box>)}</Box><Typography color="text.secondary">These are choices. Pick one, or leave them for another night.</Typography>{planEditor}<Button variant="outlined" onClick={onPoster}>{result.sample ? 'See the poster and pages' : 'Back to our poster'}</Button>{onShelf && <Button onClick={onShelf}>Back to Our stories</Button>}<Button onClick={() => jump(anchors[0])}>Back to the start</Button></Stack></Box>
  </Box>;
}
