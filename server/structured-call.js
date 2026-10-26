import { carryCodeDigits } from './picture-code-digits.js';

const rejected = new WeakMap();
export function withJSONModeInput(body) {
  if (body?.text?.format?.type !== 'json_object' || !Array.isArray(body.input)) return body;
  const hasHint = body.input.some(message => (typeof message.content === 'string' ? [message.content] : Array.isArray(message.content) ? message.content.filter(part => ['input_text', 'output_text'].includes(part.type)).map(part => part.text) : []).some(text => typeof text === 'string' && /\bjson\b/i.test(text)));
  if (hasHint) return body;
  // The API checks input messages, even when instructions already request JSON.
  return carryCodeDigits(body, { ...body, input: [...body.input, { role: 'user', content: 'Return JSON only.' }] });
}
export function isSchemaRejection(request, status, response) {
  const error = response?.error;
  return request?.text?.format?.type === 'json_schema' && request.text.format.strict === true && [400, 422].includes(status) &&
    error && typeof error.message === 'string' && (!response.usage || response.usage.input_tokens === 0 && response.usage.output_tokens === 0) && (!response.output || Array.isArray(response.output) && response.output.length === 0) &&
    (error.code === 'invalid_json_schema' || ['invalid_request_error', 'unsupported_parameter', 'unsupported_value'].includes(error.code ?? error.type) && /schema|structured output|text\.format|response_format/i.test(`${error.param ?? ''} ${error.message}`));
}
export async function callStructured(transport, request) {
  let models = rejected.get(transport);
  if (!models) { models = new Set(); rejected.set(transport, models); }
  const schemaKey = request.body?.model + ':' + JSON.stringify(request.body?.text?.format?.schema);
  const fallback = () => ({ ...request, schemaFallback: true, body: carryCodeDigits(request.body, { ...request.body, text: { ...request.body.text, format: { type: 'json_object' } } }) });
  if (request.body?.text?.format?.type === 'json_schema' && models.has(schemaKey)) return transport.call(fallback());
  try { return await transport.call(request); }
  catch (error) {
    if (!error.schemaRejected) throw error;
    models.add(schemaKey);
    transport.recordLocalResult?.('structured-output-fallback', { stage: request.stage, model: request.body.model, schema: request.body.text.format.name, reason: error.response?.error, fallback: 'json_object', strictRejectedBeforeGeneration: true }, 'The API rejected the strict schema; retry once in JSON mode with the same typed parser.');
    return transport.call(fallback());
  }
}
