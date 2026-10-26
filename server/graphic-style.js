import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pictureStyleIdFor, pictureStyleOptionFor } from '../app/picture-styles.js';
import { originalStyleLine } from './project-source.js';

// Old receipts keep their original name. Fresh work uses the selected profile.
export const graphicStyleVersion = 'flat-ink-graphic-novel-v1';
export const graphicStyleRule = 'Use expressive clean ink lines, warm colour fills and simple cel shadows. Preserve maximum facial likeness first. No photographic skin, hair or fabric texture or shiny toy rendering.';
const commonRule = 'Use the supplied photograph as the drawing input. Preserve maximum facial likeness first: face shape, hairline, hair, beard pattern, eyebrows, nose, eyes, mouth and build. Then apply the selected drawing style. Apply that same style to every family member, poster, story panel and final card. A different visual world changes the setting and colours, never the family identity or selected style. No extreme chibi proportions or shiny plastic toy finish.';
const profiles = {
  // Owner's chosen looks, October 16 evening. Each draws faces its own way and
  // carries its own medium; identity comes from the separate family identity
  // line, never from one shared face style. Written rules only, no example files.
  'friendly-anime': { version: 'friendly-anime-v1', usesInkPortrait: true, ownFaces: true, requireFlatInk: true, forbidPhotographicTexture: true, forbidOversizedEyes: true,
    rule: 'FRIENDLY ANIME. Clean modern anime illustration: thin even dark outlines, flat local colours and crisp hard-edged cel shadow shapes in soft light. Faces use clear anime construction: defined angular brows, almond-shaped eyes with a simple highlight, a small line nose, calm relaxed brows and a small smile; hair as sharp grouped locks with a few highlight streaks; beards as shaped cel masses, with grey streaks where the person has them. Natural head and body sizes, never chibi. Every person, prop and the simple, softly coloured background share the same clean cel treatment.' },
  'adventure-comic': { version: 'adventure-comic-v1', usesInkPortrait: true, ownFaces: true, requireFlatInk: false, forbidPhotographicTexture: true, forbidOversizedEyes: false,
    rule: 'ADVENTURE COMIC. A warm adventure graphic novel: confident textured ink outlines, warm painterly printed colour with golden light and a subtle print grain, and rich illustrated scenes with depth, plants, books and light. Faces are warm expressive cartoon faces: large readable drawn eyes, a simplified rounded nose, hair and beard drawn as grouped shapes with a few ink strokes, friendly brows and a relaxed smile by default. Recognisable proportions, never chibi or caricature. Every person, prop and the whole scene share the same inked, warmly painted treatment.' },
  'diary-doodles': { version: 'diary-doodles-v1', usesInkPortrait: true, ownFaces: true, monochrome: true, requireFlatInk: false, forbidPhotographicTexture: true, forbidOversizedEyes: false,
    rule: 'DIARY DOODLES. Loose hand-drawn black ink on plain off-white paper, like an illustrated diary: lively uneven pen lines with hand-drawn energy, simple dot or small round eyes, a simple rounded nose, hair and beard as quick ink strokes and light hatching, with white or grey patches left as paper. BLACK INK ONLY: no colour, no coloured fills, no grey wash or painted shading. Dark clothes are solid black or dense hatching; light clothes stay paper white. Every person, prop, card, banner and the whole scene are drawn in the same black pen on off-white paper.' },
  // Owner's October 16 direction from a hand-inked storybook thumbnail. Written
  // rule only: no sample picture exists, so none is sent or versioned.
  'heritage-storybook': { version: 'heritage-storybook-v1', usesInkPortrait: true, requireFlatInk: false, forbidPhotographicTexture: true, forbidOversizedEyes: true,
    rule: 'HERITAGE STORYBOOK. Draw a traditional hand-inked storybook adventure illustration, like a classic printed illustrated book. Use confident pen contours, visible fine hatching and cross-hatching for shadow and form, a subtle warm paper texture and muted earth colours in soft washes: ochre, sienna, sage, slate blue and cream. Keep natural human facial proportions, normal eye and head sizes and readable expressions. Give people, clothes, props and the entire scenery the same hand-inked, hatched and softly coloured treatment. No photographic faces or skin texture, glossy digital painting, halftone comic dots, anime cel shading or cute caricature.' },
  'painted-comic': { version: 'painted-comic-v1', usesInkPortrait: true, requireFlatInk: false, forbidPhotographicTexture: true, forbidOversizedEyes: true,
    rule: 'PAINTED COMIC. Draw a clearly two-dimensional ink-and-watercolour graphic novel. Use expressive precise contours, broad transparent painted washes, visible pigment edges and restrained paper grain. Reconstruct faces with drawing marks and painted shapes, never photographic shading. Paint people, clothes, furniture, plants, walls and distant scenery with the same ink-and-wash treatment. Preserve natural facial anatomy and readable expressions. This is an illustrated comic scene, not an oil-painted photograph or a cute picture-book caricature.' },
  'bold-ink-comic': { version: 'bold-ink-comic-v1', usesInkPortrait: true, requireFlatInk: true, forbidPhotographicTexture: true, forbidOversizedEyes: true,
    rule: 'BOLD INK COMIC. Match the owner-chosen clear drawn graphic-novel treatment. Use confident black contours, designed flat warm colour shapes, broad black shadow areas and selective printed halftone dots. Keep recognizable face geometry and normal eye and head sizes. Show beard and hair through deliberate ink shapes and selected strokes rather than photographic hair texture. Carry the same ink, contrast, halftone and colour treatment through every person, prop and the full background. No photographic faces pasted into drawn scenery.' },
  'anime-comic': { version: 'anime-comic-v1', usesInkPortrait: true, requireFlatInk: true, forbidPhotographicTexture: true, forbidOversizedEyes: true,
    rule: 'ANIME COMIC. Use a clearly two-dimensional contemporary cel-animated adventure-comic treatment. Use precise tapered contours, shaped hair locks, flat local colours and crisp angular cel-shadow shapes. Stylize drawing marks and light shapes while preserving recognizable human face geometry, natural eyes, noses, jaws and head sizes. Render people and the entire room or landscape in the same cel-drawn style. Subtle expressions belong in a family scene. No enlarged anime eyes, chibi proportions, rounded three-dimensional movie rendering, photographic faces or skin texture.' },
  'classic-comic': { version: 'playful-storybook-v1', requireFlatInk: true, forbidPhotographicTexture: true,
    rule: 'PLAYFUL COMIC. Match the warm, rounded, clearly simplified two-dimensional animated storybook comic of the original family posters. Use clean outlines, expressive readable eyes, simple shaped hair and beard, warm colours and soft cel shading. Small colour gradients are fine. It must look drawn and playful, with no photographic skin pores, individual realistic hair strands or fabric texture. Do not turn this into a detailed portrait or a three-dimensional movie render.' },
  'animated-film': { version: 'matte-animated-film-v1', requireFlatInk: false, forbidPhotographicTexture: true,
    rule: 'ANIMATED FILM. Use a clearly stylized three-dimensional family-animation character with rounded sculpted forms, smooth matte surfaces, soft dimensional lighting and expressive eyes. Simplify hair and beard into recognizable sculpted shapes. Preserve the real face. No photographic skin pores, realistic hair strands, hyperreal rendering or flat ink-comic treatment.' },
  'detailed-comic': { version: 'detailed-illustrated-comic-v1', requireFlatInk: false, forbidPhotographicTexture: false,
    rule: 'DETAILED COMIC. Use a more lifelike illustrated graphic novel with fine linework, natural facial proportions, carefully drawn hair and beard and shaded depth. Fine face, hair and fabric detail is allowed. It still looks illustrated, not an unchanged photograph, a simplified storybook cartoon or a three-dimensional movie character.' },
};
const references = new Map();
export function pictureStyleReferenceFor(recordOrId) {
  const id = pictureStyleIdFor(recordOrId), file = fileURLToPath(new URL(`../public/style-examples/${id}.png`, import.meta.url));
  let stat;
  try { stat = statSync(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const stamp = `${stat.size}:${stat.mtimeMs}`, saved = references.get(id);
  if (saved?.stamp === stamp) return saved.value;
  const bytes = readFileSync(file), hash = createHash('sha256').update(bytes).digest('hex');
  const value = { file, hash, data: `data:image/png;base64,${bytes.toString('base64')}` };
  references.set(id, { stamp, value });
  return value;
}
export function pictureStyleFor(recordOrId) {
  const id = pictureStyleIdFor(recordOrId), profile = profiles[id], reference = pictureStyleReferenceFor(id);
  // The owner's chosen looks take identity from the family identity line instead.
  const identityRule = profile.ownFaces ? '' : profile.usesInkPortrait ? 'For a photo-based character, the actual photograph supplies likeness to its ink identity drawing. Later colour scenes use that generated identity reference. For a description-based character, follow the anonymous appearance and preserve the chosen drawing in later scenes. Preserve recognizable face shape, hairline, hair, beard pattern and grey placement, eyebrows, nose, eyes, mouth and build. Keep natural eye and head sizes. Apply the chosen rendering to every family member, their clothes, all props and the entire scenery. A changing visual world changes the setting and accents, never the family identity or selected comic style. No shiny plastic toy finish.' : commonRule;
  return { id, label: pictureStyleOptionFor(id).label, ...profile,
    version: `${profile.version}${reference ? `:${reference.hash}` : ''}`, referenceHash: reference?.hash ?? null,
    rule: [profile.rule, identityRule].filter(Boolean).join(' ') };
}
export const graphicStyleRuleFor = recordOrId => pictureStyleFor(recordOrId).rule;
// The look's own rule, without the ink-sketch identity sentence, for drawings
// made straight from the photo or restyled from a neutral sketch.
export const pictureStyleCoreRule = recordOrId => profiles[pictureStyleIdFor(recordOrId)].rule;
// Owner direction, October 16: recognisable comic family characters like the
// original Project posters, not traced photographs. A separate line on new
// drawing requests for the three current looks; the look rules above stay
// unchanged because saved person keys include them.
export const comicFaceRuleVersion = 'middle-grade-comic-face-v1';
// Starts from the original Project STYLE.txt line 5, then the owner's current face direction.
export const comicFaceRule = `COMIC FAMILY FACES. Original style: ${originalStyleLine()} Current owner direction: draw each person as a middle-grade graphic novel character. Keep them recognisable from their OWN photo or appearance words: face shape, skin tone, hairline and hairstyle, facial hair, apparent age and build; glasses or headwear only when their own photo or words show them. Simplify the rest: a few clean strokes for the nose, smooth cheeks without face marks, hair as shaped masses with a few strands, expressive illustrated eyes and eyebrows, clean 2D outlines, warm colour fills and soft cel shadows. No photographic pores, single rendered hairs, copied wrinkles or photo-filter look. No caricature, baby or chibi proportions, and never a generic face that is not this person.`;
const comicFaceLooks = new Set(['heritage-storybook', 'bold-ink-comic', 'anime-comic']);
// The owner's chosen looks (friendly-anime, adventure-comic, diary-doodles) share only
// identity, never one face construction: each look's own rule says how faces are drawn.
export const lookIdentityRuleVersion = 'family-identity-own-look-v1';
export const lookIdentityRule = 'FAMILY IDENTITY. Keep each person recognisable from their OWN photo or appearance words: face shape, skin tone, hairline and hairstyle, facial hair and its grey patches, apparent age and build; glasses or headwear only when their own photo or words show them. Draw the face the way the selected look draws faces: its eyes, nose, brows and hair shapes belong to the look and never by themselves make a different person. No photographic skin or single rendered hairs. Portraits default to a friendly, relaxed expression; story scenes show the feeling the story asks for.';
export const comicFaceRuleFor = recordOrId => {
  const id = pictureStyleIdFor(recordOrId);
  return comicFaceLooks.has(id) ? comicFaceRule : profiles[id].ownFaces ? lookIdentityRule : '';
};
// A black-ink look carries no colour anywhere: people, clothes, scenery and page furniture.
export const pictureMonochrome = recordOrId => profiles[pictureStyleIdFor(recordOrId)].monochrome === true;
// What the poster source adapter and the judges need to know about one of the
// owner's chosen looks. Older looks return null and keep their exact wording.
export const ownLookFor = recordOrId => {
  const id = pictureStyleIdFor(recordOrId), profile = profiles[id];
  return profile.ownFaces ? { id, label: pictureStyleOptionFor(id).label, monochrome: profile.monochrome === true } : null;
};
// Checker words for the owner's chosen looks: each look's own eyes and medium are the look.
export const lookCheckNote = 'For Friendly anime, almond eyes with a simple highlight and a small line nose are the look. For Adventure comic, large readable drawn eyes and a simplified rounded nose are the look. For Diary doodles, dot or small round eyes and black ink with no colour anywhere are the look, so flatInk may be false and missing colour is correct. None of these alone is oversizedEyes, a style failure or a different person; set oversizedEyes true only for baby or chibi eyes that dominate the face.';
// Shared checker words: a simplified comic face is the style, not another person.
export const comicFaceCheckNote = 'Family faces are drawn in the selected look, often simplified or stylised: a simpler or rounder nose, smooth cheeks, hair drawn as shaped masses, and eyes that are dots, almond shapes or large drawn eyes are the drawing style, never by themselves a different person or appearance. Judge whether each person is recognisably the same person: face shape, skin tone, hair, facial hair, glasses or headwear, apparent age and build. In a black-ink look, skin and clothes carry no colour; judge clothing by garment type, shape and pattern, never by colour.';
export const graphicStyleObservationSchema = {
  type: 'object', properties: {
    matchesSelectedStyle: { type: 'boolean' }, flatInk: { type: 'boolean' }, photographicTexture: { type: 'boolean' }, toyShine: { type: 'boolean' }, oversizedEyes: { type: 'boolean' }, evidence: { type: 'string' },
  }, required: ['matchesSelectedStyle', 'flatInk', 'photographicTexture', 'toyShine', 'oversizedEyes', 'evidence'], additionalProperties: false,
};
export function assessGraphicStyle(observation, { required = false, pictureStyleId } = {}) {
  if (!observation && !required) return { required: false, verified: false, faults: [], needsRecheck: false };
  // A historical receipt is not a fresh approval under a newly chosen style.
  if (!required && typeof observation?.matchesSelectedStyle !== 'boolean') return { required: false, verified: false, faults: [], needsRecheck: false };
  const profile = pictureStyleFor(pictureStyleId ?? 'classic-comic');
  const complete = observation && ['matchesSelectedStyle', 'flatInk', 'photographicTexture', 'toyShine', 'oversizedEyes'].every(key => typeof observation[key] === 'boolean') && typeof observation.evidence === 'string' && observation.evidence.trim();
  if (!complete) return { required, id: profile.id, version: profile.version, verified: false, faults: [], needsRecheck: true };
  const confirmed = [];
  if (!observation.matchesSelectedStyle) confirmed.push('does not match the selected look');
  if (profile.forbidPhotographicTexture && observation.photographicTexture) confirmed.push('photographic texture');
  if (observation.toyShine) confirmed.push('shiny plastic toy finish');
  if ((profile.forbidOversizedEyes || profile.id === 'detailed-comic') && observation.oversizedEyes) confirmed.push('oversized eyes instead of natural proportions');
  const needsRecheck = !confirmed.length && profile.requireFlatInk && !observation.flatInk;
  return { required, id: profile.id, version: profile.version, verified: !confirmed.length && !needsRecheck, evidence: observation.evidence,
    faults: confirmed.length ? [`confirmed_selected_picture_style_mismatch: ${confirmed.join(', ')}. ${observation.evidence}`] : [], needsRecheck };
}
