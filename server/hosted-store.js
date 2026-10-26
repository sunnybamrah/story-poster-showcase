import { Client } from 'pg';

// One app writer holds this connection's advisory lock for its entire lifetime.
// The private volume owns kit files; Postgres owns account/job/session records.
export async function openHostedStore({ connectionString = process.env.DATABASE_URL, client = new Client({ connectionString }), bootstrapState = null } = {}) {
  if (!connectionString && !arguments[0]?.client) throw Error('DATABASE_URL is required for hosted accounts.');
  await client.connect();
  let failed = null, chain = Promise.resolve();
  client.on('error', () => { failed = Error('Account storage connection was lost.'); });
  client.on('end', () => { failed ??= Error('Account storage connection ended.'); });
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(830718612) AS locked');
    if (!lock.rows[0]?.locked) throw Error('Another Story Poster server already owns the account store.');
    await client.query('CREATE TABLE IF NOT EXISTS story_poster_state (id INTEGER PRIMARY KEY CHECK (id = 1), body JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await client.query('INSERT INTO story_poster_state (id, body) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING', [JSON.stringify(bootstrapState ?? { accounts: [], sessions: [], jobs: [] })]);
    const result = await client.query('SELECT body FROM story_poster_state WHERE id = 1');
    const assertWritable = () => { if (failed) throw Object.assign(Error('Saving is temporarily unavailable. Please try again shortly.'), { status: 503 }); };
    return {
      initialState: result.rows[0].body,
      assertWritable,
      save(state) {
        assertWritable(); const snapshot = JSON.stringify(state);
        chain = chain.then(async () => { assertWritable(); await client.query('UPDATE story_poster_state SET body = $1::jsonb, updated_at = now() WHERE id = 1', [snapshot]); }).catch(error => { failed = error; });
      },
      async flush() { await chain; assertWritable(); },
      async close() { await chain; await client.end(); },
    };
  } catch (error) { await client.end(); throw error; }
}
