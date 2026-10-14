import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

function runCli(args: string[]) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'crypto-agent-cli-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertSingleLineError(stderr: string, pattern: RegExp): void {
  const lines = stderr.trimEnd().split('\n');
  assert.equal(lines.length, 1, `expected one stderr line, got: ${stderr}`);
  assert.match(lines[0] ?? '', pattern);
}

test('init seeds 1000 USDC once and status reports it in fixture mode', () => {
  withTempDir((dir) => {
    const first = runCli(['init', '--data-dir', dir]);
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(JSON.parse(first.stdout), {
      mode: 'fixture', cashUSDCUnits: '1000000000', realizedPnlUSDCUnits: '0',
    });

    assert.equal(runCli(['init', '--data-dir', dir]).status, 0);

    const status = runCli(['status', '--data-dir', dir]);
    assert.equal(status.status, 0, status.stderr);
    assert.deepEqual(JSON.parse(status.stdout), {
      mode: 'fixture', cashUSDCUnits: '1000000000', realizedPnlUSDCUnits: '0',
    });
    assert.equal(existsSync(join(dir, 'state.lock')), false);
  });
});

test('status before init fails with one English line and creates nothing', () => {
  withTempDir((dir) => {
    const missing = join(dir, 'missing');
    const result = runCli(['status', '--data-dir', missing]);
    assert.equal(result.status, 1);
    assertSingleLineError(result.stderr, /^Error: Database is not initialized/);
    assert.equal(result.stdout, '');
    assert.equal(existsSync(missing), false);
  });
});

test('unknown commands, unknown options, and a missing command fail cleanly', () => {
  withTempDir((dir) => {
    const cases: [string[], RegExp][] = [
      [['trade', '--data-dir', dir], /^Error: Unknown command "trade"/],
      [['status', '--data-dir', dir, '--live'], /^Error: .*--live/],
      [['--data-dir', dir], /^Error: Missing command/],
      [['status', 'extra', '--data-dir', dir], /^Error: Unexpected argument "extra"/],
    ];
    for (const [args, pattern] of cases) {
      const result = runCli(args);
      assert.equal(result.status, 1, args.join(' '));
      assertSingleLineError(result.stderr, pattern);
    }
  });
});

test('help lists the commands and states fixture mode', () => {
  const result = runCli(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /fixture mode/i);
  assert.match(result.stdout, /^\s+init\b/m);
  assert.match(result.stdout, /^\s+status\b/m);
  assert.match(result.stdout, /--data-dir/);
});

test('a leading -- separator passed through by pnpm is ignored', () => {
  withTempDir((dir) => {
    const result = runCli(['--', 'init', '--data-dir', dir]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).cashUSDCUnits, '1000000000');
  });
});
