import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appCheckPortraitInputs, appCheckPortraitPayload, runPaidAppKit } from './run-app-kit.mjs';

const photo = fileURLToPath(new URL('./fixtures/offline-art.png', import.meta.url));
const childDescription = 'Brown skin, short curly dark hair and brown eyes.';
const parentDescription = 'Adult man with short dark hair and a trimmed beard.';
const env = values => Object.fromEntries(Object.entries(values).map(([key, value]) => ['STORY_POSTER_CHECK_' + key, value]));

test('runner accepts both mixed directions and produces one exclusive source payload per person', () => {
  for (const values of [{ CHILD_PHOTO: photo, PARENT_DESCRIPTION: parentDescription }, { CHILD_DESCRIPTION: childDescription, PARENT_PHOTO: photo }]) {
    const inputs = appCheckPortraitInputs(env(values)); assert.deepEqual(inputs.map(input => input.personId), ['child', 'grown-up-one']);
    assert.deepEqual(inputs.map(input => input.inputMode).sort(), ['description', 'photo']);
    for (const input of inputs) {
      const payload = appCheckPortraitPayload(input); assert.equal(payload.childId, 'primary'); assert.equal(payload.inputMode, input.inputMode);
      assert.notEqual(Object.hasOwn(payload, 'photo'), Object.hasOwn(payload, 'description'));
      if (input.inputMode === 'photo') { assert.equal(payload.photo.mime, 'image/png'); assert.deepEqual(Buffer.from(payload.photo.base64, 'base64'), readFileSync(photo)); }
      else assert.equal(payload.description, input.description);
    }
    // The private input receipt contains modes and source descriptions/paths, not photo bytes.
    assert.ok(!JSON.stringify(inputs).includes(readFileSync(photo).toString('base64')));
  }
});

test('runner keeps legacy all-photo and no-input resume behavior and accepts two descriptions', () => {
  const photos = appCheckPortraitInputs(env({ CHILD_PHOTO: photo, PARENT_PHOTO: photo }));
  assert.deepEqual(photos.map(input => [input.inputMode, input.path]), [['photo', resolve(photo)], ['photo', resolve(photo)]]);
  assert.deepEqual(appCheckPortraitInputs({}), []);
  assert.deepEqual(appCheckPortraitInputs(env({ RESUME_RECEIPT: '/private/example.json' })), []);
  assert.deepEqual(appCheckPortraitInputs(env({ CHILD_PHOTO: '', PARENT_PHOTO: '  ' })), []);
  const descriptions = appCheckPortraitInputs(env({ CHILD_DESCRIPTION: childDescription, PARENT_DESCRIPTION: parentDescription }));
  assert.ok(descriptions.every(input => input.inputMode === 'description' && !Object.hasOwn(appCheckPortraitPayload(input), 'photo')));
});

test('runner refuses one-sided, conflicting and invalid descriptions before opening any app', () => {
  for (const values of [{ CHILD_PHOTO: photo }, { PARENT_DESCRIPTION: parentDescription }, { CHILD_DESCRIPTION: childDescription, PARENT_PHOTO: '' }]) assert.throws(() => appCheckPortraitInputs(env(values)), /both fictional people/);
  for (const values of [{ CHILD_PHOTO: photo, CHILD_DESCRIPTION: childDescription, PARENT_PHOTO: photo }, { CHILD_DESCRIPTION: childDescription, PARENT_PHOTO: photo, PARENT_DESCRIPTION: parentDescription }]) assert.throws(() => appCheckPortraitInputs(env(values)), /not both/);
  for (const description of ['x'.repeat(601), 'data:image/png;base64,AAAA', 'https://example.com/person']) assert.throws(() => appCheckPortraitInputs(env({ CHILD_DESCRIPTION: description, PARENT_DESCRIPTION: parentDescription })));
});

test('runner still requires the explicit paid command without creating a new budget option', async () => {
  await assert.rejects(runPaidAppKit([]), /Paid calls require/);
  await assert.rejects(runPaidAppKit(['--paid', '--new-budget']), /Paid calls require/);
});

test('the general app runner lets the app choose a guide for each supplied goal', async () => {
  const { startAppCheckStory } = await import('./run-app-kit.mjs');
  for (const tonight of ['A child wants to wait until a sibling finishes speaking.', 'A child needs a plan to remember a library book.', 'A child wants words for a feeling.']) {
    const calls = [];
    const result = await startAppCheckStory(async (path, body) => {
      calls.push({ path, body });
      return path === 'moment/clarify' ? { status: 200, data: { status: 'ready', draftId: 'checked-note' } } : { status: 202, data: { id: 'new-kit' } };
    }, tonight);
    assert.equal(result.id, 'new-kit');
    assert.deepEqual(calls.map(c => c.path), ['moment/clarify', 'jobs']);
    assert.equal(calls[1].body.tonight, tonight);
    assert.equal(calls[1].body.clarificationId, 'checked-note');
    assert.equal(calls[1].body.moveId, undefined);
  }
});
test('the general app runner does not invent answers or skip an incomplete moment check', async () => {
  const { startAppCheckStory } = await import('./run-app-kit.mjs');
  for (const data of [{ status: 'question', question: 'Who was speaking?' }, { status: 'unavailable' }, { status: 'ready' }]) {
    const paths = [];
    await assert.rejects(startAppCheckStory(async path => { paths.push(path); return { status: 200, data }; }, 'An ambiguous note.'), /real answer/);
    assert.deepEqual(paths, ['moment/clarify']);
  }
});
