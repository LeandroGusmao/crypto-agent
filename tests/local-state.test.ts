import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openLocalState } from '../src/state/local-state.ts';
import { initializePaperPortfolio, readPortfolio } from '../src/state/portfolio.ts';

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'crypto-agent-test-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('reopening preserves the original balance instead of reinitializing', () => {
  withTempDir((dir) => {
    const first = openLocalState(dir, 'write');
    try {
      assert.deepEqual(initializePaperPortfolio(first, '1000000000'), { created: true });
    } finally {
      first.close();
    }

    const second = openLocalState(dir, 'write');
    try {
      assert.deepEqual(initializePaperPortfolio(second, '5'), { created: false });
      assert.deepEqual(readPortfolio(second), {
        mode: 'fixture', cashUSDCUnits: '1000000000', realizedPnlUSDCUnits: '0',
      });
    } finally {
      second.close();
    }
  });
});

test('a second writer is rejected while the first is alive', () => {
  withTempDir((dir) => {
    const writer = openLocalState(dir, 'write');
    try {
      assert.throws(() => openLocalState(dir, 'write'), /Database is already in use/);
    } finally {
      writer.close();
    }
    const next = openLocalState(dir, 'write');
    next.close();
  });
});

test('closing a writer leaves a lock owned by someone else in place', () => {
  withTempDir((dir) => {
    const writer = openLocalState(dir, 'write');
    const lockPath = join(dir, 'state.lock');
    writeFileSync(lockPath, JSON.stringify({ pid: 1, token: 'foreign-owner' }));
    writer.close();
    assert.equal(existsSync(lockPath), true);
    assert.throws(() => openLocalState(dir, 'write'), /Database is already in use/);
  });
});

test('a reader can inspect state while a writer holds the lock', () => {
  withTempDir((dir) => {
    const writer = openLocalState(dir, 'write');
    try {
      initializePaperPortfolio(writer, '1000000000');
      const reader = openLocalState(dir, 'read');
      try {
        assert.equal(readPortfolio(reader).cashUSDCUnits, '1000000000');
      } finally {
        reader.close();
      }
    } finally {
      writer.close();
    }
  });
});

test('read mode on a missing directory fails without creating it', () => {
  withTempDir((dir) => {
    const missing = join(dir, 'missing');
    assert.throws(() => openLocalState(missing, 'read'), /Database is not initialized/);
    assert.equal(existsSync(missing), false);
  });
});

test('read mode on an empty directory fails without creating a database', () => {
  withTempDir((dir) => {
    assert.throws(() => openLocalState(dir, 'read'), /Database is not initialized/);
    assert.equal(existsSync(join(dir, 'state.db')), false);
    assert.equal(existsSync(join(dir, 'state.lock')), false);
  });
});

test('read mode on a database without a schema fails as uninitialized', () => {
  withTempDir((dir) => {
    new DatabaseSync(join(dir, 'state.db')).close();
    assert.throws(() => openLocalState(dir, 'read'), /Database is not initialized/);
  });
});

test('reading a migrated but uninitialized portfolio fails', () => {
  withTempDir((dir) => {
    const writer = openLocalState(dir, 'write');
    try {
      assert.throws(() => readPortfolio(writer), /Portfolio is not initialized/);
    } finally {
      writer.close();
    }
  });
});

test('initialization rejects negative and malformed amounts', () => {
  withTempDir((dir) => {
    const writer = openLocalState(dir, 'write');
    try {
      for (const value of ['-1', '1.5', '1e9', '']) {
        assert.throws(() => initializePaperPortfolio(writer, value), /Invalid amount/);
      }
      assert.throws(() => readPortfolio(writer), /Portfolio is not initialized/);
    } finally {
      writer.close();
    }
  });
});

test('a schema newer than supported is rejected and releases the lock', () => {
  withTempDir((dir) => {
    openLocalState(dir, 'write').close();
    const raw = new DatabaseSync(join(dir, 'state.db'));
    raw.exec('PRAGMA user_version = 99');
    raw.close();

    assert.throws(() => openLocalState(dir, 'write'), /newer than supported/);
    assert.equal(existsSync(join(dir, 'state.lock')), false);
    assert.throws(() => openLocalState(dir, 'read'), /newer than supported/);
  });
});

test('a reader refuses an outdated schema until a writer migrates it', () => {
  withTempDir((dir) => {
    const raw = new DatabaseSync(join(dir, 'state.db'));
    raw.exec(`CREATE TABLE portfolio (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL CHECK (mode = 'fixture'),
      cash_usdc_units TEXT NOT NULL,
      realized_pnl_usdc_units TEXT NOT NULL
    ) STRICT;
    INSERT INTO portfolio VALUES (1, 'fixture', '1000000000', '0');
    PRAGMA user_version = 1;`);
    raw.close();

    assert.throws(() => openLocalState(dir, 'read'), /out of date/);
    openLocalState(dir, 'write').close();
    const reader = openLocalState(dir, 'read');
    try {
      assert.equal(readPortfolio(reader).cashUSDCUnits, '1000000000');
      const tables = reader.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      ).all() as { name: string }[];
      assert.deepEqual(tables.map((t) => t.name), ['fills', 'orders', 'portfolio', 'positions']);
    } finally {
      reader.close();
    }
  });
});
