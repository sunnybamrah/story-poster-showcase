import { selectedRhymeFor } from './rhyme.js';
import { readJSON, moves } from './files.js';
import { identityHits } from './identity-text.js';
import { POSTER_SCENE_RULES } from './scene-rules.js';
import { pictureSegments, isCodeDigit } from './picture-code-digits.js';
import { readerClarity, practiceReaderText } from '../app/reader-notes.js';

const vocabulary = readJSON(new URL('../content/common-words.json', import.meta.url));
const common = new Set([...vocabulary.commonEnglish, ...vocabulary.lookWords, 'practice', 'practise', 'grouping', 'objects', 'material', 'materials']);
const sensitive = new Set(vocabulary.sensitiveWords);
const functionWords = new Set(['i', "i'm", "i've", "i'll", "i'd", 'the', 'a', 'an', 'and', 'or', 'but', 'with', 'in', 'at', 'for', 'of', 'to', 'from', 'on', 'our', 'their', 'we', 'you', 'he', 'she', 'it', 'my', 'is', 'are', 'was', 'were']);
const ordinaryCapital = word => functionWords.has(word) && (common.has(word) || word.startsWith("i'"));
const clean = text => String(text ?? '').normalize('NFKC').replace(/[‘’]/g, "'");
const lower = text => clean(text).toLowerCase();
const tokenize = text => [...clean(text).matchAll(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu)].map(match => ({ text: match[0], word: lower(match[0]).replace(/'s$/, ''), start: match.index, end: match.index + match[0].length }));
const sentenceBreak = text => /[.!?;\r\n]/u.test(text);
function catalog(context) {
  const source = clean(context.familyContext), tokens = tokenize(source), singles = new Map(), pairs = new Set();
  tokens.forEach((token, index) => {
    // English vocabulary never overrides an identified name, digit or explicit secret.
    if (/\p{N}/u.test(token.text)) singles.set(token.word, 'familyContext digit token');
    else if (/^\p{Lu}/u.test(token.text) && !ordinaryCapital(token.word) && !common.has(token.word)) singles.set(token.word, 'familyContext name');
    else if (sensitive.has(token.word)) singles.set(token.word, 'familyContext sensitive word');
    else if (common.has(token.word)) { /* Secondary ordinary-English exemption. */ }
    // Ordinary sentence starters use the English exemption; unknown capitalised names do not.
    // Keep specific relationships and lived facts private. Sharing an ordinary
    // colour, object or room word with a family note does not identify a person.
    for (let size = 2; size <= 7 && size <= index + 1; size++) {
      const phrase = tokens.slice(index + 1 - size, index + 1), words = phrase.map(item => item.word).join(' ');
      if (!sentenceBreak(source.slice(phrase[0].end, token.start)) &&
        (/^(?:coach|teacher|aunt|uncle|grandma|grandpa|friend|school) /.test(words) && phrase.some(item => singles.get(item.word) === 'familyContext name') ||
        /^(?:little|older|younger|twin|step|half) (?:brother|sister|sibling)$|^(?:shares?|shared) (?:a |the )?room$|^(?:soccer|football|baseball|basketball|dance|piano) (?:tryouts?|team|club|lessons?)$|^(?:lives?|stays?|goes?|attends?|works?) (?:at|on|in) .+|^(?:has|takes|needs) (?:insulin|medication|medicine|therapy|dialysis)\b/.test(words))) pairs.add(words);
    }
  });
  for (const match of source.matchAll(/\b(?:named|called|pet is|dog is|cat is|school is|coach|teacher|friend)\s+(\p{Lu}[\p{L}'-]*)/gu)) singles.set(lower(match[1]), 'familyContext name');
  // Shared guide/search text needs a general goal, not a copied location from
  // the private note. Image scenes keep their ordinary objects and colours.
  const privateNote = clean(context.privateNoteFragments);
  for (const match of privateNote.matchAll(/\b(?:on|in|at|near|beside|behind|under|inside)\s+(?:the|our|my|his|her|their)\s+([^.!?;,]+)/giu)) {
    const words = tokenize(match[1]);
    const boundary = words.findIndex(token => /^(?:and|but|while|because|then|yesterday|today|tonight|before|after|wants|wanted)$/.test(token.word));
    const place = boundary < 0 ? words : words.slice(0, boundary);
    for (let start = 0; start < place.length; start++) for (let end = start + 3; end <= Math.min(place.length, start + 7); end++) {
      const phrase = place.slice(start, end);
      if (phrase.filter(token => !functionWords.has(token.word)).length >= 3) pairs.add(phrase.map(token => token.word).join(' '));
    }
  }
  const identitySource = clean(context.identityContext), identityTokens = tokenize(identitySource);
  identityTokens.forEach((token, index) => {
    if (/\p{N}/u.test(token.text)) singles.set(token.word, 'familyContext digit token');
    else if (/^\p{Lu}/u.test(token.text) && !ordinaryCapital(token.word) && !common.has(token.word)) singles.set(token.word, 'familyContext name');
  });
  const exact = [];
  for (const pattern of [/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, /(?:\+?\d[\d ()-]{6,}\d)/gu, /\b\d+\s+(?:[\p{L}]+\s+){1,5}(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|court|ct|boulevard|blvd)\b/giu]) {
    for (const match of source.matchAll(pattern)) exact.push(match[0]);
  }
  return { singles, pairs, exact };
}
export function fixedPrivacyPassages(context) {
  const move = moves.find(item => item.id === context.moveId);
  return [...(move ? ['actionLine', 'name', 'childPhrase', 'practiceScript', 'positiveAction', 'kidScienceLine', 'whereItCameFrom', 'whereItCameFromShort', 'searchPhrase', 'bodyAction'].map(key => move[key]) : []), ...(move ? [
    selectedRhymeFor(move).tagline,
    practiceReaderText('guide-practice', move, move.practiceScript),
    practiceReaderText('guide-action', move, move.positiveAction),
    readerClarity('poster-claim', move.id, move.science?.claim ?? move.kidScienceLine),
  ] : []), POSTER_SCENE_RULES].filter(value => typeof value === 'string' && value);
}
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function withoutFixed(text, context, preserveCase = false) {
  let result = clean(text);
  for (const passage of fixedPrivacyPassages(context)) result = result.replace(new RegExp(escape(clean(passage)), 'giu'), match => '.' + ' '.repeat(match.length - 1));
  return preserveCase ? result : lower(result);
}
function individualParentHit(text, label, context) {
  const candidate = withoutFixed(text, context, true);
  return identityHits(candidate, { ...context, parentLabel: label, parentLabels: [] }).some(hit => {
    if (hit.kind !== 'parent label') return false;
    // A common lowercase word is ordinary prose. A capitalized name is private.
    if (!tokenize(hit.alias).every(token => common.has(token.word))) return true;
    const alias = new RegExp('(?<![\\p{L}\\p{N}_])' + escape(hit.alias) + '(?![\\p{L}\\p{N}_])', 'giu');
    return [...candidate.matchAll(alias)].some(match => /\p{Lu}/u.test(match[0]));
  });
}
export function familyContextHits(value, context) {
  const original = clean(value), text = withoutFixed(original, context), { singles, pairs, exact } = catalog(context), tokens = tokenize(text), hits = [];
  tokens.forEach((token, index) => {
    if (singles.has(token.word)) hits.push({ kind: singles.get(token.word), text: original.slice(token.start, token.end), start: token.start, end: token.end });
    for (let size = 2; size <= 7 && size <= index + 1; size++) {
      const phrase = tokens.slice(index + 1 - size, index + 1), start = phrase[0].start;
      if (!sentenceBreak(text.slice(phrase[0].end, token.start)) && pairs.has(phrase.map(item => item.word).join(' '))) hits.push({ kind: 'familyContext phrase', text: original.slice(start, token.end), start, end: token.end });
    }
  });
  for (const passage of exact) for (const match of text.matchAll(new RegExp(escape(lower(passage)).replace(/\s+/g, '\\s+'), 'giu'))) hits.push({ kind: 'familyContext contact or address', text: original.slice(match.index, match.index + match[0].length), start: match.index, end: match.index + match[0].length });
  return hits;
}
export function picturePrivacyHits(body, context) {
  if (!context || typeof context.familyContext !== 'string' || !context.nickname || typeof context.tonight !== 'string') throw new Error('OpenAI privacy context is required.');
  return pictureSegments(body).flatMap(({ text, field }) => {
    const tokens = new Set(tokenize(text).map(token => token.word)), hits = [];
    if (/^data:image\//.test(text)) hits.push({ kind: 'malformed image data', text });
    if (tokenize(context.nickname).some(token => tokens.has(token.word))) hits.push({ kind: 'the nickname', text: context.nickname });
    for (const hit of identityHits(text, context).filter(hit => hit.kind === 'hero name')) hits.push({ kind: 'the hero name', text: hit.alias });
    if (context.parentLabel && !['dad', 'mom', 'parent'].includes(lower(context.parentLabel)) && tokenize(context.parentLabel).some(token => tokens.has(token.word))) hits.push({ kind: 'the parent label', text: context.parentLabel });
    for (const label of context.parentLabels ?? []) if (label && !['dad', 'mom', 'parent'].includes(lower(label)) && individualParentHit(text, label, context)) hits.push({ kind: 'the parent label', text: label });
    hits.push(...familyContextHits(text, context).filter(hit => !isCodeDigit(body, field, text, hit)));
    if (context.tonight.trim() && lower(text).includes(lower(context.tonight).trim())) hits.push({ kind: "tonight's sentence", text: context.tonight });
    return hits.map(hit => ({ field, ...hit }));
  });
}

function generic(text, kind, context) {
  const tokens = tokenize(text).map(token => token.word), phrase = tokens.join(' ');
  if (/\b(brother|sister|sibling|son|daughter)\b/.test(phrase)) return 'another child';
  if (/\b(coach|teacher|grandad|grandma|grandpa|aunt|uncle)\b/.test(phrase)) return 'a grown-up';
  if (/\b(soccer|tryouts|football|baseball|basketball)\b/.test(phrase)) return 'a game';
  if (/\b(school|room|kitchen|bedroom|home|street)\b/.test(phrase)) return 'a space';
  if (/\b(dog|cat|pet)\b/.test(phrase)) return 'an animal';
  if (kind === 'familyContext name') {
    const source = tokenize(`${context.familyContext}. ${context.identityContext ?? ''}`);
    const at = source.findIndex(token => tokens.includes(token.word));
    const near = source.slice(Math.max(0, at - 3), at + 4).map(token => token.word).join(' ');
    if (/\b(dog|cat|pet)\b/.test(near)) return 'an animal';
    if (/\b(school|street|town|city)\b/.test(near)) return 'a place';
    return 'someone';
  }
  if (kind === 'familyContext digit token' || kind === 'familyContext sensitive word') return 'a detail';
  return 'a detail';
}
export function scrubFamilyContext(value, context) {
  if (typeof value !== 'string') return value;
  let result = clean(value);
  // Resolve overlapping context matches together, and never loop on a new generic phrase.
  const seen = new Set();
  while (!seen.has(result)) {
    seen.add(result);
    const hits = familyContextHits(result, context).sort((a, b) => a.start - b.start || b.end - a.end);
    if (!hits.length) break;
    const spans = [];
    for (const hit of hits) {
      const previous = spans.at(-1);
      if (previous && hit.start < previous.end) previous.end = Math.max(previous.end, hit.end);
      else spans.push({ ...hit });
    }
    for (const span of spans.reverse()) {
      const before = result.slice(0, span.start), after = result.slice(span.end);
      // Avoid "their another child" or "a someone" after replacing a name or phrase.
      const prefix = before.replace(/\b(their|his|her|my|our|the|a|an)\s+$/i, '');
      const candidates = [generic(result.slice(span.start, span.end), span.kind, context), 'a figure', 'a detail', 'something'];
      let replacement = candidates.find(value => !familyContextHits(value, context).length && !identityHits(value, context).length) ?? 'something';
      if (!prefix.trim() || /[.!?]\s*$/.test(prefix)) replacement = replacement[0].toUpperCase() + replacement.slice(1);
      result = prefix + replacement + after;
    }
  }
  return result;
}
