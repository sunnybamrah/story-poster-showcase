import { assessGenerationCheck, essentialStoryFaults, essentialContentFault } from './stop-policy.js';
import { callStructured } from './structured-call.js';
import { carryCodeDigits, rememberCodeDigits, pictureSegments } from './picture-code-digits.js';
import { judgeFaultFields } from './story-review.js';
import { narrativeFaultKeys } from './story-rules.js';
// All checker flags point in the same direction: true means a fault with evidence.
export const storyFields = ['moveId', 'chapterTitle', 'tagline', 'story', 'panelLines', 'jokeIdea', 'feelFirst', 'tinyTryOptions', 'whereElse', 'noticedFeeling', 'replayCue'];
export const smallFields = ['tagline', 'jokeIdea', 'replayCue', 'feelFirst', 'tinyTryOptions', 'whereElse', 'noticedFeeling'];
export const storyFaults = ['secondMoveTaught', 'feelingGoesAwayPromise', 'adviceOutsideRecord', 'jokeAtPerson', 'effortOnlyPraise', 'filledWhenINotice', 'chapterShapeWrong', 'scienceClaimsTeachingHelped', ...narrativeFaultKeys];
export const posterQualityKeys = ['rhymeUsesStoryWords', 'rhymeDoesNotStateMove', 'wordAChildMustTranslate', 'scienceClaimsTeachingHelped'];
export const lockedPosterFields = ['move.name', 'move.keyWord', 'move.positiveAction', 'move.bodyAction', 'move.kidScienceLine'];
export const storyCheckFields = [...storyFields, ...lockedPosterFields];
export const storyCheckKeys = ['secondMoveTaught', 'feelingGoesAwayPromise', 'adviceOutsideRecord', 'jokeAtPerson', 'effortOnlyPraise', 'filledWhenINotice', 'screenOnlyPlace', 'chapterShapeWrong', 'tinyTryWrong', ...posterQualityKeys, ...narrativeFaultKeys];
export const pictureCheckKeys = ['lettersPresent', 'peopleCountMismatch', 'outfitMismatch', 'actionMismatch', 'clutteredActionBackground'];
export const wordCheckBooleans = ['keyWordMirrored', 'keyWordUnreadable', 'filledBlank', 'textCrossesBoundary', 'outfitMismatch', 'actionMismatch', 'peopleCountMismatch'];
export const geometryBooleanKeys = ['textIconCollision', 'fillOutsideCard', 'heroOutsideRegion', 'actionBodyPartHidden', 'clutteredActionBackground', 'glossOrDistortedProportions', 'printTextTooSmall'];
export const outfitRule = 'Compare only clothing visible in this pose and framing. A fault requires a visible garment or colour that DIFFERS from the supplied clothing. Hidden feet or clothing are not faults. Props such as a sketchbook or backpack are optional continuity, never outfit mismatches, wherever placed. Record each claimed difference in outfitObservations with the visible item, expected and observed clothing, and evidence.';
// A black-ink look draws every garment without colour (owner, October 16).
export const inkOutfitRule = 'This family look is black ink on off-white paper, so every garment is drawn without colour: dark colours become solid black or hatching and light colours stay paper white. Judge clothing by garment type, shape and pattern only. A colour that differs or is missing is never an outfit fault; a different garment, shape or pattern still is.';
const colourWords = new Set('red orange yellow green blue purple violet pink brown black white grey gray navy teal turquoise cyan magenta maroon beige tan cream gold golden silver olive khaki lavender lilac mustard rust coral burgundy indigo charcoal ivory peach mint aqua crimson scarlet reddish bluish greenish yellowish greyish grayish brownish pinkish purplish blackish whitish light dark pale bright deep muted faded pastel neon warm cool fair medium tone toned colour color coloured colored colourful colorful colours colors'.split(' '));
const inkWords = new Set('ink inked pen drawn drawing uncoloured uncolored colourless colorless monochrome monochromatic greyscale grayscale outline outlined outlines line lines linework hatched hatching crosshatched shaded shading fill filled fills unfilled paper solid plain blank only in with and a an the of as on left shown rendered'.split(' '));
const shapeWords = text => String(text ?? '').toLowerCase().split(/[^a-z]+/).filter(word => word && !colourWords.has(word) && !inkWords.has(word)).sort().join(' ');
// True when two clothing or appearance descriptions differ only by colour words,
// e.g. "blue sweater" and "sweater drawn in black ink". A different garment,
// shape or pattern ("striped", "hoodie") is never colour-only.
export const colourOnlyDifference = (expected, observed) => { const words = shapeWords(expected); return Boolean(words) && words === shapeWords(observed); };
export const outfitObservationsProperty = { type: 'array', items: { type: 'object', properties: {
  item: { type: 'string' }, kind: { type: 'string', enum: ['clothing', 'prop'] }, visible: { type: 'boolean' }, differs: { type: 'boolean' },
  expected: { type: 'string' }, observed: { type: 'string' }, evidence: { type: 'string' },
}, required: ['item', 'kind', 'visible', 'differs', 'expected', 'observed', 'evidence'], additionalProperties: false } };
export function outfitFaultSupported(answer, { monochrome = false } = {}) {
  if (Array.isArray(answer.outfitObservations)) return answer.outfitObservations.some(item => item && typeof item === 'object' && item.kind === 'clothing' && item.visible === true && item.differs === true &&
    /\b(hoodie|shirt|sweater|jacket|coat|pants|trousers|shorts|dress|skirt|sneakers?|shoes?|boots?|hat|patch|socks?|gloves?|scarf|vest|overalls|uniform)\b/i.test(item.item) &&
    !/\b(sketchbook|backpack|book|pencil|prop)\b/i.test(item.item) &&
    !/\b(hidden|not visible|no visible|obscured|out of frame|cannot see|can't see)\b/i.test(item.observed) &&
    [item.item, item.expected, item.observed, item.evidence].every(value => typeof value === 'string' && value.trim()) && item.expected.trim().toLowerCase() !== item.observed.trim().toLowerCase() &&
    !(monochrome && colourOnlyDifference(item.expected, item.observed)));
  // A black-ink look has no older receipts: only an itemised garment, shape or pattern difference counts.
  if (monochrome) return false;
  // Historical receipts can prove a visible difference, but absence or prop placement cannot.
  const clauses = (typeof answer.evidence?.outfitMismatch === 'string' ? answer.evidence.outfitMismatch : '').split(/[.;]|\bbut\b|\band\b/i);
  return clauses.some(clause => /\b(hoodie|shirt|sweater|jacket|coat|pants|trousers|shorts|dress|skirt|sneakers?|shoes?|boots?|hat|patch)\b/i.test(clause) &&
    /\b(visible|wears|wearing)\b/i.test(clause) && /\b(instead|rather|wrong|differs|different)\b/i.test(clause) &&
    !/\b(hidden|not visible|no visible|under the table|obscured)\b/i.test(clause));
}
export const faultProperties = keys => ({
  ...Object.fromEntries(keys.map(key => [key, { type: 'boolean', description: 'True means this fault is present and supported by evidence. False means this fault is absent.' }])),
  evidence: { type: 'object', properties: Object.fromEntries(keys.map(key => [key, { type: 'string' }])), required: [...keys], additionalProperties: false },
});
export const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === [...keys].sort().join();
export const faultShape = (answer, keys, observationKeys = []) => answer && keys.every(key => typeof answer[key] === 'boolean') && answer.evidence && typeof answer.evidence === 'object' && !Array.isArray(answer.evidence) && keys.every(key => typeof answer.evidence[key] === 'string');
export function addSceneObservation(properties) {
  properties.sceneTooEmpty = { type: 'boolean', description: 'Report only: true when the hero area is flat colour with no setting. Never reject or redraw solely for this observation.' };
  properties.evidence.properties.sceneTooEmpty = { type: 'string' };
  properties.evidence.required.push('sceneTooEmpty');
  return properties;
}
export const actionBackgroundProperty = { type: 'string', enum: ['acting-hand', 'elsewhere', 'none'], description: 'Where the reported clutter is. Only the small area right around the acting hand, paw or other body part doing the move is judged, never the whole scene.' };
export function sceneObservations(answer) {
  const observations = answer.sceneTooEmpty === true ? [{ key: 'sceneTooEmpty', evidence: answer.evidence?.sceneTooEmpty ?? '', supported: typeof answer.evidence?.sceneTooEmpty === 'string' && Boolean(answer.evidence.sceneTooEmpty.trim()), reportOnly: true, message: 'The hero area is flat colour without a setting.' }] : [];
  if (Object.hasOwn(answer, 'jokeInScene')) observations.push({ key: 'jokeInScene', value: answer.jokeInScene === true && Boolean(typeof answer.evidence?.jokeInScene === 'string' && answer.evidence.jokeInScene.trim()), evidence: answer.evidence?.jokeInScene ?? '', supported: Boolean(typeof answer.evidence?.jokeInScene === 'string' && answer.evidence.jokeInScene.trim()), reportOnly: true, reviewAfterPaidRun: 11 });
  return observations;
}
export function supportedFaults(answer, keys, { monochrome = false } = {}) {
  const faults = [], ignoredFaults = [];
  for (const key of keys) if (answer[key]) {
    if (key === 'clutteredActionBackground' && answer.actionBackgroundArea !== 'acting-hand') ignoredFaults.push({ key, reason: 'Only clutter right around the acting hand is a fault. Scenery elsewhere stays.' });
    else if (key === 'outfitMismatch' && !outfitFaultSupported(answer, { monochrome })) ignoredFaults.push({ key, reason: monochrome ? 'No evidenced garment, shape or pattern difference. A black-ink look draws clothes without colour, so colour alone is not an outfit fault.' : 'No evidenced difference in visible clothing. Hidden items and optional props are not outfit faults.' });
    else if (typeof answer.evidence?.[key] === 'string' && answer.evidence[key].trim()) faults.push(key);
    else ignoredFaults.push({ key, reason: 'True flag treated as false because its evidence is empty.' });
  }
  return { faults, ignoredFaults };
}
export const brokenCheck = (fault, answers = null) => ({ ready: false, verified: false, faults: [fault], answers, needsRecheck: true, contentNeedsRecheck: true, checkerIssues: [fault], ignoredFaults: [] });

// A broken checker answer earns another check of the same artifact, not a redraw.
export async function runCheck(transport, request, parse, { retry = 0, inspect } = {}) {
  let check; const retainedHard = new Set();
  for (let attempt = 0; attempt < 2; attempt++) {
    let current = request;
    if (attempt && check?.measurementFaults?.length && request.body.input?.[0]?.content?.[0]?.type === 'input_text') {
      const body = carryCodeDigits(request.body, structuredClone(request.body));
      const payload = JSON.parse(body.input[0].content[0].text);
      // Keep structured field boundaries and the provenance of the fixed layout.
      payload.measurementRecheck = 'Re-measure the SAME image. Fix these measurement errors: ' + check.measurementFaults.join(' ');
      body.input[0].content[0].text = JSON.stringify(payload);
      rememberCodeDigits(body, pictureSegments({ measurementRecheck: payload.measurementRecheck }, 'request.input[0].content[0].text'));
      current = { ...request, body };
    }
    if (attempt && request.stage === 'story-check') {
      const body = structuredClone(current.body); body.reasoning = { ...body.reasoning, effort: 'high' };
      body.instructions += '\nRecheck the SAME kit. Repair these broken answer fields: ' + (check.checkerIssues ?? check.faults).join('; ');
      current = { ...current, body };
    }
    const response = await callStructured(transport, { ...current, retry: retry * 2 + attempt });
    try { check = parse(response, { attempt, previousCheck: check }); } catch (error) { check = brokenCheck(error.message); }
    if (request.stage === 'cast-continuity-check' || /^portrait-(?:identity|render)-check$/.test(request.stage ?? '')) { check.contentNeedsRecheck = false; check.contentVerified = false; check.appearanceNeedsReview = Boolean(check.needsRecheck || check.verified === false); }
    check.artifactAttempt = retry + 1; check.checkerAttempt = attempt + 1;
    inspect?.(check);
    if (request.stage === 'story-check' && check.needsRecheck && check.answers) {
      let data; try { data = JSON.parse(request.body.input[0].content); } catch { data = {}; }
      const values = value => typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(values) : [];
      for (const key of essentialStoryFaults) {
        const quote = check.answers.evidence?.[key];
        if (check.answers[key] === true && typeof quote === 'string' && quote.trim() && (key !== 'filledWhenINotice' || /When I notice\b/i.test(quote) && !/When I notice _+, I _+/.test(quote)) && check.answers.affectedFields?.[key]?.some(field => judgeFaultFields[key]?.includes(field) && field !== 'tagline' && !field.startsWith('move.') && values(data.story?.[field]).some(value => value.includes(quote)))) retainedHard.add(key);
      }
    }
    check = assessGenerationCheck(check, { final: attempt === 1 });
    for (const key of check.faults) if (essentialContentFault(key)) retainedHard.add(key);
    if (retainedHard.size && !check.needsRecheck) { check.faults = [...new Set([...check.faults, ...retainedHard])]; check.ready = false; }
    const reason = [...check.faults.map(key => check.reasons?.[key] ?? key), ...(check.measurementFaults ?? [])].join('; ') || (check.needsRecheck ? 'Content check unverified; recheck the same saved artifact.' : '');
    if (!check.ready) transport.recordRejection(response, reason || 'Content check is unverified.');
    transport.recordVerdict?.(response, check.ready ? check.verified === false ? "CONTINUE: checker unverified, FOR SUNNY'S READ" : 'PASS' : reason, check);
    if (!check.needsRecheck) return check;
  }
  return check;
}
