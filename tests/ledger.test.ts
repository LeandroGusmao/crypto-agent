import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalState } from '../src/state/local-state.ts';
import type { LocalState } from '../src/state/local-state.ts';
import { initializePaperPortfolio, readPortfolio } from '../src/state/portfolio.ts';
import { commitPaperFill, readPaperPositions, recordUnfilledOrder } from '../src/paper/ledger.ts';
import type { FixtureIntent, PaperFill } from '../src/paper/types.ts';
import { countRows, withPaperState, withTempDir } from './helpers.ts';

const buy: PaperFill = {
  orderId: 'buy-a', mint: 'fixture-asset-a', side: 'buy',
  tokenUnits: '19800000', usdcUnits: '20000000', feeUSDCUnits: '200000',
  observedAt: '2026-10-14T12:00:02.000Z', source: 'fixture',
};
const sell: PaperFill = {
  orderId: 'sell-a', mint: 'fixture-asset-a', side: 'sell',
  tokenUnits: '19800000', usdcUnits: '21800000', feeUSDCUnits: '200000',
  observedAt: '2026-10-14T12:01:02.000Z', source: 'fixture',
};
const intent: FixtureIntent = {
  orderId: 'buy-b', mint: 'fixture-asset-b', side: 'buy',
  inputUnits: '20000000', expectedNetOutputUnits: '19800000',
  decidedAt: '2026-10-14T12:00:00.000Z',
};

function snapshot(state: LocalState) {
  return {
    portfolio: readPortfolio(state),
    positions: readPaperPositions(state),
    orders: countRows(state, 'orders'),
    fills: countRows(state, 'fills'),
  };
}

test('a buy then a full sell settles cash and realized PnL without double-counting fees', () => {
  withPaperState((state) => {
    assert.deepEqual(commitPaperFill(state, buy), { applied: true });
    assert.equal(readPortfolio(state).cashUSDCUnits, '980000000');
    assert.deepEqual(readPaperPositions(state), [{
      mint: 'fixture-asset-a', tokenUnits: '19800000',
      costBasisUSDCUnits: '20000000', status: 'open',
    }]);
    assert.deepEqual(commitPaperFill(state, buy), { applied: false });
    assert.deepEqual(commitPaperFill(state, sell), { applied: true });
    assert.equal(readPortfolio(state).cashUSDCUnits, '1001800000');
    assert.equal(readPortfolio(state).realizedPnlUSDCUnits, '1800000');
    assert.equal(readPaperPositions(state)[0]?.status, 'closed');
    assert.equal(countRows(state, 'fills'), 2);
  });
});

test('a sell below cost basis records a negative realized PnL', () => {
  withPaperState((state) => {
    commitPaperFill(state, buy);
    commitPaperFill(state, { ...sell, usdcUnits: '17000000' });
    assert.equal(readPortfolio(state).cashUSDCUnits, '997000000');
    assert.equal(readPortfolio(state).realizedPnlUSDCUnits, '-3000000');
  });
});

test('idempotency survives reopening the state', () => {
  withTempDir((dir) => {
    const first = openLocalState(dir, 'write');
    try {
      initializePaperPortfolio(first, '1000000000');
      commitPaperFill(first, buy);
      commitPaperFill(first, sell);
    } finally {
      first.close();
    }
    const reopened = openLocalState(dir, 'write');
    try {
      assert.deepEqual(commitPaperFill(reopened, buy), { applied: false });
      assert.deepEqual(commitPaperFill(reopened, sell), { applied: false });
      assert.equal(readPortfolio(reopened).cashUSDCUnits, '1001800000');
      assert.equal(countRows(reopened, 'fills'), 2);
    } finally {
      reopened.close();
    }
  });
});

test('reusing an order ID with a different payload fails', () => {
  withPaperState((state) => {
    commitPaperFill(state, buy);
    assert.throws(() => commitPaperFill(state, { ...buy, usdcUnits: '20000001' }), /Order ID conflict/);
    assert.equal(readPortfolio(state).cashUSDCUnits, '980000000');
  });
});

test('an insufficient-cash buy leaves every table unchanged', () => {
  withPaperState((state) => {
    const before = snapshot(state);
    assert.throws(
      () => commitPaperFill(state, { ...buy, usdcUnits: '1000000001' }),
      /Insufficient paper cash/,
    );
    assert.deepEqual(snapshot(state), before);
  });
});

test('a second buy for an already open mint fails', () => {
  withPaperState((state) => {
    commitPaperFill(state, buy);
    const before = snapshot(state);
    assert.throws(() => commitPaperFill(state, { ...buy, orderId: 'buy-a2' }), /already open/);
    assert.deepEqual(snapshot(state), before);
  });
});

test('a sell without an open position fails', () => {
  withPaperState((state) => {
    const before = snapshot(state);
    assert.throws(() => commitPaperFill(state, sell), /No open position/);
    assert.deepEqual(snapshot(state), before);
  });
});

test('selling a quantity different from the open position fails', () => {
  withPaperState((state) => {
    commitPaperFill(state, buy);
    const before = snapshot(state);
    assert.throws(
      () => commitPaperFill(state, { ...sell, tokenUnits: '19799999' }),
      /must equal the open position/,
    );
    assert.deepEqual(snapshot(state), before);
  });
});

test('zero, negative, and malformed units are rejected before any write', () => {
  withPaperState((state) => {
    const before = snapshot(state);
    const invalid: Partial<PaperFill>[] = [
      { tokenUnits: '0' }, { usdcUnits: '0' }, { usdcUnits: '-1' },
      { tokenUnits: '1.5' }, { feeUSDCUnits: '1e3' }, { usdcUnits: '' },
    ];
    for (const change of invalid) {
      assert.throws(() => commitPaperFill(state, { ...buy, ...change }), /Invalid/);
    }
    assert.deepEqual(snapshot(state), before);
  });
});

test('an unfilled order changes no balance and replays as a no-op', () => {
  withPaperState((state) => {
    const before = readPortfolio(state);
    recordUnfilledOrder(state, intent, 'quote_unavailable');
    recordUnfilledOrder(state, intent, 'quote_unavailable');
    assert.deepEqual(readPortfolio(state), before);
    assert.deepEqual(readPaperPositions(state), []);
    assert.equal(countRows(state, 'orders'), 1);
    assert.equal(countRows(state, 'fills'), 0);
  });
});

test('an unfilled order ID cannot be reused by a different intent or as a fill', () => {
  withPaperState((state) => {
    recordUnfilledOrder(state, intent, 'quote_unavailable');
    assert.throws(
      () => recordUnfilledOrder(state, { ...intent, inputUnits: '1' }, 'quote_unavailable'),
      /Order ID conflict/,
    );
    assert.throws(
      () => commitPaperFill(state, { ...buy, orderId: intent.orderId, mint: intent.mint }, intent),
      /Order ID conflict/,
    );
    assert.equal(countRows(state, 'fills'), 0);
  });
});

test('a mint can be bought again after its position closes', () => {
  withPaperState((state) => {
    commitPaperFill(state, buy);
    commitPaperFill(state, sell);
    commitPaperFill(state, { ...buy, orderId: 'buy-a2', usdcUnits: '10000000', tokenUnits: '9000000' });
    assert.deepEqual(readPaperPositions(state), [{
      mint: 'fixture-asset-a', tokenUnits: '9000000',
      costBasisUSDCUnits: '10000000', status: 'open',
    }]);
    assert.equal(readPortfolio(state).cashUSDCUnits, '991800000');
  });
});

test('equivalent timestamp and unit spellings replay as the same order', () => {
  withPaperState((state) => {
    commitPaperFill(state, buy);
    assert.deepEqual(
      commitPaperFill(state, { ...buy, observedAt: '2026-10-14T12:00:02Z', tokenUnits: '019800000' }),
      { applied: false },
    );
    assert.equal(countRows(state, 'fills'), 1);
  });
});

test('a fill whose intent names a different order, mint, or side is rejected', () => {
  withPaperState((state) => {
    const matching: FixtureIntent = { ...intent, orderId: buy.orderId, mint: buy.mint };
    for (const change of [{ orderId: 'other' }, { mint: 'other' }, { side: 'sell' as const }]) {
      assert.throws(
        () => commitPaperFill(state, buy, { ...matching, ...change }),
        /must match the intent/,
      );
    }
    assert.equal(countRows(state, 'orders'), 0);
  });
});

test('an unfilled order requires a reason', () => {
  withPaperState((state) => {
    assert.throws(() => recordUnfilledOrder(state, intent, ''), /reason/);
    assert.equal(countRows(state, 'orders'), 0);
  });
});
