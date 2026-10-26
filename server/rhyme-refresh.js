import { savedRhymeSelection } from './rhyme.js';

// Keep the legacy call surface for Resume. A new topic default must never
// rewrite accepted words, invalidate saved art, or spend another request.
export async function refreshSavedRhyme({ checkpoint, move }) {
  const previous = checkpoint.stages.text;
  if (previous?.ready) savedRhymeSelection(previous, move);
  return previous;
}
