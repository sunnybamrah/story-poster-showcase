import React, { useEffect, useState } from 'react';
import { Box, Button, ButtonBase, Card, Chip, FormControl, FormLabel, RadioGroup, Radio, Stack, Typography } from '@mui/material';
import PortraitViewer from './PortraitViewer';
import { pictureStyleOptions, galleryPictureStyleOptions, pictureStyleOptionFor } from './picture-styles.js';

// New families choose from real drawings of their own first person, so setup
// only names the three looks. No sample pictures of made-up people here.
export function FamilyLookIntro() {
  return <Stack spacing={1.5} className="family-look-intro">
    <Typography component="h2" variant="h3">Your family’s look</Typography>
    <Typography variant="body2">After you save, add one person’s photo or describe them. We draw that person in three looks. Pick one for your first story. You can choose a different look for each new story.</Typography>
    <Box component="ul" className="family-look-names">{pictureStyleOptions.map(style => <Typography component="li" variant="body2" key={style.id}><strong>{style.label}{style.recommended ? ' (recommended)' : ''}.</strong></Typography>)}</Box>
  </Stack>;
}

export default function FamilyStylePicker({ value, onChange, disabled = false, locked = false, pending = false }) {
  const chosen = pictureStyleOptionFor(value);
  if (pending) return <FamilyLookIntro />;
  if (locked) return <Stack spacing={1}>
    <Typography component="h2" variant="h3">Your family’s look: {chosen.label}</Typography>
    <Typography variant="body2" color="text.secondary">Everyone and every scene use the same look. Saved drawings and stories keep their look.</Typography>
  </Stack>;
  return <FormControl component="fieldset" fullWidth>
    <FormLabel component="legend" id="family-style-label" sx={{ color: 'text.primary', fontWeight: 800, mb: 1 }}>Choose your family’s look</FormLabel>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>One look for everyone and every scene. After this, each person gets a drawing in this look.</Typography>
    {!galleryPictureStyleOptions.some(style => style.id === chosen.id) && <Typography variant="body2" sx={{ mb: 1.5 }}>Saved family look: {chosen.label}. Your earlier drawings keep this look.</Typography>}
    <RadioGroup aria-labelledby="family-style-label" value={chosen.id} onChange={event => onChange(event.target.value)} name="family-picture-style">
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' }, gap: { xs: 1.5, sm: 1.5 } }}>
        {galleryPictureStyleOptions.map(style => <Card key={style.id} component="label" htmlFor={'family-style-' + style.id} sx={{ cursor: disabled ? 'default' : 'pointer', borderWidth: 2, borderColor: chosen.id === style.id ? 'primary.main' : 'divider', bgcolor: chosen.id === style.id ? 'action.selected' : 'background.paper', minWidth: 0, opacity: disabled ? .65 : 1, p: { xs: .75, sm: 1 } }}>
          <Box component="img" src={style.example} alt={style.label + ' example with made-up people'} sx={{ width: '100%', height: 'auto', aspectRatio: '3/2', display: 'block', objectFit: 'contain', bgcolor: '#fff9ed', borderRadius: 1 }} />
          <Stack direction={{ xs: 'row', sm: 'column' }} spacing={.25} sx={{ pt: 1, alignItems: 'center', justifyContent: { xs: 'space-between', sm: 'center' } }}>
            <Typography component="span" sx={{ fontSize: { xs: 18, sm: 17 }, fontWeight: 800, lineHeight: 1.3, minHeight: { xs: 'auto', sm: '2.6em' }, textAlign: { xs: 'left', sm: 'center' } }}>{style.label}</Typography>
            <Radio id={'family-style-' + style.id} value={style.id} disabled={disabled} slotProps={{ input: { 'aria-label': style.label, 'aria-describedby': 'family-style-description' } }} />
          </Stack>
          {style.recommended && <Chip label="Recommended" size="small" color="primary" sx={{ mt: .5, transition: 'none' }} />}
        </Card>)}
      </Box>
    </RadioGroup>
    <Typography id="family-style-description" variant="body2" sx={{ mt: 1.5 }}>{chosen.description}</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mt: .75 }}>These are made-up examples. Next, upload a photo or describe each person’s appearance.</Typography>
  </FormControl>;
}

// Recognition is easier than recall: keep the same personal pictures on each visit.
// Choosing a card only changes the draft. It never starts a drawing request.
export function StoryStylePicker({ api, value, onChange, onPeople, disabled = false }) {
  const [previews, setPreviews] = useState([]), [error, setError] = useState('');
  const [viewing, setViewing] = useState(null);
  useEffect(() => {
    let live = true;
    api('story-looks').then(data => { if (live) setPreviews(data.previews ?? []); }).catch(error => { if (live && error.code !== 'STALE_OWNER') setError(error.message); });
    return () => { live = false; };
  }, []);
  const chosen = pictureStyleOptionFor(value);
  return <FormControl component="fieldset" fullWidth>
    <FormLabel component="legend" id="story-look-label" sx={{ color: 'text.primary', fontWeight: 800 }}>Choose this story’s look</FormLabel>
    <Typography variant="body2" sx={{ my: 1 }}>Your saved drawings. One look for this story.</Typography>
    {error && <Typography role="alert">{error}</Typography>}
    <RadioGroup aria-labelledby="story-look-label" name="story-picture-style" value={chosen.id} onChange={event => onChange(event.target.value)}>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: { xs: .75, sm: 1.5 } }}>
        {(previews.length ? previews : pictureStyleOptions).map(style => <Card className="story-look-choice" data-selected={chosen.id === style.id} key={style.id} sx={{ minWidth: 0, p: { xs: .75, sm: 1.5 }, cursor: disabled ? 'default' : 'pointer', borderWidth: 2, borderColor: chosen.id === style.id ? 'primary.main' : 'divider', bgcolor: chosen.id === style.id ? 'action.selected' : 'background.paper' }}>
          {style.url ? <ButtonBase aria-label={'Select saved ' + style.label + ' picture'} aria-pressed={chosen.id === style.id} disabled={disabled} onClick={() => onChange(style.id)} sx={{ width: '100%', borderRadius: 1 }}><Box component="img" src={style.url} alt={'Your saved ' + style.label + ' drawing'} sx={{ width: '100%', height: { xs: 120, sm: 180 }, objectFit: 'contain', borderRadius: 1 }} /></ButtonBase> : <Typography variant="body2" color="text.secondary">No saved preview yet.</Typography>}
          {style.url && <Button size="small" aria-label={'View saved ' + style.label + ' drawing'} onClick={() => setViewing({ url: style.url, title: style.label + ' drawing' })}>View larger</Button>}
          {chosen.id === style.id && <Typography variant="body2" fontWeight={800}>✓ Selected</Typography>}
          <Box component="label" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: disabled ? 'default' : 'pointer', minHeight: 88, textAlign: 'center' }}><Radio value={style.id} disabled={disabled} slotProps={{ input: { 'aria-label': style.label } }} /><Typography fontWeight={800} sx={{ fontSize: { xs: 16, sm: 18 }, lineHeight: 1.3 }}>{style.label}</Typography></Box>
        </Card>)}
      </Box>
    </RadioGroup>
    {!pictureStyleOptions.some(style => style.id === chosen.id) && <Typography variant="body2">Your saved look is {chosen.label}. You can keep it or choose a look above.</Typography>}
    <Typography variant="body2" sx={{ mt: 1.5 }}>Need a drawing in this look? Add it in Family. Older stories stay the same.</Typography>
    <Box><Button onClick={onPeople} disabled={disabled}>Check people in this look</Button></Box>
    <PortraitViewer viewing={viewing} setViewing={setViewing} />
  </FormControl>;
}
