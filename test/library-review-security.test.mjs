import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLibrary, buildTeachingDocument, validateTeachingDraft } from '../server/library.js';
import { createLibraryCatalog } from '../server/library-catalog.js';
import { createPreparedLibrary } from '../server/library-prepared.js';
import { createMemory } from '../server/memory.js';
import { setupRecord } from '../server/app-data.js';
import { moves } from '../server/files.js';
import { libraryTopic, librarySource, libraryDraft, libraryReview, libraryTopicReview, libraryAnswer, libraryTransportFixture } from './library-fixture.mjs';

test('shared reuse returns the exact document independently reviewed for this private request', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'library-fit-review-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const preparedLibrary = createPreparedLibrary({ directory: join(directory, 'empty-prepared-bank') });
  const catalog = createLibraryCatalog(join(directory, 'shared-library'), { preparedLibrary, registerMove() {} });
  const documentFor = topic => buildTeachingDocument(topic, validateTeachingDraft(libraryDraft(), topic, [librarySource()], moves), [librarySource()], libraryReview(), moves);
  const reviewed = catalog.publish(documentFor({ ...libraryTopic(), topic: 'handling a quiet setback' }));
  const other = catalog.publish(documentFor(libraryTopic()));
  assert.notEqual(reviewed.id, other.id);
  const account = { id: 'fictional-account', childIds: ['primary'] };
  const memory = createMemory(join(directory, 'family.json'));
  memory.store(setupRecord({ real: false, nickname: 'Pip', age: 10, pronouns: 'he/him', loves: ['kites', 'drawing', 'stars'], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] }));
  let checkedId;
  const service = createLibrary({ db: {}, persist() {}, dataDirectory: directory, active: new Map(), budget: { status: () => ({ limit: 6, spent: 0, reserved: 0 }) },
    memoryFor: () => memory, childIdFor: () => 'primary', readKey: () => 'fake-not-a-key', catalog, preparedLibrary,
    searchSources: () => { throw Error('An independently checked existing guide should not buy new research.'); },
    transportFactory: () => libraryTransportFixture({ override: request => {
      if (request.stage === 'library-topic') return libraryAnswer({ ...libraryTopic(), existingDocumentId: reviewed.id });
      if (request.stage === 'library-topic-check') {
        checkedId = JSON.parse(request.body.input[0].content).existingDocument.id;
        return libraryAnswer(libraryTopicReview());
      }
    } }),
  });
  const job = service.start(account, 'primary', 'A quiet made-up afternoon included a small setback.');
  let done;
  for (let i = 0; i < 100; i++) { done = service.status(account, job.id); if (done.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.equal(checkedId, reviewed.id);
  assert.equal(done.status, 'complete');
  assert.equal(done.moveId, checkedId, 'Returning a different document bypasses the actual existing-document fit check.');
});
