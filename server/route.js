import { readJSON } from './files.js';
const rules = readJSON(new URL('../content/routes.json', import.meta.url));
const responses = readJSON(new URL('../content/parent-responses.json', import.meta.url));
const safety = readJSON(new URL('../content/parent-safety.json', import.meta.url));
const normalize = text => text.normalize('NFKC').replace(/[’‘]/g, "'").toLowerCase();

// Every route uses the same clause context. A keyword in a book title, a
// negated event or a different speaker's action is not the parent's event.
function contexts(sentence) {
  const whole = normalize(sentence);
  return whole.split(/[.!?;\n]+|\b(?:but|however)\b|(?:\band\b|\bthen\b|,)\s*(?=(?:(?:my|our) (?:child|son|daughter|kid)|(?:he|she|they|i) (?:said|says|told|want(?:s|ed)?|wish(?:es|ed)?|hop(?:e|es|ed))))/gu).filter(Boolean).map(text => ({
    text,
    whole,
    event: eventContext(text, whole)
      .replace(/\b(?:hit(?:s|ting)?|kick(?:ed|s|ing)?|punch(?:ed|es|ing)?)\s+(?:a |the |his |her |their )?(?:footballs?|soccer balls?|balls?|air|punching bags?|bags?|keys?|notes?)\b/gu, ''),
  }));
}
function eventContext(text, whole) {
  const realDisclosure = /\b(?:happened|happens|happening|in real life|for real|not (?:just |only )?(?:a |the )?(?:character|avatar|story|game))\b/u.test(text)
    || /\b(?:and|but|however)\s+(?:my (?:child|son|daughter)|she|he|they)\s+(?:said|says|told me)\s+(?:it|this|that)\s+(?:happened|happens|is happening)\b/u.test(whole);
  const media = /\b(?:story|book|film|movie|(?:video )?game|fictional)\b/u.test(whole);
  const fictionalActor = /\b(?:character|avatar|villain|fictional (?:child|person|girl|boy))\s+(?:(?:in|from)\s+(?:(?!and\b|said\b|says\b|told\b)\w+\s+){0,6})?(?:said|says|told|wants?|wanted|wished|hopes?|hoped|does|did|is|was)\b|\b(?:said|spoken) by (?:the |a )?(?:character|avatar|villain)\b/u.test(text);
  // A fictional character's explicitly attributed words are not a report
  // about the child. Playing a game alone never cancels a child's disclosure.
  if (media && fictionalActor && !realDisclosure) return '';
  return realDisclosure || /\b(?:told|said|says|confided)\b/u.test(text) ? text : text.replace(/\b(?:read|reading|watched|watching)\s+(?:(?:a|the)\s+)?(?:story|book|film|movie|game)\s+about\s+[^,]*$/gu, '');
}
function affirmed(text, pattern) {
  return [...text.matchAll(new RegExp(`\\b(?:${pattern})(?:\\b|$)`, 'giu'))].some(match => {
    const before = text.slice(Math.max(0, match.index - 45), match.index);
    // Retain intrinsic negatives such as "does not want advice" and
    // "does not want to live". They are themselves the event being routed.
    const directNegation = /\b(?:not|never|no|without|isn't|wasn't|aren't|weren't|didn't|doesn't|don't|wouldn't|couldn't|haven't|hadn't)\s+(?:(?:been|being|really|actually|ever|at all|even)\s+)*$/u.test(before);
    const negatedIntent = /\b(?:not|never|didn't|doesn't|don't|wouldn't|couldn't)\s+(?:(?:really|actually|ever|even)\s+)*(?:(?:want(?:ed|s)?|wish(?:ed|es)?|hop(?:ed|es|e))\s+)?to\s*$/u.test(before);
    const deniedReport = /\b(?:(?:didn't|did not|doesn't|does not|never) (?:say|said|tell|told|report|reported|mean)|den(?:y|ies|ied)|(?:not|isn't|wasn't) true)\s+(?:(?:that|any|she|he|they|i|me|us|anyone|them|ever|really|actually|had|has|was|were|wanting|to)\s+)*$/u.test(before);
    return !directNegation && !negatedIntent && !deniedReport;
  });
}
const reflexive = '(?:myself|himself|herself|themselves|themself|yourself|ourselves)';
const deathOrSelfHarm = `(?:die|be dead|kill ${reflexive}|(?:hurt|harm|cut|injure) ${reflexive}|(?:end|take) (?:(?:my|his|her|their|your|our) (?:own )?life|my life|their lives))`;
const desire = '(?:want(?:s|ed|ing)?|wish(?:es|ed|ing)?|hop(?:e|es|ed|ing)|plan(?:s|ned|ning)?|intend(?:s|ed|ing)?|decid(?:e|es|ed|ing))';
const intentAdverbs = '(?:(?:really|still|just|only|ever|actually|sometimes)\\s+)*';
function selfDirectedIntent(text) {
  // Past tense and reported speech retain the original concern, even when
  // the child is calm now. Negation is attached to the intended outcome:
  // not wanting to live is different from not wanting to die.
  const positive = `${desire}\\s+${intentAdverbs}(?:to\\s+${intentAdverbs}${deathOrSelfHarm}|(?:that\\s+)?(?:i|he|she|they)\\s+(?:(?:could|would)\\s+(?:die|${deathOrSelfHarm})|(?:was|were|is|are)\\s+(?:dead|not alive)|(?:had|have)\\s+never been born))`;
  const noLife = `(?:(?:do|does|did|would)(?:n't| not)\\s+${intentAdverbs}want|(?:not|never)\\s+${intentAdverbs}want(?:s|ed|ing)?)\\s+to\\s+(?:live(?![- ]stream(?:ing)?\\b)(?!\\s+(?:in|at|with|near)\\s+(?!(?:this|the) world\\b))|be alive|exist)(?:\\s+(?:anymore|any longer))?`;
  const considering = `(?:think(?:s|ing)?|thought)\\s+(?:about|of)\\s+(?:dying|(?:hurting|harming|cutting|killing) ${reflexive}|(?:ending|taking) (?:my|his|her|their|your|our) (?:own )?life)`;
  return affirmed(text, positive) || affirmed(text, noLife) || affirmed(text, considering);
}
const person = '(?:him|her|them|me|us|my (?:son|daughter|child|kid)|his (?:arm|head|face)|her (?:arm|head|face)|their (?:arm|head|face)|(?:the |my )?(?:brother|sister|child|kid))';
const harm = '(?:punch(?:ed|es|ing)?|kick(?:ed|s|ing)?|hit(?:s|ting)?|slap(?:ped|s|ping)?|beat(?:en|s|ing)?|shov(?:ed|es|ing)|push(?:ed|es|ing)?|hurt(?:s|ing)?)';
const adultActor = '(?:adult|grown[- ]up|parent|dad|mom|mum|mother|father|teacher|coach|babysitter|uncle|aunt)';
const childRecipient = '(?:(?:(?:my|our|the|his|her|their|a) )?(?:child|children|son|daughter|kid|kids)|me|him|her|them)';
function physicalEventContext(event) {
  // Keep emotional words available to ordinary lesson matching. Only physical
  // harm checks mask these clearly figurative phrases and harmless play forms.
  let physical = event
    .replace(/\bhurt(?:s|ing)?\s+(?:(?:(?:my|our|the|his|her|their|a)\s+)?(?:child|son|daughter|kid)['’]s|my|our|his|her|their)\s+feelings\b/gu, ' ')
    .replace(new RegExp(`\\bhit\\s+${childRecipient}\\s+(?:a|the)\\s+(?:ground\\s+)?ball\\b`, 'gu'), ' ');
  const literal = /\b(?:physically|forcefully|roughly|bruis\w*|bleed\w*|blood|injur\w*|pain|crying|cried|fell|falling|didn['’]t want|did not want|against (?:my|his|her|their) will)\b/u.test(physical);
  if (!literal) {
    physical = physical
      .replace(new RegExp(`\\bpush(?:ed|es|ing)?\\s+${childRecipient}\\s+on\\s+(?:(?:a|the)\\s+)?swing\\b`, 'gu'), ' ')
      .replace(new RegExp(`\\bpush(?:ed|es|ing)?\\s+${childRecipient}\\s+to\\s+(?:try|run|finish|read|learn|practise|practice|work|start|do|keep)\\b`, 'gu'), ' ')
      .replace(new RegExp(`\\bpush(?:ed|es|ing)?\\s+${childRecipient}\\s+through\\s+(?:more\\s+|the\\s+|his\\s+|her\\s+|their\\s+)*(?:homework|schoolwork|reading|work|a lesson)\\b`, 'gu'), ' ');
  }
  return physical;
}
function adultDirectedHarm(event) {
  event = physicalEventContext(event);
  const active = `${adultActor}\\s+(?:(?:has|had|is|was|just|keeps?|kept|physically|roughly|forcefully|deliberately|suddenly)\\s+)*${harm}\\s+${childRecipient}`;
  const passive = `${childRecipient}\\s+(?:(?:was|is|got|gets|has been|had been)\\s+)(?:being\\s+)?${harm}\\s+by\\s+(?:(?:an?|the|my|our|his|her|their)\\s+)?${adultActor}`;
  const parentOwned = `i\\s+(?:(?:just|had|have)\\s+)*${harm}\\s+(?:my|our)\\s+(?:child|son|daughter|kid)`;
  const carriedPattern = `(?:^|\\b(?:said|says|told me|reported)\\s+(?:that\\s+)?)(?:(?:an?|the|my|our|his|her|their)\\s+)?${adultActor}\\b([^.!?;]*)`;
  const carried = event.match(new RegExp(carriedPattern, 'u'));
  const freshSubject = /\b(?:and|then|when|while|because|after|before)\s+(?:(?:(?:my|our|the|his|her|their|a)\s+)?(?:child|son|daughter|kid|children|brother|sister|boy|girl)|he|she|they|i|we|you|someone)\b|\b(?:said|says|told)\b/u;
  const owned = carried?.[1].split(freshSubject)[0] ?? '';
  const continued = carried && affirmed(event, carriedPattern) && !/\b(?:not|never|didn't|doesn't|wasn't)\b/u.test(owned)
    && affirmed(owned, `(?:and|then)\\s+(?:(?:then|just|was|physically|forcefully)\\s+)*${harm}\\s+${childRecipient}`);
  return affirmed(event, active) || affirmed(event, passive) || affirmed(event, parentOwned) || Boolean(continued);
}
function contextualMatch(reason, { whole, event }) {
  if (!event.trim()) return false;
  if (reason === 'danger') {
    if (selfDirectedIntent(event)) return true;
    const physical = physicalEventContext(event);
    const directed = affirmed(physical, `${harm}\\s+(?:(?:at|into|against)\\s+)?${person}`) || affirmed(physical, `(?:he|she|they|my child|my son|my daughter)\\s+(?:(?:was|were|is|are|has been|have been)\\s+(?:being )?|keeps? (?:getting|being)\\s+|(?:got|gets)\\s+)${harm}`);
    const continuation = whole.includes(event) ? whole.slice(whole.indexOf(event) + event.length).match(/^\s*[.!?;]\s*(?:it|this|that)\s+(?:happens?|happened|is happening)\s+(?:again|daily|every day|repeatedly|twice|three times)\b/u)?.[0] ?? '' : '';
    const repeated = /\b(?:again|daily|every day|keeps?|repeatedly|days? (?:this|a) week|twice|three times)\b/u.test(event + ' ' + continuation);
    const injury = affirmed(whole, 'bruis(?:e|es|ed|ing)|bleed(?:ing)?|blood|injur(?:y|ies|ed)|broken (?:arm|bone|nose)|black eye');
    const retaliation = affirmed(physical, `(?:hurt|hit|beat|punch|kick).{0,30}${person}.{0,30}(?:if|when).{0,25}(?:tell|told|tells|telling)`) || affirmed(physical, `(?:if|when).{0,25}(?:tell|told|tells|telling).{0,40}(?:hurt|hit|beat|punch|kick)`);
    return retaliation || directed && (repeated || injury) || injury && /\b(?:older kids?|older children|classmates?|school|bus)\b/u.test(physical) && affirmed(physical, harm);
  }
  if (reason === 'parent-repair') {
    // Coordinate verbs inherit I; a fresh child subject does not.
    const firstPerson = event.match(/\bi\b([^.!?;]*)/u)?.[1] ?? '';
    const owned = firstPerson.split(/\b(?:when|while|that|because)\b|\b(?:my (?:child|son|daughter)|he|she|they|the child)\s+(?:was|is|had|has|snapped|yelled|shouted)\b/u)[0];
    return affirmed(owned, '(?:yelled|shouted|lost it|snapped)(?!\\s+(?:a |the |my |her |his |their )?(?:pencil|twig|stick|photo|picture|fingers))') || affirmed(event, 'this one is for me');
  }
  if (reason === 'listening-request') {
    // Listening can be part of a calm shared story. Only a request for someone
    // to listen without a learning step selects comfort instead of a kit.
    // Explicit "just listen" and "no advice" still win in matchesRouteRule.
    if (affirmed(event, '(?:learn|practise|practice|rehearse|get better at|how to).{0,35}(?:listen|listening)')) return false;
    if (affirmed(event, '(?:listen|listening)\\s+to\\s+(?:(?:a|the|our|their)\\s+)?(?:story|book|audiobook|music)')) return false;
    if (affirmed(event, '(?:listen|listening).{0,35}(?:and|then).{0,20}(?:help|learn|practise|practice|name|think|read|make|create|try)')) return false;
    // A named or described listener can follow the request. An immediate 'to'
    // means the speaker wants to listen, not that someone must only hear them.
    const listener = "(?!to\\b)(?:[\\p{L}][\\p{L}'-]*\\s+){1,4}";
    return affirmed(event, `(?:wants?|asked|asking|needs?)\\s+${listener}to\\s+(?:(?:sit|stay).{0,25})?(?:listen|listening)`)
      || affirmed(event, '(?:wants?|asked|asking|needs?).{0,25}(?:listen|listening)\\s+only');
  }
  if (reason === 'adult-responsibility') return adultDirectedHarm(event);
  return false;
}
function bodyTopicContext(event) {
  if (affirmed(event, 'doctor said|blood test|lab results')) return true;
  const topic = /\b(?:bod(?:y|ies)|weight|skin|hair|periods?|food|eating|hunger|hungry|fullness|diet|cholesterol|calories|bmi|fat|skinny)\b/u;
  if (!affirmed(event, topic.source) && !affirmed(event, "(?:(?:my|her|his|their|our) (?:body )?|(?:child|daughter|son)'s )(?:size|shape)")) return false;
  if (/\b(?:not|never) (?:about|for|because of|related to) (?:my |her |his |their |the |a )?(?:body|weight|hair|skin|periods?|food|eating)\b/u.test(event)) return false;
  if (/\b(?:body language|body of (?:(?:a|the) (?:book|story)|water)|hair dryer|hair clip|hair brush|bad hair day|board game about food|food (?:chain|web|science)|period (?:of|in) history|full (?:page|book|room))\b/u.test(event)) return false;
  // Learning a fact in class does not make the child's body a problem to fix.
  if (/\b(?:class|lesson|education|learned|learnt|learning|studied)\b/u.test(event) && !/\b(?:worried|ashamed|hate|hates|change|fix|lose|gain|diet|monitor|control)\b/u.test(event)) return false;
  return true;
}
function persistentLowMood(event) {
  return affirmed(event, '(?:felt|feels?|feeling|been|seems?|mood (?:is|has been))[^.!?;]{0,35}(?:low|flat|down|sad|empty|unhappy)[^.!?;]{0,40}(?:several|many|multiple) days|(?:low|flat|down|sad|empty|unhappy) mood[^.!?;]{0,35}(?:several|many|multiple) days');
}
export function matchesRouteRule(sentence, rule) {
  return contexts(sentence).some(context => {
    if (rule.reason === 'parent-repair') return contextualMatch(rule.reason, context);
    if (rule.reason === 'body-and-food') return bodyTopicContext(context.event);
    if (rule.reason === 'persistent-low-mood') return persistentLowMood(context.event);
    const event = rule.reason === 'danger' ? physicalEventContext(context.event) : context.event;
    return rule.patterns.some(pattern => affirmed(event, pattern)) || contextualMatch(rule.reason, context);
  });
}
// Practice selection shares the route's event, speaker and negation evidence.
// This helper does not change the protective route or infer a hidden feeling.
export function matchingEventContexts(sentence, pattern) {
  return contexts(sentence).filter(context => affirmed(context.event, pattern)).map(context => context.event);
}
export function explainRoute(sentence, options = {}) {
  if (typeof sentence !== 'string' || !sentence.trim()) return { route: 'listen', reason: 'empty' };
  for (const rule of rules.rules) {
    if (rule.reason === 'parent-repair' && options.parentEdition === true) continue;
    if (rule.reason === 'loss' && options.remembranceRequested === true && options.remembranceChildLed === true) continue;
    if (matchesRouteRule(sentence, rule)) return { route: rule.route, reason: rule.reason };
  }
  return { route: rules.default, reason: 'everyday-moment' };
}
export const route = (sentence, options) => explainRoute(sentence, options).route;
export function parentResponse(sentence, options) {
  const result = explainRoute(sentence, options);
  if (result.route === 'move') return null;
  const response = responses[result.reason];
  if (!response) throw new Error(`Missing parent response: ${result.reason}`);
  const adultHarm = contexts(sentence).some(context => adultDirectedHarm(context.event));
  const help = (result.reason === 'adult-responsibility' && !adultHarm || result.reason === 'danger' && /school|bus|locker|bull(?:y|ied|ying)|threat|older (?:child|kid|children)|every day|daily/iu.test(sentence))
    ? { guidance: { ...structuredClone(safety.schoolHarm), reviewLabel: safety.reviewLabel, ownerApproval: safety.ownerApproval } } : {};
  return { status: 'parentResponse', ...result, ...structuredClone(response), ...help };
}
