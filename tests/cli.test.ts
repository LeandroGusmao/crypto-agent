import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { offlineScenario, withTempDir } from './helpers.ts';

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function assertSingleLineError(stderr: string, pattern: RegExp): void {
  const lines = stderr.trimEnd().split('\n');
  assert.equal(lines.length, 1, `expected one stderr line, got: ${stderr}`);
  assert.match(lines[0] ?? '', pattern);
}

function readJsonReport(dir: string) {
  const response = runCli(['report', '--format', 'json', '--data-dir', dir]);
  assert.equal(response.status, 0, response.stderr);
  return JSON.parse(response.stdout);
}

test('init seeds 1000 USDC once and status reports it in fixture mode', () => {
  withTempDir((dir) => {
    const first = runCli(['init', '--json', '--data-dir', dir]);
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(JSON.parse(first.stdout), {
      mode: 'fixture', cashUSDCUnits: '1000000000', realizedPnlUSDCUnits: '0',
    });

    assert.equal(runCli(['init', '--data-dir', dir]).status, 0);

    const status = runCli(['status', '--json', '--data-dir', dir]);
    assert.equal(status.status, 0, status.stderr);
    assert.deepEqual(JSON.parse(status.stdout), {
      mode: 'fixture', cashUSDCUnits: '1000000000', realizedPnlUSDCUnits: '0',
    });
    assert.equal(existsSync(join(dir, 'state.lock')), false);
  });
});

test('init and status print readable USDC amounts by default', () => {
  withTempDir((dir) => {
    const first = runCli(['init', '--data-dir', dir]);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /^Created a paper portfolio with 1000 USDC/m);
    assert.match(first.stdout, /^Mode: fixture$/m);
    assert.match(first.stdout, /^Cash: 1000 USDC$/m);
    assert.match(first.stdout, /^Realized paper PnL: 0 USDC$/m);
    assert.doesNotMatch(first.stdout, /1000000000/);

    const again = runCli(['init', '--data-dir', dir]);
    assert.match(again.stdout, /^A paper portfolio already exists .*; its balance was not changed\.$/m);
    assert.match(again.stdout, /^Cash: 1000 USDC$/m);

    const status = runCli(['status', '--data-dir', dir]);
    assert.equal(status.status, 0, status.stderr);
    assert.match(status.stdout, /^Mode: fixture$/m);
    assert.match(status.stdout, /^Cash: 1000 USDC$/m);
    assert.match(status.stdout, /^Realized paper PnL: 0 USDC$/m);
  });
});

test('demo survives separate processes without duplicate fills', () => {
  withTempDir((dir) => {
    assert.equal(runCli(['init', '--data-dir', dir]).status, 0);
    assert.equal(runCli(['demo', '--data-dir', dir]).status, 0);
    assert.equal(runCli(['demo', '--data-dir', dir]).status, 0);

    assert.deepEqual(readJsonReport(dir), {
      mode: 'fixture', cashUSDCUnits: '1001800000', realizedPnlUSDCUnits: '1800000',
      openPositions: [], modeledFillCount: 2, unfilledOrderCount: 1,
      positionsWithoutExitValue: 0,
    });
    const status = runCli(['status', '--json', '--data-dir', dir]);
    assert.equal(status.status, 0, status.stderr);
    assert.deepEqual(JSON.parse(status.stdout), {
      mode: 'fixture', cashUSDCUnits: '1001800000', realizedPnlUSDCUnits: '1800000',
    });
  });
});

test('demo initializes on demand and the default report is Markdown', () => {
  withTempDir((dir) => {
    const demo = runCli(['demo', '--json', '--data-dir', dir]);
    assert.equal(demo.status, 0, demo.stderr);
    assert.equal(JSON.parse(demo.stdout).cashUSDCUnits, '1001800000');
    const jsonReport = runCli(['report', '--json', '--data-dir', dir]);
    assert.equal(JSON.parse(jsonReport.stdout).modeledFillCount, 2);

    const report = runCli(['report', '--data-dir', dir]);
    assert.equal(report.status, 0, report.stderr);
    assert.match(report.stdout, /^# Paper Trading Report$/m);
    assert.match(report.stdout, /^Mode: fixture$/m);
    assert.match(report.stdout, /^Realized paper PnL: 1\.8 USDC$/m);
    assert.match(report.stdout, /^Cash: 1001\.8 USDC$/m);
  });
});

test('demo prints each outcome and how many orders were newly recorded', () => {
  withTempDir((dir) => {
    const first = runCli(['demo', '--data-dir', dir]);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /^Replayed scenario offline-demo-v1 \(3 events, synthetic fixture data\)\.$/m);
    assert.match(first.stdout, /^ {2}1\. offline-demo-v1:buy: filled$/m);
    assert.match(first.stdout, /^ {2}2\. offline-demo-v1:exit-unavailable: unfilled \(quote_unavailable\)$/m);
    assert.match(first.stdout, /^ {2}3\. offline-demo-v1:sell: filled$/m);
    assert.match(first.stdout, /^New orders recorded: 3$/m);
    assert.match(first.stdout, /^Cash: 1001\.8 USDC$/m);

    const second = runCli(['demo', '--data-dir', dir]);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /^New orders recorded: 0 \(all orders were already recorded; nothing changed\)$/m);
    assert.match(second.stdout, /^Cash: 1001\.8 USDC$/m);
  });
});

test('a scenario ending after an unavailable exit keeps the position without an exit value', () => {
  withTempDir((dir) => {
    const scenario = offlineScenario();
    scenario.events = scenario.events.slice(0, 2);
    const fixturePath = join(dir, 'open position.json');
    writeFileSync(fixturePath, JSON.stringify(scenario));
    const dataDir = join(dir, 'state');

    const replay = runCli(['replay', '--fixture', fixturePath, '--data-dir', dataDir]);
    assert.equal(replay.status, 0, replay.stderr);
    assert.deepEqual(readJsonReport(dataDir), {
      mode: 'fixture', cashUSDCUnits: '980000000', realizedPnlUSDCUnits: '0',
      openPositions: [{
        mint: 'fixture-asset-a', tokenUnits: '19800000',
        costBasisUSDCUnits: '20000000', status: 'open',
      }],
      modeledFillCount: 1, unfilledOrderCount: 1, positionsWithoutExitValue: 1,
    });
    const markdown = runCli(['report', '--format', 'markdown', '--data-dir', dataDir]);
    assert.match(markdown.stdout, /^Positions without a verified exit value: 1$/m);
    assert.match(markdown.stdout, /^\| fixture-asset-a \| 19800000 \| 20 USDC \| unknown \|$/m);
  });
});

test('replaying invalid JSON fails before creating the data directory', () => {
  withTempDir((dir) => {
    const fixturePath = join(dir, 'broken fixture.json');
    writeFileSync(fixturePath, '{ "mode": "fixture", ');
    const dataDir = join(dir, 'state');
    const result = runCli(['replay', '--fixture', fixturePath, '--data-dir', dataDir]);
    assert.equal(result.status, 1);
    assertSingleLineError(result.stderr, /^Error: Invalid fixture: .* is not valid JSON/);
    assert.equal(existsSync(dataDir), false);
  });
});

test('a scenario with a valid event followed by an invalid one changes nothing', () => {
  withTempDir((dir) => {
    const scenario = offlineScenario();
    (scenario.events[1] as { now: string }).now = 'not-a-time';
    const fixturePath = join(dir, 'partly invalid.json');
    writeFileSync(fixturePath, JSON.stringify(scenario));
    const dataDir = join(dir, 'state');
    assert.equal(runCli(['init', '--data-dir', dataDir]).status, 0);

    const result = runCli(['replay', '--fixture', fixturePath, '--data-dir', dataDir]);
    assert.equal(result.status, 1);
    assertSingleLineError(result.stderr, /^Error: Invalid fixture event 2: now/);
    const report = readJsonReport(dataDir);
    assert.equal(report.cashUSDCUnits, '1000000000');
    assert.equal(report.modeledFillCount, 0);
    assert.equal(report.unfilledOrderCount, 0);
  });
});

test('status before init fails with one English line and creates nothing', () => {
  withTempDir((dir) => {
    const missing = join(dir, 'missing');
    for (const args of [['status'], ['report']]) {
      const result = runCli([...args, '--data-dir', missing]);
      assert.equal(result.status, 1);
      assertSingleLineError(result.stderr, /^Error: Database is not initialized/);
      assert.equal(result.stdout, '');
    }
    assert.equal(existsSync(missing), false);
  });
});

test('invalid commands and options fail cleanly', () => {
  withTempDir((dir) => {
    const cases: [string[], RegExp][] = [
      [['trade', '--data-dir', dir], /^Error: Unknown command "trade"/],
      [['status', '--data-dir', dir, '--live'], /^Error: .*--live/],
      [['--data-dir', dir], /^Error: Missing command/],
      [['status', 'extra', '--data-dir', dir], /^Error: Unexpected argument "extra"/],
      [['report', '--format', 'xml', '--data-dir', dir], /^Error: Unsupported report format "xml"/],
      [['replay', '--data-dir', dir], /^Error: Missing --fixture/],
      [['status', '--format', 'json', '--data-dir', dir], /^Error: Option --format is only valid with report/],
      [['demo', '--fixture', 'x.json', '--data-dir', dir], /^Error: Option --fixture is only valid with replay/],
      [['report', '--json', '--format', 'markdown', '--data-dir', dir], /^Error: --json cannot be combined with --format markdown/],
    ];
    for (const [args, pattern] of cases) {
      const result = runCli(args);
      assert.equal(result.status, 1, args.join(' '));
      assertSingleLineError(result.stderr, pattern);
    }
  });
});

test('help lists every command and states fixture mode', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /fixture mode/i);
  for (const command of ['init', 'status', 'demo', 'replay', 'report']) {
    assert.match(result.stdout, new RegExp(`^\\s+${command}\\b`, 'm'), command);
  }
  assert.match(result.stdout, /--data-dir/);
  assert.match(result.stdout, /--json/);
});

test('a leading -- separator passed through by pnpm is ignored', () => {
  withTempDir((dir) => {
    const result = runCli(['--', 'init', '--json', '--data-dir', dir]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).cashUSDCUnits, '1000000000');
  });
});
