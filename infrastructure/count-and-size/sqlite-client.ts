import Database from 'better-sqlite3';
import path from 'path';
import {
  openWalDatabase,
  retryWhileBusy,
} from '@/infrastructure/sqlite/open-database';

// Overridable so ad-hoc/manual verification runs can point at a throwaway
// database instead of ever touching the real one at the default path.
const dbPath =
  process.env.COUNT_AND_SIZE_DB_PATH ||
  path.join(process.cwd(), 'data', 'count-and-size.sqlite');

// Opened (and its schema created) through the busy-tolerant helpers: this
// module is evaluated concurrently by several of `next build`'s page-data
// workers, all racing on the same file — see open-database.ts.
export const db: Database.Database = openWalDatabase(dbPath);

retryWhileBusy(() =>
  db.exec(`
  CREATE TABLE IF NOT EXISTS directory_scan_nodes (
    path TEXT PRIMARY KEY,
    parent_path TEXT,
    depth INTEGER NOT NULL,
    own_outcome TEXT NOT NULL,
    direct_file_count INTEGER NOT NULL DEFAULT 0,
    direct_file_size INTEGER NOT NULL DEFAULT 0,
    has_unreadable_entries INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    own_finished_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_directory_scan_nodes_parent_path
    ON directory_scan_nodes (parent_path);
`),
);
