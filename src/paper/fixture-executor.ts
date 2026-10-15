import { parseUtcTimestamp } from '../core/time.ts';
import type { LocalState } from '../state/local-state.ts';
import { requireText, requireUnits } from '../core/validation.ts';
import {
  commitPaperFill, hashIntent, normalizeIntent, readOrderRecord, recordUnfilledOrder,
} from './ledger.ts';
import type { ExecutionOutcome, FixtureIntent, FixtureQuote, PaperFill } from './types.ts';

const MIN_LATENCY_MS = 1000;
const MAX_QUOTE_AGE_MS = 15000;
// Accept at most 3% adverse slippage: actual * 10000 >= expected * 9700.
const SLIPPAGE_FLOOR_BPS = 9700n;

function validateQuoteShape(quote: FixtureQuote): FixtureQuote {
  if (typeof quote !== 'object' || quote === null) throw new Error('Invalid quote: must be an object');
  return {
    source: requireText('quote', 'source', quote.source) as FixtureQuote['source'],
    evidenceClass: requireText('quote', 'evidenceClass', quote.evidenceClass) as FixtureQuote['evidenceClass'],
    mint: requireText('quote', 'mint', quote.mint),
    side: requireText('quote', 'side', quote.side) as FixtureQuote['side'],
    inputUnits: requireUnits('quote', 'inputUnits', quote.inputUnits, { positive: false }),
    netOutputUnits: requireUnits('quote', 'netOutputUnits', quote.netOutputUnits, { positive: false }),
    feeUSDCUnits: requireUnits('quote', 'feeUSDCUnits', quote.feeUSDCUnits, { positive: false }),
    observedAt: requireText('quote', 'observedAt', quote.observedAt),
  };
}

// Returns why the quote cannot fill the intent, or null when it is eligible.
function rejectionReason(intent: FixtureIntent, quote: FixtureQuote, nowMs: number): string | null {
  if (quote.source !== 'fixture') return 'quote_source_mismatch';
  if (quote.mint !== intent.mint) return 'quote_mint_mismatch';
  if (quote.side !== intent.side) return 'quote_side_mismatch';
  if (quote.inputUnits !== intent.inputUnits) return 'quote_input_mismatch';
  if (quote.evidenceClass !== 'modeled') return 'quote_not_modeled';
  const observedMs = parseUtcTimestamp(quote.observedAt);
  const decidedMs = Date.parse(intent.decidedAt);
  if (observedMs === null) return 'quote_timestamp_invalid';
  if (observedMs > nowMs) return 'quote_from_future';
  if (observedMs < decidedMs) return 'quote_before_decision';
  if (observedMs < decidedMs + MIN_LATENCY_MS) return 'quote_before_min_latency';
  if (nowMs - observedMs > MAX_QUOTE_AGE_MS) return 'quote_stale';
  const expected = BigInt(intent.expectedNetOutputUnits);
  const actual = BigInt(quote.netOutputUnits);
  if (actual * 10000n < expected * SLIPPAGE_FLOOR_BPS) return 'slippage_exceeded';
  return null;
}

// Fills an intent from a dated fixture quote, or records why it stayed unfilled.
export function executeFixtureOrder(
  state: LocalState, intent: FixtureIntent, quote: FixtureQuote | null, nowMs: number,
): ExecutionOutcome {
  const normalized = normalizeIntent(intent);
  const checkedQuote = quote === null ? null : validateQuoteShape(quote);
  if (!Number.isFinite(nowMs)) throw new Error('Invalid execution time: nowMs must be finite');

  const stored = readOrderRecord(state, normalized.orderId);
  if (stored) {
    if (stored.intentHash !== hashIntent(normalized)) {
      throw new Error(`Order ID conflict: ${normalized.orderId}`);
    }
    return { orderId: normalized.orderId, status: stored.status, reason: stored.reason };
  }

  const unfilled = (reason: string): ExecutionOutcome => {
    recordUnfilledOrder(state, normalized, reason);
    return { orderId: normalized.orderId, status: 'unfilled', reason };
  };
  if (checkedQuote === null) return unfilled('quote_unavailable');
  const reason = rejectionReason(normalized, checkedQuote, nowMs);
  if (reason !== null) return unfilled(reason);

  const isBuy = normalized.side === 'buy';
  const fill: PaperFill = {
    orderId: normalized.orderId,
    mint: normalized.mint,
    side: normalized.side,
    tokenUnits: isBuy ? checkedQuote.netOutputUnits : normalized.inputUnits,
    usdcUnits: isBuy ? normalized.inputUnits : checkedQuote.netOutputUnits,
    feeUSDCUnits: checkedQuote.feeUSDCUnits,
    observedAt: checkedQuote.observedAt,
    source: 'fixture',
  };
  commitPaperFill(state, fill, normalized);
  return { orderId: normalized.orderId, status: 'filled', reason: null };
}
