import { wireCeiling } from './app-budget.js';

// Keep measured usage intact. A missing bill consumes the entire reserved bound;
// it must neither become a fictitious measured price nor poison later calls.
export function chargeAccounting(cost, ceiling) {
  if (!Number.isFinite(ceiling) || ceiling < 0) throw new Error('Cannot account for an unbounded charge.');
  const measured = Number.isFinite(cost?.usd) && cost.usd >= 0;
  return { usd: measured ? cost.usd : ceiling, basis: measured ? 'provider-usage' : 'reserved-ceiling', ceiling };
}
export function accountSavedAttempts(rows, catalog) {
  const receipts = new Map(rows.filter(row => row.event === 'response').map(row => [row.id, row]));
  return rows.filter(row => row.event === 'request' && row.method !== 'GET').map(request => {
    const receipt = receipts.get(request.id);
    const ceiling = request.reservedCeiling ?? wireCeiling({ path: new URL(request.url).pathname, body: request.body }, catalog);
    return { id: request.id, timestamp: request.timestamp, accounting: receipt?.accounting ?? chargeAccounting(receipt?.cost, ceiling) };
  });
}
