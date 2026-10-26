export const POSTER_SCENE_RULES = [
  'Keep the five cards, badge, title, rhyme pill and footer readable, each with clear space around its words, wherever you place them.',
  'Place the hero in a complete, warm scene in the chosen world. Keep the setting recognisable through a few broad shapes, soft light and gentle depth. Use only furnishings needed for the action; a room does not need a window, table, chair, backpack and bookcase all at once.',
  'Place the hero inside that scene, doing the selected move with a thoughtful expression. Show the whole acting hand or paw. Use normal proportions and clean, flat graphic-novel colours.',
  'Add one small joke tied to this move inside the scene. It belongs in the same scene, never a separate inset or a separate dog portrait. Any name tag or prop in the joke stays blank.',
  'Make the title banner and rhyme pill belong to this illustrated world.',
  'Carry the scene colours and a few themed shapes around the page and around the footer banner. Preserve the empty centre of the footer banner for the local name.',
  'Keep the cards light and readable. Add no unapproved words.',
  'The child, their visible action, the rhyme and the five teaching cards are the main focus. Keep warmth and depth without a busy backdrop: roughly halve decorative background detail compared with a richly ornamented poster. This is an art-direction target, not a scientific measurement. Use fewer leaves, books, floor patterns and scattered accents, with lower contrast and softer edges behind the hero. Keep clear space around the hands and card text. Do not make the whole scene blank or bland.',
  'Every prop must be visibly held, rest on a surface, or hang from a visible strap. Nothing floats against a body. A reference portrait’s handheld object is not clothing: omit it when it is not needed, especially when both hands perform the action. Keep the useful action and story objects clear.',
].join('\n');
// The owner's chosen looks (October 16) bring their own faces and medium, so the
// colour, proportion and single-expression words give way. Older looks keep the
// rules above exactly.
export function posterSceneRulesFor(look) {
  if (!look) return POSTER_SCENE_RULES;
  const changes = [['a complete, warm scene', 'a complete, inviting scene'], ['with a thoughtful expression', 'with an expression that fits the story'],
    ['Use normal proportions and clean, flat graphic-novel colours.', "Draw everyone in the family's chosen look, exactly as its look rule describes."],
    ...(look.monochrome ? [['Carry the scene colours and a few themed shapes', 'Carry the black-ink textures and a few themed shapes']] : [])];
  return changes.reduce((text, [find, replace]) => {
    if (!text.includes(find)) throw Error(`Scene rules no longer contain: ${find}`);
    return text.replace(find, replace);
  }, POSTER_SCENE_RULES);
}
