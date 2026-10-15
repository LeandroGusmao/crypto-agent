import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseUnits } from './core/units.ts';
import { loadFixtureScenario, runFixtureReplay } from './paper/replay.ts';
import { buildPaperReport, renderPaperMarkdown } from './reporting/paper-report.ts';
import { openLocalState } from './state/local-state.ts';
import { initializePaperPortfolio, readPortfolio } from './state/portfolio.ts';

const USDC_DECIMALS = 6;
const INITIAL_PAPER_USDC = '1000';
const INITIAL_PAPER_UNITS = parseUnits(INITIAL_PAPER_USDC, USDC_DECIMALS).toString();
const DEFAULT_DATA_DIR = '.crypto-agent';
const DEMO_SCENARIO = fileURLToPath(new URL('../fixtures/paper/offline-demo.json', import.meta.url));
const REPORT_FORMATS = ['json', 'markdown'] as const;

const HELP = `Usage: crypto-agent <command> [options]

Local paper-trading CLI running in fixture mode. It makes no network requests,
uses no live market data, holds no wallet, and never trades real funds.

Commands:
  init      Create the local paper portfolio with ${INITIAL_PAPER_USDC} paper USDC if it does not exist
  status    Print the paper portfolio as JSON (read-only)
  demo      Replay the bundled synthetic scenario and print a JSON report
  replay    Replay a synthetic scenario file (--fixture <path>) and print a JSON report
  report    Print a paper trading report (read-only; --format json|markdown, default markdown)

Options:
  --data-dir <path>  Local state directory (default: ${DEFAULT_DATA_DIR})
  --fixture <path>   Scenario file for replay
  --format <format>  Report format for report: json or markdown
  -h, --help         Show this help

Amounts are integer USDC units with ${USDC_DECIMALS} decimal places (1 USDC = 1000000 units).
Repeated init, demo, and replay runs never reset or duplicate recorded results.
`;

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runInit(dataDir: string): void {
  const state = openLocalState(dataDir, 'write');
  try {
    initializePaperPortfolio(state, INITIAL_PAPER_UNITS);
    printJson(readPortfolio(state));
  } finally {
    state.close();
  }
}

function runStatus(dataDir: string): void {
  const state = openLocalState(dataDir, 'read');
  try {
    printJson(readPortfolio(state));
  } finally {
    state.close();
  }
}

// Validates the whole scenario before opening state, then replays it atomically.
function runScenario(dataDir: string, scenarioPath: string): void {
  const scenario = loadFixtureScenario(scenarioPath);
  const state = openLocalState(dataDir, 'write');
  try {
    initializePaperPortfolio(state, INITIAL_PAPER_UNITS);
    runFixtureReplay(state, scenario);
    printJson(buildPaperReport(state));
  } finally {
    state.close();
  }
}

function runReport(dataDir: string, format: (typeof REPORT_FORMATS)[number]): void {
  const state = openLocalState(dataDir, 'read');
  try {
    const report = buildPaperReport(state);
    if (format === 'json') printJson(report);
    else process.stdout.write(renderPaperMarkdown(report));
  } finally {
    state.close();
  }
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
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }

  const [command, ...extra] = positionals;
  if (command === undefined) {
    throw new Error('Missing command. Run with --help to list commands.');
  }
  if (extra.length > 0) {
    throw new Error(`Unexpected argument "${extra[0]}". Run with --help for usage.`);
  }
  if (values.fixture !== undefined && command !== 'replay') {
    throw new Error('Option --fixture is only valid with replay.');
  }
  if (values.format !== undefined && command !== 'report') {
    throw new Error('Option --format is only valid with report.');
  }

  const dataDir = values['data-dir'];
  switch (command) {
    case 'init':
      runInit(dataDir);
      return;
    case 'status':
      runStatus(dataDir);
      return;
    case 'demo':
      runScenario(dataDir, DEMO_SCENARIO);
      return;
    case 'replay':
      if (values.fixture === undefined) {
        throw new Error('Missing --fixture <path>. Run with --help for usage.');
      }
      runScenario(dataDir, values.fixture);
      return;
    case 'report': {
      const format = values.format ?? 'markdown';
      if (!(REPORT_FORMATS as readonly string[]).includes(format)) {
        throw new Error(`Unsupported report format "${format}". Use json or markdown.`);
      }
      runReport(dataDir, format as (typeof REPORT_FORMATS)[number]);
      return;
    }
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
