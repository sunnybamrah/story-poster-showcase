import { publicCast, visibleCast } from './cast.js';

// One direction is shared by individual panels and the native four-scene sheet.
// It changes drawing instructions, never accepted story text or saved artwork.
export const panelActionDirection = 'ACTION CONTINUITY: Draw the supplied anonymous scene literally. Preserve who acts, the object acted on, its starting and ending state, the surface supporting it and the stated direction of movement. Keep the same object outline across scenes. Distinguish a turn within a flat surface from lifting, standing upright or flipping over. Wide or tall describes the outline in its own plane, not whether it stands up. Left and right belong to the acting character when specified. In a frontal view where the character faces the viewer, the character\'s RIGHT is the LEFT side of the image, and the character\'s LEFT is the RIGHT side of the image. In an over-the-shoulder view looking in the same direction as the character, these sides match the viewer. Apply the same camera-relative mapping to the object, pencil and prediction; never mix actor-right with page-right. When object direction or rotation is the teaching point, choose an overhead or over-the-shoulder view from the acting person\'s side so the stated directions can be compared directly. Put a stated feature on its exact edge, not merely near a corner on another edge. Only draw the features stated for that object or prediction. Moving a feature to another edge does not mean duplicating it on both edges. A predicted drawing stays separate from the real object and must keep any stated difference, including its outline and which edge carries each feature. Show the moment described in this cell, not a later step. If an angle is not stated, do not invent a precise angle or another action. Words on the page and scenery never change the physical action.';

const normalized = text => text.normalize('NFKC').replace(/[’‘]/g, "'").replace(/[“”]/g, '"');
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Legacy stories can recover an attribution only from an explicit speech tag.
// Nearest name or scene position alone is not evidence of who spoke.
export function panelWithSpeaker(record, panel, story = '') {
  if (panel.speakerId !== undefined) panelSpeaker(record, panel);
  if (record.kitContext?.storyMode === 'factual') return panel;
  const names = [{ castId: 'child', names: [record.hero.nickname, record.hero.name] },
    ...(record.storyPeople ?? []).map(person => ({ castId: person.castId, names: [person.storyName] }))];
  if (!(record.storyPeople ?? []).length) names.push({ castId: publicCast(record).find(person => person.role === 'grown-up')?.id, names: [record.parentLabel] });
  const text = normalized(story), line = escape(normalized(panel.line).replace(/[.!?,]+$/, ''));
  const matches = new Set();
  for (const person of names) for (const name of person.names.filter(Boolean)) {
    if (!publicCast(record).some(member => member.id === person.castId)) continue;
    const who = escape(normalized(name)), verb = '(?:said|asked|whispered|replied|called|murmured|added|answered)';
    if (new RegExp(`\\b${who}\\s+${verb}[,:]?\\s*"${line}[.!?,]?"`, 'i').test(text) ||
      new RegExp(`"${line}[.!?,]?"[ ,]*${who}\\s+${verb}\\b`, 'i').test(text) ||
      new RegExp(`"${line}[.!?,]?"[ ,]*${verb}\\s+${who}\\b`, 'i').test(text)) matches.add(person.castId);
  }
  if (panel.speakerId !== undefined) {
    if (matches.size === 1 && !matches.has(panel.speakerId)) throw new Error('invalid_panel_speaker: saved speaker contradicts the explicit story attribution.');
    return panel;
  }
  return matches.size === 1 ? { ...panel, speakerId: [...matches][0] } : panel;
}
export function panelSpeaker(record, panel) {
  if (record.kitContext?.storyMode === 'factual') return null;
  if (panel?.speakerId === undefined) return null;
  const person = publicCast(record).find(person => person.id === panel.speakerId);
  if (!person) throw new Error('invalid_panel_speaker: choose one supplied anonymous cast id.');
  return person;
}
export function pictureCast(record, move, panel) {
  const cast = visibleCast(record, panel ? { scene: panel.scene } : { count: move.expectedPeopleCount });
  const speaker = panel && panelSpeaker(record, panel);
  if (speaker && !cast.some(person => person.id === speaker.id)) cast.push(speaker);
  return cast;
}
export const speakerObservationSchema = { type: 'object', properties: {
  characterId: { type: 'string' }, certainty: { type: 'string', enum: ['confirmed', 'uncertain'] }, evidence: { type: 'string' },
}, required: ['characterId', 'certainty', 'evidence'], additionalProperties: false };
export function assessSpeaker(observation, expectedSpeakerId) {
  if (!expectedSpeakerId) return { faults: [], reviewFlags: [{ key: 'speaker_unverified', evidence: 'Historical panel has no unambiguous saved speaker identity.', fields: ['panelLines'] }] };
  if (!observation) return { faults: ['missing_speaker_observation'], reviewFlags: [], needsRecheck: true };
  if (observation.certainty === 'confirmed' && observation.characterId !== expectedSpeakerId && observation.evidence.trim()) return {
    faults: [`confirmed_bubble_speaker_mismatch: expected ${expectedSpeakerId}, observed ${observation.characterId}: ${observation.evidence}`], reviewFlags: [],
  };
  return { faults: [], reviewFlags: observation.certainty !== 'confirmed' || !observation.evidence.trim() ? [{ key: 'speaker_unverified', evidence: observation.evidence || 'The bubble tail could not be confidently attributed.', fields: ['panelLines'] }] : [] };
}
