import { existsSync } from 'node:fs';
import { readJSON, saveJSON } from './files.js';
import { randomUUID } from 'node:crypto';
import { modelRateForInput } from './cost.js';

export const centralDay = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
// Reserve before EACH wire attempt, including retries. The envelope deliberately
// overcounts input bytes as tokens and image tokens; it is not a cost quote.
export function wireCeiling(request, catalog) {
  let rate = catalog.models[request.body?.model];
  if (!rate || rate.provider !== 'openai') throw new Error('Unknown model price.');
  if (request.body.tools !== undefined && (!Array.isArray(request.body.tools) || request.body.tools.length)) throw new Error('Hosted tools have no bounded reservation in this app. Fetch bounded public sources first.');
  if (request.body.service_tier !== undefined && request.body.service_tier !== 'default') throw new Error('Only standard processing is priced in this app.');
  let images = 0;
  const input = JSON.stringify(request.body).replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, () => { images++; return ''; });
  const inputTokens = Buffer.byteLength(input) + images * 16384;
  const imageRequest = request.path.includes('/images/');
  if (imageRequest && (!['1024x1536', '1536x1024', '1024x1024'].includes(request.body.size) || request.body.n !== 1 || !['medium', 'high'].includes(request.body.quality))) throw new Error('Cannot reserve an unbounded image request.');
  const outputTokens = imageRequest ? 16384 : request.body.max_output_tokens;
  const contextWindow = rate.contextWindow ?? 200000;
  if (!Number.isSafeInteger(outputTokens) || outputTokens < 1 || rate.maxOutputTokens && outputTokens > rate.maxOutputTokens || inputTokens > contextWindow || rate.contextWindow && inputTokens + outputTokens > contextWindow) throw new Error('Cannot reserve this request safely.');
  rate = modelRateForInput(rate, inputTokens);
  if (!rate) throw new Error('Cannot reserve missing long-context prices.');
  return (inputTokens * Math.max(rate.input, rate.imageInput ?? 0, rate.cacheWriteInput ?? 0) + outputTokens * (rate.imageOutput ?? rate.output)) / 1e6;
}
export const defaultDailyLimit = 6;
export const newKitAllowance = 2; // Measured kits were $0.73 to $0.93, plus reservation headroom.
export function createAppBudget(file, { limit = defaultDailyLimit, now = () => new Date() } = {}) {
  if (!Number.isFinite(limit) || limit < 0 || limit > 30) throw new Error('Daily budget must be between $0 and $30.');
  const read = () => existsSync(file) ? readJSON(file) : { days: {} };
  const state = data => data.days[centralDay(now())] ??= { spent: 0, reserved: {}, uncertain: false };
  return {
    status() { const data = read(), day = state(data); return { day: centralDay(now()), limit, spent: day.spent, reserved: Object.values(day.reserved).reduce((a, b) => a + b, 0), uncertain: Boolean(day.overrun) }; },
    reserve(usd) {
      const data = read(), day = state(data);
      if (!Number.isFinite(usd) || usd < 0 || day.overrun || day.spent + Object.values(day.reserved).reduce((a, b) => a + b, 0) + usd > limit + 1e-9) throw new Error('Daily budget reached. Your saved work is safe. Try the sample or return tomorrow.');
      const id = randomUUID(); day.reserved[id] = usd; saveJSON(file, data); return { id, day: centralDay(now()) };
    },
    settle(slot, usd) {
      const data = read(), day = data.days[slot.day];
      if (!day || !(slot.id in day.reserved)) throw new Error('Missing budget reservation.');
      const ceiling = day.reserved[slot.id];
      const measured = Number.isFinite(usd) && usd >= 0;
      const charged = measured ? usd : ceiling;
      day.spent += charged;
      if (charged > ceiling + 1e-9) day.overrun = true;
      delete day.reserved[slot.id];
      (day.settlements ??= {})[slot.id] = { usd: charged, ceiling, basis: measured ? 'provider-usage' : 'reserved-ceiling' };
      day.uncertain = false;
      saveJSON(file, data);
      return day.settlements[slot.id];
    },
    recoverReservations() {
      // Startup only: a dead process cannot settle its in-flight calls. Charge the
      // saved bounds once, including legacy uncertain slots, and retain evidence.
      const data = read();
      for (const day of Object.values(data.days)) {
        for (const [id, ceiling] of Object.entries(day.reserved)) {
          day.spent += ceiling;
          (day.settlements ??= {})[id] = { usd: ceiling, ceiling, basis: 'interrupted-reserved-ceiling' };
        }
        day.reserved = {};
        day.uncertain = false;
      }
      saveJSON(file, data);
    },
  };
}
