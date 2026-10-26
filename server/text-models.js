import { readJSON } from './files.js';
export const textStages = ['story', 'story-rewrite', 'story-correction', 'story-check'];
export function textModels(catalog = readJSON(new URL('../content/prices.json', import.meta.url))) {
  if (process.env.STORY_POSTER_GENERATION_ROUTE === 'subscription') return { story: 'gpt-6-astra', storyCheck: 'gpt-6.1-sol' };
  const { story, storyCheck } = catalog.selected;
  if (!story || !storyCheck || story === storyCheck) throw new Error('The story writer and judge must be two different models.');
  for (const model of [story, storyCheck]) if (catalog.models[model]?.provider !== 'openai') throw new Error('The writer and judge must use OpenAI models from prices.json.');
  return { story, storyCheck };
}
export function responseText(response) {
  if (response?.status !== 'completed') throw new Error(`The text service did not finish its answer: ${response?.incomplete_details?.reason ?? response?.status ?? 'missing status'}.`);
  const text = (response.output ?? []).flatMap(item => item.content ?? []).filter(item => item.type === 'output_text').map(item => item.text).join('\n');
  if (!text) throw new Error('The text service returned no text.');
  return text;
}
