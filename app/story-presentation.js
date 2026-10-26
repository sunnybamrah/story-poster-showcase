// Read saved presentation text without changing the generated kit.
export function savedTagline(result) {
  if (!Array.isArray(result?.posterSections)) return null;
  const section = result.posterSections.find(item => item?.id === 'tagline' && typeof item.text === 'string' && item.text.trim());
  return section?.text ?? null;
}

export function storyHonestyLabel(result) {
  return result?.storyMode === 'factual' || /^REAL\n/.test(result?.story ?? '')
    ? 'Based on the facts you shared'
    : 'A made-up story inspired by your note';
}
