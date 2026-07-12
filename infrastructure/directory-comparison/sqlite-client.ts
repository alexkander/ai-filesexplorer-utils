import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// Overridable so ad-hoc/manual verification runs can point at a throwaway
// database instead of ever touching the real one at the default path.
const dbPath =
  process.env.DIRECTORY_COMPARISON_DB_PATH ||
  path.join(process.cwd(), 'data', 'directory-comparison.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db: Database.Database = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS directory_comparison_nodes (
    path TEXT PRIMARY KEY,
    parent_path TEXT,
    depth INTEGER NOT NULL,
    own_outcome TEXT NOT NULL,
    has_unreadable_entries INTEGER NOT NULL DEFAULT 0,
    directory_checksum TEXT,
    own_finished_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_directory_comparison_nodes_parent_path
    ON directory_comparison_nodes (parent_path);

  CREATE TABLE IF NOT EXISTS file_checksums (
    path TEXT PRIMARY KEY,
    parent_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    modification_time TEXT NOT NULL,
    partial_checksum TEXT,
    full_checksum TEXT,
    checksummed_at TEXT,
    has_read_error INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_file_checksums_parent_path
    ON file_checksums (parent_path);
`);
