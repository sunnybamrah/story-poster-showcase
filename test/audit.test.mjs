import test from 'node:test';
import assert from 'node:assert/strict';
import { auditHistory, auditKits, auditDeletion, deletedFactHits, attemptRejectReasons } from '../server/audit.js';
import { moves } from '../server/files.js';
import { family, sentences, deletedFact } from './fixture.mjs';
import { buildStoryRequest, buildStoryCheckRequest } from '../server/requests.js';
import { previewPages } from '../server/layout.js';

test('past references are information with exact source locations or a request to read', () => {
  const supported = auditHistory("MADE UP\nPip's grandad moved in with us in September.\n" + moves[0].practiceScript, family, moves[0]);
  assert.equal(supported.status, 'INFO'); assert.match(supported.references[0].source, /record.familyContext/);
  const unsupported = auditHistory('MADE UP\nLast year Pip won the soccer cup.', family, moves[0]);
  assert.equal(unsupported.status, 'INFO'); assert.equal(unsupported.references[0].supported, false);
  assert.equal(unsupported.references[0].source, null);
});
test('a clean keyword scan does not pretend to prove new narrative has no hidden history', () => {
  const audit = auditHistory('MADE UP\nPip greets their longtime teammate.', family, moves[0]);
  assert.equal(audit.status, 'INFO');
  assert.equal(audit.passed, undefined);
});
test('absent kits never pass by empty-array truth', () => {
  const audit = auditKits({ kits: [], record: family, log: [] });
  assert.ok(audit.rows.every(row => row.status === 'NOT RUN' || row.name === 'Past references for the lead to read' && row.status === 'INFO'));
});

test('past reading list covers both stories and tonight, summary and move sources', () => {
  const record = { ...family, pastKits: [{ date: '2026-10-14', moveId: moves[0].id, didItHelp: 'yes', adventureLine: 'Pip walked home yesterday.' }] };
  const tonight = 'Pip stumbled after school.';
  const history = auditHistory(`MADE UP\n${tonight}\nPip walked home yesterday.\n${moves[0].practiceScript}\nTomorrow Pip would return.`, record, moves[0], tonight);
  assert.match(history.references.find(ref => ref.text === tonight).source, /sentence \(tonight\)/);
  assert.match(history.references.find(ref => ref.text === 'Pip walked home yesterday.').source, /summary/);
  assert.ok(history.references.some(ref => ref.source?.includes('move record')));
  assert.equal(history.references.at(-1).source, null);
  const kits = [1, 2].map(number => ({ number, story: 'MADE UP\nPip walked yesterday.', recordAtStart: record, move: moves[0], pages: {}, checks: [] }));
  const audit = auditKits({ kits, record, log: [] });
  assert.deepEqual(audit.history.references.map(ref => ref.kit), [1, 2]);
  assert.equal(audit.rows.find(row => row.name === 'Past references for the lead to read').status, 'INFO');
});

test('attempt reasons trace the preceding retry in its own run and retain final rejections', () => {
  const request = (id, runId, retry, error) => ({ event: 'request', id, runId, kit: 2, stage: 'story', retry, body: { messages: [{ role: 'user', content: JSON.stringify({ correction: { error } }) }] } });
  const log = [request('old', 'older', 0), request('first', 'current', 0), request('second', 'current', 1, 'Code rejected the previous answer: story_must_be_under_350_words. Return the required JSON and fix that exact error.'), { event: 'validation-reject', id: 'second', reason: 'practice_words_changed_or_missing' }];
  const reasons = attemptRejectReasons(log);
  assert.equal(reasons.get('first'), 'story_must_be_under_350_words');
  assert.equal(reasons.get('second'), 'practice_words_changed_or_missing');
  assert.equal(reasons.has('old'), false);
});

test('deletion audit keeps before-deletion requests, ignores exact move records, and catches later copies', () => {
  const record = { ...family, familyContext: family.familyContext.replace(deletedFact, '') };
  const request = (id, body, stage = 'story') => ({ event: 'request', provider: 'anthropic', kit: id === 'before' ? 1 : 2, id, stage, body });
  const before = request('before', buildStoryRequest(family, sentences[0]));
  const marker = { event: 'memory-delete', revision: 2, timestamp: '2026-10-14T00:00:00.000Z' };
  const after = request('after', buildStoryRequest(record, sentences[1]));
  const log = [before, marker, after];
  const original = JSON.stringify(log);
  const audit = auditDeletion({ record, log, deletedFact, kit2: { move: moves[2], pages: previewPages(moves[2]) } });
  assert.equal(audit.passed, true);
  assert.equal(audit.beforeDeletion[0].id, 'before');
  assert.ok(audit.beforeDeletion[0].hits.includes('deleted sentence'));
  assert.equal(JSON.stringify(log), original);
  assert.equal(auditDeletion({ record, log: [before, after], deletedFact }).passed, false);
  assert.equal(auditDeletion({ record, log: [before, marker, before], deletedFact }).passed, false);
  const leaked = buildStoryCheckRequest('MADE UP\n' + deletedFact, moves[2]);
  assert.equal(auditDeletion({ record, log: [...log, request('check', leaked, 'story-check')], deletedFact }).passed, false);
  const changed = structuredClone(after);
  const data = JSON.parse(changed.body.input[0].content);
  data.moves[0].newFamilyField = deletedFact;
  changed.body.input[0].content = JSON.stringify(data);
  assert.equal(auditDeletion({ record, log: [...log, changed], deletedFact }).passed, false);
  const extra = structuredClone(after);
  extra.body.unrelated = deletedFact;
  assert.equal(auditDeletion({ record, log: [...log, extra], deletedFact }).passed, false);
});

test('deleted sentence, little brother, and brother plus room are checked in every later location', () => {
  const record = { ...family, familyContext: family.familyContext.replace(deletedFact, '') };
  const log = [{ event: 'memory-delete', revision: 1 }];
  for (const text of [deletedFact, 'Their little brother.', 'A brother is in the room.', 'The ROOM belongs to a BROTHER.']) {
    assert.ok(deletedFactHits(text, deletedFact).length);
    assert.equal(auditDeletion({ record: { ...record, familyContext: record.familyContext + text }, log, deletedFact }).passed, false);
    const pastKits = [{ date: '2026-10-14', moveId: moves[0].id, didItHelp: 'yes', adventureLine: text }];
    const history = auditDeletion({ record: { ...record, pastKits }, log, deletedFact });
    assert.ok(history.hits.some(hit => hit.startsWith('three-line summary')));
    for (const page of ['poster.html', 'story.html', 'try.html', 'for-you.html']) {
      const pages = previewPages(moves[0]);
      pages[page] += `<p>${text}</p>`;
      assert.equal(auditDeletion({ record, log, deletedFact, kit2: { move: moves[0], pages } }).passed, false);
    }
  }
  assert.deepEqual(deletedFactHits('Room for improvement.', deletedFact), []);
  assert.deepEqual(deletedFactHits('A brother.', deletedFact), []);
});
