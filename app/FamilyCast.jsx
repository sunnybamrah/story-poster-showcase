import React, { useEffect, useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';

export function useFamilyPeople(api, session, styleId) {
  const binding = session?.record && session.accountId ? `${session.accountId}:${session.childId}:${(session.record.cast ?? []).map(person => person.portraitCandidateId ?? '').join(':')}:${styleId ?? ''}` : '';
  const [saved, setSaved] = useState({ binding: '', people: [] });
  useEffect(() => {
    let live = true;
    if (!binding) { setSaved({ binding: '', people: [] }); return; }
    api('portraits?childId=' + encodeURIComponent(session.childId) + (styleId ? '&pictureStyleId=' + encodeURIComponent(styleId) : '')).then(data => {
      if (live) setSaved({ binding, people: data.people.filter(person => person.selectedUrl) });
    }).catch(() => { if (live) setSaved({ binding, people: [] }); });
    return () => { live = false; };
  // A non-default look changes portrait selections without changing cast IDs.
  // The fresh session after choosing must therefore refresh readiness too.
  }, [binding, session]);
  return { people: saved.binding === binding ? saved.people : [], loaded: !binding || saved.binding === binding };
}

function PersonDrawing({ person }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [person.selectedUrl]);
  return <Box className="family-person">
    {person.selectedUrl && !failed ? <Box component="img" src={person.selectedUrl} alt={'Chosen story drawing of ' + person.label} onError={() => setFailed(true)} /> : <Box className="family-picture-placeholder" aria-label={'Drawing preview unavailable for ' + person.label}>{person.label?.slice(0, 1)}</Box>}
    <Typography variant="body2" fontWeight={800}>{person.label}</Typography>
  </Box>;
}

export default function FamilyCast({ people = [], compact = false }) {
  if (!people.length) return null;
  return <Stack direction="row" className={compact ? 'family-cast compact' : 'family-cast'} spacing={2} useFlexGap>
    {people.map(person => <PersonDrawing key={person.id} person={person} />)}
  </Stack>;
}
