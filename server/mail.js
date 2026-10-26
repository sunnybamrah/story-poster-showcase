// Account email uses the owner's existing Resend sender. Provider acceptance is
// not proof of inbox delivery. Live recovery links and keys are never logged.
export function createMailSender(env = process.env, { fetchImpl = fetch } = {}) {
  const from = env.STORY_POSTER_MAIL_FROM?.trim();
  const available = !!from && !!env.STORY_POSTER_RESEND_KEY;
  const send = async ({ to, subject, text, idempotencyKey }) => {
    if (!available) throw Error('Email sender is not configured.');
    const response = await fetchImpl('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.STORY_POSTER_RESEND_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ from, to: [to], subject, text }), signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok) throw Error('Email service did not accept the message.');
    const result = await response.json();
    return { accepted: true, providerId: typeof result.id === 'string' ? result.id : null };
  };
  send.available = available; return send;
}
