import test from 'node:test';
import assert from 'node:assert/strict';
import { setupRecord } from '../server/app-data.js';
import { buildStoryRequest } from '../server/requests.js';
import { defaultPictureStyleId } from '../app/picture-styles.js';

const input = schoolGrade => ({ real: false, pictureStyleId: defaultPictureStyleId, nickname: 'Pip', age: 10, pronouns: 'he/him', loves: ['kites'], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }], ...(schoolGrade === undefined ? {} : { schoolGrade }) });
const schoolGrade = level => ({ system: 'US', level });

test('school grade stays optional and accepts only a valid explicit U.S. grade', () => {
  assert.equal(setupRecord(input()).hero.schoolGrade, undefined);
  for (const level of [0, 3, 4, 8, 12]) assert.deepEqual(setupRecord(input(schoolGrade(level))).hero.schoolGrade, schoolGrade(level));
  for (const value of [{ system: 'UK', level: 4 }, { system: 'US', level: '4' }, { system: 'US', level: 13 }, { system: 'US', level: -1 }, 4, { system: 'US', level: 4, guessedFromAge: true }]) assert.throws(() => setupRecord(input(value)), /school grade/);
});

test('school grade is not sent as a story fact', () => {
  const record = setupRecord(input(schoolGrade(4)));
  const payload = JSON.parse(buildStoryRequest(record, 'My child wants to tell a friend about a game.').input[0].content);
  assert.ok(!JSON.stringify(payload).includes('schoolGrade'));
});

test('the hosted edition’s grade-only prepared guide is not bundled in the public catalog', { skip: 'Needs the excluded file content/prepared-library/bundle.json containing the hosted grade-only guide.' }, () => {});
