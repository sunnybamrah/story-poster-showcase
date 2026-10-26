import { globSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJSON, moves, saveJSON } from '../server/files.js';
import { printedLines } from '../server/printed-type.js';
import { posterTypePlan } from '../server/poster-template.js';
import { selectedRhymeFor } from '../server/rhyme.js';
import { kitEditorial } from '../server/kit-editorial.js';
import { printedCapacity } from '../server/printed-capacity.js';
import { splitStory, backupFor, emptyMove, talkOffer, talkQuestions, whereElsePrompt, parentChoice, parentAcceptance, replayQuestions, replayTransfer, parentGuidance, replayQuietNight, replayRule, noDirectEvidence } from '../server/format.js';

const fixture = readJSON(new URL('./fixtures/pass25-overflow.json', import.meta.url));
const height = (text, width = 540, size = 12, leading = 1.36) => printedLines(text, width, size).length * size * leading;
const paras = (texts, width, size = 12, leading = 1.36, gap = 1) => texts.reduce((sum, text, i) => sum + height(text, width, size, leading) + (i ? gap : 0), 0);
const sourceText = source => [source.fitLabel, source.people, source.year, source.title, source.journal, source.doi ? `DOI ${source.doi}` : '', source.pubmed ? `PubMed ${source.pubmed}` : ''].filter(Boolean).join('. ') + '.';
const sourceLines = move => [move.whereItCameFrom, ...move.sources.flatMap(source => [sourceText(source), source.limitation]), ...(!move.sources.some(source => source.fitLabel === 'DIRECT') ? [noDirectEvidence] : []), replayTransfer, parentGuidance, replayQuietNight, replayRule];

// Replay only the recorded source lines. This is a model of the CSS change,
// explicitly not a new browser measurement or a visual acceptance receipt.
export function replaySourceColumns(receipt) {
  const result = structuredClone(receipt), page = result.pages.find(p => p.page === 'for-you');
  const rows = page.elements.filter(row => Math.abs(row.fontPoints - 8.8) < .01), line = rows[0].bounds.h / Math.round(rows[0].bounds.h / (8.8 * 1.22));
  const totalLines = rows.reduce((sum, row) => sum + Math.round(row.bounds.h / line), 0);
  const top = Math.min(...rows.map(row => row.bounds.y)), bottom = top + Math.ceil(totalLines / 2) * line + 1.5;
  const margin = page.content.y + page.content.h - 6 - bottom;
  if (margin >= 0) {
    result.faults = result.faults.filter(fault => !fault.startsWith('for-you.')); result.ready = !result.faults.length;
    rows.forEach(row => { row.overflowPoints = 0; });
  }
  return { ...result, recordedModel: true, fixture: true, reason: 'Recorded run 15 line heights, split between two columns. Fresh browser fit is UNVERIFIED.', replayMargin: margin, fitting: { textHidden: false, typeShrunk: false } };
}

export function worstCaseReport() {
  const files = globSync('test/out/**/{kit-text-final,story-attempt-*}.json');
  const saved = files.flatMap(path => { try { const text = readJSON(path); return typeof text.story === 'string' && moves.some(m => m.id === text.moveId) ? [{ path, text }] : []; } catch { return []; } });
  if (!saved.length) saved.push({ path: 'test/fixtures/pass25-overflow.json', text: fixture.text });
  const largest = (getter, measure) => saved.reduce((best, row) => { const value = getter(row.text), used = measure(value); return !best || used > best.used ? { value, used, source: row.path } : best; }, null);
  const title = largest(t => t.chapterTitle, s => height(s, 445, 22, 1.08));
  const feel = largest(t => t.feelFirst, a => paras(a, 518));
  const tries = [0, 1, 2].map(i => largest(t => `${t.tinyTryOptions[i].text} (${t.tinyTryOptions[i].seconds} seconds)`, s => height(s, 497)));
  const place = largest(t => t.whereElse.place, s => height(s, 243));
  const feeling = largest(t => t.noticedFeeling, s => height(`I noticed you looked ${s}. That makes sense.`, 499));
  const cue = largest(t => t.replayCue, s => height(`Cue: ${s}`, 238, 10, 1.2));
  const fixedRhyme = Math.max(...moves.map(m => height(selectedRhymeFor(m).tagline)));
  const card = body => 2 + 13 * 1.08 + 16 + 12 + body;
  const fixedTry = move => card(0) + card(fixedRhyme + 1 + 13 * 1.36 + 17 + 10 + height(`Another way to try: ${backupFor(move).positiveAction}`, 518, 11)) + card(0) + card(Math.max(paras([talkOffer, ...talkQuestions], 243), height(whereElsePrompt, 243))) + 13 * 1.08 + height(move.whereItCameFrom) + 24;
  const tryFixed = Math.max(...moves.map(fixedTry));
  const tryGenerated = Math.max(...moves.map(move => card(feel.used) + card(height(selectedRhymeFor(move).tagline) + 1 + 13 * 1.36 + 17 + 10 + height(`Another way to try: ${backupFor(move).positiveAction}`, 518, 11)) + card(tries.reduce((sum, t) => sum + t.used, 0) + 4) + card(Math.max(paras([talkOffer, ...talkQuestions], 243), height(whereElsePrompt, 243) + 1 + place.used)) + 13 * 1.08 + height(move.whereItCameFrom) + 24));
  const tryOutside = 30 * .5 + 30 * 1.08 + 6 + 8 + 12 * 1.36 + 1;
  const sourceHeight = move => {
    // Whole lines can cross columns. The extra line covers a balance break and
    // the saved font's ink above/below its CSS line box.
    const lines = sourceLines(move).reduce((sum, s) => sum + printedLines(s, 255.25, 8.8).length, 0);
    return (Math.ceil(lines / 2) + 1) * 8.8 * 1.22 + 9;
  };
  const parentHeight = noticed => 2 + 13 * 1.08 + 12 + 12 + paras([`I noticed you looked ${noticed}. That makes sense.`, parentChoice, parentAcceptance, 'Afterwards: You did the move. What did you notice?'], 499, 12, 1.28, 2);
  const forYou = noticed => 22 * .5 + 22 * 1.08 + 6 + parentHeight(noticed) + 14 + 180 + 14 + 2 + 13 * 1.08 + 12 + Math.max(...moves.map(sourceHeight));
  const replayFront = Math.max(...moves.map(move => 2 + 11 * 1.08 + 14 + 12 + height(move.name, 238, 12, 1.08) + 4 + 12 * 1.36 + 6 + 8 + paras(replayQuestions, 238, 10, 1.2)));
  const replayBack = 2 + 11 * 1.08 + 14 + 12 + cue.used + paras(['My move: ______', fixture.text.tagline], 238, 10, 1.2) + 2 + 8 + 3 * 12 + 4;
  const fixedStoryHeight = Math.max(...moves.map(m => height(m.practiceScript.replaceAll('[name]', 'Pip'), 540, 11.5, 1.28)));
  const storyPages = [0, 1].map(index => {
    const longest = largest(t => {
      const pagination = t.pagination ?? splitStory(t.story, t.panelLines);
      const move = moves.find(m => m.id === t.moveId), practice = move.practiceScript.replaceAll('[name]', 'Pip');
      // For a practice passage already present on this page, replace its height
      // with the longest of all 14 records. Otherwise reserve the longest one.
      const page = pagination.pages[index], stripped = page.replace(practice, '').replace(practice.replace(/\bDad\b/g, 'Dee'), '');
      return stripped;
    }, s => paras(s.split(/\n+/).filter(Boolean), 540, 11.5, 1.28));
    const fixed = 22 * .5 + title.used + 6 + fixedRhyme + 1 + 176.4 + 6 + 10 * 1.28 + 1 + fixedStoryHeight;
    return { page: index ? 'story-2' : 'story', fixedMargin: 700 - fixed, margin: 700 - fixed - longest.used, longestSaved: longest.source };
  });
  const posterMargin = Math.min(...moves.flatMap(m => Object.values(posterTypePlan(m, { tagline: selectedRhymeFor(m).tagline }).cards).flatMap(c => [c.heading.margin, (c.body ?? c.backup).margin])));
  const pages = [{ page: 'poster', fixedMargin: posterMargin, margin: posterMargin }, ...storyPages,
    { page: 'try', fixedMargin: 700 - tryOutside - tryFixed, margin: 700 - tryOutside - tryGenerated },
    { page: 'for-you', fixedMargin: Math.min(700 - forYou(''), 180 - replayFront), margin: Math.min(700 - forYou(feeling.value), 180 - replayFront, 180 - replayBack) }].map(p => ({ ...p, fixedMargin: +p.fixedMargin.toFixed(2), margin: +p.margin.toFixed(2), needsShortening: p.margin < 0 }));
  const largestMove = metric => moves.reduce((best, move) => metric(move) > metric(best) ? move : best).id;
  const report = { measured: false, method: 'Bundled font advances and recorded run 15 line heights. Conservative page-local worst cases, combining the largest saved fields with the longest fixed records. Negative margins require measured writer shortening. Browser and both themes UNVERIFIED.', moves: moves.length, savedAnswers: saved.length, pages,
    fixedSources: { practice: largestMove(m => height(m.practiceScript.replaceAll('[name]', 'Pip'), 540, 11.5, 1.28)), try: largestMove(fixedTry), sources: largestMove(sourceHeight) },
    generatedSources: { title, feel, tries, place, feeling, cue }, run15: replaySourceColumns(fixture.receipt) };
  // Only numeric results and paths go into the report; writer prose stays in its
  // saved answer or fixture, including any future family-only context folder.
  report.generatedSources = Object.fromEntries(Object.entries(report.generatedSources).map(([k, v]) => [k, Array.isArray(v) ? v.map(({ source, used }) => ({ source, used })) : { source: v.source, used: v.used }]));
  delete report.run15.pages;
  if (existsSync('test/out')) saveJSON('test/out/pass25-capacity.json', report);
  return report;
}

// Reuse the actual page builder, bundled fonts and Chrome. Each candidate keeps
// short dialogue paragraphs, the fixed furniture, and all readable type sizes.
export async function measurePrintedCapacity(directory = resolve('test/out/pass29-capacity')) {
  const { readableKitText } = await import('./readable-kit-fixture.mjs');
  const { makePages, combinedKitHTML, copyFonts } = await import('../server/layout.js');
  const { launchMeasurementBrowser } = await import('../server/layout-fit.js');
  mkdirSync(directory, { recursive: true }); copyFonts(directory);
  const browser = await launchMeasurementBrowser(), results = [];
  try {
    const page = await browser.newPage({ viewport: { width: 816, height: 1056 } });
    for (const move of moves) {
      const text = readableKitText();
      text.moveId = move.id; text.tagline = selectedRhymeFor(move).tagline;
      text.story = text.story.replace(moves.find(m => m.id === 'name-it-exactly').practiceScript, move.practiceScript);
      text.pagination = splitStory(text.story, text.panelLines);
      text.chapterTitle = 'The Quiet Chair Beside The Door';
      const path = join(directory, `${move.id}.html`);
      writeFileSync(path, combinedKitHTML(makePages(move, text, { nickname: 'Pip', parentLabel: 'Dee' })), { mode: 0o600 });
      for (const theme of ['light', 'dark']) {
        await page.goto(`${pathToFileURL(path)}?print=1&theme=${theme}`);
        await page.waitForFunction(() => document.documentElement.dataset.fitted === 'true');
        results.push({ move: move.id, theme, ...await page.evaluate(() => {
          const dialogue = [
            'The door bangs.', 'Pip drops his bag.', '“Please stay here.”',
            'Dee pulls a chair closer. His paper stays face down on the table.',
            '“The knot is still here,” he says. He turns the pencil over in his hand.',
            'Dee looks at Pip. “You can choose how much to tell me.”',
            'Pip draws a small hat on the empty bubble. He almost smiles at it.',
            '“That bubble has nothing to say either.” Dee leaves his hands on the table.',
            'He moves his chair closer. The paper can wait until he wants to show it.',
            '“I am still annoyed.” Pip rests the pencil beside his bag and looks at Dee.',
          ];
          const fill = (n, sample) => Array.from({ length: n }, (_, i) => sample.split(/\s+/)[i % sample.split(/\s+/).length]).join(' ');
          const paragraphs = (n, firstPage) => {
            const lines = []; let left = n, index = 0;
            if (firstPage) for (const hook of dialogue.slice(0, 3)) {
              const count = Math.min(left, hook.split(/\s+/).length);
              if (count) lines.push(fill(count, hook)); left -= count;
            }
            // Match the writer's paragraph guidance rather than measuring
            // hundreds of words as separate seven-word dialogue paragraphs.
            while (left > 0) { const sample = dialogue.slice(index % 6, index % 6 + 4).join(' '); index++; const count = Math.min(left, 30); lines.push(fill(count, sample)); left -= count; }
            return lines;
          };
          const fits = sheet => {
            const sources = sheet.querySelector('.sources');
            if (sources) { const body = sources.querySelector('.card-body'); body.style.height = `${Math.max(0, sources.getBoundingClientRect().height - sources.querySelector('h2').getBoundingClientRect().height - 2 * parseFloat(getComputedStyle(sources).borderTopWidth))}px`; }
            const bounds = sheet.getBoundingClientRect(), bottom = bounds.bottom - sheet.querySelector('.page-footer').getBoundingClientRect().height;
            if (sheet.querySelector('.page-footer').getBoundingClientRect().bottom > bounds.bottom + 1) return false;
            for (const node of sheet.querySelectorAll('h1,h2,h3,p,li,.writing-frame,.key-word,.identity')) {
              if (!node.textContent.trim()) continue;
              const range = document.createRange(); range.selectNodeContents(node);
              const ink = range.getBoundingClientRect(), card = node.closest('.card')?.getBoundingClientRect();
              if (ink.bottom > bottom + 1 || ink.left < bounds.left - 1 || ink.right > bounds.right + 1 || (card && ink.bottom > card.bottom + 1)) return false;
            }
            return true;
          };
          const search = (sheet, apply, high = 800) => {
            let low = 0, upper = high;
            apply(0); if (!fits(sheet)) throw Error(`Fixed furniture does not fit ${sheet.dataset.page}`);
            while (low < upper) { const n = Math.ceil((low + upper) / 2); apply(n); if (fits(sheet)) low = n; else upper = n - 1; }
            apply(low); const ready = fits(sheet); apply(low + 1); const nextFits = fits(sheet); apply(low);
            return { words: low, ready, nextFits };
          };
          const story = ['story', 'story-2'].map(name => {
            const sheet = document.querySelector(`[data-page="${name}"]`), body = sheet.querySelector('.chapter-text');
            const result = search(sheet, n => body.replaceChildren(...paragraphs(n, name === 'story').map(line => { const p = document.createElement('p'); p.dataset.generated = 'story'; p.textContent = line; return p; })));
            const style = getComputedStyle(body), p = body.querySelector('p');
            return { ...result, bodyPoints: parseFloat(style.fontSize) * .75, lineHeight: parseFloat(style.lineHeight) / parseFloat(style.fontSize), gapPoints: parseFloat(getComputedStyle(p).marginBottom) * .75, panelHeightPoints: sheet.querySelector('.panels').getBoundingClientRect().height * .75 };
          });
          const trySheet = document.querySelector('[data-page="try"]');
          // This existing fixed-furniture spacing floor is available after a
          // targeted cut. Type, panel height and handwriting space stay fixed.
          trySheet.dataset.fit = 'compact';
          const bases = { feelFirst: 14, 'tinyTryOptions[0].text': 10, 'tinyTryOptions[1].text': 10, 'tinyTryOptions[2].text': 10, 'whereElse.place': 6 };
          const sample = 'You can choose a small moment and say the feeling word that fits you best today';
          let fields;
          const tryResult = search(trySheet, n => {
            let remaining = n; const entries = Object.entries(bases);
            fields = Object.fromEntries(entries.map(([field, weight], index) => { const count = index === entries.length - 1 ? remaining : Math.floor(n * weight / 50); remaining -= count; return [field, count]; }));
            for (const [field, count] of Object.entries(fields)) {
              const nodes = [...trySheet.querySelectorAll('[data-generated]')].filter(node => node.dataset.generated === field);
              nodes.forEach((node, index) => { const words = nodes.length === 2 ? index ? count - Math.floor(count / 2) : Math.floor(count / 2) : count; node.textContent = [fill(words, sample), node.dataset.fixedText].filter(Boolean).join(' '); });
            }
          }, 400);
          const cards = document.querySelector('[data-page="for-you"]');
          cards.querySelector('[data-generated="noticedFeeling"]').textContent = 'I noticed you looked left out. That makes sense.';
          const cue = cards.querySelector('[data-generated="replayCue"]');
          const cardsResult = search(cards, n => { cue.textContent = `Cue: ${fill(n, 'My stomach feels tight when I think about the school door')}`; }, 100);
          return { story, try: { ...tryResult, fields }, 'for-you': { ...cardsResult, fields: { noticedFeeling: 2, replayCue: cardsResult.words } } };
        }) });
      }
    }
  } finally { await browser.close(); }
  const pages = [0, 1].map(index => Math.min(...results.map(row => row.story[index].words)));
  const fieldsFor = (name, rows = results) => Object.fromEntries(Object.keys(rows[0][name].fields).map(field => [field, Math.min(...rows.map(row => row[name].fields[field]))]));
  const tryFields = fieldsFor('try'), cardFields = fieldsFor('for-you');
  const editorialCapacity = printedCapacity(), editorialStory = editorialCapacity.story;
  const sample = results[0].story[0];
  const capacity = { measured: true, measuredAt: new Date().toISOString(), method: 'Pass 37 photographed practice layout. Real Chrome, bundled fonts, both themes, all 14 fixed move records. Binary search using three short hook lines followed by roughly 30-word paragraphs. Measured sample capacities are separate from the FORMAT chapter target; actual measured overflow controls shortening. These are synthetic layout probes, not generated kits or picture checks.',
    typography: { bodyPoints: sample.bodyPoints, lineHeight: sample.lineHeight, paragraphGapPoints: sample.gapPoints, panelHeightInches: sample.panelHeightPoints / 72, storyWidthPoints: 540 },
    story: { ...editorialStory, measuredSamplePages: pages },
    try: { ...editorialCapacity.try, measuredSampleFields: tryFields },
    'for-you': { ...editorialCapacity['for-you'], measuredSampleFields: cardFields },
    byMove: Object.fromEntries(moves.map(move => {
      const rows = results.filter(row => row.move === move.id), storyPages = [0, 1].map(index => Math.min(...rows.map(row => row.story[index].words)));
      const small = name => ({ ...editorialCapacity[name], measuredSampleFields: fieldsFor(name, rows) });
      return [move.id, { story: { ...editorialStory, measuredSamplePages: storyPages }, try: small('try'), 'for-you': small('for-you') }];
    })),
    ownerReview: `${kitEditorial.reviewLabel}: FORMAT v5's 550 to 750 spoken words guide new writing. The ${editorialStory.targetWords}-word target and planned page allowances are estimates, never count-only stops. This measurement samples paragraph shapes; each actual kit must fit.`,
  };
  saveJSON(join(directory, 'measurements.json'), { capacity, results });
  saveJSON(resolve('content/printed-capacity.json'), capacity);
  return { directory, ...capacity };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href && process.argv.includes('--measure')) console.log(JSON.stringify(await measurePrintedCapacity(), null, 2));
