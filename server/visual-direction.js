// Convert the writer's prose into drawing notes without adding a new joke.
export function visualJokeDirection(idea) {
  const fragment = String(idea ?? '').replace(/["“”]/g, '').replace(/[.!?;]+/g, ',')
    .replace(/^\s*(?:visual only[, :]*|draw[:, ]*|the\s+)/i, '')
    .replace(/\b(?:has|have)\b/gi, 'with').replace(/\bwears\b/gi, 'wearing')
    .replace(/\bholds\b/gi, 'holding').replace(/\b(?:is|are)\s+(?:wearing|holding)\b/gi, match => match.replace(/^(?:is|are)\s+/i, ''))
    .replace(/\b(?:is|are)\b/gi, '').replace(/\s+/g, ' ').replace(/^[,\s]+|[,\s]+$/g, '');
  return `Visual only, draw, do not write. Draw: ${fragment}; no words. No caption, label or speech for this detail.`;
}
