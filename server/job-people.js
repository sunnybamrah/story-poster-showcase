// Display the people frozen for this job, not today's currently selected look.
export function jobDisplayPeople(job, record, portraitJobs = [], siblingLabels = []) {
  const cast = job.referenceSnapshot?.cast ?? (record.cast ?? []).filter(person => person.id === 'child' || !job.kitContext?.selectedGrownUpIds || job.kitContext.selectedGrownUpIds.includes(person.id));
  return cast.map(person => {
    const current = record.cast?.find(item => item.id === person.id);
    const sibling = /^sibling-([1-3])$/.exec(person.id);
    const label = person.id === 'child' ? record.hero?.nickname : sibling ? siblingLabels[Number(sibling[1]) - 1] : record.storyPeople?.find(item => item.castId === person.id)?.storyName ?? current?.label;
    const portrait = person.portraitCandidateId && portraitJobs.find(item => item.accountId === job.accountId && item.candidates?.some(candidate => candidate.id === person.portraitCandidateId));
    return { id: person.id, role: person.id === 'child' || sibling ? 'child' : 'grown-up', label: typeof label === 'string' && label.trim() ? label : sibling ? 'Sibling' : person.id === 'child' ? 'Child' : 'Grown-up', selectedUrl: portrait ? `/api/portrait-assets/${portrait.id}/${person.portraitCandidateId}/preview.webp` : null };
  });
}
