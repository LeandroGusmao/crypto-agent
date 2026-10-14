import { parseArgs } from 'node:util';
import { parseUnits } from './core/units.ts';
import { openLocalState } from './state/local-state.ts';
import { initializePaperPortfolio, readPortfolio } from './state/portfolio.ts';

const USDC_DECIMALS = 6;
const INITIAL_PAPER_USDC = '1000';
const DEFAULT_DATA_DIR = '.crypto-agent';

const HELP = `Usage: crypto-agent <command> [options]

Local paper-trading CLI running in fixture mode. It makes no network requests,
uses no live market data, holds no wallet, and never trades real funds.

Commands:
  init      Create the local paper portfolio with ${INITIAL_PAPER_USDC} paper USDC if it does not exist
  status    Print the paper portfolio as JSON (read-only)

Options:
  --data-dir <path>  Local state directory (default: ${DEFAULT_DATA_DIR})
  -h, --help         Show this help

Amounts are integer USDC units with ${USDC_DECIMALS} decimal places (1 USDC = 1000000 units).
`;

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function runInit(dataDir: string): void {
  const state = openLocalState(dataDir, 'write');
  try {
    initializePaperPortfolio(state, parseUnits(INITIAL_PAPER_USDC, USDC_DECIMALS).toString());
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

function main(argv: string[]): void {
  // pnpm forwards a literal "--" separator to the script; drop it before parsing.
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const { values, positionals } = parseArgs({
    args,
    strict: true,
    allowPositionals: true,
    options: {
      'data-dir': { type: 'string', default: DEFAULT_DATA_DIR },
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

  const dataDir = values['data-dir'];
  switch (command) {
    case 'init':
      runInit(dataDir);
      return;
    case 'status':
      runStatus(dataDir);
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
