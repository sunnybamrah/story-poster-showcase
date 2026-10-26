// Only request builders register code-owned numbers. Family-derived slots never
// enter this table. A clone inherits rules only for byte-identical field values.
// Names, sensitive labels and copied phrases are still checked in every field.
const rules = new WeakMap();
export const cleanPictureText = value => String(value ?? '').normalize('NFKC').replace(/[‘’]/g, "'");

export function pictureSegments(value, field = 'request') {
  if (typeof value === 'string') {
    if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return [];
    if (/^\s*[\[{]/.test(value)) try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') return pictureSegments(parsed, field);
    } catch { /* Ordinary prose remains one segment. */ }
    return [{ field, text: cleanPictureText(value) }];
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => pictureSegments(item, `${field}[${index}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => [{ field: `${field}.${key} (key)`, text: cleanPictureText(key) }, ...pictureSegments(item, `${field}.${key}`)]);
  return value == null ? [] : [{ field, text: String(value) }];
}

export function rememberCodeDigits(body, parts) {
  const fields = new Map(pictureSegments(body).map(part => [part.field, part.text]));
  const allowed = new Map(rules.get(body));
  for (const part of parts) {
    const source = fields.get(part.field), text = cleanPictureText(part.text);
    if (!text || !source?.includes(text)) throw new Error('Code-owned picture text does not match its request field.');
    const prior = allowed.get(part.field);
    const ranges = prior?.source === source ? [...prior.ranges] : [];
    for (let at = source.indexOf(text); at !== -1; at = source.indexOf(text, at + text.length)) ranges.push([at, at + text.length]);
    allowed.set(part.field, { source, ranges });
  }
  rules.set(body, allowed);
  return body;
}

export function carryCodeDigits(from, to) {
  if (rules.has(from)) rules.set(to, rules.get(from));
  return to;
}

export function isCodeDigit(body, field, source, hit) {
  if (hit.kind !== 'familyContext digit token') return false;
  const rule = rules.get(body)?.get(field);
  return rule?.source === source && rule.ranges.some(([start, end]) => hit.start >= start && hit.end <= end);
}
