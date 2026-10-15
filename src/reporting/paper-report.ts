import { formatUnits } from '../core/units.ts';
import type { LocalState } from '../state/local-state.ts';
import { readPortfolio } from '../state/portfolio.ts';
import type { PortfolioSnapshot } from '../state/portfolio.ts';
import { readPaperPositions } from '../paper/ledger.ts';
import type { ExecutionOutcome, PaperPosition } from '../paper/types.ts';

const USDC_DECIMALS = 6;

export type PaperReport = {
  mode: 'fixture'; cashUSDCUnits: string; realizedPnlUSDCUnits: string;
  openPositions: PaperPosition[]; modeledFillCount: number; unfilledOrderCount: number;
  positionsWithoutExitValue: number;
};

function count(state: LocalState, sql: string): number {
  return (state.db.prepare(sql).get() as { n: number }).n;
}

// Read-only snapshot. Without a fresh modeled exit quote, an open position has unknown exit value.
export function buildPaperReport(state: LocalState): PaperReport {
  const portfolio = readPortfolio(state);
  const openPositions = readPaperPositions(state).filter((p) => p.status === 'open');
  return {
    mode: 'fixture',
    cashUSDCUnits: portfolio.cashUSDCUnits,
    realizedPnlUSDCUnits: portfolio.realizedPnlUSDCUnits,
    openPositions,
    modeledFillCount: count(state, 'SELECT COUNT(*) AS n FROM fills'),
    unfilledOrderCount: count(state, "SELECT COUNT(*) AS n FROM orders WHERE status = 'unfilled'"),
    positionsWithoutExitValue: openPositions.length,
  };
}

function usdc(units: string): string {
  return `${formatUnits(BigInt(units), USDC_DECIMALS)} USDC`;
}

export function renderPaperMarkdown(report: PaperReport): string {
  const lines = [
    '# Paper Trading Report',
    '',
    `Mode: ${report.mode}`,
    `Cash: ${usdc(report.cashUSDCUnits)}`,
    `Realized paper PnL: ${usdc(report.realizedPnlUSDCUnits)}`,
    `Modeled fills: ${report.modeledFillCount}`,
    `Unfilled orders: ${report.unfilledOrderCount}`,
    `Open positions: ${report.openPositions.length}`,
    `Positions without a verified exit value: ${report.positionsWithoutExitValue}`,
    '',
  ];
  if (report.openPositions.length > 0) {
    lines.push('## Open positions', '', '| Mint | Token units | Cost basis | Exit value |', '|---|---|---|---|');
    for (const position of report.openPositions) {
      lines.push(
        `| ${position.mint} | ${position.tokenUnits} | ${usdc(position.costBasisUSDCUnits)} | unknown |`,
      );
    }
    lines.push('');
  }
  lines.push('This report uses synthetic fixtures, not live market data or real trades.', '');
  return lines.join('\n');
}

// Human-readable portfolio lines shared by init and status.
export function renderPortfolioSummary(snapshot: PortfolioSnapshot): string {
  return [
    `Mode: ${snapshot.mode}`,
    `Cash: ${usdc(snapshot.cashUSDCUnits)}`,
    `Realized paper PnL: ${usdc(snapshot.realizedPnlUSDCUnits)}`,
    '',
  ].join('\n');
}

// Lists each replayed event's outcome and how many orders this run newly recorded.
export function renderReplaySummary(
  scenarioId: string, outcomes: ExecutionOutcome[], newOrderCount: number,
): string {
  const lines = [`Replayed scenario ${scenarioId} (${outcomes.length} events, synthetic fixture data).`];
  outcomes.forEach((outcome, index) => {
    const detail = outcome.reason ? `${outcome.status} (${outcome.reason})` : outcome.status;
    lines.push(`  ${index + 1}. ${outcome.orderId}: ${detail}`);
  });
  lines.push(newOrderCount === 0
    ? 'New orders recorded: 0 (all orders were already recorded; nothing changed)'
    : `New orders recorded: ${newOrderCount}`);
  return `${lines.join('\n')}\n`;
}
