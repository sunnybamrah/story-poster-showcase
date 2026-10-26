// One family look. New families see their first person drawn in each of the
// three first-setup looks, then choose one for everyone. Owner's choice,
// October 16: Friendly anime, Adventure comic (recommended) and Diary doodles.
export const defaultPictureStyleId = 'adventure-comic';
export const legacyPictureStyleId = 'detailed-comic';
export const lookFlowVersion = 'first-person-preview-v1';
export const pictureStyleOptions = [
  { id: 'friendly-anime', label: 'Friendly anime', description: 'Clean anime lines, flat colours and soft cel shadows, with a calm friendly face.' },
  { id: 'adventure-comic', label: 'Adventure comic', description: 'Warm painted colour, textured ink and big friendly eyes in a rich scene.', recommended: true },
  { id: 'diary-doodles', label: 'Diary doodles', description: 'Loose black pen drawings on off-white paper, like an illustrated diary. No colour.', monochrome: true },
];
// Earlier first-setup looks (October 16 morning). Saved families keep them.
const heritageStorybook = { id: 'heritage-storybook', label: 'Heritage', description: 'Hand-inked storybook pictures with fine hatching, soft paper texture and warm earth colours.' };
const boldInkComic = { id: 'bold-ink-comic', label: 'Bold ink comic', description: 'Clear ink, strong colours and printed comic dots.', example: '/style-examples/bold-ink-comic.png', recommended: true };
const animeComic = { id: 'anime-comic', label: 'Anime comic', description: 'Crisp outlines and bold colour shadows, with natural face proportions.', example: '/style-examples/anime-comic.png' };
// The older sample-picture gallery, kept for families set up before October 16
// that have not drawn anyone yet. Its own fixed entries; never remapped by position.
const paintedComic = { id: 'painted-comic', label: 'Painted comic', description: 'Drawn faces and scenery with ink and watercolour.', example: '/style-examples/painted-comic.png' };
export const galleryPictureStyleOptions = [paintedComic, boldInkComic, animeComic];
export const legacyPictureStyleOptions = [
  heritageStorybook, boldInkComic, animeComic, paintedComic,
  { id: 'classic-comic', label: 'Playful comic', description: 'Warm storybook drawings, like the original poster.', example: '/style-examples/classic-comic.png' },
  { id: 'animated-film', label: 'Animated film', description: 'Soft, rounded characters from an animated movie.', example: '/style-examples/animated-film.png' },
  { id: 'detailed-comic', label: 'Detailed comic', description: 'More lifelike drawings with fine face detail.', example: '/style-examples/detailed-comic.png' },
];
export const allPictureStyleOptions = [...pictureStyleOptions, ...legacyPictureStyleOptions];
export const isPictureStyleId = value => allPictureStyleOptions.some(style => style.id === value);
export const pictureStyleOptionFor = recordOrId => allPictureStyleOptions.find(style => style.id === pictureStyleIdFor(recordOrId));
export function pictureStyleIdFor(recordOrId, { newFamily = false } = {}) {
  const id = typeof recordOrId === 'string' ? recordOrId : recordOrId?.pictureStyleId;
  if (id === undefined || id === null || id === '') return newFamily ? defaultPictureStyleId : legacyPictureStyleId;
  if (!isPictureStyleId(id)) throw Object.assign(Error('Choose one of the three story looks.'), { status: 400 });
  return id;
}
