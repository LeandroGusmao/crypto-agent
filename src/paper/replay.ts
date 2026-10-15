import { readFileSync } from 'node:fs';
import { parseUtcTimestamp } from '../core/time.ts';
import {
  invalid,
  requireOneOf,
  requireSide,
  requireText,
  requireUnits,
  requireUtcTimestamp,
} from '../core/validation.ts';
import { runInTransaction } from '../state/local-state.ts';
import type { LocalState } from '../state/local-state.ts';
import { executeFixtureOrder } from './fixture-executor.ts';
import { normalizeIntent } from './ledger.ts';
import type { ExecutionOutcome, FixtureIntent, FixtureQuote } from './types.ts';

export type FixtureScenario = {
  mode: 'fixture';
  id: string;
  events: { intent: FixtureIntent; quote: FixtureQuote | null; now: string }[];
};

const EVIDENCE_CLASSES = ['modeled', 'quote_only', 'unsupported'] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseQuote(value: unknown): FixtureQuote | null {
  if (value === null) return null;
  if (!isObject(value)) throw invalid('quote', 'must be an object or null');
  if (value.source !== 'fixture') throw invalid('quote', 'source must be "fixture"');
  return {
    source: 'fixture',
    evidenceClass: requireOneOf('quote', 'evidenceClass', value.evidenceClass, EVIDENCE_CLASSES),
    mint: requireText('quote', 'mint', value.mint),
    side: requireSide('quote', value.side),
    inputUnits: requireUnits('quote', 'inputUnits', value.inputUnits, { positive: true }),
    netOutputUnits: requireUnits('quote', 'netOutputUnits', value.netOutputUnits, {
      positive: true,
    }),
    feeUSDCUnits: requireUnits('quote', 'feeUSDCUnits', value.feeUSDCUnits, { positive: false }),
    observedAt: requireUtcTimestamp('quote', 'observedAt', value.observedAt),
  };
}

type ScenarioEvent = FixtureScenario['events'][number];

function parseEvent(value: unknown): ScenarioEvent {
  if (!isObject(value)) throw new Error('must be an object');
  if (!('quote' in value)) throw new Error('quote must be an object or null');
  const intent = normalizeIntent(value.intent as FixtureIntent);
  const quote = parseQuote(value.quote);
  const nowMs = parseUtcTimestamp(value.now);
  if (nowMs === null) throw new Error('now must be an ISO 8601 UTC timestamp');
  return { intent, quote, now: new Date(nowMs).toISOString() };
}

// Rejects duplicate order IDs and any time that moves backward relative to the previous event.
function assertArrivalOrder(events: ScenarioEvent[]): void {
  const orderIds = new Set<string>();
  let previous: ScenarioEvent | undefined;
  let lastObservedAt: string | undefined;
  events.forEach((event, index) => {
    const fail = (detail: string) => new Error(`Invalid fixture event ${index + 1}: ${detail}`);
    if (orderIds.has(event.intent.orderId)) {
      throw fail(`duplicate order ID "${event.intent.orderId}"`);
    }
    orderIds.add(event.intent.orderId);
    if (previous && event.intent.decidedAt < previous.intent.decidedAt) {
      throw fail('decidedAt moves backward relative to the previous event');
    }
    if (previous && event.now < previous.now) {
      throw fail('now moves backward relative to the previous event');
    }
    if (event.quote) {
      if (lastObservedAt && event.quote.observedAt < lastObservedAt) {
        throw fail('observedAt moves backward relative to an earlier quote');
      }
      lastObservedAt = event.quote.observedAt;
    }
    previous = event;
  });
}

// Reads and validates an entire scenario file before any state is opened.
export function loadFixtureScenario(path: string): FixtureScenario {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Cannot read fixture file: ${path}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw invalid('fixture', `${path} is not valid JSON`);
  }
  if (!isObject(raw)) throw invalid('fixture', 'scenario must be a JSON object');
  if (raw.mode !== 'fixture') throw invalid('fixture', 'mode must be "fixture"');
  const id = requireText('fixture', 'id', raw.id);
  if (!Array.isArray(raw.events) || raw.events.length === 0) {
    throw invalid('fixture', 'events must be a non-empty array');
  }
  const events = raw.events.map((value: unknown, index: number) => {
    try {
      return parseEvent(value);
    } catch (error) {
      throw new Error(`Invalid fixture event ${index + 1}: ${(error as Error).message}`);
    }
  });
  assertArrivalOrder(events);
  return { mode: 'fixture', id, events };
}

// Replays every event in one transaction, so a failing event leaves no partial results.
export function runFixtureReplay(state: LocalState, scenario: FixtureScenario): ExecutionOutcome[] {
  return runInTransaction(state.db, () =>
    scenario.events.map((event) =>
      executeFixtureOrder(state, event.intent, event.quote, Date.parse(event.now)),
    ),
  );
}
