import Database from 'better-sqlite3';
import path from 'path';
import {
  openWalDatabase,
  retryWhileBusy,
} from '@/infrastructure/sqlite/open-database';

// Overridable so ad-hoc/manual verification runs can point at a throwaway
// database instead of ever touching the real one at the default path.
const dbPath =
  process.env.DUPLICATE_FINDER_DB_PATH ||
  path.join(process.cwd(), 'data', 'duplicate-finder.sqlite');

// Opened (and its schema created) through the busy-tolerant helpers: this
// module is evaluated concurrently by several of `next build`'s page-data
// workers, all racing on the same file — see open-database.ts.
export const db: Database.Database = openWalDatabase(dbPath);

retryWhileBusy(() =>
  db.exec(`
  -- Exactly one row (id = 1): the state of the single scan this tool can
  -- have at a time (spec FR-005, FR-006, FR-008). Persisted rather than
  -- kept in memory so results and their context survive a restart
  -- (FR-023) and so a scan left behind by a dead process is detectable
  -- (research.md Decision 3).
  CREATE TABLE IF NOT EXISTS scan_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    scan_seq INTEGER NOT NULL DEFAULT 0,
    root_path TEXT,
    include_folders INTEGER NOT NULL DEFAULT 0,
    state TEXT NOT NULL DEFAULT 'idle',
    phase TEXT,
    active_path TEXT,
    processed INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    unreadable_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    started_at TEXT,
    finished_at TEXT
  );

  -- One row per file ever observed. Doubles as this feature's cross-scan
  -- checksum cache (spec SC-009), so rows deliberately outlive the scan
  -- that created them; scan_seq is what scopes a query to the current
  -- result set (research.md Decision 8).
  CREATE TABLE IF NOT EXISTS scanned_files (
    path TEXT PRIMARY KEY,
    parent_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    modification_time TEXT NOT NULL,
    partial_checksum TEXT,
    full_checksum TEXT,
    checksummed_at TEXT,
    has_read_error INTEGER NOT NULL DEFAULT 0,
    scan_seq INTEGER NOT NULL
  );

  -- Both columns, in this order, because every caller constrains both and
  -- scan_seq has exactly ONE value in the table: given only (parent_path)
  -- and (scan_seq, size) to choose from, SQLite picked the latter and then
  -- filtered parent_path across all 57k rows of the scan, once per directory
  -- — 60 s for a folder pass that takes 74 ms with this index (research.md
  -- Decision 17). A single-column parent_path index is redundant next to it:
  -- this one leads with the same column.
  CREATE INDEX IF NOT EXISTS idx_scanned_files_parent_scan
    ON scanned_files (parent_path, scan_seq);
  -- Serves the size cascade's first stage directly (FR-013).
  CREATE INDEX IF NOT EXISTS idx_scanned_files_scan_size
    ON scanned_files (scan_seq, size);
  CREATE INDEX IF NOT EXISTS idx_scanned_files_scan_full_checksum
    ON scanned_files (scan_seq, full_checksum);

  -- has_incomplete_content means "what this row records is not the whole
  -- truth about this directory" — an unreadable entry, or a child the user
  -- ignored. Either way no Merkle checksum may be derived from it: a
  -- directory that merely LOOKS equal to another because something was
  -- filtered out of it would be a false duplicate (spec FR-014).
  CREATE TABLE IF NOT EXISTS scanned_directories (
    path TEXT PRIMARY KEY,
    parent_path TEXT,
    depth INTEGER NOT NULL,
    scan_seq INTEGER NOT NULL,
    has_incomplete_content INTEGER NOT NULL DEFAULT 0,
    is_candidate INTEGER,
    directory_checksum TEXT,
    subtree_size INTEGER NOT NULL DEFAULT 0,
    child_count INTEGER NOT NULL DEFAULT 0
  );

  -- The folder pass walks deepest-first, so depth is part of the index.
  CREATE INDEX IF NOT EXISTS idx_scanned_directories_scan_depth
    ON scanned_directories (scan_seq, depth DESC);
  CREATE INDEX IF NOT EXISTS idx_scanned_directories_parent_scan
    ON scanned_directories (parent_path, scan_seq);
  CREATE INDEX IF NOT EXISTS idx_scanned_directories_scan_checksum
    ON scanned_directories (scan_seq, directory_checksum);

  -- Derived result set, rebuilt from scratch by every scan's final phase.
  CREATE TABLE IF NOT EXISTS duplicate_groups (
    checksum TEXT NOT NULL,
    kind TEXT NOT NULL,
    size INTEGER NOT NULL,
    occurrence_count INTEGER NOT NULL,
    is_empty INTEGER NOT NULL DEFAULT 0,
    scan_seq INTEGER NOT NULL,
    PRIMARY KEY (checksum, kind)
  );

  -- One index per sort option (spec FR-020), each with checksum as a
  -- tiebreaker so the order is total and paging can never skip or repeat
  -- a row (research.md Decision 11).
  CREATE INDEX IF NOT EXISTS idx_duplicate_groups_scan_size
    ON duplicate_groups (scan_seq, size DESC, checksum);
  CREATE INDEX IF NOT EXISTS idx_duplicate_groups_scan_count
    ON duplicate_groups (scan_seq, occurrence_count DESC, checksum);

  CREATE TABLE IF NOT EXISTS duplicate_occurrences (
    checksum TEXT NOT NULL,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    scan_seq INTEGER NOT NULL,
    PRIMARY KEY (checksum, kind, path)
  );

  CREATE INDEX IF NOT EXISTS idx_duplicate_occurrences_group
    ON duplicate_occurrences (checksum, kind);
  -- Ignoring a path deletes every occurrence at or beneath it.
  CREATE INDEX IF NOT EXISTS idx_duplicate_occurrences_path
    ON duplicate_occurrences (path);

  -- Paths the user excluded from duplicate search. A row's mere presence
  -- means "ignored"; matching is exact-or-subtree, so no kind column is
  -- needed — a file simply has no descendants (research.md Decision 10).
  -- Entirely independent from the directory comparison tool's own list
  -- (spec FR-028).
  CREATE TABLE IF NOT EXISTS ignored_paths (
    path TEXT PRIMARY KEY,
    ignored_at TEXT NOT NULL
  );
`),
);

// Superseded by the (parent_path, scan_seq) pair above. Dropped rather than
// left behind: every one of the ~57k inserts a scan makes would keep paying
// for it, and the planner was already choosing badly with it around.
retryWhileBusy(() =>
  db.exec(`
  DROP INDEX IF EXISTS idx_scanned_files_parent_path;
  DROP INDEX IF EXISTS idx_scanned_directories_parent_path;
`),
);

// The single scan_state row has to exist before anything can UPDATE it.
retryWhileBusy(() =>
  db.exec(
    `INSERT OR IGNORE INTO scan_state (id, scan_seq, state) VALUES (1, 0, 'idle')`,
  ),
);
