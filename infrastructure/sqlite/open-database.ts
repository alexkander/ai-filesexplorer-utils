import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// Shared by both features' sqlite-client.ts, which open their databases at
// module scope. `next build` collects page data by evaluating each route's
// module graph in a pool of parallel worker processes, so several processes
// race to open and initialise the very same (often brand-new) database file
// at once — the same window the read-only adapters already guard against
// (see count-and-size-readonly-adapter.ts). Losing that race surfaced as
// `SqliteError: database is locked` (SQLITE_BUSY) during "Failed to collect
// page data", i.e. an intermittently failing production build.

const MAX_ATTEMPTS = 10;
const BACKOFF_STEP_MS = 25;

function sleepSync(milliseconds: number): void {
  // Module evaluation is synchronous, so the retry wait has to be too.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function isBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { code } = error as Error & { code?: unknown };
  // SQLITE_BUSY plus its extended result codes (SQLITE_BUSY_SNAPSHOT, ...).
  return typeof code === 'string' && code.startsWith('SQLITE_BUSY');
}

/**
 * Runs a SQLite statement, retrying with a short synchronous backoff while
 * another process holds the lock. Needed on top of better-sqlite3's own
 * `timeout` option because that only installs SQLite's busy handler, and
 * SQLite deliberately does not invoke the busy handler for the statements
 * below — most notably `PRAGMA journal_mode`, which needs a brief exclusive
 * lock and returns SQLITE_BUSY outright rather than waiting.
 */
export function retryWhileBusy<T>(operation: () => T): T {
  for (let attempt = 1; ; attempt++) {
    try {
      return operation();
    } catch (error) {
      if (!isBusyError(error) || attempt >= MAX_ATTEMPTS) throw error;
      sleepSync(attempt * BACKOFF_STEP_MS);
    }
  }
}

/**
 * Opens (creating it if needed) a WAL-mode database at `dbPath`, tolerating
 * other processes initialising the same file concurrently.
 */
export function openWalDatabase(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  retryWhileBusy(() => db.pragma('journal_mode = WAL'));
  return db;
}
