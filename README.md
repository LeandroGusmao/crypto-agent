# Crypto Agent

An autonomous agent experiment that discovers new Solana tokens, investigates opportunities, and refines its decisions through paper trading on live market data.

> **Status:** Milestone 1 (local paper foundation) is implemented: an offline CLI with a persistent paper portfolio, deterministic fixture execution, and JSON/Markdown reports. Risk limits, spending controls, live data, and model calls are not implemented yet. The project runs in paper mode only: it holds no wallet, signs no transactions, and uses no real capital.

## Goals

- Discover newly launched Solana tokens in any segment, starting with Pump.fun launches.
- Research each candidate with on-chain verification and market enrichment, and record a thesis.
- Simulate entries and exits with realistic costs, latency, and liquidity, using only information available at decision time.
- Evaluate net results, decision quality, and operating costs, and refine the strategy from that evidence.
- Develop its own tools and skills in an isolated workshop, with explicit and versioned activation.

Profitability is a hypothesis to test, not a demonstrated capability.

## Safety boundaries

- **Paper trading only.** Real capital is a separate, later phase gated by maturity criteria that are not yet defined.
- **No keys or signing.** The project contains no wallet keys, signing code, or transaction submission.
- **Local execution.** The agent runs on the operator's machine; language models are accessed through APIs.
- **Bounded spending.** Operating costs for models, data, and infrastructure are capped at approximately R$200/month. This is a spending ceiling, not trading capital, and it does not authorize subscribing to paid services.

## Decisions

### Confirmed

- Solana as the initial network, covering tokens in any segment.
- Pump.fun as the initial discovery source, behind extensible connectors.
- Monthly budget envelopes: R$150 for models, R$30 for data, and R$20 of unspent headroom.
- English for all project-authored content.

### Proposed, subject to review

- Simulation and risk parameters (paper capital, position sizing, exposure caps, loss limits, exit plans, latency and slippage bounds). They are starting values, not a validated strategy, and will be versioned and adjusted as the experiment produces evidence.
- Model selection, paid data sources, and the criteria for evaluating each experiment phase.

## Roadmap

Development is incremental. Each milestone gets its own plan after the previous milestone's contracts are verified.

| Milestone | Working checkpoint |
|---|---|
| 1. Local paper foundation | Offline CLI, persistent paper portfolio, deterministic fixture execution, JSON/Markdown reports |
| 2. Policy and spending controls | Enforced risk limits, exit scheduling, cost reservations, crash recovery |
| 3. Live discovery and market adapters | Read-only Pump.fun discovery, research snapshots, supported market quotes |
| 4. Model-assisted paper cycle | Budgeted LLM gateway, structured research and decisions, prospective paper runs |
| 5. Workshop and evaluation | Isolated tool and skill development, explicit activation, baseline comparison, maturity report |

Milestone 1 makes no network requests and no paid API calls, and it reads no API keys.

Out of scope for now: real wallets, other networks, individual NFT trading, and Polymarket, which is reserved for a future experiment.

## Tech stack

TypeScript executed natively by Node.js 24, local SQLite through `node:sqlite`, `node:test`, and pnpm. There are no runtime dependencies.

## Getting started

Requirements: Node.js 24.19 or newer within major version 24, and pnpm 11.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm start -- init
pnpm start -- demo
pnpm start -- status
pnpm start -- report --format markdown
```

The CLI runs in **fixture mode**: it makes no network requests, reads no API keys, holds no wallet, and never trades real funds. No live entries are enabled.

| Command | What it does |
|---|---|
| `init` | Creates the paper portfolio with 1000 paper USDC if it does not exist |
| `status` | Prints the portfolio as JSON (read-only) |
| `demo` | Replays the bundled synthetic scenario and prints a JSON report |
| `replay --fixture <path>` | Replays a synthetic scenario file and prints a JSON report |
| `report [--format json\|markdown]` | Prints the paper trading report (read-only; Markdown by default) |

All commands accept `--data-dir <path>` and `--help`.

### The demo scenario

[fixtures/paper/offline-demo.json](fixtures/paper/offline-demo.json) holds three synthetic events for one asset: a modeled buy of 20 USDC, a sell attempt with no quote (recorded as unfilled; the position stays open), and a modeled sell for 21.8 USDC. The amounts are deliberately synthetic accounting examples, not recorded market data or a profitability claim. After the demo the report shows 1001.8 USDC cash, 1.8 USDC realized paper PnL, two modeled fills, and one unfilled order.

A quote fills an order only when it is `modeled` evidence for the same asset, side, and amount, observed at least 1 second after the decision, no more than 15 seconds old, and within 3% adverse slippage of the expected output. These limits are proposed starting values, fixed for this milestone. A position without a fresh modeled exit quote stays open and is reported with an unknown exit value; no sale or profit is invented.

Scenario files are validated completely before any state is opened, and a replay is applied atomically: if any event fails, nothing from that replay is recorded.

### Monetary units

Monetary values are integer units of the asset's smallest denomination, serialized as decimal strings. USDC uses 6 decimal places, so `1000000000` units equal 1000 USDC.

### Local state

- State lives in `.crypto-agent/` by default and is ignored by git. Use `--data-dir <path>` to run an independent experiment in another directory.
- Running `init`, `demo`, or `replay` again never resets balances or duplicates recorded orders; every order ID is recorded once.
- `status` and `report` only read state; they fail if the portfolio has not been initialized.
- A writer holds `<data-dir>/state.lock` while it runs, and a second writer is rejected. If a process crashed and left the lock behind, confirm that no writer is still running before deleting the lock by hand: the lock file records the owner's PID, and `ps -p <pid>` should show no matching `node` process. The CLI never removes a lock it does not own. Automatic crash recovery is not part of this milestone.

## Contributing

Read [AGENTS.md](AGENTS.md) for project conventions. English is the default language for code, comments, CLI output, logs, reports, documentation, and commit messages.
