import { positiveActionFor, practiceFor, posterScienceClaimFor } from './format.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { approvedPosterWords, backupNameFor, boxText, cardTitles, emptyMove, visibleWords, scienceFor } from './format.js';
import { compareBoxWords } from './word-comparison.js';
import { pngDimensions } from './picture.js';
import { preparedSourceURLAllowed } from './library-prepared.js';
import { posterTemplate, posterTemplateFor, validateGeometryReceipt, makePosterMap } from './poster-template.js';
import { guideReaderLimitation, guideReaderClaim } from '../app/reader-notes.js';

export const interactiveRegionIds = Object.freeze(['tinyTry', 'science', 'source', 'plan', 'remember', 'hero', 'keyword', 'tagline']);
// These explanations are copied from the accepted interactive brief.
export const evidenceExplanations = Object.freeze({
  DIRECT: 'children of the relevant age practising the same skill.',
  ADJACENT: 'related child research, but a different age or skill.',
  MECHANISM: 'a process that might explain how something works.',
  'ADULT ONLY': 'research conducted with adults.',
  GUIDANCE: 'official instructions, not evidence that this home guide was tested.',
});
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const digest = value => createHash('sha256').update(value).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalize = text => text.normalize('NFKC').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/gu, ' ').trim();
const ericURL = value => typeof value === 'string' && /^https:\/\/eric\.ed\.gov\/\?id=E[DJ]\d{1,10}$/.test(value);
const sourceURL = source => source?.pubmed ? `https://pubmed.ncbi.nlm.nih.gov/${source.pubmed}/` : source?.doi ? `https://doi.org/${source.doi}` : source?.sourceId && (preparedSourceURLAllowed(source.url) || source.provider === 'ERIC' && source.eric === source.sourceId && source.url === `https://eric.ed.gov/?id=${source.eric}` && ericURL(source.url)) ? source.url : null;
const studyURL = value => typeof value === 'string' && (/^https:\/\/(?:pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/?|doi\.org\/10\.\d{4,9}\/\S+)$/u.test(value) || ericURL(value) || preparedSourceURLAllowed(value));

function practiceSteps(script) {
  if (!hasText(script)) return [];
  const sentences = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(script)].map(item => item.segment.trim());
  const groupSize = Math.max(1, Math.ceil(sentences.length / 4));
  const steps = [];
  for (let i = 0; i < sentences.length; i += groupSize) steps.push(sentences.slice(i, i + groupSize).join(' '));
  return steps;
}

// Review stamps do not approve themselves. A changed word invalidates this hash.
export function interactiveContentHash(content) {
  const { approval, url, sha256, ...body } = content;
  return digest(jsonBytes(body));
}

export const interactivePrintedWords = content => content.printed.map(box => ({ id: box.id, text: normalize(boxText(box)) }));
export const interactivePrintedWordsHash = content => digest(jsonBytes(interactivePrintedWords(content)));

// New explanations and study facts must come from a reviewed content record.
// The saved source labels are not silently promoted to full paper titles.
export function buildInteractiveContent({ move, kit, nickname = 'Pip', parentLabel = 'Dad', version, approvedDetails = {}, geometry }) {
  const originalSource = move.sources?.[approvedDetails.sourceIndex ?? 0] ?? {};
  const detail = approvedDetails.sections ?? {};
  const script = practiceFor(move, nickname, parentLabel);
  const boxes = approvedPosterWords(move, kit, { nickname });
  const science = move.science ? scienceFor(move) : { ...detail.science, claim: move.kidScienceLine, limitation: detail.science?.limitation ?? move.source?.limitation };
  const evidenceLabel = science.evidenceLabel ?? null;
  const readerLimit = guideReaderLimitation(move.id, science.limitation);
  const hasReaderNote = readerLimit !== science.limitation;
  const readerClaim = guideReaderClaim(move.id, science.claim);
  const hasReaderClaim = readerClaim !== science.claim;
  const printedClaim = posterScienceClaimFor(move);
  const hasPrintedClaim = printedClaim !== science.claim;
  const content = {
    ...(geometry ? { layoutRegions: makePosterMap(version, '0'.repeat(64), geometry).regions } : {}),
    version, title: move.name, moveId: move.id, printed: boxes,
    sourceRecords: structuredClone(move.sources ?? []),
    sourceText: { practiceScript: script, sourceAccount: science.claim, parentReceipt: move.parentReceipt, limitation: science.limitation },
    ...(hasReaderNote || hasReaderClaim || hasPrintedClaim ? { readerNotes: { version: 'exact-v1',
      ...(hasReaderNote ? { guideLimit: { originalSHA256: digest(science.limitation), plainSHA256: digest(readerLimit) } } : {}),
      ...(hasReaderClaim ? { guideClaim: { originalSHA256: digest(science.claim), plainSHA256: digest(readerClaim) } } : {}),
      ...(hasPrintedClaim ? { posterClaim: { originalSHA256: digest(science.claim), plainSHA256: digest(printedClaim) } } : {}),
    } } : {}),
    sections: {
      tinyTry: { title: cardTitles[0], instruction: positiveActionFor(move), validation: (kit.feelFirst ?? []).join(' '),
        choices: (kit.tinyTryOptions ?? []).map(option => option.text), steps: practiceSteps(script), realWorldAction: positiveActionFor(move) },
      science: { title: cardTitles[1], claim: science.claim, tested: science.tested ?? null,
        ...(hasReaderClaim ? { readerClaim } : {}),
        ...(hasPrintedClaim ? { printedClaim } : {}),
        participants: science.participants ?? null, ages: science.ages ?? null, result: science.result ?? null,
        evidenceLabel, evidenceExplanation: evidenceExplanations[evidenceLabel] ?? null,
        limitation: readerLimit ?? null, studyUrl: science.studyUrl ?? sourceURL(originalSource) },
      source: { title: cardTitles[4], people: detail.source?.people ?? originalSource.people ?? null,
        place: detail.source?.place ?? originalSource.place ?? null, year: detail.source?.year ?? originalSource.year ?? null,
        studyTitle: detail.source?.studyTitle ?? null, studyUrl: detail.source?.studyUrl ?? sourceURL(originalSource), searchPhrase: move.searchPhrase },
      plan: { title: cardTitles[2], backup: backupNameFor(move) },
      remember: { title: cardTitles[3], rhyme: kit.tagline, bodyAction: move.bodyAction,
        ...(detail.remember?.demonstration ? { demonstration: structuredClone(detail.remember.demonstration) } : {}) },
      hero: { title: 'Hero scene', moveSentence: move.actionLine, crop: geometry ? structuredClone(makePosterMap(version, '0'.repeat(64), geometry).regions.hero ?? null) : structuredClone(posterTemplate.regions.hero),
        jokeCrop: detail.hero?.jokeCrop ? structuredClone(detail.hero.jokeCrop) : null,
        jokeDescription: kit.jokeIdea, jokeExplanation: detail.hero?.jokeExplanation ?? null },
      keyword: { title: move.keyWord, word: move.keyWord, meaning: detail.keyword?.meaning ?? null, example: detail.keyword?.example ?? null },
      tagline: { title: kit.tagline, rhyme: kit.tagline, explanation: detail.tagline?.explanation ?? null, recallEnabled: true },
    },
    writtenByCodex: [
      ...(hasReaderNote ? ['sections.science.limitation'] : []),
      ...(hasReaderClaim ? ['sections.science.readerClaim'] : []),
      ...(hasPrintedClaim ? ['sections.science.printedClaim', 'printed.science.text'] : []),
      ...(move.kidScienceLineReview ? ['sections.science.claim', 'printed.science.text'] : []),
      ...(move.actionLineWrittenByCodex ? ['sections.hero.moveSentence'] : []),
      ...(move.bodyActionWrittenByCodex ? ['sections.remember.bodyAction'] : []),
      ...(move.backupChosenByCodex ? ['sections.plan.backup'] : []),
      ...(move.shortLineWrittenByCodex ? ['printed.source.text'] : []),
      ...(move.searchPhraseWrittenByCodex ? ['sections.source.searchPhrase', 'printed.source.text'] : []),
      ...(approvedDetails.writtenByCodex ?? []),
    ],
    approval: structuredClone(approvedDetails.approval ?? { approved: false, issues: [] }),
  };
  for (const id of interactiveRegionIds) if (/^#[a-f0-9]{6}$/iu.test(detail[id]?.accent ?? '')) content.sections[id].accent = detail[id].accent;
  content.writtenByCodex = [...new Set(content.writtenByCodex)];
  if (content.approval.approved !== true) content.approval.issues = validateInteractiveContent(content, { requireApproval: false }).faults;
  return content;
}

function rectangleInside(inner, outer) {
  return inner && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(inner[key])) && inner.w > 0 && inner.h > 0 &&
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

export function validateInteractiveContent(content, { requireApproval = true } = {}) {
  const faults = [];
  const requiredText = (object, field, path) => { if (!hasText(object?.[field])) faults.push(`${path}.${field} needs checked text`); };
  for (const field of ['version', 'title', 'moveId']) requiredText(content, field, 'content');
  const sections = content?.sections ?? {};
  if (!same(Object.keys(sections).sort(), [...interactiveRegionIds].sort())) faults.push('content needs exactly eight sections');
  for (const id of interactiveRegionIds) requiredText(sections[id], 'title', `sections.${id}`);
  const expectedTitles = { tinyTry: cardTitles[0], science: cardTitles[1], source: cardTitles[4], plan: cardTitles[2], remember: cardTitles[3],
    hero: 'Hero scene', keyword: sections.keyword?.word, tagline: sections.tagline?.rhyme };
  for (const id of interactiveRegionIds) if (sections[id]?.title !== expectedTitles[id]) faults.push(`sections.${id}.title must match its tapped element`);
  if (Object.keys(sections.plan ?? {}).some(key => !['title', 'backup', 'accent'].includes(key))) faults.push('stored plan content must not contain child answers');
  const fields = {
    tinyTry: ['instruction', 'validation', 'realWorldAction'],
    science: ['claim', 'tested', 'participants', 'ages', 'result', 'limitation'],
    source: ['people', 'place', 'studyTitle', 'searchPhrase'], plan: ['backup'], remember: ['rhyme', 'bodyAction'],
    hero: ['moveSentence', 'jokeDescription', 'jokeExplanation'], keyword: ['word', 'meaning', 'example'], tagline: ['rhyme', 'explanation'],
  };
  for (const [id, names] of Object.entries(fields)) for (const field of names) requiredText(sections[id], field, `sections.${id}`);
  for (const field of ['choices', 'steps']) if (!Array.isArray(sections.tinyTry?.[field]) || !sections.tinyTry[field].length || !sections.tinyTry[field].every(hasText)) faults.push(`sections.tinyTry.${field} needs approved text`);
  if (!hasText(content?.sourceText?.practiceScript) || normalize((sections.tinyTry?.steps ?? []).join(' ')) !== normalize(content.sourceText.practiceScript)) faults.push('practice steps must preserve the full approved script');
  // New content snapshots its display wording. Historical approved content is
  // never re-projected against a later reader-note table during validation.
  const noteReceipt = content.readerNotes;
  if (noteReceipt && (noteReceipt.version !== 'exact-v1' || !noteReceipt.guideLimit && !noteReceipt.guideClaim && !noteReceipt.posterClaim
      || noteReceipt.guideLimit && (!hasText(content.sourceText?.limitation) || !hasText(sections.science?.limitation)
        || noteReceipt.guideLimit.originalSHA256 !== digest(content.sourceText.limitation) || noteReceipt.guideLimit.plainSHA256 !== digest(sections.science.limitation))
      || noteReceipt.guideClaim && (!hasText(content.sourceText?.sourceAccount) || !hasText(sections.science?.readerClaim)
        || noteReceipt.guideClaim.originalSHA256 !== digest(content.sourceText.sourceAccount) || noteReceipt.guideClaim.plainSHA256 !== digest(sections.science.readerClaim))
      || noteReceipt.posterClaim && (!hasText(content.sourceText?.sourceAccount) || !hasText(sections.science?.printedClaim)
        || noteReceipt.posterClaim.originalSHA256 !== digest(content.sourceText.sourceAccount) || noteReceipt.posterClaim.plainSHA256 !== digest(sections.science.printedClaim)))
      || sections.science?.readerClaim !== undefined && !noteReceipt?.guideClaim
      || sections.science?.printedClaim !== undefined && !noteReceipt?.posterClaim) faults.push('reader notes must preserve their exact source and display wording');
  if (!(sections.science?.evidenceLabel in evidenceExplanations) || sections.science?.evidenceExplanation !== evidenceExplanations[sections.science?.evidenceLabel]) faults.push('science needs a specific claim evidence label and its exact explanation');
  const undatedGuidance = content.sourceRecords?.some(source => source.sourceType === 'official-guidance' && source.year === null && source.dateNotStated === true && source.dateLabel === 'No publication date shown' && source.url === sections.source?.studyUrl && preparedSourceURLAllowed(source.url));
  if (!Number.isInteger(sections.source?.year) && !undatedGuidance) faults.push('source.year needs a checked year or exact reviewed undated guidance');
  for (const id of ['science', 'source']) if (!studyURL(sections[id]?.studyUrl)) faults.push(`${id}.studyUrl needs a DOI, PubMed, ERIC or exact reviewed guidance link`);
  const hero = sections.hero;
  // Measured regions only: a composed poster whose hero was not measured shows the whole poster, no crop.
  const heroRegion = content?.layoutRegions ? content.layoutRegions.hero : posterTemplate.regions.hero;
  if (!heroRegion) { if (hero?.crop || hero?.jokeCrop) faults.push('hero crops need a measured hero region'); }
  else {
    if (!rectangleInside(heroRegion, { x: 0, y: 0, w: 612, h: 792 })) faults.push('hero region must lie inside the exported page');
    if (!same(hero?.crop, heroRegion)) faults.push('hero.crop must match the template region');
    if (!rectangleInside(hero?.jokeCrop, heroRegion)) faults.push('hero.jokeCrop needs a checked crop inside the scene');
    if (hero?.jokeCrop && hero.jokeCrop.w * hero.jokeCrop.h >= heroRegion.w * heroRegion.h / 2) faults.push('joke crop must stay smaller than the main scene');
  }
  if (sections.remember?.demonstration) {
    const demonstration = sections.remember.demonstration;
    if (demonstration.checked !== true || !hasText(demonstration.url) || !hasText(demonstration.caption) || !hasText(demonstration.reviewReference)) faults.push('demonstration needs a checked file, text version and review reference');
  }
  const printed = content?.printed ?? [];
  const printedIds = ['title', 'tagline', 'tiny', 'science', 'keyword', 'move', 'remember', 'source', 'footer'];
  if (!same(printed.map(box => box.id), printedIds)) faults.push('printed list must include every approved slot once');
  if (!same(printed.filter(box => box.card).map(box => box.title), cardTitles)) faults.push('printed list must contain exactly five approved card headings');
  const byId = Object.fromEntries(printed.map(box => [box.id, box]));
  if (byId.title?.text !== content.title || !hasText(byId.footer?.text)) faults.push('printed list must preserve the title and footer');
  // Row wrapping may change while the two blanks and words remain exact.
  // Approval hashes below still cover the original unnormalized content bytes.
  const planWords = value => typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : value;
  if (planWords(byId.move?.text) !== planWords(`${emptyMove}\nBackup: ${sections.plan?.backup}`)) faults.push('printed plan must keep both blanks empty');
  for (const [id, section, field] of [['tiny', 'tinyTry', 'instruction'], ['science', 'science', sections.science?.printedClaim !== undefined ? 'printedClaim' : 'claim'], ['keyword', 'keyword', 'word'], ['tagline', 'tagline', 'rhyme']]) {
    if (byId[id]?.text !== sections[section]?.[field]) faults.push(`printed ${id} and its section disagree`);
  }
  if (byId.remember?.text !== `${sections.remember?.rhyme}\n${sections.remember?.bodyAction}` || sections.remember?.rhyme !== sections.tagline?.rhyme) faults.push('remember and tagline must preserve the same rhyme');
  const count = printed.reduce((sum, box) => sum + visibleWords(boxText(box)).length, 0);
  if (requireApproval && (content?.approval?.approved !== true || !hasText(content.approval.reviewedBy) || !hasText(content.approval.reference) || content.approval.sha256 !== interactiveContentHash(content))) faults.push('content needs approval tied to these exact words');
  return { ready: faults.length === 0, faults, wordCount: count, wordCountReport: { count, status: count >= 110 ? 'WARN' : 'PASS', reportOnly: true } };
}

export function freezeInteractivePoster({ directory, imagePath, pdfPath, profileId, kitId, content, map, acceptance }) {
  const contentCheck = validateInteractiveContent(content);
  if (!contentCheck.ready) throw new Error(`Interactive content is not approved: ${contentCheck.faults.join('; ')}`);
  if (![profileId, kitId].every(hasText)) throw new Error('Stable profile and kit ids are required.');
  const image = readFileSync(imagePath), pdf = readFileSync(pdfPath);
  const imageSha256 = digest(image), pdfSha256 = digest(pdf);
  const dimensions = pngDimensions(imagePath);
  if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('The frozen print file must be a PDF.');
  if (map?.version !== content.version || map?.imageSha256 !== imageSha256 || map?.templateVersion !== acceptance?.geometry?.templateVersion || !same(map?.canvas, posterTemplate.canvas)) throw new Error('Image, map and content versions must match.');
  const geometry = validateGeometryReceipt(acceptance?.geometry, { expectedTemplateVersion: map.templateVersion, subBoxesRechecked: acceptance?.geometryReview?.subBoxesRechecked === true, readback: acceptance?.wordCheck?.transcription ?? [], wordVerdicts: content.printed.map(box => compareBoxWords(box, acceptance?.wordCheck?.transcription?.find(row => row.id === box.id)?.text ?? '')) });
  if (!geometry.ready) throw new Error(`The actual drawing failed its geometry check: ${[...geometry.faults, ...(geometry.measurementFaults ?? [])].join('; ')}`);
  const expectedMap = makePosterMap(content.version, imageSha256, geometry);
  // A composed poster's map holds only its measured regions; older maps hold all of them.
  const expectedIds = Object.keys(expectedMap.regions).sort();
  if (!same(Object.keys(map.regions ?? {}).sort(), expectedIds) || expectedIds.some(id => !same(map.regions[id], expectedMap.regions[id])) || !posterTemplateFor(map.templateVersion).composed && !same(expectedIds, [...interactiveRegionIds].sort())) throw new Error('The map does not match the approved drawing fit.');
  if (!same(content.sections.hero.crop ?? null, expectedMap.regions.hero ?? null)) throw new Error('Hero crop does not match the approved drawing fit.');
  if (Math.abs(dimensions.width / dimensions.height - map.canvas.width / map.canvas.height) > 1 / dimensions.height) throw new Error('The poster and template must have the same aspect ratio.');
  if (acceptance?.approved !== true || acceptance.version !== content.version || acceptance.imageSha256 !== imageSha256 || acceptance.pdfSha256 !== pdfSha256) throw new Error('Acceptance must name these exact image and PDF files.');
  const wordCheck = acceptance.wordCheck;
  if (wordCheck?.ready !== true || wordCheck.approvedWordCount !== contentCheck.wordCount || wordCheck.transcribedWordCount !== contentCheck.wordCount || wordCheck.blankPlan !== true) throw new Error('The actual final export needs its word and blank-plan check.');
  const transcription = wordCheck.transcription;
  if (wordCheck.approvedWordsSha256 !== interactivePrintedWordsHash(content) || !Array.isArray(transcription) ||
      transcription.some(box => !box || typeof box.id !== 'string' || typeof box.text !== 'string') ||
      !same(transcription.map(box => box.id), content.printed.map(box => box.id)) ||
      content.printed.some((box, index) => !compareBoxWords(box, transcription[index]?.text ?? '').matches)) throw new Error('The final transcription must match every approved printed word.');
  if (acceptance.print?.ready !== true || acceptance.print.blankPlan !== true || acceptance.print.letterSize !== true) throw new Error('The frozen print PDF needs its Letter and blank-plan check.');
  const storedContent = structuredClone(content), storedMap = structuredClone(map), storedAcceptance = structuredClone(acceptance);
  const contentBytes = jsonBytes(storedContent), mapBytes = jsonBytes(storedMap), acceptanceBytes = jsonBytes(storedAcceptance);
  const bundle = {
    version: content.version, profileId, kitId,
    image: { url: 'poster.png', version: content.version, sha256: imageSha256, ...dimensions },
    pdf: { url: 'poster.pdf', version: content.version, sha256: pdfSha256 },
    map: { ...storedMap, url: 'map.json', sha256: digest(mapBytes) },
    content: { ...storedContent, url: 'content.json', sha256: digest(contentBytes) },
    acceptance: { url: 'acceptance.json', sha256: digest(acceptanceBytes) },
  };
  const bundleBytes = jsonBytes(bundle);
  const frozenDirectory = join(directory, 'frozen', digest(bundleBytes));
  mkdirSync(join(directory, 'frozen'), { recursive: true, mode: 0o700 });
  // The folder and each file are new. Reusing a version never overwrites bytes.
  mkdirSync(frozenDirectory, { mode: 0o700 });
  const files = { 'poster.png': image, 'poster.pdf': pdf, 'content.json': contentBytes, 'map.json': mapBytes, 'acceptance.json': acceptanceBytes, 'bundle.json': bundleBytes };
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(frozenDirectory, name), bytes, { flag: 'wx', mode: 0o400 });
  return { bundle, directory: frozenDirectory, paths: Object.fromEntries(Object.keys(files).map(name => [name, join(frozenDirectory, name)])) };
}
