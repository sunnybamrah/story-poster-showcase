import { words } from './files.js';

export const quoteValue = value => JSON.stringify(value) ?? 'undefined';
const simpleFields = new Set(['chapterTitle', 'tagline', 'jokeIdea', 'replayCue', 'feelFirst', 'tinyTryOptions', 'whereElse', 'noticedFeeling', 'panelLines']);
export const correctionPath = field => simpleFields.has(field) || /^panelLines\[\d+\](?:\.(?:scene|line|speakerId))?$/.test(field) ||
  /^feelFirst\[\d+\]$/.test(field) || /^tinyTryOptions\[\d+\](?:\.(?:text|seconds|offScreen))?$/.test(field) || /^whereElse\.(?:line|place)$/.test(field);
export const pathParts = field => field.replace(/\[(\d+)\]/g, '.$1').split('.');
export const fieldValue = (value, field) => pathParts(field).reduce((current, part) => current?.[part], value);
export const minimalFields = fields => [...new Set(fields)].filter(field => !fields.some(other => other !== field && (field.startsWith(other + '.') || field.startsWith(other + '['))));
export function validationErrors(errors) {
  const unique = new Map();
  for (const error of errors.flatMap(error => error.errors ?? [error])) unique.set(error.message, error);
  const all = [...unique.values()];
  const error = new Error(all.map(item => item.message).join('\n'));
  error.errors = all;
  error.failure = all[0]?.failure;
  error.failures = all.map(item => ({ ...item.failure, code: item.message.split(':')[0], reason: item.message }));
  if (all.every(item => item.correctionFields?.length)) error.correctionFields = minimalFields(all.flatMap(item => item.correctionFields));
  return error;
}
export const fieldLabel = field => field.replace(/^panelLines\[(\d+)\]/, (_, index) => `panelLines[${index}]`).concat(
  /^panelLines\[(\d+)\]/.test(field) ? ` (panel ${Number(field.match(/\[(\d+)\]/)[1]) + 1})` :
  /^tinyTryOptions\[(\d+)\]/.test(field) ? ` (option ${Number(field.match(/\[(\d+)\]/)[1]) + 1})` : '');

// One receipt drives the saved reason, the retry text and the correction scope.
export function validationFailure(code, { field, value, measured, unit, limit, instruction, fields, ...extra }) {
  const failure = { field, value, measured, unit, limit, instruction, ...extra };
  const error = new Error(`${code}: ${fieldLabel(field)} has ${measured} ${unit}; ${instruction}; exact value: ${quoteValue(value)}.`);
  error.failure = failure;
  if (fields ?? correctionPath(field)) error.correctionFields = fields ?? [field];
  return error;
}

export function requireKeys(value, field, keys, code) {
  const object = value && typeof value === 'object' && !Array.isArray(value);
  const actual = object ? Object.keys(value) : [];
  const missing = keys.filter(key => !actual.includes(key)), extra = actual.filter(key => !keys.includes(key));
  if (!object || missing.length || extra.length) throw validationFailure(code, { field, value, measured: actual.length, unit: 'keys', limit: { exactly: keys.length },
    instruction: `return 1 object with exactly ${keys.length} keys (${keys.join(', ')}), missing ${quoteValue(missing)}, extra ${quoteValue(extra)}` });
}
export function requireCount(value, field, count, unit, code) {
  if (!Array.isArray(value) || value.length !== count) throw validationFailure(code, { field, value, measured: Array.isArray(value) ? value.length : 0, unit, limit: { exactly: count },
    instruction: `return an array with exactly ${count} ${unit}` });
}
export function requireLine(value, field, max, code, target = '') {
  if (typeof value !== 'string') throw validationFailure(code, { field, value, measured: 0, unit: 'text strings', limit: { exactly: 1 }, instruction: 'supply 1 nonempty text string' });
  const count = words(value).length;
  if (count < 1) throw validationFailure(code, { field, value, measured: count, unit: 'words', limit: { min: 1 }, instruction: 'supply at least 1 word' });
}
export function textFields(value, field = '') {
  if (typeof value === 'string') return [{ field, value }];
  if (Array.isArray(value)) return value.flatMap((item, index) => textFields(item, `${field}[${index}]`));
  return value && typeof value === 'object' ? Object.entries(value).flatMap(([key, item]) => textFields(item, field ? `${field}.${key}` : key)) : [];
}
