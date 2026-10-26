import { createServer } from 'node:http';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, rmSync, renameSync } from 'node:fs';
import { join, resolve, extname, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, moves, readJSON, saveJSON } from './files.js';
import { config as defaultAppConfig, recordDataConsent, assertFamilyAllowed, assertPhotoAllowed } from './config.js';
import { dataPolicyVersion, dataPolicyNotice, dataPolicyURL, subscriptionDataPolicyVersion, subscriptionDataPolicyNotice, subscriptionDataPolicyURL, hostedSubscriptionDataPolicyVersion, hostedSubscriptionDataPolicyNotice } from '../app/data-policy.js';
import { createPortraits, photoJSONLimit, photoByteLimit, portraitDescriptionMaxLength } from './portraits.js';
import { createMemory } from './memory.js';
import { setupRecord, heroPresets, repairPresetConflict, buildKitRecord, canLeadKit } from './app-data.js';
import { preparePick } from './picker.js';
import { createKit } from './kit.js';
import { adventureLine } from './story.js';
import { createTransport } from './transport.js';
import { createSubscriptionTransport } from './subscription-transport.js';
import { createAppBudget, centralDay, defaultDailyLimit, newKitAllowance } from './app-budget.js';
import { scienceFor, positiveActionFor, practiceFor, evidenceLabelFor, approvedPosterWords, splitStory } from './format.js';
import { kitEditorial } from './kit-editorial.js';
import { advanceJobStage, kitWaitEstimate, jobProgress } from './job-progress.js';
import { lockedCast, learningActor, hasChosenLook, withStoryOutfits } from './cast.js';
import { jobDiagnostics, parentJobFailure, requireCompleteKit, savedLessonFitFailure } from './job-failure.js';
import { createLibrary } from './library.js';
import { createLibraryCatalog } from './library-catalog.js';
import { geometryRuleVersion } from './poster-template.js';
import { pictureStyleIdFor, defaultPictureStyleId, lookFlowVersion } from '../app/picture-styles.js';
import { createAccounts, accountLimit, emailAddress, passwordFields, passwordMatches } from './accounts.js';
import { createWorkerBridge } from './worker-bridge.js';
import { openHostedStore } from './hosted-store.js';
import { createMomentClarification } from './moment-clarification.js';
import { createMailSender } from './mail.js';
import { createAccessControl } from './access-control.js';
import { createPracticeAnswers } from './practice-answers.js';
import { createKitSuggestions } from './kit-suggestions.js';
import { jobDisplayPeople } from './job-people.js';
import { createPrintCopies } from './print-copy.js';
import { createKitPages } from './kit-pages.js';
import { createBrowserPreviews } from './browser-previews.js';
import { loadPublicSample } from './public-sample.js';
import { loadSampleNarration } from './sample-narration.js';
import { createPreparedLibrary, isPreparedMove, preparedApplicability } from './library-prepared.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const familyFingerprint = (record, { includeStyle = true } = {}) => digest(JSON.stringify({ real: record.real, parentLabel: record.parentLabel, familyContext: record.familyContext, storyPeople: record.storyPeople, ...(record.kitContext ? { kitContext: record.kitContext } : {}), hero: Object.fromEntries(['nickname', 'name', 'age', 'pronouns', 'loves', 'lookChips', 'lockedOutfit'].map(key => [key, record.hero[key]])), cast: lockedCast(record).map(({ referencePath, referenceHash, ...person }) => person), ...(includeStyle ? { pictureStyleId: pictureStyleIdFor(record) } : {}) }));
const portraitFingerprint = record => digest(JSON.stringify((record.cast ?? []).filter(person => ['photo', 'description'].includes(person.referenceSource)).map(person => [person.id, person.referenceHash, person.portraitCandidateId])));
const filesAllowed = new Set(['poster.png', 'poster.pdf', 'kit_final.pdf', 'reading-art.png', ...[1, 2, 3, 4].map(n => `panel-${n}.png`)]);
export function findSample() {
  const directory = join(root, 'test/out');
  const candidates = existsSync(directory) ? readdirSync(directory).filter(name => /^pass9-/.test(name)).sort().reverse() : [];
  for (const name of candidates) {
    const kit = join(directory, name, 'kit-1');
    if (['poster.png', 'poster.pdf', 'kit_final.pdf', 'checkpoint.json'].every(file => existsSync(join(kit, file)))) {
      const checkpoint = readJSON(join(kit, 'checkpoint.json'));
      if (checkpoint.recordAtStart?.real === false && checkpoint.stages?.text?.ready) return { directory: kit, text: checkpoint.stages.text, record: checkpoint.recordAtStart };
    }
  }
  return loadPublicSample();
}
const moveView = (move, record = {}) => ({ id: move.id, name: move.name, practiceScript: practiceFor(move, record.hero ? learningActor(record).storyName : 'your name', record.parentLabel ?? 'your grown-up'), positiveAction: positiveActionFor(move), science: scienceFor(move), sources: move.sources.map(source => ({ ...source, plainFit: evidenceLabelFor(source.fitLabel), url: source.url ?? (source.doi ? `https://doi.org/${source.doi}` : `https://pubmed.ncbi.nlm.nih.gov/${source.pubmed}/`) })) });
const resultView = (text, move, record, sample = false) => ({ move: moveView(move, record), chapterTitle: text.chapterTitle, story: text.story, storyMode: record.kitContext?.storyMode ?? 'inspired', storyPages: text.pagination?.pages ?? splitStory(text.story, text.panelLines).pages, tinyTryOptions: text.tinyTryOptions, feelFirst: text.feelFirst, whereElse: text.whereElse, nickname: learningActor(record).storyName, parentLabel: record.parentLabel, sample, posterSections: approvedPosterWords(move, text, { nickname: learningActor(record).storyName }).map(box => ({ id: box.id, title: box.title ?? '', text: box.text ?? '' })), panels: (text.panelLines ?? []).map((panel, index) => ({ id: `panel-${index + 1}`, urlName: `panel-${index + 1}.png`, line: panel.line })), editorialReview: kitEditorial.reviewLabel, checker: 'Source checks and drawing observations are saved with this kit. Read it together before printing.', assets: [...filesAllowed] });

function pickView(record, data) {
  if (typeof data.tonight !== 'string' || !data.tonight.trim() || data.tonight.length > 2000) throw new Error('Write a sentence about tonight, up to 2,000 characters.');
  const pick = preparePick(record, data.tonight, { allowRepeat: data.allowRepeat === true, chosenMoveId: data.requestedMoveId });
  if (pick.status !== 'eligible') return pick;
  if (record.hero && !canLeadKit(record)) return { status: 'noMatch', reason: 'supporting-profile', canRepeat: false, suggestions: [], message: 'This child can join another family story. Choose a child aged 8 to 13 to lead a learning kit.' };
  if (data.requestedMoveId !== undefined) {
    if (typeof data.requestedMoveId !== 'string' || !pick.eligible.some(item => item.move.id === data.requestedMoveId)) return { status: 'noMatch', reason: 'guide-unavailable', suggestions: [], canRepeat: false, message: 'Choose an available guide for this child.' };
    pick.eligible.sort((left, right) => Number(right.move.id === data.requestedMoveId) - Number(left.move.id === data.requestedMoveId));
  }
  return { status: 'eligible', suggestions: pick.eligible.slice(0, 3).map(item => ({ ...moveView(item.move, record), reason: item.reason, repeated: item.repeated })) };
}

export function createApp({ dataDirectory = join(root, 'context/local-app'), sampleOnly = process.env.STORY_POSTER_SAMPLE_ONLY === '1', dailyLimit = Number(process.env.STORY_POSTER_DAILY_USD ?? defaultDailyLimit), sample = findSample(), runKit = createKit, kitExports, keyReader, transportFactory, allowSyntheticPortraits = false, librarySearch, libraryFetch, preparedLibrary = createPreparedLibrary(), generationRoute = 'api', publicOrigin = process.env.STORY_POSTER_PUBLIC_ORIGIN ?? '', sendMail = createMailSender(), ownerAccountIds = (process.env.STORY_POSTER_OWNER_ACCOUNT_IDS ?? '').split(',').filter(Boolean), ownerEmails = (process.env.STORY_POSTER_OWNER_EMAILS ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean), inviteOnly = process.env.STORY_POSTER_INVITE_ONLY === '1', ownerNotificationEmail = process.env.STORY_POSTER_OWNER_ALERT_EMAIL, autoDeliverAccess = true, printCopyRenderer, stateStore, workerBridge, workerSecret = process.env.STORY_POSTER_WORKER_SECRET } = {}) {
  const subscription = generationRoute === 'subscription';
  const sampleNarration = loadSampleNarration(sample);
  const policyVersion = subscription ? (publicOrigin ? hostedSubscriptionDataPolicyVersion : subscriptionDataPolicyVersion) : dataPolicyVersion;
  const config = subscription ? { ...defaultAppConfig, subscriptionMode: true, dataPolicyVersion: policyVersion } : defaultAppConfig;
  const policyNotice = subscription ? (publicOrigin ? hostedSubscriptionDataPolicyNotice : subscriptionDataPolicyNotice) : dataPolicyNotice;
  const policyURL = subscription ? subscriptionDataPolicyURL : dataPolicyURL;
  transportFactory ??= subscription ? createSubscriptionTransport : createTransport;
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const stateFile = join(dataDirectory, 'accounts.json');
  const db = stateStore?.initialState ?? (existsSync(stateFile) ? readJSON(stateFile) : { accounts: [], sessions: [], jobs: [] });
  const persist = () => { stateStore?.assertWritable(); saveJSON(stateFile, db); stateStore?.save(db); };
  const flush = () => stateStore?.flush() ?? Promise.resolve();
  let access;
  if (workerSecret) {
    workerBridge ??= createWorkerBridge({ db, persist, flush, secret: workerSecret, resultDirectory: join(dataDirectory, 'worker-results'), ownerAlerts: { claim: id => access?.claimAlert(id), complete: (id, data) => access.completeAlert(id, data) } });
    if (!subscription) throw Error('The remote worker uses the existing subscription route only.');
    transportFactory = options => createSubscriptionTransport({ ...options, run: workerBridge.run });
  }
  const accounts = createAccounts({ db, persist, sendMail, publicOrigin, ownerAccountIds, ownerEmails, assertAdmission: account => access?.assertAdmitted(account) });
  const baseTransportFactory = transportFactory;
  transportFactory = options => {
    const accountId = options.logFile ? relative(dataDirectory, options.logFile).split(sep)[0] : null;
    const assertCanGenerate = () => { const account = db.accounts.find(item => item.id === accountId); if (!account) throw Object.assign(Error('This family account is no longer available.'), { status: 403 }); accounts.assertCreation(account); stateStore?.assertWritable(); };
    const transport = baseTransportFactory({ ...options, assertCanGenerate, requestOwner: { accountId, workId: options.logFile ? basename(resolve(options.logFile, '..')) : null } });
    const call = transport.call.bind(transport);
    transport.call = async request => { assertCanGenerate(); await flush(); const response = await call(request); assertCanGenerate(); return response; };
    return transport;
  };
  const hostedOrigin = publicOrigin ? new URL(publicOrigin).origin : null;
  if (publicOrigin && !/^https:\/\//.test(publicOrigin) && !/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(hostedOrigin)) throw Error('Use HTTPS for the public address.');
  access = createAccessControl({ db, persist, flush, accounts, sendMail, publicOrigin, enabled: inviteOnly, ownerEmails, ownerNotificationEmail, autoDeliver: autoDeliverAccess, readyJobExists: job => ['poster.png', 'poster.pdf', 'kit_final.pdf'].every(name => existsSync(join(dataDirectory, job.accountId, job.id, name))) });
  const practice = createPracticeAnswers({ db, persist });
  const suggestions = createKitSuggestions({ db, persist, queue: access.queueSuggestion, delivery: access.suggestionDelivery });
  const printCopies = createPrintCopies({ db, dataDirectory, persist, flush, ...(printCopyRenderer ? { render: printCopyRenderer } : {}) });
  const kitPages = createKitPages();
  const browserPreviews = createBrowserPreviews();
  function finalizeDeletion(item) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(item.accountId) || item.jobId && !/^[a-zA-Z0-9_-]{1,100}$/.test(item.jobId)) throw Error('Invalid deletion receipt.');
    const original = item.jobId ? join(dataDirectory, item.accountId, item.jobId) : join(dataDirectory, item.accountId);
    rmSync(original, { recursive: true, force: true });
    const deleted = join(dataDirectory, '.deleted'), prefix = item.jobId ?? item.accountId;
    if (existsSync(deleted)) for (const name of readdirSync(deleted)) if (name.startsWith(prefix + '-')) rmSync(join(deleted, name), { recursive: true, force: true });
    for (const request of db.workerRequests ?? []) if (request.owner?.accountId === item.accountId && (!item.jobId || request.owner.workId === item.jobId)) rmSync(join(dataDirectory, 'worker-results', `${request.id}.json`), { force: true });
  }
  for (const item of db.deletions ?? []) finalizeDeletion(item);
  for (const job of db.jobs) access.queueReady(job);
  const budget = createAppBudget(join(dataDirectory, 'daily-budget.json'), { limit: dailyLimit });
  budget.recoverReservations();
  // Register the general catalog before opening histories that refer to its lessons.
  const libraryCatalog = createLibraryCatalog(join(dataDirectory, 'shared-library'), { preparedLibrary });
  const childIdFor = (account, childId = account.activeChildId) => {
    const id = childId ?? 'primary';
    if (!(account.childIds ?? ['primary']).includes(id)) throw new Error('Choose a child in this family.');
    return id;
  };
  const familyFile = (account, childId) => {
    const id = childIdFor(account, childId);
    return id === 'primary' ? join(dataDirectory, account.id, 'family.json') : join(dataDirectory, account.id, 'children', id, 'family.json');
  };
  const memoryFor = (account, childId) => createMemory(familyFile(account, childId));
  const recordForRequest = (account, childId, kitContext) => {
    const primary = childIdFor(account, childId), record = kitContext?.pictureStyleId === undefined ? memoryFor(account, primary).exportRecord() : portraits.recordInStyle(account, primary, pictureStyleIdFor(kitContext.pictureStyleId));
    if (kitContext === undefined) return record; // Earlier saved jobs keep their exact context.
    const ids = kitContext?.siblingChildIds ?? [];
    if (!Array.isArray(ids)) throw new Error('Choose saved siblings from this family.');
    const siblings = ids.map(id => {
      if (id === primary) throw new Error('The main child is already in this story.');
      const sibling = kitContext?.pictureStyleId === undefined ? memoryFor(account, childIdFor(account, id)).exportRecord() : portraits.recordInStyle(account, childIdFor(account, id), pictureStyleIdFor(kitContext.pictureStyleId));
      assertFamilyAllowed(sibling, config);
      if (sibling.real && lockedCast(sibling).some(person => person.referenceSource === 'photo')) assertPhotoAllowed(sibling, config);
      return { id, record: sibling };
    });
    return buildKitRecord(record, { kitContext, siblings });
  };
  const referenceKeys = ['referencePath', 'referenceHash', 'referenceSource', 'portraitCandidateId', 'referenceStyleId', 'referenceStyleVersion'];
  const snapshotReferences = record => ({ pictureStyleId: pictureStyleIdFor(record), lockedOutfit: structuredClone(record.hero.lockedOutfit), cast: lockedCast(record).map(person => Object.fromEntries(['id', 'outfit', ...referenceKeys].filter(key => person[key] !== undefined).map(key => [key, person[key]]))) });
  const recordForJob = (account, job) => {
    const record = recordForRequest(account, job.childId, job.kitContext);
    if (!job.referenceSnapshot) return record;
    record.pictureStyleId = job.referenceSnapshot.pictureStyleId;
    if (job.referenceSnapshot.lockedOutfit) record.hero.lockedOutfit = structuredClone(job.referenceSnapshot.lockedOutfit);
    record.cast = lockedCast(record).map(person => {
      const fixed = job.referenceSnapshot.cast.find(item => item.id === person.id);
      if (!fixed) return person;
      for (const key of referenceKeys) delete person[key];
      // Restore the original snapshot field order after a JSONB round trip.
      // Existing family fingerprints include these fields in that exact order.
      return { ...person, ...structuredClone(Object.fromEntries(['id', 'outfit', ...referenceKeys].filter(key => fixed[key] !== undefined).map(key => [key, fixed[key]]))) };
    });
    record.hero.heroPicturePath = record.cast.find(person => person.id === 'child').referencePath ?? '';
    return record;
  };
  const preserveJobReferences = account => {
    for (const job of db.jobs.filter(job => job.accountId === account.id && job.status !== 'complete' && !job.referenceSnapshot)) job.referenceSnapshot = snapshotReferences(recordForJob(account, job));
    persist();
  };

  for (const account of db.accounts) {
    if (account.needsSetup) { account.childIds = []; continue; }
    account.childIds ??= ['primary']; account.activeChildId ??= 'primary';
    const primary = familyFile(account, 'primary');
    account.pictureStyleId = pictureStyleIdFor(account.pictureStyleId ?? (existsSync(primary) ? readJSON(primary).pictureStyleId : undefined));
    for (const id of account.childIds) {
      const file = familyFile(account, id);
      if (existsSync(file)) {
        const record = readJSON(file), memory = createMemory(file);
        if (repairPresetConflict(record)) { record.pictureStyleId = account.pictureStyleId; memory.store(record); }
        else if (record.pictureStyleId !== account.pictureStyleId) memory.setPictureStyle(account.pictureStyleId);
      }
    }
  }
  for (const job of db.jobs) job.childId ??= 'primary';
  const active = new Map(), cancelled = new Set(), authAttempts = new Map();
  const momentClarification = createMomentClarification({ dataDirectory, recordForRequest, transportFactory, config, budget, readKey: () => readKey(), active, sampleOnly, jobFor: (account, id) => db.jobs.find(job => job.accountId === account.id && job.id === id) });
  for (const job of db.jobs) if (job.status === 'running') { job.status = 'paused'; job.message = 'The Mac restarted. Resume to keep the work already saved.'; }
  persist();
  const canChangePictureStyle = account => !active.has(account.id)
    && !db.jobs.some(job => job.accountId === account.id && job.status !== 'complete')
    && !(db.libraryJobs ?? []).some(job => job.accountId === account.id && ['running', 'paused', 'failed'].includes(job.status))
    && !(db.portraits ?? []).some(job => job.accountId === account.id && job.status !== 'complete')
    && account.childIds.every(id => { const record = memoryFor(account, id).exportRecord(); return !record.pastKits.length && !record.hero.heroPicturePath && !(record.cast ?? []).some(person => person.referencePath || person.portraitCandidateId); });
  const assertStyleChange = (account, id) => {
    // A new-flow family chooses its look only from its first person's drawings.
    if (id !== account.pictureStyleId && account.lookFlow) throw Object.assign(Error(account.lookChoice === 'pending' ? 'Choose your family’s look from the first person’s drawings on Story people.' : 'Your family look is already chosen. Saved drawings keep it.'), { status: 409 });
    if (id !== account.pictureStyleId && !canChangePictureStyle(account)) throw Object.assign(Error('Your family look is already used by saved drawings or unfinished work. Keep this look for this family.'), { status: 409 });
  };
  const savePictureStyle = (account, id) => {
    assertStyleChange(account, id);
    if (id === account.pictureStyleId) return;
    for (const child of account.childIds) memoryFor(account, child).setPictureStyle(id);
    account.pictureStyleId = id; persist();
  };
  const canRepairLayout = job => {
    if (!['failed', 'paused'].includes(job.status) || job.layoutRevision || job.geometryRuleVersion === geometryRuleVersion || job.privateStage !== 'poster-word-check') return false;
    const file = join(dataDirectory, job.accountId, job.id, 'failure.json');
    return existsSync(file) && /insufficient_handwriting_space|text_icon_collision|writ(?:able|ing).*space/i.test(readJSON(file).error?.message ?? '');
  };
  const savedGuideCanResume = job => {
    if (job.failureKind !== 'guide' || !job.guidePreparationJobId) return false;
    try { return library.status(db.accounts.find(account => account.id === job.accountId), job.guidePreparationJobId).canResume === true; }
    catch { return false; }
  };
  const publicJob = job => {
    const owner = db.accounts.find(account => account.id === job.accountId);
    const record = owner ? memoryFor(owner, job.childId).exportRecord() : null;
    const people = record ? jobDisplayPeople(job, record, db.portraits, (job.kitContext?.siblingChildIds ?? []).map(id => owner.childIds.includes(id) ? memoryFor(owner, id).exportRecord().hero.nickname : null)) : [];
    return { people, progress: jobProgress(job, { requests: db.workerRequests, worker: workerBridge?.status(), libraryJobs: db.libraryJobs }), readyEmail: access.readyEmailView(job), id: job.id, childId: job.childId, pictureStyleId: pictureStyleIdFor(job), waitEstimate: kitWaitEstimate, status: job.status, stage: job.stage, message: job.message, canResume: ['failed', 'paused'].includes(job.status) && (job.failureKind === 'budget' ? !budget.status().uncertain && budget.status().spent + budget.status().reserved < dailyLimit : job.canResume !== false || savedGuideCanResume(job) || savedBindingOrderCanResume(job)), canSetAside: ['failed', 'paused'].includes(job.status), canRepairLayout: canRepairLayout(job), moveId: job.moveId, move: job.moveId && record ? moveView(moves.find(move => move.id === job.moveId), record) : null, createdAt: job.createdAt, chapterNumber: job.chapterNumber, feedback: job.feedback, ...(job.result ? { result: job.result } : {}) };
  };
  const assertSelectedChild = (account, data) => {
    if (data.childId !== undefined && data.childId !== childIdFor(account)) throw new Error('Choose this child again. The selected child changed in another tab.');
  };
  const snapshot = account => ({ ...accounts.flags(account), readyEmailEligible: access.readyEmailEligible(account), accountId: account.id, username: account.username, childId: childIdFor(account), pictureStyleId: account.pictureStyleId, canChangePictureStyle: canChangePictureStyle(account) && !account.lookFlow, look: { flow: account.lookFlow ?? null, pending: account.lookChoice === 'pending', revision: account.lookRevision ?? 0 }, children: account.childIds.map(id => { const record = memoryFor(account, id).exportRecord(); return { id, nickname: record.hero.nickname, age: record.hero.age, pictureStyleId: pictureStyleIdFor(record), hasChosenLook: hasChosenLook(record) }; }), record: memoryFor(account).exportRecord(), jobs: db.jobs.filter(job => job.accountId === account.id && job.childId === childIdFor(account)).map(publicJob).reverse(), libraryJobs: (db.libraryJobs ?? []).filter(job => job.accountId === account.id && job.childId === childIdFor(account)).map(job => library.status(account, job.id)).reverse() });
  const publicSnapshot = account => { if (account.needsSetup) return { readyEmailEligible: access.readyEmailEligible(account), accountId: account.id, username: account.username, ...accounts.flags(account), record: null, children: [], jobs: [], libraryJobs: [] }; const data = snapshot(account); const other = db.jobs.find(job => job.accountId === account.id && job.childId !== data.childId && job.status === 'running'); if (other) data.otherRunningChild = data.children.find(child => child.id === other.childId); for (const person of data.record.cast ?? []) delete person.referencePath; delete data.record.hero.heroPicturePath; delete data.record.cachedRequests; return data; };
  function accountFor(req) {
    const token = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('sp_session='))?.slice(11);
    const session = token && db.sessions.find(item => item.hash === digest(token) && item.expires > Date.now());
    return session && db.accounts.find(item => item.id === session.accountId);
  }
  const loginCookie = (account, res) => {
    const token = randomBytes(32).toString('hex');
    db.sessions = db.sessions.filter(item => item.expires > Date.now());
    db.sessions.push({ accountId: account.id, hash: digest(token), expires: Date.now() + 7 * 86400000 }); persist();
    res.setHeader('Set-Cookie', `sp_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${hostedOrigin?.startsWith('https:') ? '; Secure' : ''}`);
  };
  const json = async (res, code, body) => { try { await flush(); } catch { code = 503; body = { message: 'Saving is temporarily unavailable. Please try again shortly.' }; } res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
  async function bodyFor(req, limit = 24000) {
    let bytes = 0, text = '';
    for await (const chunk of req) { bytes += chunk.length; if (bytes > limit) throw new Error('The form is too long.'); text += chunk; }
    return JSON.parse(text || '{}');
  }
  const readKey = subscription ? () => 'ChatGPT subscription' : keyReader ?? (() => {
    const env = process.env.OPENAI_API_KEY?.trim();
    if (env) return env;
    try { return execFileSync('/usr/bin/security', ['find-generic-password', '-a', 'sunny', '-s', 'OPENAI_API_KEY', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { throw new Error('Missing OpenAI key in the Mac Keychain. Use the sample for now.'); }
  });
  // New families choose their look once, from the first person's drawings. The
  // intent is saved first, so a stop halfway is finished before serving again.
  // A chosen drawing must be in the family look. Drawings saved before looks
  // were stamped on them count as the older family's own look.
  const sameLookAs = (account, person) => (person.referenceStyleId ?? (account.lookFlow ? null : account.pictureStyleId)) === account.pictureStyleId;
  const lookFor = account => ({ flow: account.lookFlow ?? null, pending: account.lookChoice === 'pending', revision: account.lookRevision ?? 0, chosenCandidateId: account.lookChosen?.candidateId ?? null });
  const lookHeldBy = account => db.jobs.some(job => job.accountId === account.id)
    || (db.libraryJobs ?? []).some(job => job.accountId === account.id && ['running', 'paused', 'failed'].includes(job.status))
    || account.childIds.some(id => { const record = memoryFor(account, id).exportRecord(); return record.pastKits.length || record.hero.heroPicturePath || (record.cast ?? []).some(person => person.referencePath || person.portraitCandidateId); });
  const finishLookChoice = account => {
    const intent = account.lookSelection;
    for (const child of account.childIds) memoryFor(account, child).setPictureStyle(intent.pictureStyleId);
    portraits.applyChoice(account, intent);
    account.pictureStyleId = intent.pictureStyleId; account.lookChoice = 'chosen'; account.lookRevision = intent.revision;
    account.lookChosen = { jobId: intent.jobId, candidateId: intent.candidateId, childId: intent.childId, personId: intent.personId, pictureStyleId: intent.pictureStyleId, pictureStyleVersion: intent.pictureStyleVersion, chosenAt: intent.createdAt };
    delete account.lookSelection; persist();
  };
  const commitLook = (account, intent) => {
    if (account.lookChoice !== 'pending' || account.lookSelection) throw Object.assign(Error('Your family look is already chosen. Saved drawings keep it.'), { status: 409 });
    if (lookHeldBy(account)) throw Object.assign(Error('Your family already has saved stories or drawings, so its look stays as it is.'), { status: 409 });
    account.lookSelection = { ...intent, createdAt: new Date().toISOString() }; persist();
    finishLookChoice(account);
  };
  const portraits = createPortraits({ db, persist, dataDirectory, active, budget, sampleOnly, memoryFor, childIdFor, readKey, transportFactory, config, allowSyntheticPortraits, lookFor, commitLook, beforeReferenceChange: preserveJobReferences });
  for (const account of db.accounts) if (account.lookSelection) {
    try { finishLookChoice(account); }
    catch (error) {
      // The chosen file is gone or changed: keep the look open and every child on the placeholder.
      console.error(`Family look choice for ${account.id} was not finished: ${error.message}`);
      delete account.lookSelection; for (const child of account.childIds) memoryFor(account, child).setPictureStyle(account.pictureStyleId); persist();
    }
  }
  const library = createLibrary({ db, persist, dataDirectory, active, budget, sampleOnly, memoryFor, childIdFor, readKey, transportFactory, config, catalog: libraryCatalog, preparedLibrary, recordForRequest, ...(librarySearch ? { searchSources: librarySearch } : {}), ...(libraryFetch ? { fetchSource: libraryFetch } : {}) });
  const recordForPick = (account, data) => {
    const record = recordForRequest(account, childIdFor(account), data.kitContext);
    const requested = moves.find(move => move.id === data.requestedMoveId);
    if (!data.libraryJobId && requested?.library && !isPreparedMove(requested)) {
      const completed = (db.libraryJobs ?? []).findLast(job => {
        if (job.accountId !== account.id || job.childId !== childIdFor(account) || job.status !== 'complete' || job.documentId !== requested.id || job.tonight?.trim() !== data.tonight?.trim()) return false;
        try { library.matchingRecord(account, childIdFor(account), data.tonight, job.id, { kitContext: record.kitContext }); return true; } catch { return false; }
      });
      if (completed) data.libraryJobId = completed.id;
    }
    if (!data.libraryJobId) return record;
    let match;
    try { match = library.matchingRecord(account, childIdFor(account), data.tonight, data.libraryJobId, { kitContext: record.kitContext }); }
    catch (error) {
      if (error.code === 'saved_lesson_fit_review_required') error.message = 'Choose a checked teaching guide for this same child and moment again.';
      throw error;
    }
    return { ...record, libraryMatch: { moveId: match.moveId, tonight: match.tonight } };
  };
  const bindLibraryJob = (account, job) => {
    if (!job.libraryJobId) return null;
    const match = library.matchingRecord(account, job.childId, job.tonight, job.libraryJobId, { ...job.libraryBinding, moveId: job.moveId, kitContext: job.kitContext });
    if (!job.libraryBinding) { job.libraryBinding = match; persist(); }
    return { moveId: match.moveId, tonight: match.tonight };
  };
  const bindPreparedJob = (account, job) => {
    const move = moves.find(move => move.id === job.moveId);
    if (!isPreparedMove(move)) return null;
    const record = recordForJob(account, job);
    if (!job.preparedBinding || job.familyFingerprint !== familyFingerprint(record) || !preparePick(record, job.tonight, { allowRepeat: job.allowRepeat }).eligible?.some(item => item.move.id === job.moveId)) throw savedLessonFitFailure({ reason: 'prepared-guide-current-child-or-moment-no-longer-fits' });
    try { return preparedLibrary.assertBinding(job.preparedBinding, move, record, job.tonight); }
    catch { throw savedLessonFitFailure({ reason: 'prepared-guide-source-or-version-changed' }); }
  };
  const savedBindingOrderCanResume = job => {
    // Recover only the legacy false rejection caused by JSONB key ordering.
    // Both bindings still run their full source, family, goal and feedback checks.
    if (job.failureKind !== 'review' || !job.preparedBinding || job.message !== parentJobFailure(savedLessonFitFailure()).message) return false;
    try {
      const account = db.accounts.find(item => item.id === job.accountId);
      bindLibraryJob(account, job);
      const current = bindPreparedJob(account, job);
      return Boolean(current && JSON.stringify(current) !== JSON.stringify(job.preparedBinding));
    } catch { return false; }
  };
  persist();
  async function perform(account, job) {
    const memory = memoryFor(account, job.childId), directory = join(dataDirectory, account.id, job.id);
    const secrets = [], diagnostics = jobDiagnostics(directory, job, secrets);
    job.attempt = (job.attempt ?? 0) + 1; job.privateStage = 'starting';
    job.status = 'running'; job.message = ''; cancelled.delete(job.id);
    try {
      diagnostics.event('started'); persist();
      const prepareGuide = async () => {
        if (!job.autoGuide || job.moveId) return job.moveId;
        job.privateStage = 'library-saved-selection';
        job.message = 'Finding a fitting saved topic first.'; persist();
        const guide = await library.ensureForMoment(account, job.childId, job.tonight, {
          kitContext: job.kitContext, parentJobId: job.id, libraryJobId: job.guidePreparationJobId,
          onLibraryJob: id => { job.guidePreparationJobId = id; persist(); },
          shouldContinue: () => !cancelled.has(job.id),
          onProgress: state => { job.privateStage = typeof state === 'string' ? state : state.stage ?? 'library-research'; job.message = state.message ?? 'Checking a source for this topic. Your family story stays private.'; diagnostics.event('stage'); persist(); },
        });
        if (cancelled.has(job.id)) throw new Error('Kit paused. Resume to keep the work already saved.');
        if (guide.status !== 'complete' || !guide.moveId) throw Object.assign(new Error(guide.message || 'We could not find honest support for this topic. Your note is saved.'), { code: 'guide_preparation_incomplete', canResume: guide.canResume === true });
        job.moveId = guide.moveId; job.libraryJobId = guide.libraryJobId; job.libraryBinding = guide.binding;
        if (guide.preparedBinding) job.preparedBinding = guide.preparedBinding;
        job.message = 'The topic is ready. Writing your family story.'; persist();
        return job.moveId;
      };
      bindLibraryJob(account, job);
      bindPreparedJob(account, job);
      const key = readKey(); if (!key) throw new Error('Missing OpenAI key in the Mac Keychain.');
      secrets.push(key);
      const transport = transportFactory({ config, keys: { openai: key }, maxCalls: 76, logFile: join(directory, 'requests.jsonl'), budget, familyRecordFor: () => { bindLibraryJob(account, job); bindPreparedJob(account, job); return recordForJob(account, job); }, allowSyntheticPortraits });
      transport.allowSavedCheckRetry = job.attempt > 1;
      transport.prepareGuide = prepareGuide;
      transport.onLessonSelected = moveId => {
        const move = moves.find(item => item.id === moveId);
        if (!move || job.moveId && job.moveId !== moveId) throw savedLessonFitFailure({ reason: 'selected-guide-changed' });
        if (isPreparedMove(move) && !job.preparedBinding) job.preparedBinding = preparedLibrary.binding(move, recordForJob(account, job), job.tonight);
        job.moveId = moveId;
        bindLibraryJob(account, job); bindPreparedJob(account, job); persist();
      };
      transport.onStage = stage => {
        if (cancelled.has(job.id)) throw new Error('Kit paused. Resume to keep the work already saved.');
        bindLibraryJob(account, job);
        bindPreparedJob(account, job);
        job.privateStage = stage;
        job.message = '';
        job.stage = advanceJobStage(job.stage, stage);
        diagnostics.event('stage'); persist();
      };
      const original = transport.call.bind(transport);
      transport.call = async request => {
        transport.onStage(request.stage);
        return original(request);
      };
      // Old fictional families create their first checked references inside the
      // kit. Fill those empty slots once; chosen family references stay pinned.
      // Do not write the kit's filtered people or clothes over the family profile.
      const keepKitReferences = supplied => {
        job.referenceSnapshot ??= snapshotReferences(recordForJob(account, job));
        const additions = [];
        for (const person of supplied) {
          const fixed = job.referenceSnapshot.cast.find(item => item.id === person.id);
          if (!fixed) throw Error('This person is not in the saved kit.');
          if (fixed.referencePath) {
            if (person.referencePath !== fixed.referencePath || fixed.referenceHash && person.referenceHash !== fixed.referenceHash) throw Error('The kit’s chosen drawing changed.');
            if (!fixed.referenceHash) {
              if (!existsSync(person.referencePath) || digest(readFileSync(person.referencePath)) !== person.referenceHash) throw Error('The saved kit reference is missing or changed.');
              additions.push({ id: person.id, referencePath: person.referencePath, referenceHash: person.referenceHash });
            }
            continue;
          }
          if (fixed.portraitCandidateId || ['photo', 'description'].includes(fixed.referenceSource)) throw Error('The chosen family drawing is missing.');
          const local = typeof person.referencePath === 'string' ? relative(directory, resolve(person.referencePath)) : '..';
          if (!local || local === '..' || local.startsWith('..' + sep) || resolve(directory, local) !== resolve(person.referencePath) || !existsSync(person.referencePath) || digest(readFileSync(person.referencePath)) !== person.referenceHash) throw Error('The new kit reference is missing or changed.');
          additions.push({ id: person.id, referencePath: person.referencePath, referenceHash: person.referenceHash });
        }
        for (const reference of additions) Object.assign(job.referenceSnapshot.cast.find(person => person.id === reference.id), reference);
        persist();
        if (additions.length) {
          const family = memory.exportRecord();
          const cast = lockedCast(family).map(person => {
            const reference = additions.find(item => item.id === person.id);
            return reference && !person.portraitCandidateId && (!person.referencePath || person.referencePath === reference.referencePath) ? { ...person, ...reference } : person;
          });
          memory.setCast(cast);
        }
        return recordForJob(account, job);
      };
      const kitMemory = { ...memory,
        setHeroPicture: path => keepKitReferences([{ id: 'child', referencePath: path, referenceHash: digest(readFileSync(path)) }]),
        setCast: cast => keepKitReferences(cast),
        exportRecord: () => ({ ...recordForJob(account, job), ...(job.libraryJobId ? { libraryMatch: bindLibraryJob(account, job) } : {}) }),
      };
      const result = await runKit(transport, kitMemory, job.tonight, { kit: job.chapterNumber, chapterNumber: job.chapterNumber, directory, readingArtCacheDirectory: join(dataDirectory, account.id, 'reading-art'), chosenMoveId: job.moveId, allowRepeat: job.allowRepeat, layoutRevision: job.layoutRevision, resume: existsSync(join(directory, 'checkpoint.json')), ...(kitExports ? { exports: kitExports } : {}) });
      accounts.assertCreation(account);
      job.privateStage = 'completion';
      requireCompleteKit(result);
      for (const file of ['poster.png', 'poster.pdf', 'kit_final.pdf']) if (!existsSync(join(directory, file))) throw new Error('Kit export file is missing.');
      if (!memory.exportRecord().pastKits.some(kit => kit.chapterNumber === job.chapterNumber)) memory.addKit({ date: centralDay(new Date(job.createdAt)), chapterNumber: job.chapterNumber, moveId: result.moveId, triedMove: 'unanswered', didItHelp: 'unanswered', adventureLine: adventureLine(result.story, learningActor(result.recordAtStart).storyName), world: result.world, colourSet: result.colourSet, keyWord: result.move.keyWord, keyWordMeaning: result.move.positiveAction, tagline: result.tagline, storyMode: result.recordAtStart.kitContext?.storyMode ?? 'inspired', focusPersonId: result.recordAtStart.kitContext?.focusPersonId ?? 'child' });
      job.moveId = result.moveId;
      job.result = resultView(result, result.move, result.recordAtStart); job.status = 'complete'; job.stage = 'ready'; job.message = 'Your kit is ready.';
      persist(); await flush(); access.queueReady(job);
      diagnostics.event('complete');
    } catch (error) {
      job.status = cancelled.has(job.id) ? 'paused' : 'failed'; const failure = parentJobFailure(error, job.privateStage); job.message = failure.message; job.canResume = failure.canResume; job.failureKind = failure.kind;
      try { diagnostics.failure(error); }
      catch { job.diagnosticWriteError = 'Failure files could not be written; the real reason is in lastFailure in accounts.json.'; }
    }
    finally { persist(); active.delete(account.id); }
  }
  const startJob = (account, job) => {
    // Set the lock before starting asynchronous work, even when the key is missing.
    active.set(account.id, job.id); job.status = 'running'; job.message = ''; persist();
    Promise.resolve().then(flush).then(() => perform(account, job)).catch(() => { active.delete(account.id); job.status = 'paused'; job.message = 'Saving is temporarily unavailable. Resume when the service returns.'; });
  };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost'), path = url.pathname;
      if (path === '/health' && req.method === 'GET') return json(res, 200, { ok: true });
      const expectedHost = `127.0.0.1:${server.address()?.port}`;
      const allowedHosts = [expectedHost, `localhost:${server.address()?.port}`, ...(hostedOrigin ? [new URL(hostedOrigin).host] : [])];
      if (!allowedHosts.includes(req.headers.host)) return json(res, 403, { message: 'Open this app through its local address.' });
      if (!['GET', 'HEAD'].includes(req.method)) {
        stateStore?.assertWritable();
        const origin = req.headers.origin;
        if (origin && ![`http://${expectedHost}`, `http://localhost:${server.address()?.port}`, ...(hostedOrigin ? [hostedOrigin] : [])].includes(origin)) return json(res, 403, { message: 'Use the form in this app.' });
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(res, 415, { message: 'Use the form in this app.' });
      }
      if (path.startsWith('/api/worker/')) {
        if (!workerBridge || req.method !== 'POST') return json(res, 404, { message: 'Worker not available.' });
        return json(res, 200, await workerBridge.handle(path, await bodyFor(req, 64 * 1024 * 1024), req.headers.authorization));
      }
      const account = accountFor(req);
      const expectedAccount = req.headers['x-story-poster-account'];
      const discovery = ['/api/session', '/api/config', '/api/login', '/api/signup', '/api/sample', '/api/access-requests', '/api/invitations/inspect'].includes(path) || path.startsWith('/api/sample/');
      if (path.startsWith('/api/') && !discovery && expectedAccount && account && expectedAccount !== account.id) return json(res, 409, { code: 'FAMILY_SESSION_CHANGED', message: 'The family login changed. Open the current family to continue.' });
      if (path === '/api/config' && req.method === 'GET') {
        let photoAllowed = false;
        if (account && !account.needsSetup && !sampleOnly) try { assertPhotoAllowed(memoryFor(account).exportRecord(), config, { allowSyntheticPortraits }); photoAllowed = true; } catch {}
        return json(res, 200, { accessRequests: { enabled: inviteOnly && !sampleOnly }, signup: { mode: inviteOnly ? 'request' : 'open', requiresInvitation: inviteOnly, enabled: !sampleOnly && !!publicOrigin && sendMail.available === true, limit: accountLimit, available: db.accounts.length < accountLimit, remaining: Math.max(0, accountLimit - db.accounts.length), emailAvailable: sendMail.available === true, message: !sendMail.available ? 'Email signup is not ready yet. Existing families can still sign in.' : db.accounts.length >= accountLimit ? 'The showcase is full for now. Existing families can still sign in.' : '' }, ownerReviewNotice: 'Sunny can review finished kits during this showcase. This review screen does not show your original notes or uploaded photos.', worker: workerBridge?.status() ?? { mode: 'local' }, zeroRetentionApproved: config.zeroRetentionApproved, realFamiliesApproved: subscription || config.zeroRetentionApproved, generationRoute, standardDataPolicyAllowed: config.standardDataPolicyAllowed, familyDataSetupAllowed: config.familyDataSetupAllowed, realFamilySetupAllowed: config.familyDataSetupAllowed && (config.zeroRetentionApproved || config.standardDataPolicyAllowed) && !sampleOnly, dataPolicyVersion: policyVersion, dataPolicyNotice: policyNotice, dataPolicyURL: policyURL, photoUploadsApproved: photoAllowed, syntheticPortraits: allowSyntheticPortraits && !sampleOnly, photoMaxBytes: photoByteLimit, portraitDescriptionMaxLength, sampleOnly, sampleAvailable: Boolean(sample), presets: heroPresets, waitEstimate: kitWaitEstimate, daily: budget.status() });
      }
      if (path === '/api/sample' && req.method === 'GET') return sample ? json(res, 200, { ...resultView(sample.text, sample.move ?? moves.find(item => item.id === sample.text.moveId), sample.record, true), ...(sample.printCopy ? { printCopy: sample.printCopy } : {}), ...(sampleNarration ? { narration: { src: sampleNarration.src, seconds: sampleNarration.seconds } } : {}) }) : json(res, 404, { message: 'No completed sample is saved on this Mac yet.' });
      if (path === '/api/session' && req.method === 'GET') return json(res, 200, account ? publicSnapshot(account) : { record: null });
      if (path === '/api/access-requests' || path === '/api/invitations/inspect') {
        if (req.method !== 'POST') return json(res, 405, { message: 'Use the form in this app.' });
        if (sampleOnly) return json(res, 403, { message: 'Access requests are not open in this preview.' });
        const key = `access:${req.socket.remoteAddress}`, attempt = authAttempts.get(key) ?? { since: Date.now(), count: 0 };
        if (Date.now() - attempt.since > 60000) { attempt.since = Date.now(); attempt.count = 0; }
        attempt.count++; authAttempts.set(key, attempt);
        if (attempt.count > 15) return json(res, 429, { message: 'Please wait a minute before trying again.' });
        const data = await bodyFor(req);
        const result = path === '/api/access-requests' ? access.requestAccess(data) : access.inspectPublic(data.token);
        await flush(); return json(res, path === '/api/access-requests' ? 202 : 200, result);
      }
      if (path.startsWith('/api/auth/') || ['/api/signup', '/api/login'].includes(path)) {
        if (req.method !== 'POST') return json(res, 405, { message: 'Use the form in this app.' });
        const data = await bodyFor(req);
        const identifier = String(data.email ?? data.username ?? '').trim().toLowerCase();
        // The hosted proxy address is shared; throttle on the account identifier as well.
        const rateKey = `${req.socket.remoteAddress}:${identifier || account?.id || 'link'}`;
        const tries = authAttempts.get(rateKey) ?? { since: Date.now(), count: 0 };
        if (Date.now() - tries.since > 60000) { tries.since = Date.now(); tries.count = 0; }
        tries.count++; authAttempts.set(rateKey, tries);
        if (authAttempts.size > 2000) for (const [key, value] of authAttempts) if (Date.now() - value.since > 60000) authAttempts.delete(key);
        if (tries.count > 15) return json(res, 429, { message: 'Please wait a minute before trying again.' });
        if (path === '/api/auth/verify') { accounts.consume(data.token, 'verify'); return json(res, 200, { ok: true, message: 'Your email is confirmed. You can sign in and make stories.' }); }
        if (path === '/api/auth/reset-password') { accounts.consume(data.token, 'reset', data.password); return json(res, 200, { ok: true, message: 'Your password is changed. Sign in to return to your saved stories.' }); }
        if (path === '/api/auth/forgot-password') {
          const user = db.accounts.find(item => item.email && item.email === emailAddress(identifier));
          if (user) try { await accounts.issue(user, 'reset'); } catch { (db.mailFailures ??= []).push({ accountId: user.id, kind: 'recovery', at: new Date().toISOString(), reason: 'provider-unavailable' }); persist(); }
          return json(res, 200, { ok: true, message: 'If that email has an account, a recovery link has been sent.' });
        }
        if (path === '/api/auth/resend-verification') {
          if (!account) return json(res, 401, { message: 'Sign in to request another email.' });
          if (account.email && !account.emailVerified) await accounts.issue(account, 'verify');
          return json(res, 200, { ok: true, message: 'Check your email for the confirmation link.' });
        }
        if (!['/api/signup', '/api/login'].includes(path)) return json(res, 404, { message: 'This page is not available.' });
        const email = emailAddress(identifier), legacy = /^[a-z0-9_-]{3,32}$/.test(identifier);
        if (!email && !legacy || typeof data.password !== 'string' || data.password.length < 8 || data.password.length > 128) return json(res, 400, { message: 'Use your email address and a password of at least 8 characters. Existing family logins still work.' });
        let user = db.accounts.find(item => item.username === identifier || item.email === identifier);
        if (path === '/api/signup') {
          const admission = inviteOnly ? access.inspect(data.inviteToken, email ?? '') : null;
          if (hostedOrigin && (!email || !sendMail.available && !admission)) return json(res, 503, { message: 'Email signup is not ready yet. Existing families can still sign in.' });
          if (user) return json(res, 409, { message: 'That account already exists. Sign in or reset your password.' });
          if (db.accounts.length >= accountLimit) return json(res, 409, { message: 'The showcase is full for now. Existing families can still sign in.' });
          if (data.lookFlow !== undefined && data.lookFlow !== lookFlowVersion) return json(res, 400, { message: 'Reload the page and set up your family again.' });
          const id = randomUUID(), lookFlow = data.lookFlow === lookFlowVersion;
          const record = data.family ? setupRecord(lookFlow ? { ...data.family, pictureStyleId: defaultPictureStyleId } : data.family, config) : null;
          if (!record && !email) return json(res, 400, { message: 'Use your email address to create an account.' });
          if (record) createMemory(join(dataDirectory, id, 'family.json')).store(record);
          user = { id, username: identifier, ...(email ? { email, emailVerified: false } : {}), createdAt: new Date().toISOString(), creationEnabled: true, needsSetup: !record, pictureStyleId: record?.pictureStyleId ?? defaultPictureStyleId, ...(lookFlow ? { lookFlow: lookFlowVersion, lookChoice: 'pending', lookRevision: 0 } : {}), childIds: record ? ['primary'] : [], activeChildId: record ? 'primary' : null, ...passwordFields(data.password) };
          if (admission) access.redeem(admission, user);
          db.accounts.push(user); persist(); await flush();
          loginCookie(user, res);
          if (email && !admission) try { await accounts.issue(user, 'verify'); } catch (error) { return json(res, 200, { ...publicSnapshot(user), emailMessage: error.message }); }
        } else {
          if (!passwordMatches(user, data.password)) return json(res, 401, { message: 'The login or password did not match.' });
          loginCookie(user, res);
        }
        return json(res, 200, publicSnapshot(user));
      }
      if (path === '/api/logout' && req.method === 'POST') {
        const token = req.headers.cookie?.match(/sp_session=([^;]+)/)?.[1];
        if (token) db.sessions = db.sessions.filter(item => item.hash !== digest(token)); persist();
        res.setHeader('Set-Cookie', 'sp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(res, 200, { ok: true });
      }
      if (path === '/api/quick-pick' && req.method === 'POST') return json(res, 200, pickView({ pastKits: [] }, await bodyFor(req)));
      if (path.startsWith('/api/') && !path.startsWith('/api/sample/') && !account) return json(res, 401, { message: 'Sign in to your local family first.' });
      if (path === '/api/invitations' && req.method === 'GET') return json(res, 200, access.invitationStatus(account));
      if (path === '/api/invitations' && req.method === 'POST') { const result = access.createInvitation(account, await bodyFor(req)); await flush(); return json(res, result.created ? 201 : 200, result); }
      const resendInvitation = path.match(/^\/api\/invitations\/([a-f0-9-]{36})\/send$/);
      if (resendInvitation && req.method === 'POST') { const result = access.resend(account, resendInvitation[1]); await flush(); return json(res, 200, result); }
      if (path === '/api/family/setup' && req.method === 'POST') {
        if (!account.needsSetup) return json(res, 409, { message: 'Your family is already set up. Open Family to change it.' });
        const data = await bodyFor(req);
        const record = setupRecord({ ...data.family, pictureStyleId: defaultPictureStyleId }, config);
        createMemory(join(dataDirectory, account.id, 'family.json')).store(record);
        Object.assign(account, { needsSetup: false, childIds: ['primary'], activeChildId: 'primary', pictureStyleId: record.pictureStyleId, lookFlow: lookFlowVersion, lookChoice: 'pending', lookRevision: 0 });
        persist(); return json(res, 200, publicSnapshot(account));
      }
      if (path.startsWith('/api/owner/')) {
        if (!accounts.isOwner(account)) return json(res, 403, { message: 'This view is for the showcase owner.' });
        if (path === '/api/owner/access-requests' && req.method === 'GET') return json(res, 200, { requests: access.list(), notificationConfig: access.notificationConfig() });
        const accessDecision = path.match(/^\/api\/owner\/access-requests\/([a-f0-9-]{36})\/decision$/);
        if (accessDecision) { if (req.method !== 'POST') return json(res, 405, { message: 'Use the approve or decline button.' }); const data = await bodyFor(req); const result = access.decide(accessDecision[1], data.decision, account.id); await flush(); return json(res, 200, result); }
        if (path === '/api/owner/judge-account') {
          if (req.method !== 'POST') return json(res, 405, { message: 'Use the judge account setup action.' });
          const result = accounts.prepareJudge(account, await bodyFor(req)); await flush(); return json(res, 200, result);
        }
        if (path === '/api/owner/suggestions' && req.method === 'GET') return json(res, 200, { suggestions: suggestions.list() });
        if (path === '/api/owner/accounts' && req.method === 'GET') return json(res, 200, { accounts: accounts.publicAccounts() });
        const target = path.match(/^\/api\/owner\/accounts\/([a-f0-9-]{36})$/);
        if (target && req.method === 'PATCH') {
          const data = await bodyFor(req), found = db.accounts.find(item => item.id === target[1]);
          if (!found) return json(res, 404, { message: 'Account not found.' });
          if (typeof data.creationEnabled !== 'boolean') return json(res, 400, { message: 'Choose whether new stories are allowed.' });
          found.creationEnabled = data.creationEnabled; persist(); return json(res, 200, { accounts: accounts.publicAccounts() });
        }
        const completed = db.jobs.filter(job => job.status === 'complete' && job.result);
        if (path === '/api/owner/kits' && req.method === 'GET') return json(res, 200, { kits: completed.map(job => ({ id: job.id, accountId: job.accountId, createdAt: job.createdAt, chapterNumber: job.chapterNumber, result: job.result })) });
        const asset = path.match(/^\/api\/owner\/kits\/([a-f0-9-]{36})\/files\/([^/]+)$/);
        const job = asset && completed.find(item => item.id === asset[1]);
        if (job && req.method === 'GET') return serveFile(req, res, join(dataDirectory, job.accountId, job.id), asset[2], true, url.searchParams.get('download') === '1');
        return json(res, 404, { message: 'That finished kit is not available.' });
      }
      if (account?.needsSetup && path.startsWith('/api/')) return json(res, 409, { message: 'Add your story people first.', needsSetup: true });
      if (path === '/api/moment/clarify' && req.method === 'POST') {
        const data = await bodyFor(req); assertSelectedChild(account, data); accounts.assertCreation(account, { newStory: true });
        await flush(); return json(res, 200, await momentClarification.assess(account, data));
      }
      if (path === '/api/family/consent' && req.method === 'POST') {
        const data = await bodyFor(req); assertSelectedChild(account, data);
        if (typeof data.accepted !== 'boolean' || data.version !== policyVersion) throw new Error('Read the current OpenAI data notice before changing your permission.');
        const consent = data.accepted ? recordDataConsent(data, () => new Date(), policyVersion) : { accepted: false, version: policyVersion, revokedAt: new Date().toISOString() };
        memoryFor(account, childIdFor(account, data.childId)).setDataPolicyConsent(consent);
        return json(res, 200, publicSnapshot(account));
      }
      if (path === '/api/family/style' && req.method === 'POST') {
        const data = await bodyFor(req); assertSelectedChild(account, data);
        if (typeof data.pictureStyleId !== 'string' || !data.pictureStyleId) throw Object.assign(Error('Choose one of the three story looks.'), { status: 400 });
        savePictureStyle(account, pictureStyleIdFor(data.pictureStyleId));
        return json(res, 200, publicSnapshot(account));
      }
      if (path === '/api/library' && req.method === 'GET') {
        const documents = library.list(), record = memoryFor(account).exportRecord();
        const entries = moves.map(move => {
          const document = documents.find(item => item.id === move.id), science = scienceFor(move), prepared = isPreparedMove(move);
          let applicability = prepared ? preparedApplicability(move, record) : { label: move.library ? 'Checked for its saved general goal' : 'Starting library, ages eight through thirteen', eligible: true, reason: 'The current moment and action history still need to fit.' };
          let currentSourceStatuses = [];
          if (prepared) {
            try { currentSourceStatuses = preparedLibrary.sourceStatuses(document); preparedLibrary.assertCurrent(document); }
            catch { applicability = { ...applicability, eligible: false, reason: 'The source check needs review before this guide can be used again.' }; }
          }
          return { id: move.id, kind: prepared ? 'prepared' : move.library ? 'general' : 'original', title: document?.title ?? move.name, positiveAction: positiveActionFor(move), practiceScript: practiceFor(move), science: { claim: science.claim, limitation: science.limitation, reviewLabel: science.reviewLabel, ownerApproved: science.approval?.status === 'approved' }, sources: move.sources.map(source => ({ title: source.title, year: source.year, ...(source.dateLabel ? { dateLabel: source.dateLabel, dateNotStated: source.dateNotStated === true } : {}), ...(source.sourceType ? { sourceType: source.sourceType } : {}), ...(source.audit ? { audit: source.audit } : {}), ...(source.sourceStatus ? { notices: (currentSourceStatuses.find(item => item.id === source.sourceId)?.status ?? source.sourceStatus).notices, correctionDisposition: (currentSourceStatuses.find(item => item.id === source.sourceId)?.status ?? source.sourceStatus).correctionDisposition, checkedOn: (currentSourceStatuses.find(item => item.id === source.sourceId)?.status ?? source.sourceStatus).checkedAt, sourceState: (currentSourceStatuses.find(item => item.id === source.sourceId)?.status ?? source.sourceStatus).state } : {}), limitation: source.limitation, plainFit: evidenceLabelFor(source.fitLabel), url: source.url ?? (source.doi ? `https://doi.org/${source.doi}` : `https://pubmed.ncbi.nlm.nih.gov/${source.pubmed}/`), contentScope: source.contentScope ?? 'Original source record. See its stated limits.' })), review: document ? { status: document.review.status, writer: document.review.writer, judge: document.review.judge, ownerApproved: document.review.ownerApproved, scope: document.review.scope } : { status: 'original-record', writer: null, judge: null, ownerApproved: science.approval?.status === 'approved', scope: 'Original source record. See its stated limits.' }, applicability, canCheck: true };
        });
        return json(res, 200, { documents, entries });
      }
      if (path === '/api/library/jobs' && req.method === 'POST') {
        accounts.assertCreation(account);
        const data = await bodyFor(req); assertSelectedChild(account, data);
        if (data.preferPrepared === true && data.researchNewGoal !== true) {
          const picked = pickView(recordForPick(account, data), data);
          return json(res, 200, { ...picked, preparedAvailable: picked.status === 'eligible', ...(data.libraryJobId ? { libraryJobId: data.libraryJobId } : {}) });
        }
        if (!canLeadKit(memoryFor(account).exportRecord())) return json(res, 200, { status: 'noMatch', reason: 'supporting-profile', canRepeat: false, message: 'Choose a child aged 8 to 13 to prepare a learning guide. This profile can join another story.' });
        return json(res, 202, library.start(account, childIdFor(account), data.tonight?.trim(), { kitContext: data.kitContext }));
      }
      const libraryJob = path.match(/^\/api\/library\/jobs\/([a-f0-9-]{36})(\/resume)?$/);
      if (libraryJob && req.method === 'GET' && !libraryJob[2]) return json(res, 200, library.status(account, libraryJob[1]));
      if (libraryJob && req.method === 'POST' && libraryJob[2]) { accounts.assertCreation(account); return json(res, 202, library.resume(account, libraryJob[1])); }
      if (path === '/api/story-looks' && req.method === 'GET') return json(res, 200, { previews: portraits.previews(account, url.searchParams.get('childId') ?? undefined) });
      if (path === '/api/portraits' && req.method === 'GET') return json(res, 200, portraits.list(account, url.searchParams.get('childId') ?? undefined, url.searchParams.get('pictureStyleId') ?? undefined));
      const portraitDraft = path.match(/^\/api\/portraits\/(child|grown-up-(?:one|two|three|four))\/draft$/);
      if (portraitDraft && req.method === 'PATCH') {
        if (sampleOnly) return json(res, 403, { message: 'Descriptions cannot be saved in this preview.' });
        const data = await bodyFor(req, 24000); assertSelectedChild(account, data);
        const result = portraits.saveDraft(account, portraitDraft[1], data); await flush(); return json(res, 200, result);
      }
      const portraitMatch = path.match(/^\/api\/portraits\/(child|grown-up-(?:one|two|three|four))(\/select)?$/);
      if (portraitMatch && req.method === 'POST') {
        // Private real-family permission applies to either appearance input.
        // The portrait worker checks the chosen mode before credentials or sends.
        if (!portraitMatch[2]) accounts.assertCreation(account);
        if (!portraitMatch[2]) try { assertFamilyAllowed(memoryFor(account).exportRecord(), config); }
        catch (error) { throw Object.assign(error, { status: error.status ?? 403 }); }
        const data = await bodyFor(req, portraitMatch[2] ? 24000 : photoJSONLimit);
        assertSelectedChild(account, data);
        return json(res, portraitMatch[2] ? 200 : 202, portraitMatch[2] ? portraits.select(account, portraitMatch[1], data) : await portraits.start(account, portraitMatch[1], data));
      }
      const portraitAsset = path.match(/^\/api\/portrait-assets\/([a-f0-9-]{36})\/([a-f0-9-]{36})(\/preview\.webp)?$/);
      if (portraitAsset && req.method === 'GET') {
        if (portraitAsset[3]) {
          const source = portraits.assetFile(account, portraitAsset[1], portraitAsset[2]);
          const preview = await browserPreviews.previewFile({ source: source.path, width: 640, isCurrent: source.isCurrent });
          return serveFile(req, res, preview.directory, preview.name, false, false, 'private, no-cache');
        }
        const bytes = portraits.asset(account, portraitAsset[1], portraitAsset[2]);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' }); return res.end(bytes);
      }
      if (path === '/api/children' && req.method === 'POST') {
        const data = await bodyFor(req), id = randomUUID();
        // Validate/store before changing the selected child. A running kit keeps
        // its original child id and memory; switching cannot redirect its writes.
        const requestedStyle = data.family?.pictureStyleId === undefined ? account.pictureStyleId : pictureStyleIdFor(data.family);
        if (requestedStyle !== account.pictureStyleId) throw Object.assign(Error('Use the same family look for every child.'), { status: 409 });
        const nextRecord = setupRecord({ ...data.family, pictureStyleId: account.pictureStyleId }, config, { allowSupportingChild: true });
        if (data.reuseGrownUpsFromChildId !== undefined) {
          const sourceRecord = memoryFor(account, childIdFor(account, data.reuseGrownUpsFromChildId)).exportRecord();
          for (const person of nextRecord.cast.filter(person => person.role === 'grown-up')) {
            const label = nextRecord.storyPeople.find(item => item.castId === person.id)?.storyName;
            const matches = (sourceRecord.cast ?? []).filter(saved => saved.role === 'grown-up' && ['photo', 'description'].includes(saved.referenceSource) && saved.referencePath && saved.referenceHash && sameLookAs(account, saved) && sourceRecord.storyPeople?.find(item => item.castId === saved.id)?.storyName === label && JSON.stringify([saved.pronouns, saved.description, saved.outfit]) === JSON.stringify([person.pronouns, person.description, person.outfit]));
            if (matches.length === 1) {
              const saved = matches[0];
              Object.assign(person, { referencePath: saved.referencePath, referenceHash: saved.referenceHash, referenceSource: saved.referenceSource, portraitCandidateId: saved.portraitCandidateId, ...(saved.referenceStyleId ? { referenceStyleId: saved.referenceStyleId } : {}), ...(saved.referenceStyleVersion ? { referenceStyleVersion: saved.referenceStyleVersion } : {}) });
            }
          }
        }
        createMemory(join(dataDirectory, account.id, 'children', id, 'family.json')).store(nextRecord);
        account.childIds.push(id); account.activeChildId = id; persist();
        return json(res, 200, publicSnapshot(account));
      }
      if (path === '/api/children/current' && req.method === 'PATCH') {
        const data = await bodyFor(req);
        account.activeChildId = childIdFor(account, data.childId); persist();
        return json(res, 200, publicSnapshot(account));
      }
      if (path === '/api/family' && req.method === 'PATCH') {
        if (active.has(account.id)) return json(res, 409, { message: 'Pause the current kit before editing family notes.' });
        const data = await bodyFor(req); assertSelectedChild(account, data);
        const memory = memoryFor(account);
        const current = memory.exportRecord();
        if (data.family) {
          if (data.appearanceDraftVersions !== undefined) {
            if (!Array.isArray(data.appearanceDraftVersions) || data.appearanceDraftVersions.length > 5) throw new Error('Check the saved appearance descriptions.');
            const people = portraits.list(account, childIdFor(account)).people;
            for (const version of data.appearanceDraftVersions) {
              if (!version || typeof version.id !== 'string') throw new Error('Check the saved appearance descriptions.');
              const person = people.find(item => item.id === version.id);
              const matches = version.isNew === true ? !person : person && version.personIdentity === person.personIdentity && version.revision === (person.draft?.revision ?? 0);
              if (!matches) return json(res, 409, { message: 'This person or description changed in another window. Reopen their details before saving.' });
            }
          }
          const requestedStyle = data.family.pictureStyleId === undefined ? account.pictureStyleId : pictureStyleIdFor(data.family);
          assertStyleChange(account, requestedStyle);
          const next = setupRecord({ ...data.family, pictureStyleId: requestedStyle }, config, { allowSupportingChild: true });
          const sameHero = JSON.stringify([next.hero.lookChips, next.hero.lockedOutfit, next.hero.age, next.hero.pronouns]) === JSON.stringify([current.hero.lookChips, current.hero.lockedOutfit, current.hero.age, current.hero.pronouns]);
          if (sameHero) next.hero.heroPicturePath = current.hero.heroPicturePath;
          for (const person of next.cast) {
            const saved = current.cast?.find(item => item.id === person.id);
            const sameDrawing = ['photo', 'description'].includes(saved?.referenceSource) ? saved.role === person.role && JSON.stringify(saved.outfit) === JSON.stringify(person.outfit) : saved && (person.role !== 'child' || sameHero) && JSON.stringify([saved.description, saved.outfit, saved.pronouns]) === JSON.stringify([person.description, person.outfit, person.pronouns]);
            if (sameDrawing) Object.assign(person, { referencePath: saved.referencePath, ...(saved.referenceHash ? { referenceHash: saved.referenceHash } : {}), ...(saved.referenceSource ? { referenceSource: saved.referenceSource, portraitCandidateId: saved.portraitCandidateId } : {}), ...(saved.referenceStyleId ? { referenceStyleId: saved.referenceStyleId } : {}), ...(saved.referenceStyleVersion ? { referenceStyleVersion: saved.referenceStyleVersion } : {}) });
          }
          if (['photo', 'description'].includes(next.cast[0].referenceSource)) next.hero.heroPicturePath = next.cast[0].referencePath;
          next.pastKits = current.pastKits.map(kit => ({ ...kit, adventureLine: '' })); next.usedMoveIds = current.usedMoveIds;
          memory.store(next); portraits.pruneDrafts(account, childIdFor(account)); savePictureStyle(account, requestedStyle);
        } else {
          if (typeof data.familyContext !== 'string' || data.familyContext.length > 4000) throw new Error('Please check family notes.');
          current.familyContext = data.familyContext; current.pastKits = current.pastKits.map(kit => ({ ...kit, adventureLine: '' })); memory.store(current);
        }
        return json(res, 200, publicSnapshot(account));
      }
      if (path === '/api/family' && req.method === 'DELETE') {
        if (active.has(account.id)) return json(res, 409, { message: 'Pause the current kit before deleting the family.' });
        db.authTokens = db.authTokens.filter(item => item.accountId !== account.id); db.storyReservations = db.storyReservations.filter(item => item.accountId !== account.id);
        db.accounts = db.accounts.filter(item => item.id !== account.id); db.sessions = db.sessions.filter(item => item.accountId !== account.id); db.jobs = db.jobs.filter(item => item.accountId !== account.id); db.portraits = db.portraits.filter(item => item.accountId !== account.id); db.portraitSelections = (db.portraitSelections ?? []).filter(item => item.accountId !== account.id); db.portraitDrafts = (db.portraitDrafts ?? []).filter(item => item.accountId !== account.id);
        db.libraryJobs = db.libraryJobs.filter(item => item.accountId !== account.id);
        practice.remove(account.id); suggestions.remove(account.id); db.accessDeliveries = db.accessDeliveries.filter(row => row.kind !== 'kit-ready' || row.accountId !== account.id);
        const deletion = { accountId: account.id, deletedAt: new Date().toISOString() }; (db.deletions ??= []).push(deletion); persist(); await flush();
        const deleted = join(dataDirectory, '.deleted'); mkdirSync(deleted, { recursive: true, mode: 0o700 });
        if (existsSync(join(dataDirectory, account.id))) renameSync(join(dataDirectory, account.id), join(deleted, `${account.id}-${Date.now()}`));
        finalizeDeletion(deletion);
        return json(res, 200, { ok: true });
      }
      if (path === '/api/pick' && req.method === 'POST') {
        const data = await bodyFor(req); assertSelectedChild(account, data);
        return json(res, 200, { ...pickView(recordForPick(account, data), data), ...(data.libraryJobId ? { libraryJobId: data.libraryJobId } : {}) });
      }
      if (path === '/api/jobs' && req.method === 'POST') {
        const originalData = await bodyFor(req), data = momentClarification.resolvedInput(account, originalData); assertSelectedChild(account, data);
        accounts.assertCreation(account, { newStory: true });
        if (data.notifyWhenReady !== undefined && typeof data.notifyWhenReady !== 'boolean') throw Object.assign(Error('Choose whether to email when this kit is ready.'), { status: 400 });
        if (data.notifyWhenReady === true && !access.readyEmailEligible(account)) throw Object.assign(Error('A confirmed email is needed for a ready notice.'), { status: 409 });
        if (active.has(account.id)) return json(res, 409, { message: 'A kit is already running. Open My kits to return to it.', ...(db.jobs.some(job => job.id === active.get(account.id)) ? { job: publicJob(db.jobs.find(job => job.id === active.get(account.id))) } : {}) });
        if (sampleOnly) return json(res, 503, { message: 'This preview makes no paid calls. Open the saved sample, or start the normal app to make a new kit.' });
        if (typeof data.tonight !== 'string' || !data.tonight.trim() || data.tonight.length > 2000) throw new Error('Please check tonight’s sentence.');
        let familyRecord = recordForPick(account, { ...data, kitContext: data.kitContext ?? {} });
        // Automatic evening stories may revisit a fitting skill. Novelty is not
        // a reason to reject it after the writer has already chosen it.
        const allowRepeat = data.moveId === undefined || data.allowRepeat === true;
        const pick = preparePick(familyRecord, data.tonight, { allowRepeat, chosenMoveId: data.moveId });
        if (moves.some(move => move.id === data.moveId && move.library && !isPreparedMove(move)) && familyRecord.libraryMatch?.moveId !== data.moveId) throw new Error('Choose a checked guide for this child and moment.');
        if (pick.status !== 'eligible') return json(res, 200, pick);
        if (!canLeadKit(familyRecord)) return json(res, 200, { status: 'noMatch', reason: 'supporting-profile', canRepeat: false, message: 'This child can join another family story. Choose a child aged 8 to 13 to lead a learning kit.' });
        if ((familyRecord.real || data.kitContext?.pictureStyleId !== undefined) && (familyRecord.cast ?? []).some(person => !['photo', 'description'].includes(person.referenceSource) || !person.referenceHash || !person.referencePath)) return json(res, 409, { message: 'Choose a story drawing for each person, from a photo or appearance description, before making your family kit.' });
        // No scenery is drawn in a placeholder look, and no person is drawn in another look.
        if (account.lookChoice === 'pending') return json(res, 409, { message: 'Choose your family’s look first. On Story people, see the first person in three looks and pick one.' });
        if ((familyRecord.cast ?? []).some(person => person.portraitCandidateId && (person.referenceStyleId ?? account.pictureStyleId) !== pictureStyleIdFor(familyRecord))) return json(res, 409, { message: 'One story drawing is in a different look from your family look. Make that person’s drawing again on Story people.' });
        if (data.moveId !== undefined && !pick.eligible.some(item => item.move.id === data.moveId)) throw new Error('Choose an available teaching guide.');
        if (!subscription && (budget.status().uncertain || dailyLimit - budget.status().spent - budget.status().reserved < newKitAllowance)) return json(res, 429, { message: 'Daily budget reached for a new kit. Your saved kits and the sample are still here. Try again tomorrow.' });
        const previous = db.jobs.filter(job => job.accountId === account.id && job.childId === childIdFor(account) && ['failed', 'paused'].includes(job.status) && existsSync(join(dataDirectory, account.id, job.id, 'checkpoint.json')));
        if (previous.length) return json(res, 409, { message: 'Open the unfinished kit in My kits first. Resume it or keep it and set it aside.' });
        const jobId = randomUUID();
        familyRecord = withStoryOutfits(familyRecord, jobId);
        const job = { notifyWhenReady: data.notifyWhenReady === true, id: jobId, accountId: account.id, childId: childIdFor(account), pictureStyleId: pictureStyleIdFor(familyRecord), referenceSnapshot: snapshotReferences(familyRecord), status: 'running', stage: 'writing', tonight: data.tonight.trim(), moveId: data.moveId, allowRepeat, kitContext: familyRecord.kitContext, autoGuide: data.moveId === undefined, familyFingerprint: familyFingerprint(familyRecord), portraitFingerprint: portraitFingerprint(familyRecord), chapterNumber: Math.max(0, ...memoryFor(account).exportRecord().pastKits.map(kit => kit.chapterNumber), ...db.jobs.filter(item => item.accountId === account.id && item.childId === childIdFor(account)).map(item => item.chapterNumber)) + 1, createdAt: new Date().toISOString() };
        job.geometryRuleVersion = geometryRuleVersion;
        job.sourceMetadataRevision = moves.find(move => move.id === job.moveId)?.sourceMetadataRevision ?? null;
        if (isPreparedMove(moves.find(move => move.id === job.moveId))) job.preparedBinding = preparedLibrary.binding(moves.find(move => move.id === job.moveId), familyRecord, job.tonight);
        if (data.libraryJobId) { job.libraryJobId = data.libraryJobId; job.libraryBinding = library.matchingRecord(account, job.childId, job.tonight, job.libraryJobId, { moveId: job.moveId, kitContext: job.kitContext }); }
        momentClarification.consume(account, originalData, job); accounts.reserveStory(account, job); db.jobs.push(job); persist(); startJob(account, job); return json(res, 202, publicJob(job));
      }
      const jobMatch = path.match(/^\/api\/jobs\/([a-f0-9-]{36})(?:\/(resume|repair-layout|set-aside|pause|feedback|suggestions|practice|print-copy|pages\/[1-5]\.(?:png|webp)|previews\/(?:poster|panel-[1-4])\.webp|files\/[^/]+))?$/);
      if (jobMatch) {
        const job = db.jobs.find(item => item.id === jobMatch[1] && item.accountId === account.id);
        if (!job) return json(res, 404, { message: 'That kit is not on your shelf.' });
        const action = jobMatch[2];
        if (action?.startsWith('pages/') && req.method === 'GET') {
          const isCurrent = () => db.jobs.includes(job) && db.accounts.includes(account) && job.status === 'complete';
          if (!isCurrent()) return json(res, 404, { message: 'Finish this kit before opening its pages.' });
          const file = await kitPages.pageFile({ source: join(dataDirectory, account.id, job.id), page: Number(action[6]), isCurrent });
          if (action.endsWith('.webp')) {
            const preview = await browserPreviews.previewFile({ source: join(file.directory, file.name), width: 1200, isCurrent: file.isCurrent });
            return serveFile(req, res, preview.directory, preview.name, false, false, 'private, no-cache');
          }
          return serveFile(req, res, file.directory, file.name);
        }
        if (action?.startsWith('previews/') && req.method === 'GET') {
          const isCurrent = () => db.jobs.includes(job) && db.accounts.includes(account) && job.status === 'complete';
          const source = join(dataDirectory, account.id, job.id, action.slice(9).replace(/\.webp$/, '.png'));
          const file = await browserPreviews.previewFile({ source, width: action.includes('poster') ? 1600 : 1200, isCurrent });
          return serveFile(req, res, file.directory, file.name, false, false, 'private, no-cache');
        }
        if (!action && req.method === 'GET') return json(res, 200, publicJob(job));
        if (action === 'suggestions') {
          if (req.method !== 'POST') return json(res, 405, { message: 'Use the feedback form.' });
          if (sampleOnly) return json(res, 403, { message: 'Sign in to the full app and open your own saved kit to send feedback.' });
          const result = suggestions.save(account, job, await bodyFor(req, 8000)); await flush(); return json(res, 200, result);
        }
        if (action === 'practice') {
          if (req.method === 'GET') return json(res, 200, practice.view(job));
          if (req.method === 'PUT' || req.method === 'DELETE') return json(res, 200, practice.change(job, await bodyFor(req, 8000), req.method === 'DELETE'));
          return json(res, 405, { message: 'Use the practice plan form.' });
        }
        if (action === 'print-copy') {
          if (req.method === 'GET') return json(res, 200, printCopies.view(job));
          if (req.method === 'POST') { const copy = printCopies.prepare(job); return json(res, copy.status === 'preparing' ? 202 : 200, copy); }
          return json(res, 405, { message: 'Use the print copy button.' });
        }
        if (action?.startsWith('files/') && ['poster-bw.pdf', 'kit-bw.pdf'].includes(action.slice(6)) && req.method === 'GET') {
          const file = printCopies.checkedFile(job, action.slice(6));
          return file ? serveFile(req, res, file.directory, file.name, false, new URL(req.url, 'http://localhost').searchParams.get('download') === '1') : json(res, 404, { message: 'This print copy is not ready.' });
        }
        if (action === 'set-aside' && req.method === 'POST') {
          if (active.has(account.id) || !['failed', 'paused'].includes(job.status)) return json(res, 409, { message: 'Pause this unfinished kit before setting it aside.' });
          job.status = 'set-aside'; job.message = 'This unfinished kit is kept with its saved work and costs. You can start another kit.'; job.canResume = false;
          persist(); return json(res, 200, publicSnapshot(account));
        }
        if (['resume', 'repair-layout'].includes(action) && req.method === 'POST') {
          accounts.assertCreation(account);
          if (sampleOnly) return json(res, 503, { message: 'This preview makes no paid calls. Use the sample.' });
          if (job.status === 'complete' || active.has(account.id)) return json(res, 200, publicJob(job));
          if (job.status === 'set-aside' || action === 'resume' && !publicJob(job).canResume) return json(res, 409, { message: job.message });
          try { bindLibraryJob(account, job); bindPreparedJob(account, job); }
          catch (error) {
            const failure = parentJobFailure(error, 'starting');
            job.status = 'failed'; job.message = failure.message; job.canResume = failure.canResume; job.failureKind = failure.kind; persist();
            return json(res, 409, { message: job.message, job: publicJob(job) });
          }
          const checkpoint = existsSync(join(dataDirectory, account.id, job.id, 'checkpoint.json'));
          const siblings = db.jobs.filter(item => item.accountId === account.id && item.childId === job.childId && item !== job);
          if (memoryFor(account, job.childId).exportRecord().pastKits.some(kit => kit.chapterNumber === job.chapterNumber) || siblings.some(item => item.chapterNumber === job.chapterNumber) || !checkpoint && siblings.some(item => db.jobs.indexOf(item) > db.jobs.indexOf(job))) return json(res, 409, { message: 'A newer kit has taken this place on your shelf. Remove this unfinished kit and start a new one.' });
          if (job.portraitFingerprint && job.portraitFingerprint !== portraitFingerprint(recordForJob(account, job)) || job.familyFingerprint && job.familyFingerprint !== familyFingerprint(recordForJob(account, job), { includeStyle: Boolean(job.pictureStyleId) }) || job.recordRevision !== undefined && job.recordRevision !== memoryFor(account, job.childId).exportRecord().revision) return json(res, 409, { message: 'Family notes changed after this kit started. Remove this unfinished kit before starting a new one, so old notes cannot be sent again.' });
          if (action === 'repair-layout') {
            if (!checkpoint || !canRepairLayout(job)) return json(res, 409, { message: 'This kit has no new writing-space repair available. Resume its saved work instead.' });
            const checkpointFile = join(dataDirectory, account.id, job.id, 'checkpoint.json'), saved = readJSON(checkpointFile);
            const backup = join(dataDirectory, account.id, job.id, 'layout-revisions', `${geometryRuleVersion}-before.json`);
            if (existsSync(backup)) return json(res, 409, { message: 'The writing-space repair was already started. Resume saved work instead.' });
            saveJSON(backup, saved);
            for (const stage of ['poster', 'cast-continuity', 'poster-export', 'poster-pdf', 'kit-pdf']) delete saved.stages[stage];
            saved.layoutRevision = geometryRuleVersion;
            saveJSON(checkpointFile, saved);
            job.layoutRevision = geometryRuleVersion; persist();
          }
          startJob(account, job); return json(res, 202, publicJob(job));
        }
        if (action === 'pause' && req.method === 'POST') { cancelled.add(job.id); job.message = 'Pausing after the current call. Your work stays saved.'; persist(); return json(res, 200, publicJob(job)); }
        if (action === 'feedback' && req.method === 'POST') {
          const data = await bodyFor(req);
          if (job.status !== 'complete' || !['yes', 'no'].includes(data.triedMove) || !['yes', 'a little', 'no', 'not for us'].includes(data.didItHelp) || !['Yes', 'Change it', 'Keep it off the wall'].includes(data.wallChoice)) throw new Error('Please answer both questions and choose where the poster lives.');
          const memory = memoryFor(account, job.childId); memory.setFeedback(job.chapterNumber, data); memory.setWallChoice(job.chapterNumber, data.wallChoice);
          job.feedback = { triedMove: data.triedMove, didItHelp: data.didItHelp, wallChoice: data.wallChoice }; persist(); return json(res, 200, publicSnapshot(account));
        }
        if (!action && req.method === 'DELETE') {
          if (active.has(account.id)) return json(res, 409, { message: 'Pause the kit before removing it.' });
          if (job.status === 'complete') return json(res, 400, { message: 'To remove all saved stories, open Family and choose Delete this saved family.' });
          db.jobs = db.jobs.filter(item => item !== job); practice.remove(account.id, job.id); suggestions.remove(account.id, job.id); db.accessDeliveries = db.accessDeliveries.filter(row => row.kind !== 'kit-ready' || row.subjectId !== job.id); const deletion = { accountId: account.id, jobId: job.id, deletedAt: new Date().toISOString() }; (db.deletions ??= []).push(deletion); persist(); await flush();
          const deleted = join(dataDirectory, '.deleted'); mkdirSync(deleted, { recursive: true, mode: 0o700 });
          if (existsSync(join(dataDirectory, account.id, job.id))) renameSync(join(dataDirectory, account.id, job.id), join(deleted, `${job.id}-${Date.now()}`));
          finalizeDeletion(deletion);
          return json(res, 200, publicSnapshot(account));
        }
        if (action?.startsWith('files/') && req.method === 'GET' && job.status === 'complete') return serveFile(req, res, join(dataDirectory, account.id, job.id), action.slice(6), true, new URL(req.url, 'http://localhost').searchParams.get('download') === '1');
      }
      const samplePage = path.match(/^\/api\/sample\/pages\/([1-5])\.(png|webp)$/);
      if (samplePage && sample && req.method === 'GET') {
        const file = await kitPages.pageFile({ source: sample.directory, cacheRoot: join(dataDirectory, 'sample-reader-pages'), page: Number(samplePage[1]) });
        if (samplePage[2] === 'webp') {
          const preview = await browserPreviews.previewFile({ source: join(file.directory, file.name), width: 1200, isCurrent: file.isCurrent });
          return servePublicPreview(req, res, preview);
        }
        return serveFile(req, res, file.directory, file.name);
      }
      const samplePreview = path.match(/^\/api\/sample\/previews\/(poster|panel-[1-4])\.webp$/);
      if (samplePreview && sample && req.method === 'GET') {
        const file = await browserPreviews.previewFile({ source: join(sample.directory, samplePreview[1] + '.png'), cacheRoot: join(dataDirectory, 'sample-browser-previews'), width: samplePreview[1] === 'poster' ? 1600 : 1200 });
        return servePublicPreview(req, res, file);
      }
      if (path === '/api/sample/narration.m4a' && sampleNarration && ['GET', 'HEAD'].includes(req.method)) return serveFile(req, res, sampleNarration.directory, sampleNarration.name);
      const sampleFile = path.match(/^\/api\/sample\/files\/([^/]+)$/);
      if (sampleFile && sample && sample.printCopy?.status === 'ready' && ['poster-bw.pdf', 'kit-bw.pdf'].includes(sampleFile[1]) && req.method === 'GET') return serveFile(req, res, sample.directory, sampleFile[1], false, new URL(req.url, 'http://localhost').searchParams.get('download') === '1');
      if (sampleFile && sample && req.method === 'GET') return serveFile(req, res, sample.directory, sampleFile[1], true, new URL(req.url, 'http://localhost').searchParams.get('download') === '1');
      if (path.startsWith('/api/')) return json(res, 404, { message: 'This page is not available.' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { message: 'Method not allowed.' });
      if (path.startsWith('/fonts/')) return serveFile(req, res, join(root, 'content/fonts'), basename(path));
      const clean = decodeURIComponent(path), build = join(root, 'app-dist');
      const target = resolve(build, '.' + clean);
      if (!target.startsWith(build + '/') && target !== build) return json(res, 404, { message: 'Page not found.' });
      const file = existsSync(target) && statSync(target).isFile() ? target : join(build, 'index.html');
      if (!existsSync(file)) return json(res, 503, { message: 'Run npm run build first.' });
      return serveFile(req, res, resolve(file, '..'), basename(file), false, false, file === target && clean.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store');
    } catch (error) { return json(res, error.status ?? 400, { message: error.status || /^(Please|Choose|Add|Use |real families|The form)/i.test(error.message) ? error.message : 'That request could not be completed. Your saved work is safe.' }); }
  });
  function servePublicPreview(req, res, file) {
    const url = new URL(req.url, 'http://localhost');
    if (url.searchParams.get('v') !== file.version) {
      url.searchParams.set('v', file.version);
      res.writeHead(302, { Location: url.pathname + url.search, 'Cache-Control': 'no-store' });
      return res.end();
    }
    return serveFile(req, res, file.directory, file.name, false, false, 'public, max-age=31536000, immutable');
  }
  function serveFile(req, res, directory, name, kitFile = false, download = false, cacheControl = 'no-store') {
    if (name !== basename(name) || kitFile && !filesAllowed.has(name)) return json(res, 404, { message: 'File not found.' });
    const path = join(directory, name);
    if (!existsSync(path) || !statSync(path).isFile()) return json(res, 404, { message: 'File not found.' });
    const type = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.ttf': 'font/ttf', '.txt': 'text/plain' }[extname(name)] ?? 'application/octet-stream';
    const bytes = readFileSync(path), length = bytes.length;
    const headers = { 'Content-Type': type, 'Cache-Control': cacheControl, 'Accept-Ranges': 'bytes', ...(name.endsWith('.pdf') ? { 'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name === 'kit_final.pdf' ? 'tonights-five-page-kit.pdf' : name}"` } : {}) };
    if (cacheControl === 'private, no-cache') {
      headers.ETag = '"' + digest(bytes) + '"';
      if (req.headers['if-none-match'] === headers.ETag && !req.headers.range) { res.writeHead(304, headers); return res.end(); }
    }
    // Unsupported, malformed and conditional ranges get the full file. Long
    // decimal offsets use BigInt so they cannot wrap into a different range.
    const match = req.method === 'GET' && !req.headers['if-range'] && /^bytes=(\d*)-(\d*)$/i.exec(String(req.headers.range ?? '').trim());
    if (match && (match[1] || match[2])) {
      const size = BigInt(length), suffix = !match[1];
      const first = suffix ? size - (BigInt(match[2]) > size ? size : BigInt(match[2])) : BigInt(match[1]);
      const last = suffix || !match[2] ? size - 1n : BigInt(match[2]) < size ? BigInt(match[2]) : size - 1n;
      if (!length || first >= size || first > last) { res.writeHead(416, { ...headers, 'Content-Range': `bytes */${length}`, 'Content-Length': 0 }); return res.end(); }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${first}-${last}/${length}`, 'Content-Length': Number(last - first + 1n) });
      return res.end(bytes.subarray(Number(first), Number(last) + 1));
    }
    res.writeHead(200, { ...headers, 'Content-Length': length }); res.end(req.method === 'HEAD' ? undefined : bytes);
  }
  return { server, budget, active, flush, close: () => new Promise(resolve => { access.close(); workerBridge?.close(); server.closeAllConnections(); server.close(resolve); }) };
}
export async function startConfiguredApp(env = process.env) {
  const hosted = env.STORY_POSTER_HOSTED === '1';
  const dataDirectory = env.STORY_POSTER_DATA_DIRECTORY ?? join(root, 'context/local-app');
  if (hosted && (!env.DATABASE_URL || !env.STORY_POSTER_PUBLIC_ORIGIN || !env.STORY_POSTER_DATA_DIRECTORY || !env.STORY_POSTER_WORKER_SECRET)) throw Error('Hosted mode needs Postgres, a public HTTPS address, a private data volume and a worker secret.');
  const stateFile = join(dataDirectory, 'accounts.json');
  const stateStore = hosted ? await openHostedStore({ connectionString: env.DATABASE_URL, bootstrapState: existsSync(stateFile) ? readJSON(stateFile) : null }) : undefined;
  try {
    const app = createApp({ dataDirectory, generationRoute: env.STORY_POSTER_GENERATION_ROUTE ?? 'subscription', publicOrigin: env.STORY_POSTER_PUBLIC_ORIGIN, workerSecret: hosted ? env.STORY_POSTER_WORKER_SECRET : undefined, inviteOnly: env.STORY_POSTER_INVITE_ONLY === '1', ownerNotificationEmail: env.STORY_POSTER_OWNER_ALERT_EMAIL, stateStore });
    await app.flush();
    const port = Number(env.PORT ?? 4317), host = hosted ? '0.0.0.0' : '127.0.0.1';
    await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(port, host, resolve); });
    return { ...app, close: async () => { await app.close(); await stateStore?.close(); } };
  } catch (error) { await stateStore?.close(); throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = await startConfiguredApp();
  process.stdout.write(`Story Poster is listening on port ${app.server.address().port}.\n`);
  const stop = () => { app.close().then(() => process.exit(0)); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
