import { readJSON } from './files.js';

export function modelRateForInput(rate, input) {
  const tier = rate?.longContext;
  if (!tier || input <= tier.aboveInputTokens) return rate;
  if (!Number.isSafeInteger(tier.aboveInputTokens) || tier.aboveInputTokens < 1 || ['input', 'cachedInput', 'output', ...(rate.cacheWriteInput !== undefined ? ['cacheWriteInput'] : [])].some(key => !Number.isFinite(tier[key]) || tier[key] < 0)) return null;
  return { ...rate, ...tier };
}

export function calculateCost(model, usage, catalog = readJSON(new URL('../content/prices.json', import.meta.url)), { webSearchCalls = 0 } = {}) {
  let rate = catalog.models[model];
  if (!rate || !usage) return { usd: null, reason: 'Missing model rate or provider usage.' };
  const fields = rate.imageOutput !== undefined ? ['input', 'imageInput', 'cachedInput', 'cachedImageInput', 'imageOutput'] : ['input', 'output', 'cachedInput'];
  if (fields.some(field => typeof rate[field] !== 'number' || !Number.isFinite(rate[field]) || rate[field] < 0)) return { usd: null, reason: 'Missing or invalid model price in prices.json.' };
  const input = usage.input_tokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || input < 0 || output < 0) return { usd: null, reason: 'Missing or invalid input or output token count.' };
  if (!Number.isSafeInteger(webSearchCalls) || webSearchCalls < 0 || webSearchCalls && (!Number.isFinite(catalog.toolPrices?.webSearchPerCall) || catalog.toolPrices.webSearchPerCall < 0)) return { usd: null, reason: 'Missing web search count or price.' };
  const toolUSD = webSearchCalls * (catalog.toolPrices?.webSearchPerCall ?? 0);
  if (webSearchCalls && (rate.provider !== 'openai' || rate.imageOutput !== undefined)) return { usd: null, reason: 'Web search usage was reported for an unsupported model.' };
  rate = modelRateForInput(rate, input);
  if (!rate) return { usd: null, reason: 'Missing or invalid long-context price.' };
  if (rate.provider === 'anthropic') {
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const write5 = usage.cache_creation?.ephemeral_5m_input_tokens ?? usage.cache_creation_input_tokens ?? 0;
    const write1h = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    return { usd: (input * rate.input + output * rate.output + cacheRead * rate.cachedInput + write5 * rate.cacheWrite5m + write1h * rate.cacheWrite1h) / 1e6 };
  }
  const detail = usage.input_tokens_details ?? usage.prompt_tokens_details ?? {};
  const cached = detail.cached_tokens ?? 0;
  if (!Number.isSafeInteger(cached) || cached < 0 || cached > input) return { usd: null, reason: 'Invalid cached token count.' };
  if (rate.cacheWriteInput !== undefined && input >= rate.cacheMinimumTokens && detail.cache_write_tokens === undefined) return { usd: null, reason: 'Missing cache-write token usage for this model.' };
  const written = detail.cache_write_tokens ?? 0;
  if (!Number.isSafeInteger(written) || written < 0 || written + cached > input || written && (!Number.isFinite(rate.cacheWriteInput) || rate.cacheWriteInput < 0)) return { usd: null, reason: 'Invalid cache-write token usage or missing price.' };
  if (rate.imageOutput !== undefined) {
    if (![detail.text_tokens, detail.image_tokens].every(value => Number.isSafeInteger(value) && value >= 0)) return { usd: null, reason: 'Missing image/text input token split.' };
    if (detail.text_tokens + detail.image_tokens !== input) return { usd: null, reason: 'Image usage totals disagree.' };
    const cachedText = detail.cached_tokens_details?.text_tokens ?? 0;
    const cachedImage = detail.cached_tokens_details?.image_tokens ?? 0;
    if (![cachedText, cachedImage].every(value => Number.isSafeInteger(value) && value >= 0) || cachedText > detail.text_tokens || cachedImage > detail.image_tokens || cached !== cachedText + cachedImage) return { usd: null, reason: 'Missing cached image/text token split.' };
    return { usd: ((detail.text_tokens - cachedText) * rate.input + (detail.image_tokens - cachedImage) * rate.imageInput + cachedText * rate.cachedInput + cachedImage * rate.cachedImageInput + output * rate.imageOutput) / 1e6 };
  }
  return { usd: ((input - cached - written) * rate.input + cached * rate.cachedInput + written * (rate.cacheWriteInput ?? 0) + output * rate.output) / 1e6 + toolUSD };
}
