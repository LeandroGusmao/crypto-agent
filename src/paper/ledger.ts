import { createHash } from 'node:crypto';
import { parseUtcTimestamp } from '../core/time.ts';
import { runInTransaction } from '../state/local-state.ts';
import type { LocalState } from '../state/local-state.ts';
import { readPortfolio } from '../state/portfolio.ts';
import type { FixtureIntent, PaperFill, PaperPosition } from './types.ts';

export type OrderRecord = {
  status: 'filled' | 'unfilled'; reason: string | null; intentHash: string | null;
};

function invalid(kind: string, detail: string): Error {
  return new Error(`Invalid ${kind}: ${detail}`);
}

export function requireText(kind: string, field: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw invalid(kind, `${field} must be a non-empty string`);
  }
  return value;
}

// Returns the canonical form of a nonnegative integer unit string.
export function requireUnits(
  kind: string, field: string, value: unknown, { positive }: { positive: boolean },
): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw invalid(kind, `${field} must be an integer unit string`);
  }
  const units = BigInt(value);
  if (positive && units === 0n) throw invalid(kind, `${field} must be positive`);
  return units.toString();
}

export function requireSide(kind: string, value: unknown): 'buy' | 'sell' {
  if (value !== 'buy' && value !== 'sell') throw invalid(kind, 'side must be "buy" or "sell"');
  return value;
}

// Returns the timestamp in canonical ISO form so equal instants hash identically.
export function requireUtcTimestamp(kind: string, field: string, value: unknown): string {
  const ms = parseUtcTimestamp(value);
  if (ms === null) throw invalid(kind, `${field} must be an ISO 8601 UTC timestamp`);
  return new Date(ms).toISOString();
}

function normalizeFill(fill: PaperFill): PaperFill {
  if (fill?.source !== 'fixture') throw invalid('fill', 'source must be "fixture"');
  return {
    orderId: requireText('fill', 'orderId', fill.orderId),
    mint: requireText('fill', 'mint', fill.mint),
    side: requireSide('fill', fill.side),
    tokenUnits: requireUnits('fill', 'tokenUnits', fill.tokenUnits, { positive: true }),
    usdcUnits: requireUnits('fill', 'usdcUnits', fill.usdcUnits, { positive: true }),
    feeUSDCUnits: requireUnits('fill', 'feeUSDCUnits', fill.feeUSDCUnits, { positive: false }),
    observedAt: requireUtcTimestamp('fill', 'observedAt', fill.observedAt),
    source: 'fixture',
  };
}

export function normalizeIntent(intent: FixtureIntent): FixtureIntent {
  if (typeof intent !== 'object' || intent === null) throw invalid('intent', 'must be an object');
  return {
    orderId: requireText('intent', 'orderId', intent.orderId),
    mint: requireText('intent', 'mint', intent.mint),
    side: requireSide('intent', intent.side),
    inputUnits: requireUnits('intent', 'inputUnits', intent.inputUnits, { positive: true }),
    expectedNetOutputUnits: requireUnits(
      'intent', 'expectedNetOutputUnits', intent.expectedNetOutputUnits, { positive: true },
    ),
    decidedAt: requireUtcTimestamp('intent', 'decidedAt', intent.decidedAt),
  };
}

// Hashes a fixed field order so object key order never affects identity.
function hashFields(fields: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

function hashFill(fill: PaperFill): string {
  return hashFields([
    fill.orderId, fill.mint, fill.side, fill.tokenUnits, fill.usdcUnits,
    fill.feeUSDCUnits, fill.observedAt, fill.source,
  ]);
}

export function hashIntent(intent: FixtureIntent): string {
  return hashFields([
    intent.orderId, intent.mint, intent.side, intent.inputUnits,
    intent.expectedNetOutputUnits, intent.decidedAt,
  ]);
}

export function readOrderRecord(state: LocalState, orderId: string): OrderRecord | undefined {
  const row = state.db.prepare(
    'SELECT status, reason, intent_hash FROM orders WHERE order_id = ?',
  ).get(orderId) as
    { status: 'filled' | 'unfilled'; reason: string | null; intent_hash: string | null } | undefined;
  return row && { status: row.status, reason: row.reason, intentHash: row.intent_hash };
}

type PositionRow = { token_units: string; cost_basis_usdc_units: string; status: 'open' | 'closed' };

// Applies a modeled fill atomically; an identical replay of a filled order is a no-op.
export function commitPaperFill(
  state: LocalState, fill: PaperFill, intent?: FixtureIntent,
): { applied: boolean } {
  const normalized = normalizeFill(fill);
  const normalizedIntent = intent === undefined ? undefined : normalizeIntent(intent);
  if (normalizedIntent && (normalizedIntent.orderId !== normalized.orderId ||
      normalizedIntent.mint !== normalized.mint || normalizedIntent.side !== normalized.side)) {
    throw invalid('fill', 'orderId, mint, and side must match the intent');
  }
  const payloadHash = hashFill(normalized);
  const intentHash = normalizedIntent ? hashIntent(normalizedIntent) : null;
  const { db } = state;

  return runInTransaction(db, () => {
    const existing = db.prepare(
      'SELECT status, payload_hash, intent_hash FROM orders WHERE order_id = ?',
    ).get(normalized.orderId) as
      { status: string; payload_hash: string; intent_hash: string | null } | undefined;
    if (existing) {
      const identical = existing.status === 'filled' && existing.payload_hash === payloadHash &&
        (intentHash === null || existing.intent_hash === intentHash);
      if (identical) return { applied: false };
      throw new Error(`Order ID conflict: ${normalized.orderId}`);
    }

    const portfolio = readPortfolio(state);
    let cash = BigInt(portfolio.cashUSDCUnits);
    let realizedPnl = BigInt(portfolio.realizedPnlUSDCUnits);
    const usdc = BigInt(normalized.usdcUnits);
    const position = db.prepare(
      'SELECT token_units, cost_basis_usdc_units, status FROM positions WHERE mint = ?',
    ).get(normalized.mint) as PositionRow | undefined;

    // Fees are already included in the buy debit and the sell net credit.
    if (normalized.side === 'buy') {
      if (cash < usdc) throw new Error('Insufficient paper cash for this buy');
      if (position?.status === 'open') {
        throw new Error(`A position is already open for mint ${normalized.mint}`);
      }
      cash -= usdc;
      db.prepare(
        `INSERT INTO positions (mint, token_units, cost_basis_usdc_units, status)
         VALUES (?, ?, ?, 'open')
         ON CONFLICT (mint) DO UPDATE SET token_units = excluded.token_units,
           cost_basis_usdc_units = excluded.cost_basis_usdc_units, status = 'open'`,
      ).run(normalized.mint, normalized.tokenUnits, normalized.usdcUnits);
    } else {
      if (position?.status !== 'open') {
        throw new Error(`No open position for mint ${normalized.mint}`);
      }
      if (position.token_units !== normalized.tokenUnits) {
        throw new Error('Sell quantity must equal the open position; partial exits are not supported');
      }
      cash += usdc;
      realizedPnl += usdc - BigInt(position.cost_basis_usdc_units);
      db.prepare(
        `UPDATE positions SET token_units = '0', cost_basis_usdc_units = '0', status = 'closed'
         WHERE mint = ?`,
      ).run(normalized.mint);
    }

    db.prepare(
      `INSERT INTO orders (order_id, payload_hash, intent_hash, status, reason, payload_json)
       VALUES (?, ?, ?, 'filled', NULL, ?)`,
    ).run(normalized.orderId, payloadHash, intentHash, JSON.stringify(normalized));
    db.prepare(
      `INSERT INTO fills (order_id, mint, side, token_units, usdc_units, fee_usdc_units, observed_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      normalized.orderId, normalized.mint, normalized.side, normalized.tokenUnits,
      normalized.usdcUnits, normalized.feeUSDCUnits, normalized.observedAt, normalized.source,
    );
    db.prepare(
      'UPDATE portfolio SET cash_usdc_units = ?, realized_pnl_usdc_units = ? WHERE id = 1',
    ).run(cash.toString(), realizedPnl.toString());
    return { applied: true };
  });
}

// Records an attempt that produced no fill; balances and positions stay untouched.
export function recordUnfilledOrder(state: LocalState, intent: FixtureIntent, reason: string): void {
  const normalized = normalizeIntent(intent);
  requireText('unfilled order', 'reason', reason);
  const intentHash = hashIntent(normalized);
  const { db } = state;
  runInTransaction(db, () => {
    const existing = db.prepare(
      'SELECT status, payload_hash FROM orders WHERE order_id = ?',
    ).get(normalized.orderId) as { status: string; payload_hash: string } | undefined;
    if (existing) {
      if (existing.status === 'unfilled' && existing.payload_hash === intentHash) return;
      throw new Error(`Order ID conflict: ${normalized.orderId}`);
    }
    db.prepare(
      `INSERT INTO orders (order_id, payload_hash, intent_hash, status, reason, payload_json)
       VALUES (?, ?, ?, 'unfilled', ?, ?)`,
    ).run(normalized.orderId, intentHash, intentHash, reason, JSON.stringify(normalized));
  });
}

export function readPaperPositions(state: LocalState): PaperPosition[] {
  const rows = state.db.prepare(
    'SELECT mint, token_units, cost_basis_usdc_units, status FROM positions ORDER BY mint',
  ).all() as (PositionRow & { mint: string })[];
  return rows.map((row) => ({
    mint: row.mint,
    tokenUnits: row.token_units,
    costBasisUSDCUnits: row.cost_basis_usdc_units,
    status: row.status,
  }));
}
