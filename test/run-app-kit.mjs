import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app-server.mjs';
import { root, readJSON, saveJSON } from '../server/files.js';
import { appJobClient, waitAppJob } from './app-job-client.mjs';
import { readFileSync } from 'node:fs';
import { dataPolicyVersion } from '../app/data-policy.js';
import { normalizePortraitDescription } from '../server/requests.js';

export function appCheckPortraitInputs(env = process.env) {
  const inputs = [['CHILD', 'child'], ['PARENT', 'grown-up-one']].map(([key, personId]) => {
    const photo = env[`STORY_POSTER_CHECK_${key}_PHOTO`]?.trim(), description = env[`STORY_POSTER_CHECK_${key}_DESCRIPTION`]?.trim();
    if (photo && description) throw new Error(`Choose either a fictional photo or an appearance description for ${key.toLowerCase()}, not both.`);
    if (photo) {
      return { personId, inputMode: 'photo', path: resolve(photo.trim()) };
    }
    if (description) return { personId, inputMode: 'description', description: normalizePortraitDescription(description) };
    return null;
  });
  if (inputs.some(Boolean) && !inputs.every(Boolean)) throw new Error('Supply a photo or appearance description for both fictional people, or neither.');
  return inputs.filter(Boolean);
}
export function appCheckPortraitPayload(input) {
  if (input.inputMode === 'description') return { childId: 'primary', inputMode: 'description', description: input.description };
  if (input.inputMode !== 'photo') throw new Error('Unknown fictional portrait input mode.');
  const bytes = readFileSync(input.path);
  try { return { childId: 'primary', inputMode: 'photo', photo: { mime: 'image/png', base64: bytes.toString('base64') } }; }
  finally { bytes.fill(0); }
}

export async function startAppCheckStory(request, tonight) {
  const checked = await request('moment/clarify', { childId: 'primary', tonight });
  if (checked.status !== 200 || checked.data?.status !== 'ready' || typeof checked.data.draftId !== 'string' || !checked.data.draftId) {
    throw new Error(`The app needs a real answer before this check can continue: ${checked.data?.question ?? checked.data?.message ?? checked.status}`);
  }
  // Exercise the ordinary automatic guide path. A general app test must not
  // silently choose the naming-feelings lesson for every supplied moment.
  const created = await request('jobs', { childId: 'primary', tonight, clarificationId: checked.data.draftId });
  if (created.status !== 202) throw new Error(`App could not start a kit: ${created.data?.message ?? `HTTP ${created.status}`}`);
  return created.data;
}

const listening = port => new Promise(resolve => {
  const socket = createConnection({ port, host: '127.0.0.1' });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', error => { socket.destroy(); resolve(error.code !== 'ECONNREFUSED'); });
});

export async function runPaidAppKit(args = process.argv.slice(2)) {
  if (args.length !== 1 || args[0] !== '--paid') throw new Error('Paid calls require: node test/run-app-kit.mjs --paid');
  const portraitInputs = appCheckPortraitInputs();
  // The embedded server uses the app's existing accounts and daily ledger.
  // Refuse concurrent access by the ordinary server rather than creating a new cap.
  if (await listening(Number(process.env.PORT ?? 4317))) throw new Error('Stop the normal app server first; this check shares context/local-app and its daily cap.');
  const app = createApp({ sampleOnly: false });
  let jobId;
  try {
    await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
    const request = appJobClient(`http://127.0.0.1:${app.server.address().port}`);
    let record, receiptFile;
    if (process.env.STORY_POSTER_CHECK_RESUME_RECEIPT) {
      receiptFile = resolve(process.env.STORY_POSTER_CHECK_RESUME_RECEIPT);
      if (!receiptFile.startsWith(join(root, 'context/local-app') + '/') || !/\/app-check-[a-f0-9]+\.json$/.test(receiptFile)) throw new Error('Resume needs this runner’s private saved receipt.');
      record = readJSON(receiptFile);
      const saved = await request('login', { username: record.username, password: record.password });
      if (saved.status !== 200 || saved.data.record.real !== false || !record.jobId) throw new Error('The saved fictional check could not be opened.');
      jobId = record.jobId;
      const resumed = await request('jobs/' + jobId + (process.env.STORY_POSTER_CHECK_REPAIR_LAYOUT === '1' ? '/repair-layout' : '/resume'), {});
      if (![200, 202].includes(resumed.status)) throw new Error(`Saved work could not resume: ${resumed.data?.message ?? resumed.status}`);
    } else {
    const username = `app-check-${randomBytes(5).toString('hex')}`, password = randomBytes(24).toString('hex');
    const signup = await request('signup', { username, password, family: {
      real: false, nickname: 'Pip', age: 8, pronouns: 'he/him', loves: ['comics', 'space', 'puzzles'], presetId: 'comet',
      familyContext: 'This is a made-up family. Pip is 8. There are 2 children at home.',
      parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }],
      ...(portraitInputs.some(input => input.inputMode === 'photo') ? { dataPolicyConsent: { accepted: true, version: dataPolicyVersion } } : {}),
    } });
    if (signup.status !== 200) throw new Error(`App setup failed (HTTP ${signup.status}).`);
    record = { username, password, createdAt: new Date().toISOString(), budget: app.budget.status(), note: 'Synthetic family. Run through signup, pick, jobs, polling and authenticated downloads. Credentials stay private.' };
    receiptFile = join(root, 'context/local-app', `${username}.json`);
    saveJSON(receiptFile, record);
    if (portraitInputs.length) {
      record.portraitTest = { synthetic: true, inputs: portraitInputs, selected: [] };
      // Retain the previous all-photo receipt shape for existing proof readers.
      if (portraitInputs.every(input => input.inputMode === 'photo')) record.photoTest = { synthetic: true, inputs: portraitInputs.map(input => input.path), selected: [] };
      saveJSON(receiptFile, record);
      for (const input of portraitInputs) {
        const { personId, inputMode } = input;
        const uploaded = await request('portraits/' + personId, appCheckPortraitPayload(input));
        if (uploaded.status !== 202) throw new Error(`Portrait setup failed: ${uploaded.data?.message ?? uploaded.status}`);
        let person;
        while (true) {
          const current = await request('portraits?childId=primary');
          if (current.status !== 200) throw new Error('Portrait progress could not be read.');
          person = current.data.people.find(item => item.id === personId);
          if (person.job?.status !== 'running') break;
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        // A family with a chosen look gets one checked drawing per person.
        if (person.job?.status !== 'complete' || person.candidates.length !== person.job.expected) throw new Error(`The portrait job did not finish its drawing: ${person.job?.message ?? personId}`);
        const candidate = person.candidates[0];
        const chosen = await request('portraits/' + personId + '/select', { childId: 'primary', jobId: person.job.id, candidateId: candidate.id });
        if (chosen.status !== 200) throw new Error('The selected drawing could not be saved.');
        const selection = { personId, inputMode, jobId: person.job.id, candidateId: candidate.id, url: candidate.url };
        record.portraitTest.selected.push(selection);
        if (record.photoTest) { const { inputMode, ...legacySelection } = selection; record.photoTest.selected.push(legacySelection); }
        saveJSON(receiptFile, record);
        process.stdout.write(`Three fictional ${inputMode} choices ready and first drawing selected: ${personId}.\n`);
      }
    }
    const tonight = process.env.STORY_POSTER_CHECK_MOMENT?.trim() || 'Pip feels frustrated after homework and wants help naming the feeling.';
    const created = await startAppCheckStory(request, tonight);
    jobId = created.id; record.jobId = jobId; saveJSON(receiptFile, record);
    }
    process.stdout.write(`App job ${jobId}; shared daily limit $${app.budget.status().limit}.\n`);
    const job = await waitAppJob(request, jobId, { progress: state => process.stdout.write(state + '\n') });
    const privateJob = readJSON(join(root, 'context/local-app/accounts.json')).jobs.find(item => item.id === jobId);
    const directory = join(root, 'context/local-app', privateJob.accountId, jobId);
    Object.assign(record, { status: job.status, directory, budgetAfter: app.budget.status() });
    saveJSON(receiptFile, record);
    if (job.status !== 'complete') throw new Error(`${job.message}\nPrivate reason: ${join(directory, 'failure.json')}`);
    for (const file of ['poster.png', 'poster.pdf', 'kit_final.pdf', 'panel-1.png', 'panel-2.png', 'panel-3.png', 'panel-4.png']) {
      const response = await request(`jobs/${jobId}/files/${file}`);
      if (response.status !== 200 || !response.bytes.length) throw new Error(`App download failed: ${file} (HTTP ${response.status}).`);
    }
    const session = await request('session');
    if (!session.data.jobs.some(item => item.id === jobId && item.status === 'complete') || !session.data.record.pastKits.some(kit => kit.chapterNumber === job.chapterNumber)) throw new Error('The completed job was not on the saved shelf.');
    process.stdout.write(`COMPLETE through the app: ${directory}\nPrivate login and run receipt: ${receiptFile}\n`);
    const libraryTopic = process.env.STORY_POSTER_CHECK_LIBRARY_TOPIC?.trim();
    if (libraryTopic) {
      const started = await request('library/jobs', { childId: 'primary', tonight: libraryTopic });
      if (started.status !== 202 || started.data.status === 'parentResponse') throw new Error(`Topic check could not start: ${started.data?.message ?? started.status}`);
      record.libraryCheck = { id: started.data.id, synthetic: true }; saveJSON(receiptFile, record);
      let checked = started.data, last;
      while (checked.status === 'running') {
        const state = `Topic check: ${checked.stage}`; if (state !== last) { process.stdout.write(state + '\n'); last = state; }
        await new Promise(resolve => setTimeout(resolve, 1500));
        const polled = await request('library/jobs/' + checked.id);
        if (polled.status !== 200) throw new Error('The topic check could not be read.');
        checked = polled.data;
      }
      record.libraryCheck = { ...record.libraryCheck, result: checked }; record.budgetAfter = app.budget.status(); saveJSON(receiptFile, record);
      if (checked.status !== 'complete') throw new Error(`Kit is complete; the new-topic check stopped honestly: ${checked.message}`);
      const shared = await request('library');
      if (!shared.data.documents.some(document => document.id === checked.documentId)) throw new Error('The checked topic was missing from the general library.');
      const reuse = await request('pick', { childId: 'primary', tonight: libraryTopic, libraryJobId: checked.id, allowRepeat: true });
      if (!reuse.data?.suggestions?.some(move => move.id === checked.moveId)) throw new Error('The checked topic was not offered for this same private moment.');
      const reader = appJobClient(`http://127.0.0.1:${app.server.address().port}`);
      const readerSignup = await reader('signup', { username: `guide-reader-${randomBytes(5).toString('hex')}`, password: randomBytes(24).toString('hex'), family: { real: false, nickname: 'Cedar', age: 10, pronouns: 'they/them', loves: ['books', 'puzzles', 'space'], presetId: 'comet', parents: [{ label: 'Dad', pronouns: 'he/him', hair: 'short dark hair' }] } });
      if (readerSignup.status !== 200 || readerSignup.data.jobs.length || readerSignup.data.record.pastKits.length) throw new Error('The second fictional family did not receive an empty private shelf.');
      const otherLibrary = await reader('library'), privateKit = await reader(`jobs/${jobId}`);
      if (!otherLibrary.data.documents.some(document => document.id === checked.documentId) || privateKit.status !== 404) throw new Error('General-guide sharing and private-kit isolation failed.');
      record.libraryCheck.otherFamilyIsolation = true; saveJSON(receiptFile, record);
      if ((await reader('family', {}, { method: 'DELETE' })).status !== 200) throw new Error('The temporary fictional reader could not be removed.');
      process.stdout.write(`COMPLETE new general guide: ${checked.documentId}. Private story remains separate.\n`);
    }
    return { jobId, directory, receiptFile };
  } finally { await app.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runPaidAppKit(); }
  catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
