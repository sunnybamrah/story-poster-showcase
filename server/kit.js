import { reviewNote } from './stop-policy.js';
import { measureLayout, assertLayoutFit, fitPrintedText } from './layout-fit.js';
import { rhymeForKit, snapshotTopicRhyme } from './rhyme.js';
import { assertFamilyAllowed } from './config.js';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { copyFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { moves, saveJSON, readJSON } from './files.js';
import { preparePick } from './picker.js';
import { learningActor } from './cast.js';
import { readyStory, validateStory, shortenLayoutText } from './story.js';
import { readyPicture, readyCastReferences, readyKitArt, imageHash } from './picture.js';
import { assertKeyWordHistory, parentLabelFor, posterWordReport, assertPosterWordCap } from './format.js';
import { buildPosterRequest, buildPanelRequest, privacyFor } from './requests.js';
import { writePages, makePages, copyFonts, combinedKitHTML, renderPoster, renderKitPDF } from './layout.js';
import { buildInteractiveContent, validateInteractiveContent, freezeInteractivePoster, interactivePrintedWordsHash } from './interactive-assets.js';
import { renderInteractiveHTML } from './interactive-view.js';
import { makePosterMap } from './poster-template.js';
import { pngDimensions } from './picture.js';
import { posterFooter } from './format.js';
import { withKitEvidence } from './kit-evidence.js';
import { kitEditorial, printedSourcesFor } from './kit-editorial.js';
import { scienceFor } from './format.js';
import { recoverFitAttempts } from './fit-recovery.js';
import { refreshSavedRhyme } from './rhyme-refresh.js';
import { checkStory } from './check-story.js';
import { prepareReadingArt } from './reading-art.js';
import { savedLessonFitFailure } from './job-failure.js';

function writeInteractiveView(directory, bundle, { preview = false } = {}) {
  mkdirSync(directory, { recursive: true });
  for (const name of ['interactive.js', 'interactive.css']) copyFileSync(new URL(`../web/${name}`, import.meta.url), join(directory, name));
  for (const name of ['Nunito-Variable.ttf', 'Nunito-OFL.txt']) copyFileSync(new URL(`../content/fonts/${name}`, import.meta.url), join(directory, name));
  writeFileSync(join(directory, 'index.html'), renderInteractiveHTML(bundle, { preview }), { mode: 0o600 });
}

// Call after the exact exported files and all expanded text have been reviewed.
// Neither the renderer nor a successful checksum grants content approval.
export function publishInteractiveLocally({ directory, imagePath, pdfPath, profileId, kitId, content, map, acceptance }) {
  const frozen = freezeInteractivePoster({ directory, imagePath, pdfPath, profileId, kitId, content, map, acceptance });
  writeInteractiveView(frozen.directory, frozen.bundle);
  return frozen;
}

export async function createKit(transport, memory, tonight, { kit, chapterNumber, directory, allowRepeat = false, chosenMoveId, layoutRevision, readingArtCacheDirectory, interactive = {}, stopBeforePictures = false, resume = false, exports: exporters = { renderPoster, renderKitPDF, measureLayout } } = {}) {
  transport.onStage?.('preflight');
  if (!chosenMoveId && transport.prepareGuide) chosenMoveId = await transport.prepareGuide();
  const checkpointPath = join(directory, 'checkpoint.json');
  if (resume && !existsSync(checkpointPath)) throw new Error('Resume checkpoint is missing; no text will be bought again.');
  const checkpoint = resume && existsSync(checkpointPath) ? readJSON(checkpointPath) : { version: 1, kit, tonight, recordAtStart: memory.exportRecord(), stages: {} };
  if (checkpoint.version !== 1 || checkpoint.kit !== kit || checkpoint.tonight !== tonight) throw new Error('Resume checkpoint belongs to a different kit or night.');
  if (!resume && existsSync(checkpointPath)) throw new Error('Kit already exists. Use --resume to retain its saved stages.');
  if (checkpoint.savedLayoutRevision?.status === 'review') throw Object.assign(Error('printed_layout_review_required: Saved layout needs review. Keep this kit and start another when ready.'), { code: 'printed_layout_review_required', canResume: false });
  const recordAtStart = checkpoint.recordAtStart;
  const chapter = checkpoint.chapterNumber ?? chapterNumber ?? Math.max(0, ...recordAtStart.pastKits.map(kit => kit.chapterNumber)) + 1;
  if (!Number.isSafeInteger(chapter) || chapter < 1 || chapterNumber !== undefined && chapterNumber !== chapter) throw new Error('Resume checkpoint belongs to a different chapter.');
  checkpoint.chapterNumber = chapter;
  const saveCheckpoint = () => saveJSON(checkpointPath, checkpoint);
  const stage = async (name, run) => {
    if (checkpoint.stages[name]) return checkpoint.stages[name];
    transport.onStage?.(name);
    const value = await run();
    if (value?.rendered !== false) { checkpoint.stages[name] = value; saveCheckpoint(); }
    return value;
  };
  (transport.assertFamilyAllowed ?? assertFamilyAllowed)(recordAtStart);
  const pick = preparePick(recordAtStart, tonight, { allowRepeat, chosenMoveId });
  if (pick.status !== 'eligible') {
    if (chosenMoveId && pick.status === 'noMatch') throw savedLessonFitFailure(pick);
    return pick;
  }
  if (chosenMoveId && !pick.eligible.some(item => item.move.id === chosenMoveId)) throw savedLessonFitFailure();
  checkpoint.topicReminders ??= Object.fromEntries(pick.eligible.map(({ move }) => [move.id, snapshotTopicRhyme(move)]));
  transport = withKitEvidence(transport, directory);
  const recovered = recoverFitAttempts(checkpoint, directory);
  if (recovered.length) transport.recordLocalResult('fit-lock-recovery', { recovered, fitAttempts: checkpoint.fitAttempts }, 'Recovered only allowances proven lost to code cleanup. Original evidence retained.');
  saveCheckpoint();
  const options = { savedParagraphReflow: checkpoint.savedLayoutRevision?.status === 'fitted', record: recordAtStart, nickname: learningActor(recordAtStart).storyName, parentLabel: parentLabelFor(recordAtStart), kitCount: chapter - 1, privacy: privacyFor(recordAtStart, tonight) };
  const preflightWordCounts = pick.eligible.map(item => posterWordReport(item.move, undefined, options));
  saveJSON(join(directory, 'poster-word-counts.json'), { preflight: preflightWordCounts });
  let result = await stage('text', () => readyStory(transport, recordAtStart, tonight, { kit, allowRepeat, lockedMoveId: chosenMoveId, topicReminders: checkpoint.topicReminders, draft: checkpoint.stages['story-draft'], saveDraft: draft => { checkpoint.stages['story-draft'] = draft; saveCheckpoint(); } }));
  if (chosenMoveId && result.moveId !== chosenMoveId) throw savedLessonFitFailure({ reason: 'saved-story-uses-a-different-lesson' });
  if (!result.ready) return result;
  await transport.onLessonSelected?.(result.moveId);
  const editorialMove = moves.find(move => move.id === result.moveId);
  result = await refreshSavedRhyme({ checkpoint, move: editorialMove, record: recordAtStart,
    check: candidate => checkStory(transport, candidate, editorialMove, { kit, record: recordAtStart, tonight }),
    preserve: original => saveJSON(join(directory, 'rhyme-revisions', `${Date.now()}-${Object.keys(original.stages).length}.json`), original),
    save: saveCheckpoint, note: revision => transport.recordLocalResult('rhyme-refresh', revision, 'Short rhyme rechecked before new art. Accepted people and unchanged panels reused.') });
  checkpoint.sourceMetadataRevision = editorialMove.sourceMetadataRevision ?? null;
  saveCheckpoint();
  const editorial = { ...kitEditorial, sourceMetadataRevision: checkpoint.sourceMetadataRevision, moveSnapshot: structuredClone(editorialMove), moveSnapshotHash: createHash('sha256').update(JSON.stringify(editorialMove)).digest('hex'), rhyme: rhymeForKit(result, editorialMove), science: scienceFor(editorialMove), sources: editorialMove.sources, printedSources: printedSourcesFor(editorialMove) };
  saveJSON(join(directory, 'kit-editorial.json'), editorial);
  transport.recordLocalResult('kit-editorial', editorial, "FOR SUNNY'S READ");
  // Saved wording belongs to this kit, even after the topic default changes.
  result.pagination = validateStory(result, { ...options, storyMode: recordAtStart.kitContext?.storyMode, lockedMoveId: result.moveId, pagination: result.pagination }).pagination;
  transport.recordKitText(result);
  if (checkpoint.savedLayoutRevision && checkpoint.savedLayoutRevision.sourceTextSHA256 !== createHash('sha256').update(JSON.stringify(checkpoint.stages.text)).digest('hex')) throw Object.assign(Error('printed_layout_review_required: Saved text differs from its measured layout revision.'), { code: 'printed_layout_review_required', canResume: false });
  const fitDirectory = join(directory, 'text-fit');
  mkdirSync(fitDirectory, { recursive: true }); copyFonts(fitDirectory);
  const fit = async (measure, receiptName) => fitPrintedText({ text: result, measure,
    async recover(current, failedReceipt) {
      const version = 'saved-paragraph-reflow-v1';
      const sourceTextSHA256 = createHash('sha256').update(JSON.stringify(checkpoint.stages.text)).digest('hex');
      const prior = checkpoint.savedLayoutRevision;
      if (prior && (prior.version !== version || prior.sourceTextSHA256 !== sourceTextSHA256)) throw Object.assign(Error('printed_layout_review_required: Saved text differs from its measured layout revision.'), { code: 'printed_layout_review_required', canResume: false });
      const revisionDirectory = join(directory, 'layout-revisions', version + '-' + sourceTextSHA256);
      mkdirSync(revisionDirectory, { recursive: true });
      const original = join(revisionDirectory, 'checkpoint-before.json');
      if (!existsSync(original)) saveJSON(original, checkpoint);
      checkpoint.savedLayoutRevision = { version, sourceTextSHA256, status: 'measuring', directory: revisionDirectory };
      saveCheckpoint();
      options.savedParagraphReflow = true;
      const receipt = await measure(current);
      saveJSON(join(revisionDirectory, receiptName), { version, sourceTextSHA256, originalReceipt: failedReceipt, receipt, wordsChanged: false, pageCutsChanged: false, typeShrunk: false, fitAttempts: checkpoint.fitAttempts });
      checkpoint.savedLayoutRevision.status = receipt.measured && receipt.ready ? 'fitted' : 'review';
      saveCheckpoint();
      transport.recordLocalResult('saved-layout-revision', { ...checkpoint.savedLayoutRevision, receipt }, receipt.ready ? 'Saved words fit by measured paragraph reflow. No model request.' : 'Saved words still need layout review. No new model allowance.');
      return receipt;
    }, priorAttempts: checkpoint.fitAttempts, allowBubbleShortening: receiptName !== 'layout-fit.json',
    save(receipt, attempt) {
      transport.recordLocalResult('printed-fit', { stage: receiptName, attempt, receipt }, receipt.shorteningRejected ? receipt.shorteningRejected : receipt.measured ? receipt.ready ? 'PASS' : 'OVERFLOW' : 'UNVERIFIED');
      if (typeof attempt === 'number') saveJSON(join(directory, receiptName), receipt);
    },
    async shorten(previous, plan) {
      checkpoint.fitAttempts ??= {};
      const prior = checkpoint.fitAttempts[plan.page], wireBefore = transport.wireCount?.();
      checkpoint.fitAttempts[plan.page] = (prior ?? 0) + 1; saveCheckpoint();
      try { return await shortenLayoutText(transport, recordAtStart, tonight, previous, plan, { kit, allowRepeat }); }
      catch (error) {
        if (error.preflight === true && Number.isSafeInteger(wireBefore) && transport.wireCount?.() === wireBefore) {
          if (prior === undefined) delete checkpoint.fitAttempts[plan.page]; else checkpoint.fitAttempts[plan.page] = prior;
          saveCheckpoint();
          transport.recordLocalResult('fit-preflight-stop', { page: plan.page, wireCalls: 0 }, 'No model request was sent. The fitting allowance stays available.');
        }
        throw error;
      }
    },
    accept(next) { checkpoint.stages.text = next; saveCheckpoint(); transport.recordKitText(next); },
  });
  const fitted = await fit(async current => {
    const textPages = makePages(moves.find(move => move.id === current.moveId), current, options);
    writeFileSync(join(fitDirectory, 'kit_final.html'), combinedKitHTML(textPages), { mode: 0o600 });
    return transport.localStage('text-layout-fit', () => (exporters.measureLayout ?? measureLayout)(join(fitDirectory, 'kit_final.html')));
  }, 'text-layout-fit.json');
  result = fitted.text;
  const layoutFit = fitted.receipt;
  const fitAssessment = assertLayoutFit(layoutFit);
  if (fitAssessment.reviewFlags?.length) transport.recordReviewFlags?.('text-layout-fit', fitAssessment.reviewFlags);
  if (stopBeforePictures) { saveCheckpoint(); return { ...result, recordAtStart, directory, layoutFit, stoppedBeforePictures: true, complete: false }; }
  saveJSON(join(directory, 'story-pagination.json'), result.pagination);
  const move = moves.find(move => move.id === result.moveId);
  const posterWordCheck = posterWordReport(move, result, options);
  saveJSON(join(directory, 'poster-word-counts.json'), { preflight: preflightWordCounts, final: posterWordCheck });
  assertPosterWordCap(posterWordCheck.count, move.id);
  const historyFlag = assertKeyWordHistory(recordAtStart, move);
  if (historyFlag) transport.recordReviewFlags?.('key-word-history', [historyFlag]);
  const selection = { world: result.world, colourSet: result.colourSet };
  transport.onStage?.('picture-preflight');
  buildPosterRequest(recordAtStart, move, tonight, result, { selection });
  for (const panel of result.panelLines) buildPanelRequest(recordAtStart, move, tonight, panel, { selection });
  if (!recordAtStart.hero.heroPicturePath) {
    const hero = await stage('hero', () => readyPicture(transport, recordAtStart, move, tonight, { kit, directory: join(directory, 'hero'), hero: true, selection }));
    if (imageHash(hero.path) !== hero.hash) throw new Error('Saved hero bytes changed.');
    memory.setHeroPicture(hero.path);
  }
  const cast = await readyCastReferences(transport, memory.exportRecord(), move, tonight, { kit, directory, selection, saved: checkpoint.stages, heroReference: checkpoint.stages.hero,
    saveStage(name, value) { checkpoint.stages[name] = value; saveCheckpoint(); } });
  memory.setCast(cast);
  const art = await readyKitArt(transport, memory.exportRecord(), move, tonight, result, { kit, directory, layoutRevision: layoutRevision ?? checkpoint.layoutRevision, selection, saved: checkpoint.stages, saveStage(name, value) { checkpoint.stages[name] = value; saveCheckpoint(); } });
  if (readingArtCacheDirectory) options.readingArt = await prepareReadingArt(transport, memory.exportRecord(), { directory, cacheDirectory: readingArtCacheDirectory, kit });
  const picture = art.poster;
  let pages;
  const finalFitted = await fit(async current => {
    pages = await transport.localStage('layout', () => writePages(directory, move, current, art, options));
    return transport.localStage('layout-fit', () => (exporters.measureLayout ?? measureLayout)(join(directory, 'kit_final.html')));
  }, 'layout-fit.json');
  result = finalFitted.text;
  saveJSON(join(directory, 'story-pagination.json'), result.pagination);
  const finalFit = finalFitted.receipt;
  const finalAssessment = assertLayoutFit(finalFit);
  if (finalAssessment.reviewFlags?.length) transport.recordReviewFlags?.('layout-fit', finalAssessment.reviewFlags);
  const exportStage = async (name, file, run) => {
    const path = join(directory, file), saved = checkpoint.stages[name];
    const sourceHash = imageHash(join(directory, name === 'kit-pdf' ? 'kit_final.html' : 'poster.html'));
    if (saved && (!existsSync(path) || saved.sha256 && imageHash(path) !== saved.sha256 || saved.sourceHash !== sourceHash)) {
      transport.recordLocalResult('export-checkpoint-invalid', { stage: name, file, reason: 'Accepted file missing or changed; render from saved content again.' });
      delete checkpoint.stages[name]; saveCheckpoint();
    }
    const result = await stage(name, async () => {
      const receipt = await transport.localStage(name, run);
      if (!receipt.rendered) throw Object.assign(new Error(`${name}: ${receipt.reason ?? 'Export did not finish.'}`), { details: receipt });
      return { ...receipt, sha256: imageHash(path), sourceHash };
    });
    return result;
  };
  const render = await exportStage('poster-export', 'poster.png', () => exporters.renderPoster(join(directory, 'poster.html'), join(directory, 'poster.png'), { finalMaster: true, replaceUnaccepted: true }));
  const posterPDF = await exportStage('poster-pdf', 'poster.pdf', () => exporters.renderKitPDF(join(directory, 'poster.html'), join(directory, 'poster.pdf'), { posterOnly: true, replaceUnaccepted: true }));
  const pdf = await exportStage('kit-pdf', 'kit_final.pdf', () => exporters.renderKitPDF(join(directory, 'kit_final.html'), join(directory, 'kit_final.pdf'), { replaceUnaccepted: true }));
  const version = interactive.version ?? `poster-${art.poster.hash.slice(0, 16)}-${options.kitCount + 1}`;
  const posterGeometry = art.poster.checks.at(-1).geometry;
  const content = buildInteractiveContent({ geometry: posterGeometry, move, kit: result, nickname: options.nickname, parentLabel: options.parentLabel, version, approvedDetails: interactive.approvedDetails });
  saveJSON(join(directory, 'interactive-content.json'), content);
  let interactiveResult = { ready: false, contentCheck: validateInteractiveContent(content), reason: 'The exact expanded text and final export need review.' };
  if (!interactiveResult.contentCheck.ready) transport.recordReviewFlags?.('interactive-content', interactiveResult.contentCheck.faults.map(reason => reviewNote('interactive_content_pending', reason)));
  if (render.rendered && posterPDF.rendered) {
    const imagePath = join(directory, 'poster.png'), pdfPath = join(directory, 'poster.pdf');
    const map = makePosterMap(version, imageHash(imagePath), posterGeometry);
    saveJSON(join(directory, 'interactive-map.json'), map);
    const latest = art.poster.checks.at(-1);
    const readbackVerified = latest.verified !== false && latest.wordVerdicts?.length > 0 && latest.wordVerdicts.every(row => row.matches);
    const blankPlan = Boolean(readbackVerified && latest.answers?.filledBlank === false);
    // This is evidence for a reviewer, not an approval of the composed export.
    saveJSON(join(directory, 'interactive-acceptance-draft.json'), {
      approved: false, version, imageSha256: imageHash(imagePath), pdfSha256: imageHash(pdfPath),
      wordCheck: { ready: Boolean(readbackVerified), approvedWordsSha256: interactivePrintedWordsHash(content), approvedWordCount: latest.wordCap?.count ?? null,
        transcribedWordCount: latest.transcriptionWordCap?.count ?? null, blankPlan,
        transcription: (Array.isArray(latest.answers?.boxes) ? latest.answers.boxes.filter(box => box && typeof box.id === 'string' && typeof box.text === 'string') : []).map(box => box.id === 'footer' ? { id: 'footer', text: posterFooter(options.nickname) } : box),
        footerSource: 'Local footer text, verified in the PDF. The nickname never goes to image or vision services.' },
      geometry: latest.answers?.geometry ?? null, geometryReview: { subBoxesRechecked: latest.checkerAttempt > 1 }, print: { ready: posterPDF.rendered, blankPlan, letterSize: posterPDF.inspection.letter },
    });
    const bundle = { version, profileId: interactive.profileId ?? 'local-profile', kitId: interactive.kitId ?? `kit-${options.kitCount + 1}`,
      image: { url: 'poster.png', version, sha256: imageHash(imagePath), ...pngDimensions(imagePath) },
      pdf: { url: 'poster.pdf', version, sha256: imageHash(pdfPath) }, map, content };
    await transport.localStage('interactive-view', () => writeInteractiveView(directory, bundle, { preview: true }));
    if (interactive.acceptance) {
      const frozen = publishInteractiveLocally({ directory, imagePath, pdfPath, profileId: bundle.profileId, kitId: bundle.kitId, content, map, acceptance: interactive.acceptance });
      interactiveResult = { ready: true, directory: frozen.directory, bundle: frozen.bundle };
    }
  }
  return { ...result, chapterNumber: options.kitCount + 1, recordAtStart, move, picture, art, posterCardWords: posterWordCheck.count, posterWordCheck, preflightWordCounts, pages, render, pdf, posterPDF, interactive: interactiveResult, directory,
    heroHash: imageHash(memory.exportRecord().hero.heroPicturePath), complete: render.rendered && posterPDF.rendered && pdf.rendered };
}
