import React from 'react';
import { Accordion, AccordionSummary, AccordionDetails, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import FamilyPortraits from './FamilyPortraits';
import { pictureStyleOptions } from './picture-styles.js';

export function familySetupIssue(family) {
  if (!family.nickname?.trim()) return { section: 'child', message: 'Add the child’s story name first.', field: 'setup-child-name' };
  const missingParent = family.parents.findIndex(parent => !parent.label?.trim());
  if (missingParent !== -1) return { section: 'grownups', message: 'Add a name for each grown-up.', field: missingParent ? 'setup-second-parent-name' : 'setup-parent-name' };
  const missingOutfit = family.parents.findIndex(parent => parent.customOutfit !== undefined && !parent.customOutfit.trim());
  if (missingOutfit !== -1) return { section: 'grownups', message: 'Add clothes for this grown-up.', field: 'setup-parent-outfit-' + missingOutfit };
  if (family.presetId === 'custom' && !family.customOutfit?.trim()) return { section: 'extras', message: 'Add the clothes you want, or choose an outfit.', field: 'setup-outfit' };
  return null;
}

export default function FamilySetup({ family, setField, config, busy, editing, addingChild, consent, session, api, onSaved, ensureSaved, inputMemory, onContinue, pictureStyleId, onStyleChange, onActivity }) {
  const pronouns = ['he/him', 'she/her', 'they/them'];
  const people = [{ id: 'child', role: 'child', label: family.nickname || 'Child' }, ...family.parents.map((parent, i) => ({ id: i ? 'grown-up-two' : 'grown-up-one', role: 'grown-up', label: parent.label || 'Grown-up', index: i }))];
  const details = person => person.role === 'child' ? <Stack spacing={2}>
    <TextField disabled={busy} id="setup-child-name" required label="Child’s story name" value={family.nickname} onChange={e => setField('nickname', e.target.value)} slotProps={{ htmlInput: { maxLength: 30 } }} />
    <Box className="field-row"><TextField disabled={busy} select label="Age" value={family.age} onChange={e => setField('age', Number(e.target.value))}>{(addingChild || editing ? Array.from({ length: 18 }, (_, age) => age) : [8, 9, 10, 11, 12, 13]).map(age => <MenuItem key={age} value={age}>{age}</MenuItem>)}</TextField><TextField disabled={busy} select label="Child’s pronouns" value={family.pronouns} onChange={e => setField('pronouns', e.target.value)}>{pronouns.map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField></Box>
    <Accordion className="person-outfit"><AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}><Typography>Child’s outfit</Typography></AccordionSummary><AccordionDetails><Stack spacing={1.5}>
      <TextField disabled={busy} select label="Outfit" value={family.presetId} onChange={e => setField('presetId', e.target.value)}>{config.presets.map(item => <MenuItem key={item.id} value={item.id}>{item.title}</MenuItem>)}<MenuItem value="custom">Our own outfit</MenuItem></TextField>
      {family.presetId === 'custom' && <TextField disabled={busy} id="setup-outfit" label="Outfit notes" value={family.customOutfit ?? ''} onChange={e => setField('customOutfit', e.target.value)} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 400 } }} />}
      <Typography variant="body2">Clothes stay the same in these drawings. Changing them needs a new drawing. Saved kits stay as they are.</Typography>
    </Stack></AccordionDetails></Accordion>
    {(family.age < 8 || family.age > 13) && <Typography variant="body2">This child can join a sibling’s story. New learning kits are for ages 8 to 13.</Typography>}
  </Stack> : <Stack spacing={2}>
    <TextField disabled={busy} id={person.index ? 'setup-second-parent-name' : 'setup-parent-name'} required label="Grown-up’s story name" value={family.parents[person.index].label} onChange={e => setField('parents', family.parents.map((p, i) => i === person.index ? { ...p, label: e.target.value } : p))} placeholder="For example: Mom, Dad or Grandma" slotProps={{ htmlInput: { maxLength: 40 } }} />
    <TextField disabled={busy} select label="Grown-up’s pronouns" value={family.parents[person.index].pronouns} onChange={e => setField('parents', family.parents.map((p, i) => i === person.index ? { ...p, pronouns: e.target.value } : p))}>{pronouns.map(value => <MenuItem key={value} value={value}>{value}</MenuItem>)}</TextField>
    <Accordion className="person-outfit"><AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}><Typography>Grown-up’s outfit</Typography></AccordionSummary><AccordionDetails><Stack spacing={1.5}>
      <TextField disabled={busy} id={'setup-parent-outfit-' + person.index} label="Grown-up outfit notes" value={family.parents[person.index].customOutfit ?? (person.index ? 'coral sweater; dark trousers; brown shoes' : 'blue sweater; dark trousers; brown shoes')} onChange={e => setField('parents', family.parents.map((p, i) => i === person.index ? { ...p, customOutfit: e.target.value } : p))} multiline minRows={2} slotProps={{ htmlInput: { maxLength: 400 } }} helperText="Clothes, colours and shoes. Separate items with a semicolon." />
      <Typography variant="body2">Changing clothes needs a new drawing. Saved kits stay as they are.</Typography>
    </Stack></AccordionDetails></Accordion>
    {person.index === 1 && <Button onClick={() => setField('parents', family.parents.slice(0, 1))}>Remove second grown-up</Button>}
  </Stack>;
  return <Stack spacing={2.5} className="unified-people">
    {consent}
    <TextField disabled={busy} select label="Drawing style for this story" value={pictureStyleId} onChange={e => onStyleChange(e.target.value)}>{pictureStyleOptions.map(style => <MenuItem key={style.id} value={style.id}>{style.label}</MenuItem>)}</TextField>
    <FamilyPortraits api={api} session={session} config={config} onSaved={onSaved} pictureStyleId={pictureStyleId} onStyleChange={onStyleChange} onActivity={onActivity} draftFamily={family} draftPeople={people} renderDetails={details} ensureSaved={ensureSaved} inputMemory={inputMemory} />
    {family.parents.length < 2 && <Button variant="outlined" disabled={busy} onClick={() => setField('parents', [...family.parents, { label: '', pronouns: 'they/them' }])}>Add another grown-up (optional)</Button>}
    <Accordion className="setup-extras"><AccordionSummary expandIcon={<span aria-hidden="true">＋</span>}><Typography>Optional notes</Typography></AccordionSummary><AccordionDetails><Stack spacing={2}>
      <TextField label="Family notes (optional)" value={family.familyContext} onChange={e => setField('familyContext', e.target.value)} multiline minRows={2} />
      <TextField disabled={busy} select label="Who is this for?" value={family.real ? 'real' : 'fictional'} onChange={e => setField('real', e.target.value === 'real')}><MenuItem value="fictional">A made-up family</MenuItem><MenuItem value="real" disabled={!config.realFamilySetupAllowed}>My real family</MenuItem></TextField>
    </Stack></AccordionDetails></Accordion>
    <Box className="people-save-actions"><Button type="submit" variant="outlined" disabled={busy}>Save details</Button><Button variant="contained" disabled={busy} onClick={onContinue}>Save and continue to story</Button></Box>
  </Stack>;
}
