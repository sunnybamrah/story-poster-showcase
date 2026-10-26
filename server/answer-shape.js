export const objectShape = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required: [...required], additionalProperties: false });
export const listShape = items => ({ type: 'array', items });
export const stringShape = { type: 'string' };
export const booleanShape = { type: 'boolean' };
export const numberShape = { type: 'number' };

// Known values stay typed. Unknown keys are recorded and excluded, never executed.
export function inspectAnswer(answer, schema, path = '') {
  const issues = [], extraKeys = [];
  const visit = (value, shape, at) => {
    const label = at || 'answer';
    const hasType = type => type === 'null' ? value === null : type === 'object' ? value && typeof value === 'object' && !Array.isArray(value) :
      type === 'array' ? Array.isArray(value) : type === 'integer' ? Number.isInteger(value) :
      type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type;
    const valid = (Array.isArray(shape.type) ? shape.type : [shape.type]).some(hasType);
    if (!valid) { issues.push(`${label} must be ${shape.type}.`); return value; }
    if (shape.enum && !shape.enum.includes(value)) issues.push(`${label} must be one of ${JSON.stringify(shape.enum)}.`);
    if (shape.type === 'array') return value.map((item, index) => visit(item, shape.items, `${at}[${index}]`));
    if (shape.type !== 'object') return value;
    for (const key of shape.required ?? []) if (!Object.hasOwn(value, key)) issues.push(`${at ? at + '.' : ''}${key} is required.`);
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      const field = at ? `${at}.${key}` : key;
      if (!Object.hasOwn(shape.properties, key)) { extraKeys.push(field); continue; }
      Object.defineProperty(result, key, { value: visit(item, shape.properties[key], field), enumerable: true, writable: true, configurable: true });
    }
    return result;
  };
  return { value: visit(answer, schema, path), issues, extraKeys };
}

export const strictFormat = (name, schema) => ({ type: 'json_schema', name, strict: true, schema: structuredClone(schema) });
