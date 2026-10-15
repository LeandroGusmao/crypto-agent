import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseUnits } from './core/units.ts';
import { loadFixtureScenario, runFixtureReplay } from './paper/replay.ts';
import {
  buildPaperReport,
  renderPaperMarkdown,
  renderPortfolioSummary,
  renderReplaySummary,
} from './reporting/paper-report.ts';
import type { PaperReport } from './reporting/paper-report.ts';
import { openLocalState } from './state/local-state.ts';
import { initializePaperPortfolio, readPortfolio } from './state/portfolio.ts';

const USDC_DECIMALS = 6;
const INITIAL_PAPER_USDC = '1000';
const INITIAL_PAPER_UNITS = parseUnits(INITIAL_PAPER_USDC, USDC_DECIMALS).toString();
const DEFAULT_DATA_DIR = '.crypto-agent';
const DEMO_SCENARIO = fileURLToPath(
  new URL('../fixtures/paper/offline-demo.json', import.meta.url),
);
const REPORT_FORMATS = ['json', 'markdown'] as const;
type ReportFormat = (typeof REPORT_FORMATS)[number];

const HELP = `Usage: crypto-agent <command> [options]

Local paper-trading CLI running in fixture mode. It makes no network requests,
uses no live market data, holds no wallet, and never trades real funds.

Commands:
  init      Create the local paper portfolio with ${INITIAL_PAPER_USDC} paper USDC if it does not exist
  status    Show the paper portfolio (read-only)
  demo      Replay the bundled synthetic scenario and show the results
  replay    Replay a synthetic scenario file (--fixture <path>) and show the results
  report    Show the paper trading report (read-only)

Options:
  --data-dir <path>  Local state directory (default: ${DEFAULT_DATA_DIR})
  --fixture <path>   Scenario file for replay
  --format <format>  Report format for report: markdown (default) or json
  --json             Print machine-readable JSON instead of text
  -h, --help         Show this help

Text output shows amounts in USDC. JSON output uses integer USDC units with
${USDC_DECIMALS} decimal places (1 USDC = 1000000 units), serialized as strings.
Repeated init, demo, and replay runs never reset or duplicate recorded results.
`;

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runInit(dataDir: string, json: boolean): void {
  const state = openLocalState(dataDir, 'write');
  try {
    const { created } = initializePaperPortfolio(state, INITIAL_PAPER_UNITS);
    const snapshot = readPortfolio(state);
    if (json) {
      printJson(snapshot);
      return;
    }
    const headline = created
      ? `Created a paper portfolio with ${INITIAL_PAPER_USDC} USDC in ${dataDir} (fixture mode).`
      : `A paper portfolio already exists in ${dataDir}; its balance was not changed.`;
    process.stdout.write(`${headline}\n\n${renderPortfolioSummary(snapshot)}`);
  } finally {
    state.close();
  }
}

function runStatus(dataDir: string, json: boolean): void {
  const state = openLocalState(dataDir, 'read');
  try {
    const snapshot = readPortfolio(state);
    if (json) printJson(snapshot);
    else process.stdout.write(renderPortfolioSummary(snapshot));
  } finally {
    state.close();
  }
}

function recordedOrderCount(report: PaperReport): number {
  return report.modeledFillCount + report.unfilledOrderCount;
}

// Validates the whole scenario before opening state, then replays it atomically.
function runScenario(dataDir: string, scenarioPath: string, json: boolean): void {
  const scenario = loadFixtureScenario(scenarioPath);
  const state = openLocalState(dataDir, 'write');
  try {
    initializePaperPortfolio(state, INITIAL_PAPER_UNITS);
    const before = recordedOrderCount(buildPaperReport(state));
    const outcomes = runFixtureReplay(state, scenario);
    const report = buildPaperReport(state);
    if (json) {
      printJson(report);
      return;
    }
    const newOrders = recordedOrderCount(report) - before;
    process.stdout.write(
      `${renderReplaySummary(scenario.id, outcomes, newOrders)}\n${renderPaperMarkdown(report)}`,
    );
  } finally {
    state.close();
  }
}

function runReport(dataDir: string, format: ReportFormat): void {
  const state = openLocalState(dataDir, 'read');
  try {
    const report = buildPaperReport(state);
    if (format === 'json') printJson(report);
    else process.stdout.write(renderPaperMarkdown(report));
  } finally {
    state.close();
  }
}

// Returns the single command, rejecting extra arguments and options meant for another command.
function requireCommand(
  positionals: string[],
  options: { fixture?: string; format?: string },
): string {
  const [command, ...extra] = positionals;
  if (command === undefined) {
    throw new Error('Missing command. Run with --help to list commands.');
  }
  if (extra.length > 0) {
    throw new Error(`Unexpected argument "${extra[0]}". Run with --help for usage.`);
  }
  if (options.fixture !== undefined && command !== 'replay') {
    throw new Error('Option --fixture is only valid with replay.');
  }
  if (options.format !== undefined && command !== 'report') {
    throw new Error('Option --format is only valid with report.');
  }
  return command;
}

function resolveReportFormat(json: boolean, format: string | undefined): ReportFormat {
  if (json && format !== undefined && format !== 'json') {
    throw new Error(`--json cannot be combined with --format ${format}.`);
  }
  const resolved = json ? 'json' : (format ?? 'markdown');
  if (!(REPORT_FORMATS as readonly string[]).includes(resolved)) {
    throw new Error(`Unsupported report format "${resolved}". Use json or markdown.`);
  }
  return resolved as ReportFormat;
}

function main(argv: string[]): void {
  // pnpm forwards a literal "--" separator to the script; drop it before parsing.
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      'data-dir': { type: 'string', default: DEFAULT_DATA_DIR },
      fixture: { type: 'string' },
      format: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  const command = requireCommand(positionals, values);
  const dataDir = values['data-dir'];
  switch (command) {
    case 'init':
      runInit(dataDir, values.json);
      return;
    case 'status':
      runStatus(dataDir, values.json);
      return;
    case 'demo':
      runScenario(dataDir, DEMO_SCENARIO, values.json);
      return;
    case 'replay':
      if (values.fixture === undefined) {
        throw new Error('Missing --fixture <path>. Run with --help for usage.');
      }
      runScenario(dataDir, values.fixture, values.json);
      return;
    case 'report':
      runReport(dataDir, resolveReportFormat(values.json, values.format));
      return;
    default:
      throw new Error(`Unknown command "${command}". Run with --help to list commands.`);
  }
}

try {
  main(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unexpected error';
  process.stderr.write(`Error: ${message.split('\n')[0]}\n`);
  process.exitCode = 1;
}
