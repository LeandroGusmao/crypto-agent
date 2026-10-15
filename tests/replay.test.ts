import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPortfolio } from '../src/state/portfolio.ts';
import { loadFixtureScenario, runFixtureReplay } from '../src/paper/replay.ts';
import { buildPaperReport, renderPaperMarkdown } from '../src/reporting/paper-report.ts';
import { countRows, offlineScenario, withPaperState, withTempDir } from './helpers.ts';

type Scenario = ReturnType<typeof offlineScenario>;

function loadFrom(dir: string, content: unknown): ReturnType<typeof loadFixtureScenario> {
  const path = join(dir, 'scenario.json');
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content));
  return loadFixtureScenario(path);
}

test('the loader returns a validated scenario with parsed events in order', () => {
  withTempDir((dir) => {
    const scenario = loadFrom(dir, offlineScenario());
    assert.equal(scenario.id, 'offline-demo-v1');
    assert.deepEqual(
      scenario.events.map((e) => e.intent.orderId),
      ['offline-demo-v1:buy', 'offline-demo-v1:exit-unavailable', 'offline-demo-v1:sell'],
    );
    assert.equal(scenario.events[1]?.quote, null);
  });
});

test('the loader rejects malformed scenarios with a located English error', () => {
  const cases: { name: string; change: (s: Scenario) => void; error: RegExp }[] = [
    {
      name: 'mode',
      change: (s) => {
        (s as { mode: string }).mode = 'live';
      },
      error: /mode must be "fixture"/,
    },
    {
      name: 'id',
      change: (s) => {
        s.id = '';
      },
      error: /id must be a non-empty string/,
    },
    {
      name: 'no events',
      change: (s) => {
        s.events = [];
      },
      error: /events must be a non-empty array/,
    },
    {
      name: 'duplicate order ID',
      change: (s) => {
        s.events[2]!.intent.orderId = 'offline-demo-v1:buy';
      },
      error: /event 3: duplicate order ID "offline-demo-v1:buy"/,
    },
    {
      name: 'decision moves backward',
      change: (s) => {
        s.events[1]!.intent.decidedAt = '2026-10-14T11:59:59.000Z';
      },
      error: /event 2: decidedAt moves backward/,
    },
    {
      name: 'now moves backward',
      change: (s) => {
        s.events[2]!.now = '2026-10-14T12:00:31.000Z';
      },
      error: /event 3: now moves backward/,
    },
    {
      name: 'observation moves backward',
      change: (s) => {
        s.events[2]!.quote!.observedAt = '2026-10-14T12:00:01.000Z';
      },
      error: /event 3: observedAt moves backward/,
    },
    {
      name: 'quote timestamp',
      change: (s) => {
        s.events[0]!.quote!.observedAt = '2026-10-14 12:00:02';
      },
      error: /event 1: Invalid quote: observedAt/,
    },
    {
      name: 'evidence class',
      change: (s) => {
        s.events[0]!.quote!.evidenceClass = 'guess';
      },
      error: /event 1: Invalid quote: evidenceClass/,
    },
    {
      name: 'quote source',
      change: (s) => {
        s.events[0]!.quote!.source = 'live';
      },
      error: /event 1: Invalid quote: source must be "fixture"/,
    },
    {
      name: 'zero net output',
      change: (s) => {
        s.events[0]!.quote!.netOutputUnits = '0';
      },
      error: /event 1: Invalid quote: netOutputUnits must be positive/,
    },
    {
      name: 'missing now',
      change: (s) => {
        delete (s.events[0] as { now?: string }).now;
      },
      error: /event 1: now must be an ISO 8601 UTC timestamp/,
    },
    {
      name: 'exponent units',
      change: (s) => {
        s.events[0]!.intent.inputUnits = '2e7';
      },
      error: /event 1: Invalid intent: inputUnits/,
    },
  ];
  withTempDir((dir) => {
    for (const { name, change, error } of cases) {
      const scenario = offlineScenario();
      change(scenario);
      assert.throws(() => loadFrom(dir, scenario), error, name);
    }
    assert.throws(() => loadFrom(dir, '[1, 2'), /Invalid fixture: .* is not valid JSON/);
    assert.throws(
      () => loadFixtureScenario(join(dir, 'missing.json')),
      /Cannot read fixture file: .*missing\.json/,
    );
  });
});

test('a rejected event keeps the underlying validation error as its cause', () => {
  withTempDir((dir) => {
    const scenario = offlineScenario();
    scenario.events[0]!.intent.inputUnits = '2e7';
    assert.throws(
      () => loadFrom(dir, scenario),
      (error: Error) =>
        error.cause instanceof Error &&
        error.cause.message.startsWith('Invalid intent: inputUnits'),
    );
  });
});

test('replay returns each outcome in event order', () => {
  withTempDir((dir) => {
    const scenario = loadFrom(dir, offlineScenario());
    withPaperState((state) => {
      assert.deepEqual(runFixtureReplay(state, scenario), [
        { orderId: 'offline-demo-v1:buy', status: 'filled', reason: null },
        {
          orderId: 'offline-demo-v1:exit-unavailable',
          status: 'unfilled',
          reason: 'quote_unavailable',
        },
        { orderId: 'offline-demo-v1:sell', status: 'filled', reason: null },
      ]);
    });
  });
});

test('replay is all-or-nothing when a later event fails accounting', () => {
  withTempDir((dir) => {
    const raw = offlineScenario();
    raw.events[2]!.intent.mint = 'fixture-asset-z';
    raw.events[2]!.quote!.mint = 'fixture-asset-z';
    const scenario = loadFrom(dir, raw);
    withPaperState((state) => {
      assert.throws(() => runFixtureReplay(state, scenario), /No open position/);
      assert.equal(countRows(state, 'orders'), 0);
      assert.equal(countRows(state, 'positions'), 0);
      assert.equal(readPortfolio(state).cashUSDCUnits, '1000000000');
    });
  });
});

test('the Markdown report for the completed demo matches the documented layout', () => {
  withTempDir((dir) => {
    const scenario = loadFrom(dir, offlineScenario());
    withPaperState((state) => {
      runFixtureReplay(state, scenario);
      assert.equal(
        renderPaperMarkdown(buildPaperReport(state)),
        [
          '# Paper Trading Report',
          '',
          'Mode: fixture',
          'Cash: 1001.8 USDC',
          'Realized paper PnL: 1.8 USDC',
          'Modeled fills: 2',
          'Unfilled orders: 1',
          'Open positions: 0',
          'Positions without a verified exit value: 0',
          '',
          'This report uses synthetic fixtures, not live market data or real trades.',
          '',
        ].join('\n'),
      );
    });
  });
});

test('a realized loss renders with a minus sign', () => {
  withTempDir((dir) => {
    const raw = offlineScenario();
    raw.events[2]!.intent.expectedNetOutputUnits = '17000000';
    raw.events[2]!.quote!.netOutputUnits = '17000000';
    const scenario = loadFrom(dir, raw);
    withPaperState((state) => {
      runFixtureReplay(state, scenario);
      assert.match(renderPaperMarkdown(buildPaperReport(state)), /^Realized paper PnL: -3 USDC$/m);
    });
  });
});
