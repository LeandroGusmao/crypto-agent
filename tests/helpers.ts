import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalState } from '../src/state/local-state.ts';
import type { LocalState } from '../src/state/local-state.ts';
import { initializePaperPortfolio } from '../src/state/portfolio.ts';

export function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'crypto-agent-test-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Opens a writer on a fresh directory seeded with 1000 paper USDC.
export function withPaperState(run: (state: LocalState, dir: string) => void): void {
  withTempDir((dir) => {
    const state = openLocalState(dir, 'write');
    try {
      initializePaperPortfolio(state, '1000000000');
      run(state, dir);
    } finally {
      state.close();
    }
  });
}

export function countRows(state: LocalState, table: 'orders' | 'fills' | 'positions'): number {
  const row = state.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

// Literal copy of the tracked offline demo so tests do not derive expectations from the fixture file.
export function offlineScenario() {
  return {
    mode: 'fixture',
    id: 'offline-demo-v1',
    events: [
      {
        intent: {
          orderId: 'offline-demo-v1:buy',
          mint: 'fixture-asset-a',
          side: 'buy',
          inputUnits: '20000000',
          expectedNetOutputUnits: '19800000',
          decidedAt: '2026-10-14T12:00:00.000Z',
        },
        quote: {
          source: 'fixture',
          evidenceClass: 'modeled',
          mint: 'fixture-asset-a',
          side: 'buy',
          inputUnits: '20000000',
          netOutputUnits: '19800000',
          feeUSDCUnits: '200000',
          observedAt: '2026-10-14T12:00:02.000Z',
        },
        now: '2026-10-14T12:00:02.000Z',
      },
      {
        intent: {
          orderId: 'offline-demo-v1:exit-unavailable',
          mint: 'fixture-asset-a',
          side: 'sell',
          inputUnits: '19800000',
          expectedNetOutputUnits: '21800000',
          decidedAt: '2026-10-14T12:00:30.000Z',
        },
        quote: null,
        now: '2026-10-14T12:00:32.000Z',
      },
      {
        intent: {
          orderId: 'offline-demo-v1:sell',
          mint: 'fixture-asset-a',
          side: 'sell',
          inputUnits: '19800000',
          expectedNetOutputUnits: '21800000',
          decidedAt: '2026-10-14T12:01:00.000Z',
        },
        quote: {
          source: 'fixture',
          evidenceClass: 'modeled',
          mint: 'fixture-asset-a',
          side: 'sell',
          inputUnits: '19800000',
          netOutputUnits: '21800000',
          feeUSDCUnits: '200000',
          observedAt: '2026-10-14T12:01:02.000Z',
        },
        now: '2026-10-14T12:01:02.000Z',
      },
    ],
  };
}
