import test from 'node:test';
import assert from 'node:assert/strict';
import { pictureStyleReferenceFor } from '../server/graphic-style.js';
import { pictureStyleOptions } from '../app/picture-styles.js';
import { family } from './fixture.mjs';
import { moves, readJSON } from '../server/files.js';
import { publicCast } from '../server/cast.js';
import { setupRecord } from '../server/app-data.js';
import { buildPictureRequest, buildPortraitRequest, buildPortraitStageRequest, buildPortraitIdentityCheckRequest, buildPosterRequest, buildPanelRequest, buildFrameRequest, buildWordCheckRequest, styleExampleUse, assessPortraitIdentity } from '../server/requests.js';
import { buildReadingArtRequest, buildReadingArtCheckRequest } from '../server/reading-art.js';
import { portraitFingerprint, inkPortraitPipelineVersion, portraitReferencePolicy } from '../server/portraits.js';
import { kitText } from './kit-text-fixture.mjs';

// October 16: a mother's portrait came back as the bald bearded father from the
// public Bold style example. Every public example shows made-up people, so no
// picture-making request may carry any of them, for any look.
const styles = ['friendly-anime', 'adventure-comic', 'diary-doodles', 'heritage-storybook', 'painted-comic', 'bold-ink-comic', 'anime-comic', 'classic-comic', 'animated-film', 'detailed-comic'];
const examples = styles.map(id => pictureStyleReferenceFor(id)).filter(Boolean);
const png = 'data:image/png;base64,AAAA';
const imagesOf = body => [].concat(body.image ?? [], ...(body.input ?? []).flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'input_image').map(part => part.image_url) : []));

test('every public style example exists and every one shows people, so the rule covers all of them', () => {
  // The owner's three chosen looks and Heritage have no made-up example picture on purpose; every other look has one.
  assert.deepEqual(styles.filter(id => !pictureStyleReferenceFor(id)), ['friendly-anime', 'adventure-comic', 'diary-doodles', 'heritage-storybook']);
  assert.equal(examples.length, styles.length - 4);
  assert.deepEqual(pictureStyleOptions.map(style => style.id), ['friendly-anime', 'adventure-comic', 'diary-doodles']);
  assert.ok(pictureStyleOptions.every(style => style.example === undefined && !pictureStyleReferenceFor(style.id)), 'offered looks show no sample people');
  assert.deepEqual(styleExampleUse, { generation: false, checkers: ['word-check', 'reading-art-check'] });
});

test('no picture-making request carries any style example image or example wording, for every look', () => {
  const models = readJSON(new URL('../content/prices.json', import.meta.url)).selected;
  for (const id of styles) {
    const record = { ...family, pictureStyleId: id }, cast = publicCast(record), move = moves[0], text = kitText();
    const references = cast.map(person => ({ characterId: person.id, data: png }));
    const people = cast.map(person => ({ id: person.id, outfit: person.outfit }));
    const bodies = {
      hero: buildPictureRequest(record, move, '', { hero: true, referenceData: png }),
      character: buildPictureRequest(record, move, '', { character: cast[1], referenceImages: [references[0]] }),
      poster: buildPosterRequest(record, move, '', text, { referenceImages: references }),
      panel: buildPanelRequest(record, move, '', text.panelLines[0], { referenceImages: references }),
      frame: buildFrameRequest(record, ''),
      legacyPortrait: buildPortraitRequest(record, cast[0], png),
      inkPhoto: buildPortraitStageRequest(record, cast[0], { phase: 'ink', inputMode: 'photo', referenceData: png }),
      inkDescription: buildPortraitStageRequest(record, cast[0], { phase: 'ink', inputMode: 'description', description: 'Short curly dark hair and brown eyes.' }),
      finish: buildPortraitStageRequest(record, cast[0], { phase: 'finish', inputMode: 'photo', referenceData: png }),
      neutralInk: buildPortraitStageRequest(record, cast[0], { phase: 'ink', inputMode: 'photo', referenceData: png, neutral: true }),
      restyledFinish: buildPortraitStageRequest(record, cast[0], { phase: 'finish', inputMode: 'photo', referenceData: png, restyle: true }),
      description: buildPortraitStageRequest(record, cast[0], { phase: 'description', inputMode: 'description', description: 'Short curly dark hair and brown eyes.' }),
      readingArt: buildReadingArtRequest(record, people, references, models),
    };
    for (const [name, body] of Object.entries(bodies)) {
      for (const example of examples) assert.ok(!imagesOf(body).includes(example.data), `${id} ${name} must not send a style example`);
      assert.doesNotMatch(body.prompt, /RENDERING STYLE EXAMPLE|rendering-style example/i, `${id} ${name}`);
    }
    assert.equal(bodies.inkDescription.image, undefined); assert.equal(bodies.frame.image, undefined);
    assert.deepEqual(bodies.inkPhoto.image, [png]); assert.deepEqual(bodies.finish.image, [png]); assert.deepEqual(bodies.neutralInk.image, [png]); assert.deepEqual(bodies.restyledFinish.image, [png]);
  }
});

test('checkers keep the style example as a labelled yardstick; the sketch check sees only the sketch and its own source', () => {
  const models = readJSON(new URL('../content/prices.json', import.meta.url)).selected;
  for (const id of ['painted-comic', 'bold-ink-comic', 'anime-comic']) {
    const record = { ...family, pictureStyleId: id }, cast = publicCast(record), move = moves[0], text = kitText(), example = pictureStyleReferenceFor(id);
    const references = cast.map(person => ({ characterId: person.id, data: png }));
    assert.ok(imagesOf(buildWordCheckRequest(record, move, '', png, { panel: text.panelLines[0] })).includes(example.data));
    assert.ok(imagesOf(buildReadingArtCheckRequest(record, cast.map(person => ({ id: person.id, outfit: person.outfit })), references, Buffer.from('sheet'), { width: 1536, height: 1024 }, models)).includes(example.data));
    const sketch = 'data:image/png;base64,SKETCH', photo = 'data:image/png;base64,PHOTO';
    assert.deepEqual(imagesOf(buildPortraitIdentityCheckRequest(record, cast[0], { inputMode: 'photo', inkData: sketch, sourceData: photo })), [sketch, photo]);
    assert.deepEqual(imagesOf(buildPortraitIdentityCheckRequest(record, cast[0], { inputMode: 'description', description: 'Short curly dark hair.', inkData: sketch })), [sketch]);
  }
});

test('saved person keys are pinned to their values from before the repair, so chosen drawings still match', () => {
  // Values computed with commit 7704f0b before any change.
  const pinned = {
    'bold-ink-comic': { 'child:photo-ink': '4de3cb8263d22e9b920c266285582199c73964768ef4026e3714467ed22a6d27', 'grown-up-two:photo-ink': '52258043d2bbfb958a039c55ff00632e22859d1e9b13d35c0ca7e9c285b9efa0', 'grown-up-one:description-ink': '89d27780d7dab46eb904e87502e634bf1d0c234453e0d453994e3875de007af8', 'child:photo-legacy': '5641d3cfc3c09a1e949eb1acca4e26d13837f45cfe3d82d1a1f64a9e63efd79a' },
    'painted-comic': { 'child:photo-ink': '9283b1502d37a498e8935ce5f901affb9fb23462fece7430497c9512fc3018dc', 'grown-up-two:photo-ink': '568471859e9db0ab925584c4d65e9b779bdd6f480917f8eb451d953b21295c0b' },
    'anime-comic': { 'child:photo-ink': 'f2a9e2ec4df256f33e8a8d24c09168fcc341d22cce783ed988cb6ca55dd04944', 'grown-up-one:description-ink': '625f88a7f75f723472192c54dd2b40e08bdccae90e764d728c421e57e9adb841' },
    'classic-comic': { 'child:photo-legacy': 'd8441887cf81a3236422dd32111ae2a4c78921cead696efa5eb7cc3b343fd698', 'grown-up-two:photo-ink': 'cece7a6e32cf73f58fb4e43c1addf5211e8bf058c4ec40d0d8d1b65fe1c52b14' },
  };
  for (const [style, keys] of Object.entries(pinned)) {
    const record = setupRecord({ real: false, pictureStyleId: style, nickname: 'Pip', age: 10, pronouns: 'he/him', loves: ['comics', 'soccer', 'space'], presetId: 'comet', familyContext: 'Fictional household.', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }, { label: 'Mom', pronouns: 'she/her', hair: 'long dark hair' }] });
    for (const [key, value] of Object.entries(keys)) {
      const [personId, mode] = key.split(':'), person = record.cast.find(item => item.id === personId);
      const options = mode === 'photo-legacy' ? {} : { inputMode: mode === 'photo-ink' ? 'photo' : 'description', pipelineVersion: inkPortraitPipelineVersion };
      assert.equal(portraitFingerprint(record, person, options), value, `${style} ${key}`);
    }
  }
  assert.equal(portraitReferencePolicy, 'identity-refs-only-v1');
});

test('the sketch verdict rejects only a confirmed, evidenced mismatch', () => {
  const person = { id: 'grown-up-two' };
  const row = (identityMatches, certainty, identityEvidence = 'Concrete visible evidence.', observedSpecies = 'human') => ({ castObservations: [{ characterId: 'grown-up-two', observedSpecies, identityMatches, certainty, identityEvidence, appearance: [], clothing: [] }] });
  assert.equal(assessPortraitIdentity(row(false, 'confirmed'), person).status, 'mismatch');
  assert.equal(assessPortraitIdentity(row(false, 'confirmed', ' '), person).status, 'uncertain');
  assert.equal(assessPortraitIdentity(row(false, 'uncertain'), person).status, 'uncertain');
  assert.equal(assessPortraitIdentity(row(true, 'confirmed'), person).status, 'match');
  assert.equal(assessPortraitIdentity(row(true, 'confirmed', 'A cat.', 'cat'), person).status, 'mismatch');
  // The check promised one row for the one person drawn.
  assert.equal(assessPortraitIdentity({ castObservations: [] }, person).status, 'unreadable');
  const other = (certainty, identityEvidence = 'A second adult stands behind her.') => ({ characterId: 'child', observedSpecies: 'human', identityMatches: false, certainty, identityEvidence, appearance: [], clothing: [] });
  assert.equal(assessPortraitIdentity({ castObservations: [other('confirmed')] }, person).status, 'unreadable', 'only a row for someone else');
  const extra = assessPortraitIdentity({ castObservations: [...row(true, 'confirmed').castObservations, other('confirmed')] }, person);
  assert.equal(extra.status, 'mismatch'); assert.match(extra.evidence, /Another person is in the picture: A second adult/);
  assert.equal(assessPortraitIdentity({ castObservations: [...row(true, 'confirmed').castObservations, other('confirmed', ' ')] }, person).status, 'uncertain', 'an unexplained extra row is not a confirmed second person');
  assert.equal(assessPortraitIdentity({ castObservations: [...row(true, 'confirmed').castObservations, other('uncertain')] }, person).status, 'uncertain');
  assert.equal(assessPortraitIdentity(row(true, 'uncertain', 'The face is small and turned away.'), person).status, 'uncertain', 'genuine doubt about the right person stays for the parent');
  for (const broken of [null, {}, { castObservations: [{ characterId: 'grown-up-two' }] }]) assert.equal(assessPortraitIdentity(broken, person).status, 'unreadable');
});
