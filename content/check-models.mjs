import { textModels } from '../server/text-models.js';
import { pathToFileURL } from 'node:url';
import { readJSON, saveJSON } from '../server/files.js';
import { createTransport } from '../server/transport.js';

export async function checkModels(transport, { path = new URL('./prices.json', import.meta.url), receiptPath } = {}) {
  const catalog = readJSON(path);
  textModels(catalog);
  catalog.liveModelsAttemptedAt = new Date().toISOString();
  try {
    const data = await transport.call({ provider: 'openai', method: 'GET', path: '/v1/models', stage: 'model-list' });
    if (!Array.isArray(data.data)) throw new Error('Live model list is malformed.');
    const ids = data.data.map(model => model.id);
    catalog.liveModelsCheckedAt = new Date().toISOString();
    catalog.liveModelAvailability = Object.fromEntries(['story', 'storyCheck', 'hero', 'poster', 'pictureCheck'].map(role => [catalog.selected[role], ids.includes(catalog.selected[role])]));
    catalog.liveModelStatus = Object.values(catalog.liveModelAvailability).every(Boolean) ? 'confirmed' : 'required model missing';
    catalog.availableVisionCandidates = ids.filter(id => /^(gpt-6.*luna|gpt-5.*nano|gpt-4.*mini)/.test(id)).sort();
    if (receiptPath) saveJSON(receiptPath, catalog);
    if (catalog.liveModelStatus !== 'confirmed') throw new Error('A requested model is absent from the live account list.');
    return catalog;
  } catch (error) {
    catalog.liveModelStatus = `failed: ${error.message}`;
    if (receiptPath) saveJSON(receiptPath, catalog);
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const transport = createTransport({ keys: { openai: process.env.OPENAI_API_KEY?.trim() || '' } });
  try { const result = await checkModels(transport); console.log(JSON.stringify({ status: result.liveModelStatus, models: result.liveModelAvailability })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
