import type { LocalState } from './local-state.ts';

export type PortfolioSnapshot = {
  mode: 'fixture'; cashUSDCUnits: string; realizedPnlUSDCUnits: string;
};

function canonicalUnits(value: string): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('Invalid amount');
  return BigInt(value).toString();
}

// Seeds the paper portfolio once; later calls never reset an existing balance.
export function initializePaperPortfolio(state: LocalState, initialUnits: string): void {
  const units = canonicalUnits(initialUnits);
  const { db } = state;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `INSERT OR IGNORE INTO portfolio (id, mode, cash_usdc_units, realized_pnl_usdc_units)
       VALUES (1, 'fixture', ?, '0')`,
    ).run(units);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
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
