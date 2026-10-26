export function readKeys() {
  const openai = process.env.OPENAI_API_KEY?.trim() || '';
  return { openai, status: { openaiPresent: Boolean(openai) } };
}
