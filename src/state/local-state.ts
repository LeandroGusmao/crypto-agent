import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type LocalState = { db: DatabaseSync; close(): void };

const BUSY_TIMEOUT_MS = 5000;

// Ordered schema migrations; entry N upgrades the database to user_version N + 1.
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE portfolio (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mode TEXT NOT NULL CHECK (mode = 'fixture'),
    cash_usdc_units TEXT NOT NULL,
    realized_pnl_usdc_units TEXT NOT NULL
  ) STRICT;`,
];

const LATEST_VERSION = MIGRATIONS.length;

function readSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

function assertSupportedVersion(version: number): void {
  if (version > LATEST_VERSION) {
    throw new Error(
      `Database schema version ${version} is newer than supported version ${LATEST_VERSION}`,
    );
  }
}

function migrate(db: DatabaseSync): void {
  const current = readSchemaVersion(db);
  assertSupportedVersion(current);
  for (let version = current; version < LATEST_VERSION; version++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[version] as string);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function acquireWriterLock(lockPath: string): string {
  const token = randomUUID();
  let fd: number;
  try {
    fd = openSync(lockPath, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Database is already in use by another writer (lock file: ${lockPath})`);
    }
    throw error;
  }
  try {
    writeSync(fd, `${JSON.stringify({ pid: process.pid, token })}\n`);
  } finally {
    closeSync(fd);
  }
  return token;
}

function releaseWriterLock(lockPath: string, token: string): void {
  try {
    const owner = JSON.parse(readFileSync(lockPath, 'utf8')) as { token?: unknown };
    if (owner.token === token) unlinkSync(lockPath);
  } catch {
    // A missing or foreign lock is left untouched.
  }
}

function openReader(dbPath: string): LocalState {
  if (!existsSync(dbPath)) throw new Error('Database is not initialized');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const version = readSchemaVersion(db);
    if (version === 0) throw new Error('Database is not initialized');
    assertSupportedVersion(version);
  } catch (error) {
    db.close();
    throw error;
  }
  return { db, close: () => db.close() };
}

function openWriter(dataDir: string, dbPath: string): LocalState {
  mkdirSync(dataDir, { recursive: true });
  const lockPath = join(dataDir, 'state.lock');
  const token = acquireWriterLock(lockPath);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath);
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA journal_mode = WAL');
    migrate(db);
  } catch (error) {
    try {
      db?.close();
    } finally {
      releaseWriterLock(lockPath, token);
    }
    throw error;
  }
  const opened = db;
  return {
    db: opened,
    close: () => {
      try {
        opened.close();
      } finally {
        releaseWriterLock(lockPath, token);
      }
    },
  };
}

// Writers hold an exclusive lock file and apply migrations; readers never create or migrate state.
export function openLocalState(dataDir: string, access: 'read' | 'write'): LocalState {
  const dbPath = join(dataDir, 'state.db');
  return access === 'write' ? openWriter(dataDir, dbPath) : openReader(dbPath);
}
