import { runInTransaction } from './local-state.ts';
import type { LocalState } from './local-state.ts';

export type PortfolioSnapshot = {
  mode: 'fixture'; cashUSDCUnits: string; realizedPnlUSDCUnits: string;
};

function canonicalUnits(value: string): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Invalid amount');
  return BigInt(value).toString();
}

// Seeds the paper portfolio once; later calls never reset an existing balance.
export function initializePaperPortfolio(
  state: LocalState, initialUnits: string,
): { created: boolean } {
  const units = canonicalUnits(initialUnits);
  return runInTransaction(state.db, () => {
    const result = state.db.prepare(
      `INSERT OR IGNORE INTO portfolio (id, mode, cash_usdc_units, realized_pnl_usdc_units)
       VALUES (1, 'fixture', ?, '0')`,
    ).run(units);
    return { created: Number(result.changes) > 0 };
  });
}

export function readPortfolio(state: LocalState): PortfolioSnapshot {
  const row = state.db.prepare(
    'SELECT cash_usdc_units, realized_pnl_usdc_units FROM portfolio WHERE id = 1',
  ).get() as { cash_usdc_units: string; realized_pnl_usdc_units: string } | undefined;
  if (!row) throw new Error('Portfolio is not initialized');
  return {
    mode: 'fixture',
    cashUSDCUnits: row.cash_usdc_units,
    realizedPnlUSDCUnits: row.realized_pnl_usdc_units,
  };
}
