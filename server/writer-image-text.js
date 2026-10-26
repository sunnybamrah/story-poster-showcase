import { anonymousLabels, identityHits, scrubIdentityNames } from './identity-text.js';
import { scrubFamilyContext, familyContextHits, picturePrivacyHits } from './family-privacy.js';
export { anonymousLabels, identityHits } from './identity-text.js';
export function scrubIdentityText(text, context) { return scrubFamilyContext(scrubIdentityNames(text, context), context); }
export function writerImageFields(text) {
  const fields = ['chapterTitle', 'tagline', 'jokeIdea'].filter(key => typeof text?.[key] === 'string').map(key => ({ field: key, root: key, value: text[key], set: value => { text[key] = value; } }));
  if (Array.isArray(text?.panelLines)) text.panelLines.forEach((panel, index) => {
    for (const key of ['scene', 'line']) if (typeof panel?.[key] === 'string') fields.push({ field: `panelLines[${index}].${key}`, root: 'panelLines', value: panel[key], set: value => { panel[key] = value; } });
  });
  // Field corrections use literal paths as JSON keys, not a whole new panel array.
  for (const [path, patch] of Object.entries(text ?? {})) {
    if (/^panelLines\[\d+\]\.(scene|line)$/.test(path) && typeof patch === 'string') fields.push({ field: path, root: 'panelLines', value: patch, set: value => { text[path] = value; } });
    if (/^panelLines\[\d+\]$/.test(path) && patch && typeof patch === 'object') for (const key of ['scene', 'line']) {
      if (typeof patch[key] === 'string') fields.push({ field: `${path}.${key}`, root: 'panelLines', value: patch[key], set: value => { patch[key] = value; } });
    }
  }
  return fields;
}
export function scrubWriterImageText(answer, context) {
  const text = structuredClone(answer), changes = [], violations = [], remainingViolations = [];
  context = { ...context, moveId: answer?.moveId ?? context.moveId };
  for (const item of writerImageFields(text)) {
    const beforeHits = picturePrivacyHits(item.value, context);
    for (const identity of identityHits(item.value, context)) if (!beforeHits.some(hit => hit.kind.includes(identity.kind))) beforeHits.push({ kind: identity.kind, text: identity.alias });
    violations.push(...beforeHits.map(hit => ({ ...hit, field: item.field })));
    const after = scrubIdentityText(item.value, context);
    if (after !== item.value) { item.set(after); changes.push({ field: item.field, before: item.value, after }); }
    remainingViolations.push(...picturePrivacyHits(after, context).map(hit => ({ ...hit, field: item.field })));
  }
  return { text, changes, violations, remainingViolations };
}
