import test from 'node:test';
import assert from 'node:assert/strict';
import { readPortfolio } from '../src/state/portfolio.ts';
import { readPaperPositions } from '../src/paper/ledger.ts';
import { executeFixtureOrder } from '../src/paper/fixture-executor.ts';
import type { FixtureIntent, FixtureQuote } from '../src/paper/types.ts';
import { countRows, withPaperState } from './helpers.ts';

const decidedAt = '2026-10-14T12:00:00.000Z';
const nowMs = Date.parse('2026-10-14T12:00:02.000Z');

const buyIntent: FixtureIntent = {
  orderId: 'buy-a', mint: 'fixture-asset-a', side: 'buy',
  inputUnits: '20000000', expectedNetOutputUnits: '19800000', decidedAt,
};
const buyQuote: FixtureQuote = {
  source: 'fixture', evidenceClass: 'modeled', mint: 'fixture-asset-a', side: 'buy',
  inputUnits: '20000000', netOutputUnits: '19800000', feeUSDCUnits: '200000',
  observedAt: '2026-10-14T12:00:02.000Z',
};
const sellIntent: FixtureIntent = {
  orderId: 'sell-a', mint: 'fixture-asset-a', side: 'sell',
  inputUnits: '19800000', expectedNetOutputUnits: '21800000',
  decidedAt: '2026-10-14T12:01:00.000Z',
};
const sellQuote: FixtureQuote = {
  source: 'fixture', evidenceClass: 'modeled', mint: 'fixture-asset-a', side: 'sell',
  inputUnits: '19800000', netOutputUnits: '21800000', feeUSDCUnits: '200000',
  observedAt: '2026-10-14T12:01:02.000Z',
};
const sellNowMs = Date.parse('2026-10-14T12:01:02.000Z');

test('a fresh modeled quote observed after the minimum latency fills the buy', () => {
  withPaperState((state) => {
    assert.deepEqual(executeFixtureOrder(state, buyIntent, buyQuote, nowMs), {
      orderId: 'buy-a', status: 'filled', reason: null,
    });
    assert.equal(readPortfolio(state).cashUSDCUnits, '980000000');
    assert.deepEqual(readPaperPositions(state), [{
      mint: 'fixture-asset-a', tokenUnits: '19800000',
      costBasisUSDCUnits: '20000000', status: 'open',
    }]);
  });
});

test('a modeled sell credits the quoted net output and realizes PnL', () => {
  withPaperState((state) => {
    executeFixtureOrder(state, buyIntent, buyQuote, nowMs);
    assert.deepEqual(executeFixtureOrder(state, sellIntent, sellQuote, sellNowMs), {
      orderId: 'sell-a', status: 'filled', reason: null,
    });
    assert.equal(readPortfolio(state).cashUSDCUnits, '1001800000');
    assert.equal(readPortfolio(state).realizedPnlUSDCUnits, '1800000');
    assert.equal(readPaperPositions(state)[0]?.status, 'closed');
  });
});

test('ineligible or unavailable quotes leave the order unfilled and balances unchanged', () => {
  const cases: { name: string; quote: FixtureQuote | null; now?: number; reason: string }[] = [
    { name: 'missing quote', quote: null, reason: 'quote_unavailable' },
    { name: 'non-fixture source', quote: { ...buyQuote, source: 'live' as 'fixture' }, reason: 'quote_source_mismatch' },
    { name: 'quote-only evidence', quote: { ...buyQuote, evidenceClass: 'quote_only' }, reason: 'quote_not_modeled' },
    { name: 'unsupported evidence', quote: { ...buyQuote, evidenceClass: 'unsupported' }, reason: 'quote_not_modeled' },
    { name: 'other mint', quote: { ...buyQuote, mint: 'fixture-asset-z' }, reason: 'quote_mint_mismatch' },
    { name: 'other side', quote: { ...buyQuote, side: 'sell' }, reason: 'quote_side_mismatch' },
    { name: 'other input', quote: { ...buyQuote, inputUnits: '20000001' }, reason: 'quote_input_mismatch' },
    { name: 'non-UTC timestamp', quote: { ...buyQuote, observedAt: '2026-10-14T12:00:02.000-03:00' }, reason: 'quote_timestamp_invalid' },
    { name: 'impossible date', quote: { ...buyQuote, observedAt: '2026-02-30T12:00:02.000Z' }, reason: 'quote_timestamp_invalid' },
    { name: 'observed after now', quote: { ...buyQuote, observedAt: '2026-10-14T12:00:02.001Z' }, reason: 'quote_from_future' },
    { name: 'observed before decision', quote: { ...buyQuote, observedAt: '2026-10-14T11:59:59.000Z' }, reason: 'quote_before_decision' },
    { name: 'inside minimum latency', quote: { ...buyQuote, observedAt: '2026-10-14T12:00:00.999Z' }, reason: 'quote_before_min_latency' },
    {
      name: 'older than 15 seconds', quote: { ...buyQuote, observedAt: '2026-10-14T12:00:02.000Z' },
      now: Date.parse('2026-10-14T12:00:17.001Z'), reason: 'quote_stale',
    },
  ];
  withPaperState((state) => {
    const before = readPortfolio(state);
    cases.forEach((c, index) => {
      const intent = { ...buyIntent, orderId: `buy-${index}` };
      assert.deepEqual(
        executeFixtureOrder(state, intent, c.quote, c.now ?? nowMs),
        { orderId: intent.orderId, status: 'unfilled', reason: c.reason },
        c.name,
      );
    });
    assert.deepEqual(readPortfolio(state), before);
    assert.deepEqual(readPaperPositions(state), []);
    assert.equal(countRows(state, 'fills'), 0);
    assert.equal(countRows(state, 'orders'), cases.length);
  });
});

test('quotes exactly at the latency and freshness boundaries fill', () => {
  const boundaries = [
    { observedAt: '2026-10-14T12:00:01.000Z', now: nowMs },
    { observedAt: '2026-10-14T12:00:02.000Z', now: Date.parse('2026-10-14T12:00:17.000Z') },
  ];
  for (const { observedAt, now } of boundaries) {
    withPaperState((state) => {
      const outcome = executeFixtureOrder(state, buyIntent, { ...buyQuote, observedAt }, now);
      assert.equal(outcome.status, 'filled', observedAt);
    });
  }
});

test('slippage of exactly 3% is accepted and one unit more is rejected', () => {
  const intent = { ...buyIntent, expectedNetOutputUnits: '20000000' };
  withPaperState((state) => {
    const outcome = executeFixtureOrder(state, intent, { ...buyQuote, netOutputUnits: '19400000' }, nowMs);
    assert.equal(outcome.status, 'filled');
    assert.equal(readPaperPositions(state)[0]?.tokenUnits, '19400000');
  });
  withPaperState((state) => {
    const outcome = executeFixtureOrder(state, intent, { ...buyQuote, netOutputUnits: '19399999' }, nowMs);
    assert.deepEqual(outcome, { orderId: 'buy-a', status: 'unfilled', reason: 'slippage_exceeded' });
    assert.equal(readPortfolio(state).cashUSDCUnits, '1000000000');
  });
});

test('a missing sell quote keeps the position open with no realized PnL', () => {
  withPaperState((state) => {
    executeFixtureOrder(state, buyIntent, buyQuote, nowMs);
    const outcome = executeFixtureOrder(state, sellIntent, null, sellNowMs);
    assert.deepEqual(outcome, { orderId: 'sell-a', status: 'unfilled', reason: 'quote_unavailable' });
    assert.equal(readPaperPositions(state)[0]?.status, 'open');
    assert.equal(readPortfolio(state).realizedPnlUSDCUnits, '0');
    assert.equal(readPortfolio(state).cashUSDCUnits, '980000000');
  });
});

test('replaying an identical intent returns its recorded outcome regardless of the new quote', () => {
  withPaperState((state) => {
    executeFixtureOrder(state, buyIntent, buyQuote, nowMs);
    assert.deepEqual(executeFixtureOrder(state, buyIntent, null, nowMs), {
      orderId: 'buy-a', status: 'filled', reason: null,
    });
    assert.equal(readPortfolio(state).cashUSDCUnits, '980000000');

    const late = { ...buyIntent, orderId: 'buy-late', mint: 'fixture-asset-b' };
    executeFixtureOrder(state, late, null, nowMs);
    assert.deepEqual(
      executeFixtureOrder(state, late, { ...buyQuote, mint: 'fixture-asset-b' }, nowMs),
      { orderId: 'buy-late', status: 'unfilled', reason: 'quote_unavailable' },
    );
    assert.equal(countRows(state, 'fills'), 1);
  });
});

test('reusing an order ID for a different intent fails', () => {
  withPaperState((state) => {
    executeFixtureOrder(state, buyIntent, buyQuote, nowMs);
    assert.throws(
      () => executeFixtureOrder(state, { ...buyIntent, inputUnits: '30000000' }, buyQuote, nowMs),
      /Order ID conflict/,
    );
  });
});

test('malformed intents and quotes throw an English error before any write', () => {
  const badIntents: Partial<FixtureIntent>[] = [
    { orderId: '' }, { mint: '' }, { side: 'hold' as 'buy' }, { inputUnits: '1e6' },
    { inputUnits: '0' }, { expectedNetOutputUnits: '-5' }, { decidedAt: 'yesterday' },
  ];
  const badQuotes: Partial<FixtureQuote>[] = [
    { netOutputUnits: 'abc' }, { inputUnits: '' }, { feeUSDCUnits: '1.5' },
  ];
  withPaperState((state) => {
    for (const change of badIntents) {
      assert.throws(
        () => executeFixtureOrder(state, { ...buyIntent, ...change }, buyQuote, nowMs),
        /^Error: Invalid intent/,
        JSON.stringify(change),
      );
    }
    for (const change of badQuotes) {
      assert.throws(
        () => executeFixtureOrder(state, buyIntent, { ...buyQuote, ...change }, nowMs),
        /^Error: Invalid quote/,
        JSON.stringify(change),
      );
    }
    assert.throws(
      () => executeFixtureOrder(state, buyIntent, buyQuote, Number.NaN),
      /^Error: Invalid execution time/,
    );
    assert.equal(countRows(state, 'orders'), 0);
  });
});
