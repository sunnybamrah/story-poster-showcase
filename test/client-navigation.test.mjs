import test from 'node:test';
import { savedTagline, storyHonestyLabel } from '../app/story-presentation.js';
import assert from 'node:assert/strict';
import { createRouteGuard, resolveRoute, routeHash, rememberedView, rememberOpened, recentWorkFor, filterKits } from '../app/navigation.js';

const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const saved = { username: 'fictional-family', childId: 'primary', record: {}, jobs: [{ id, childId: 'primary', status: 'complete', result: { story: 'Saved words.' } }], libraryJobs: [] };

test('stable family screens survive reload while transient choices fall back without guessing', () => {
  for (const screen of ['tonight', 'shelf', 'family', 'people', 'setup', 'library']) assert.equal(resolveRoute('#' + screen, saved).screen, screen);
  for (const screen of ['move', 'parent', 'feedback']) assert.deepEqual(resolveRoute('#' + screen, saved), { screen: 'tonight' });
  assert.equal(resolveRoute('#family', null).screen, 'welcome');
  assert.equal(resolveRoute('#login', null).screen, 'login');
});

test('saved result, reader and feedback restore only a current-child owned completed job', () => {
  for (const screen of ['result', 'story', 'feedback']) {
    assert.equal(resolveRoute(`#${screen}/${id}`, saved).job.id, id);
    assert.deepEqual(resolveRoute(`#${screen}/${other}`, saved), { screen: 'tonight' });
    assert.deepEqual(resolveRoute(`#${screen}/${id}`, { ...saved, childId: 'sibling' }), { screen: 'tonight' });
    assert.deepEqual(resolveRoute(`#${screen}/${id}`, null), { screen: 'welcome' });
    assert.deepEqual(resolveRoute(`#${screen}/${id}`, { ...saved, jobs: [{ ...saved.jobs[0], status: 'failed' }] }), { screen: 'tonight' });
  }
});

test('progress can return to owned saved work and completed work opens its result', () => {
  for (const status of ['running', 'paused', 'failed', 'set-aside']) {
    const session = { ...saved, jobs: [{ ...saved.jobs[0], status, result: undefined }] };
    assert.equal(resolveRoute(`#wait/${id}`, session).screen, 'wait');
    assert.equal(resolveRoute(`#wait/${id}`, session).job.status, status);
  }
  assert.equal(resolveRoute(`#wait/${id}`, saved).screen, 'result');
});

test('a default return finds running work but does not hijack an explicit stable screen', () => {
  const session = { ...saved, jobs: [{ ...saved.jobs[0], status: 'running', result: undefined }] };
  assert.equal(resolveRoute('', session).screen, 'wait');
  assert.equal(resolveRoute('#family', session).screen, 'family');
  assert.equal(resolveRoute('', { ...saved, libraryJobs: [{ status: 'running' }] }).screen, 'library');
});

test('sample routes are explicit and historical sample markers migrate without a private job', () => {
  assert.deepEqual(resolveRoute('#story/sample', null), { screen: 'story', sample: true });
  assert.deepEqual(resolveRoute('#result', saved, { sample: true }), { screen: 'result', sample: true });
  assert.deepEqual(resolveRoute('#result/sample', null), { screen: 'result', sample: true });
  assert.deepEqual(resolveRoute('#poster/sample', null), { screen: 'result', sample: true });
  for (const screen of ['result', 'story']) assert.deepEqual(resolveRoute(routeHash(screen, { sample: true }), null), { screen, sample: true });
  assert.equal(resolveRoute('#result', saved, { jobId: id }).job.id, id);
});

test('routes expose only opaque job ids and reject extra or malformed route data', () => {
  assert.equal(routeHash('story', { jobId: id }), '#story/' + id);
  assert.equal(routeHash('result', { sample: true, jobId: id }), '#poster/sample');
  assert.equal(routeHash('story', { jobId: 'private sentence' }), '#story');
  for (const hash of [`#story/${id}/extra`, '#family/private%20note', '#result/../family', '#result/private-name']) assert.deepEqual(resolveRoute(hash, saved), { screen: 'tonight' });
});

test('a delayed Back session cannot apply after a newer route or family switch', async () => {
  const guard = createRouteGuard(), applied = [];
  let finish;
  const sessionRead = new Promise(resolve => { finish = resolve; });
  const current = guard.begin();
  const restore = (async () => { const snapshot = await sessionRead; if (current()) applied.push(snapshot); })();
  guard.invalidate(); finish(saved); await restore;
  assert.deepEqual(applied, []);
});

test('a delayed sample read retains the Back epoch and cannot replace a newer result', async () => {
  const guard = createRouteGuard(), applied = [];
  let finish;
  const imageRead = new Promise(resolve => { finish = resolve; });
  const older = guard.begin();
  const restore = (async () => { const result = await imageRead; if (older()) applied.push(result); })();
  const newer = guard.begin();
  if (newer()) applied.push('newer owned result');
  finish('older saved sample'); await restore;
  assert.deepEqual(applied, ['newer owned result']);
});

test('saved view metadata keeps the actual private return when opening a sample', () => {
  const first = rememberOpened(null, { jobId: id });
  const sample = rememberOpened({ ...first, textSize: 'larger', places: { [id]: 'story-paragraph-2-4' } }, { sample: true });
  assert.equal(sample.sample, true); assert.equal(sample.jobId, null); assert.equal(sample.lastOpenedJobId, id);
  assert.equal(sample.textSize, 'larger'); assert.equal(sample.places[id], 'story-paragraph-2-4');
  assert.deepEqual(rememberedView('broken JSON'), { screen: null, sample: false, jobId: null, lastOpenedJobId: null, textSize: 'standard', places: {} });
  const unsafe = rememberedView({ jobId: 'private note', lastOpenedJobId: '../other', places: { [id]: 'private note', sample: 'story-page-1', name: 'story-page-2' }, textSize: 'huge' });
  assert.equal(unsafe.lastOpenedJobId, null); assert.deepEqual(unsafe.places, { sample: 'story-page-1' }); assert.equal(unsafe.textSize, 'standard');
});

test('running owned work wins, then actual last-opened rather than newest-created', () => {
  const session = { ...saved, jobs: [{ ...saved.jobs[0], id: other }, saved.jobs[0], { ...saved.jobs[0], id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', childId: 'sibling', status: 'running' }] };
  assert.equal(recentWorkFor(session, { lastOpenedJobId: id }).id, id);
  assert.equal(recentWorkFor(session, { lastOpenedJobId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }).id, other);
  session.jobs[0].status = 'running'; assert.equal(recentWorkFor(session, { lastOpenedJobId: id }).id, other);
});

test('kit retrieval searches only the current child titles, moves and chapters', () => {
  const session = { ...saved, jobs: [{ ...saved.jobs[0], chapterNumber: 2, tonight: 'Private note excluded', result: { chapterTitle: 'The Small Bridge', move: { name: 'Ask for help' } } }, { id: other, childId: 'primary', status: 'paused', chapterNumber: 3, move: { name: 'A quiet pause' } }, { ...saved.jobs[0], childId: 'sibling' }] };
  assert.deepEqual(filterKits(session, 'bridge').map(job => job.id), [id]);
  assert.deepEqual(filterKits(session, 'ASK FOR HELP').map(job => job.id), [id]);
  assert.deepEqual(filterKits(session, 'chapter 3', 'saved').map(job => job.id), [other]);
  assert.deepEqual(filterKits(session, 'private note'), []);
  assert.equal(filterKits(session).length, 2); assert.equal(filterKits(session, '', 'complete').length, 1);
});

test('reader restoration can observe an epoch without granting a new route', () => {
  const guard = createRouteGuard(), back = guard.begin(), reader = guard.capture();
  assert.equal(back(), true); assert.equal(reader(), true); guard.invalidate(); assert.equal(reader(), false); assert.equal(back(), false);
});


test('reader rhyme uses only exact saved tagline text, including historical lengths', () => {
  const exact = '  Take five.\nThen verify.  ';
  assert.equal(savedTagline({ posterSections: [{ id: 'remember', text: 'Not a substitute' }, { id: 'tagline', text: exact }] }), exact);
  const historical = 'This older saved rhyme has more than seven words and still belongs to this kit.';
  assert.equal(savedTagline({ posterSections: [{ id: 'tagline', text: historical }] }), historical);
  for (const result of [null, {}, { posterSections: {} }, { posterSections: [null, { id: 'tagline', text: 4 }] }, { posterSections: [{ id: 'tagline', text: '  ' }, { id: 'remember', text: 'Never invent a fallback' }] }]) assert.equal(savedTagline(result), null);
});

test('screen honesty labels preserve factual and fictional meaning for any learner', () => {
  assert.equal(storyHonestyLabel({ storyMode: 'factual', story: 'MADE UP\nOlder marker' }), 'Based on the facts you shared');
  assert.equal(storyHonestyLabel({ story: 'REAL\nA historical retelling.' }), 'Based on the facts you shared');
  for (const result of [{ storyMode: 'inspired' }, { story: 'MADE UP\nAn adult is learning.' }, {}]) assert.equal(storyHonestyLabel(result), 'A made-up story inspired by your note');
});

test('email accounts resume People and owner navigation requires its actual flag', () => {
  const pending = { accountId: 'pending', needsSetup: true, record: null, jobs: [] };
  for (const hash of ['', '#tonight', '#shelf', '#setup', '#login', '#welcome']) assert.equal(resolveRoute(hash, pending).screen, 'setup');
  assert.equal(resolveRoute('#recovery', pending).screen, 'recovery');
  assert.equal(resolveRoute('#owner', saved).screen, 'tonight');
  assert.equal(resolveRoute('#owner', { ...saved, isOwner: true }).screen, 'owner');
  assert.equal(resolveRoute('#owner', null).screen, 'login');
  assert.equal(resolveRoute('#access', null).screen, 'access');
  assert.equal(resolveRoute('#join', null).screen, 'join');
  assert.equal(resolveRoute('#invites', null).screen, 'welcome');
  assert.equal(resolveRoute('#invites', saved).screen, 'invites');
  assert.equal(resolveRoute('#recovery', null).screen, 'recovery');
});

test('reopening landing screens resumes owned work but deliberate Back and explicit links stay put', () => {
  const session = { ...saved, jobs: [{ ...saved.jobs[0], status: 'running', result: undefined, progress: { label: 'Checking the pictures' } }] };
  for (const hash of ['', '#welcome', '#login', '#tonight', '#shelf']) {
    const route = resolveRoute(hash, session, null, { resumeWork: true });
    assert.equal(route.screen, 'wait'); assert.equal(route.job.id, id);
    assert.equal(route.job.progress.label, 'Checking the pictures');
  }
  for (const hash of ['#tonight', '#shelf', '#family', '#people']) assert.equal(resolveRoute(hash, session).screen, hash.slice(1));
  assert.equal(resolveRoute('#story/sample', session, null, { resumeWork: true }).sample, true);
  assert.equal(resolveRoute('#owner', { ...session, isOwner: true }, null, { resumeWork: true }).screen, 'owner');
  assert.equal(resolveRoute('', { ...session, childId: 'other' }).job, undefined);
});

test('closed-tab wait metadata reopens completion or a paused job without restarting it', () => {
  const remembered = rememberOpened(null, { screen: 'wait', jobId: id });
  assert.equal(resolveRoute('#tonight', saved, remembered, { resumeWork: true }).screen, 'result');
  const paused = { ...saved, jobs: [{ ...saved.jobs[0], status: 'paused', result: undefined }] };
  assert.equal(resolveRoute('', paused, remembered, { resumeWork: true }).job.status, 'paused');
  assert.equal(resolveRoute('', { ...saved, childId: 'other' }, remembered, { resumeWork: true }).job, undefined);
  assert.equal(resolveRoute('#tonight', saved, remembered).screen, 'tonight');
  assert.equal(rememberedView({ screen: 'private note' }).screen, null);
});


test('Home remains the front page while initial reopening still restores running work', () => {
  assert.equal(resolveRoute('#welcome', saved).screen, 'welcome');
  const running = { ...saved, jobs: [{ ...saved.jobs[0], status: 'running' }] };
  assert.equal(resolveRoute('#welcome', running).screen, 'welcome');
  assert.equal(resolveRoute('#welcome', running, null, { resumeWork: true }).screen, 'wait');
});

test('completion received just before closing preserves the result on reopening', () => {
  for (const screen of ['wait', 'result', 'story']) {
    const remembered = rememberOpened(null, { screen, jobId: id });
    for (const hash of ['', '#tonight']) {
      const route = resolveRoute(hash, saved, remembered, { resumeWork: true });
      assert.equal(route.screen, screen === 'story' ? 'story' : 'result');
      assert.equal(route.job.id, id);
    }
    assert.equal(resolveRoute('#tonight', saved, remembered).screen, 'tonight');
    assert.equal(resolveRoute('#family', saved, remembered, { resumeWork: true }).screen, 'family');
    assert.equal(resolveRoute('', { ...saved, childId: 'other' }, remembered, { resumeWork: true }).job, undefined);
  }
  assert.equal(resolveRoute('#tonight', saved, { screen: 'result', sample: true, jobId: id }, { resumeWork: true }).screen, 'tonight');
  const left = rememberOpened(rememberOpened(null, { screen: 'result', jobId: id }), { screen: null, jobId: null });
  assert.equal(left.lastOpenedJobId, id);
  assert.equal(resolveRoute('', saved, left, { resumeWork: true }).screen, 'tonight');
});
