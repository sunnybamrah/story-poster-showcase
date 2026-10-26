import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

// Uses real loopback HTTP even when a test replaces fetch at the model boundary.
export function appJobClient(base) {
  let cookie;
  const send = new URL(base).protocol === 'https:' ? httpsRequest : httpRequest;
  return async (path, data, { method = data === undefined ? 'GET' : 'POST' } = {}) => {
    const body = data === undefined ? undefined : JSON.stringify(data);
    return new Promise((resolve, reject) => {
      const request = send(new URL(`/api/${path}`, base), { method, headers: { 'Content-Type': 'application/json', ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }), ...(cookie ? { Cookie: cookie } : {}) } }, response => {
        if (response.headers['set-cookie']) cookie = response.headers['set-cookie'][0].split(';')[0];
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const bytes = Buffer.concat(chunks);
          resolve({ status: response.statusCode, data: response.headers['content-type']?.includes('json') ? JSON.parse(bytes.toString()) : null, bytes });
        });
      });
      request.on('error', reject); request.end(body);
    });
  };
}

export async function waitAppJob(request, id, { interval = 1000, maxPolls = Infinity, progress = () => {} } = {}) {
  let last;
  for (let count = 0; count < maxPolls; count++) {
    const response = await request(`jobs/${id}`);
    if (response.status !== 200) throw new Error(`Job status returned HTTP ${response.status}.`);
    const job = response.data, state = `${job.status}: ${job.stage}`;
    if (state !== last) { progress(state); last = state; }
    if (job.status !== 'running') return job;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error('Fixture job did not settle.');
}
