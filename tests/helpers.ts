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
