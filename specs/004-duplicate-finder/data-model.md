# Data Model: Duplicate Finder

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**:
2026-07-29

Phase 1 output. All tables live in this feature's own database,
`data/duplicate-finder.sqlite` (override: `DUPLICATE_FINDER_DB_PATH`), created
at module scope by `infrastructure/duplicate-finder/sqlite-client.ts` through
the shared `openWalDatabase()` / `retryWhileBusy()` helpers in
`infrastructure/sqlite/open-database.ts` — the same busy-tolerant startup the
other two tools use, because `next build` evaluates route module graphs in
parallel worker processes that race on the same fresh file.

Nothing here is ever written to `data/directory-comparison.sqlite`; that
database is opened separately, read-only, and only for the hash-reuse lookup
described in [research.md](./research.md) Decision 6.

## Entity map

| Spec entity (spec.md § Key Entities)      | Table(s)                  |
| ----------------------------------------- | ------------------------- |
| Scan run                                  | `scan_state` (single row) |
| File fact                                 | `scanned_files`           |
| — (walk bookkeeping for folder detection) | `scanned_directories`     |
| Duplicate group                           | `duplicate_groups`        |
| Occurrence                                | `duplicate_occurrences`   |
| Ignored path                              | `ignored_paths`           |

## `scan_state`

Exactly one row, `id = 1`. The authoritative state of the one scan this tool can
have (FR-005, FR-006, FR-008, FR-023).

| Column                       | Type                       | Notes                                                                                                |
| ---------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `id`                         | INTEGER PK                 | `CHECK (id = 1)` — enforces the single row                                                           |
| `scan_seq`                   | INTEGER NOT NULL           | Monotonic; bumped on every start. Stamps the rows of the current result set (research.md Decision 8) |
| `root_path`                  | TEXT                       | The scanned root; NULL before the first ever scan                                                    |
| `include_folders`            | INTEGER NOT NULL DEFAULT 0 | Whether folder detection was requested for this run                                                  |
| `state`                      | TEXT NOT NULL              | `idle` \| `running` \| `finished` \| `stopped` \| `failed`                                           |
| `phase`                      | TEXT                       | `listing` \| `hashing` \| `deriving_folders` \| `grouping` \| NULL when not running                  |
| `active_path`                | TEXT                       | Path currently being listed or hashed (FR-006)                                                       |
| `processed`                  | INTEGER NOT NULL DEFAULT 0 | Units done in the current phase                                                                      |
| `total`                      | INTEGER NOT NULL DEFAULT 0 | Units known for the current phase; 0 while unknown                                                   |
| `unreadable_count`           | INTEGER NOT NULL DEFAULT 0 | Entries skipped because they could not be read (FR-010)                                              |
| `error_message`              | TEXT                       | Set with `state = 'failed'`                                                                          |
| `started_at` / `finished_at` | TEXT                       | ISO 8601                                                                                             |

**State transitions**: `idle|finished|stopped|failed` →(start)→ `running`
→(pipeline completes)→ `finished`; →(Stop, after the partial grouping pass of
research.md Decision 13)→ `stopped`; →(unexpected error)→ `failed`.

**Startup reconciliation**: a row found in `running` when the worker module is
first evaluated belongs to a process that no longer exists — it is rewritten to
`stopped` (research.md Decision 3). Nothing is ever auto-resumed.

## `scanned_files`

One row per file observed by any scan. Doubles as this feature's cross-scan
checksum cache (SC-009), so rows survive a new scan of a different root.

| Column              | Type                       | Notes                                                                                                                                   |
| ------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `path`              | TEXT PK                    | Absolute path                                                                                                                           |
| `parent_path`       | TEXT NOT NULL              | Indexed; used by the bottom-up folder pass                                                                                              |
| `size`              | INTEGER NOT NULL           | Bytes as reported by `stat`                                                                                                             |
| `modification_time` | TEXT NOT NULL              | ISO 8601, from `stats.mtime.toISOString()`                                                                                              |
| `partial_checksum`  | TEXT                       | SHA-256 of the first 64 KB; NULL until phase 3 needs it                                                                                 |
| `full_checksum`     | TEXT                       | SHA-256 of the whole file; NULL until phase 4 needs it. Set together with `partial_checksum` for files ≤ 64 KB (research.md Decision 5) |
| `checksummed_at`    | TEXT                       | ISO 8601                                                                                                                                |
| `has_read_error`    | INTEGER NOT NULL DEFAULT 0 | Set when a read failed; excluded from grouping and from folder candidacy                                                                |
| `scan_seq`          | INTEGER NOT NULL           | Which scan last observed this path; indexed                                                                                             |

Indexes: `(parent_path)`, `(scan_seq, size)` — the latter serves phase 2's
`GROUP BY size HAVING COUNT(*) > 1` directly — and `(scan_seq, full_checksum)`
for phase 4's grouping.

**Invalidation**: the phase 1 upsert keeps `partial_checksum`, `full_checksum`
and `checksummed_at` only when the incoming `size` **and** `modification_time`
both equal the stored ones, and nulls them otherwise — the same
`ON CONFLICT ... DO UPDATE SET x = CASE WHEN ... THEN x ELSE NULL END` shape the
comparison tool already uses. This is what makes a stale row safe to reuse
(research.md Decision 6).

## `scanned_directories`

One row per directory observed by the current scan. Only meaningfully used when
`include_folders` is on, but always written — the walk needs the parent links,
and the rows are orders of magnitude fewer than the file rows.

| Column                   | Type                       | Notes                                                                                                                                                                              |
| ------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`                   | TEXT PK                    | Absolute path                                                                                                                                                                      |
| `parent_path`            | TEXT                       | NULL for the scanned root                                                                                                                                                          |
| `depth`                  | INTEGER NOT NULL           | Enables the deepest-first (`ORDER BY depth DESC`) bottom-up pass                                                                                                                   |
| `scan_seq`               | INTEGER NOT NULL           | Indexed with `depth`                                                                                                                                                               |
| `has_incomplete_content` | INTEGER NOT NULL DEFAULT 0 | Forces `is_candidate = 0`: an incompletely-known directory can never claim a trustworthy checksum. Set by an unreadable entry **or** by an ignored child (research.md Decision 15) |
| `is_candidate`           | INTEGER                    | NULL until phase 5 decides; 1 when every descendant file's content is shared (research.md Decision 4)                                                                              |
| `directory_checksum`     | TEXT                       | Merkle checksum; NULL for non-candidates                                                                                                                                           |
| `subtree_size`           | INTEGER NOT NULL DEFAULT 0 | Sum of descendant file sizes, accumulated in the same bottom-up pass; this is the "size" shown for a folder group                                                                  |
| `child_count`            | INTEGER NOT NULL DEFAULT 0 | Direct children after symlink/unreadable/ignored filtering; `0` marks an empty folder (FR-016)                                                                                     |

## `duplicate_groups`

The derived result set, rebuilt from scratch by phase 6 of every scan.

| Column             | Type                       | Notes                                                                    |
| ------------------ | -------------------------- | ------------------------------------------------------------------------ |
| `checksum`         | TEXT                       | Content checksum (file) or Merkle checksum (folder)                      |
| `kind`             | TEXT                       | `file` \| `directory`                                                    |
| `size`             | INTEGER NOT NULL           | Bytes of a single occurrence (file size, or `subtree_size` for a folder) |
| `occurrence_count` | INTEGER NOT NULL           | Always ≥ 2                                                               |
| `is_empty`         | INTEGER NOT NULL DEFAULT 0 | Empty content (research.md Decision 12) or a childless folder            |
| `scan_seq`         | INTEGER NOT NULL           | The scan that produced it                                                |

Primary key `(checksum, kind)`. Indexes `(scan_seq, size DESC, checksum)` and
`(scan_seq, occurrence_count DESC, checksum)` — one per sort option, each
covering the `ORDER BY ... LIMIT/OFFSET` of FR-018/FR-020 with a total order
(research.md Decision 11).

**Invariant**: a group with fewer than two occurrences never exists. Phase 6
never creates one, and `set-ignored` deletes the group when removing an
occurrence would break it (FR-026).

**Reads are scoped to the current scan**: every result query joins on
`scan_state.scan_seq`, so rows produced by an earlier scan — of the same root or
a different one — become invisible the instant `beginScan` bumps the counter,
not only once phase 6 gets around to deleting them. This is what keeps FR-009
("a re-scan replaces the previous results") true even when a scan fails, or the
process is killed, before ever reaching phase 6: the stale result set is already
unreachable, and `clearResults` merely reclaims the space on the next successful
grouping pass.

## `duplicate_occurrences`

| Column     | Type             | Notes                                      |
| ---------- | ---------------- | ------------------------------------------ |
| `checksum` | TEXT             | With `kind`, references `duplicate_groups` |
| `kind`     | TEXT             | `file` \| `directory`                      |
| `path`     | TEXT             | Absolute path                              |
| `scan_seq` | INTEGER NOT NULL | The scan that produced it                  |

Primary key `(checksum, kind, path)`, plus an index on `(checksum, kind)` for
the expand-one-group query.

## `ignored_paths`

| Column       | Type          | Notes                                                       |
| ------------ | ------------- | ----------------------------------------------------------- |
| `path`       | TEXT PK       | Absolute path                                               |
| `ignored_at` | TEXT NOT NULL | ISO 8601; the ignored-paths view orders by it, newest first |

Matching rule (research.md Decision 10): a path `p` is excluded when `p = path`
**or** `p LIKE path || '/%'`. There is no `kind` column — a file has no
descendants, so the subtree rule already behaves as an exact rule for it. Loaded
once into memory at the start of a scan and matched by the pure
`domain/duplicate-finder/ignored-path-match.ts` during the walk, so the
per-entry check costs no query.

**Independence**: this table has no relationship whatsoever with the comparison
tool's `ignored_paths` table (FR-028).

## Derived, not stored

- **Wasted space** (`size × (occurrence_count − 1)`) — displayed if useful,
  never persisted; it is a pure function of two stored columns.
- **Partial-result labelling** — read from `scan_state.state = 'stopped'`, not
  duplicated onto the group rows.
- **Whether a group was collapsed** — collapsed groups are simply never written
  by phase 6 (FR-015); no tombstone rows.
