import type {
  DirectChildren,
  DuplicateFilters,
  DirectoryFacts,
  DirectoryResult,
  DirectoryRow,
  DuplicateRepositoryPort,
  FileCandidate,
  FileFacts,
  GroupQuery,
  IgnoredPath,
  PruneCounts,
  RecordedChecksums,
  ScanProgress,
  ScanState,
} from '@/application/duplicate-finder/duplicate-repository-port';
import type Database from 'better-sqlite3';
import type {
  DuplicateGroup,
  DuplicateGroupWithPaths,
  GroupKind,
  SortBy,
  SortDir,
} from '@/domain/duplicate-finder/duplicate-group';
import { db } from './sqlite-client';

interface ScanStateRow {
  scan_seq: number;
  root_path: string | null;
  include_folders: number;
  state: ScanState['state'];
  phase: ScanState['phase'];
  active_path: string | null;
  processed: number;
  total: number;
  unreadable_count: number;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
}

interface FileCandidateRow {
  path: string;
  size: number;
  modification_time: string;
  partial_checksum: string | null;
  full_checksum: string | null;
}

interface GroupRow {
  checksum: string;
  kind: GroupKind;
  size: number;
  occurrence_count: number;
  is_empty: number;
}

/**
 * `LIKE` pattern matching everything strictly beneath `path`. `%` and `_`
 * are legal characters in a POSIX filename, so they are escaped rather than
 * left to act as wildcards — a directory literally named `100%` must not
 * match its siblings.
 */
function subtreeLikePattern(path: string): string {
  const escaped = path
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
  return `${escaped}/%`;
}

function toScanState(row: ScanStateRow): ScanState {
  return {
    scanSeq: row.scan_seq,
    rootPath: row.root_path,
    includeFolders: row.include_folders === 1,
    state: row.state,
    phase: row.phase,
    activePath: row.active_path,
    processed: row.processed,
    total: row.total,
    unreadableCount: row.unreadable_count,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toCandidate(row: FileCandidateRow): FileCandidate {
  return {
    path: row.path,
    size: row.size,
    modificationTime: row.modification_time,
    partialChecksum: row.partial_checksum,
    fullChecksum: row.full_checksum,
  };
}

// ---- scan lifecycle -------------------------------------------------------

const getScanStateStmt = db.prepare(`SELECT * FROM scan_state WHERE id = 1`);

const beginScanStmt = db.prepare(`
  UPDATE scan_state SET
    scan_seq = scan_seq + 1,
    root_path = @rootPath,
    include_folders = @includeFolders,
    state = 'running',
    phase = 'listing',
    active_path = NULL,
    processed = 0,
    total = 0,
    unreadable_count = 0,
    error_message = NULL,
    started_at = @now,
    finished_at = NULL
  WHERE id = 1
`);

// COALESCE means a partial update only writes the fields it was given —
// the worker reports "the path changed" far more often than it reports a
// new total, and neither should clobber the other.
const updateProgressStmt = db.prepare(`
  UPDATE scan_state SET
    phase = CASE WHEN @setPhase = 1 THEN @phase ELSE phase END,
    active_path = CASE WHEN @setActivePath = 1 THEN @activePath ELSE active_path END,
    processed = COALESCE(@processed, processed),
    total = COALESCE(@total, total),
    unreadable_count = COALESCE(@unreadableCount, unreadable_count)
  WHERE id = 1
`);

const finishScanStmt = db.prepare(`
  UPDATE scan_state SET
    state = @state,
    phase = NULL,
    active_path = NULL,
    error_message = @errorMessage,
    finished_at = @now
  WHERE id = 1
`);

// A row still 'running' when this module is first evaluated belongs to a
// process that no longer exists — nothing is ever auto-resumed
// (research.md Decision 3).
const reconcileStmt = db.prepare(`
  UPDATE scan_state SET
    state = 'stopped',
    phase = NULL,
    active_path = NULL,
    finished_at = COALESCE(finished_at, @now)
  WHERE id = 1 AND state = 'running'
`);

// ---- phase 1: listing -----------------------------------------------------

// Checksums survive a re-scan only while the file's own facts are unchanged;
// any difference in size or modification time nulls them, which is what makes
// a cached value safe to trust later (research.md Decision 6).
const upsertFileFactsStmt = db.prepare(`
  INSERT INTO scanned_files
    (path, parent_path, size, modification_time, partial_checksum, full_checksum, checksummed_at, has_read_error, scan_seq)
  VALUES (@path, @parentPath, @size, @modificationTime, NULL, NULL, NULL, 0, @scanSeq)
  ON CONFLICT(path) DO UPDATE SET
    parent_path = excluded.parent_path,
    size = excluded.size,
    modification_time = excluded.modification_time,
    scan_seq = excluded.scan_seq,
    partial_checksum = CASE
      WHEN scanned_files.size = excluded.size
        AND scanned_files.modification_time = excluded.modification_time
      THEN scanned_files.partial_checksum ELSE NULL END,
    full_checksum = CASE
      WHEN scanned_files.size = excluded.size
        AND scanned_files.modification_time = excluded.modification_time
      THEN scanned_files.full_checksum ELSE NULL END,
    checksummed_at = CASE
      WHEN scanned_files.size = excluded.size
        AND scanned_files.modification_time = excluded.modification_time
      THEN scanned_files.checksummed_at ELSE NULL END,
    has_read_error = 0
`);

// Directory rows carry no cross-scan value (their checksum depends on the
// whole subtree), so every scan resets the derived columns.
const upsertDirectoryStmt = db.prepare(`
  INSERT INTO scanned_directories
    (path, parent_path, depth, scan_seq, has_incomplete_content, is_candidate, directory_checksum, subtree_size, child_count)
  VALUES (@path, @parentPath, @depth, @scanSeq, @hasIncompleteContent, NULL, NULL, 0, 0)
  ON CONFLICT(path) DO UPDATE SET
    parent_path = excluded.parent_path,
    depth = excluded.depth,
    scan_seq = excluded.scan_seq,
    has_incomplete_content = excluded.has_incomplete_content,
    is_candidate = NULL,
    directory_checksum = NULL,
    subtree_size = 0,
    child_count = 0
`);

// ---- phases 2-4: hashing --------------------------------------------------

// FR-013 lives here: a file whose size is unique in this scan is never
// returned, so it is never opened.
const findSharedSizeCandidatesStmt = db.prepare(`
  SELECT path, size, modification_time, partial_checksum, full_checksum
  FROM scanned_files
  WHERE scan_seq = @scanSeq
    AND has_read_error = 0
    AND size IN (
      SELECT size FROM scanned_files
      WHERE scan_seq = @scanSeq AND has_read_error = 0
      GROUP BY size HAVING COUNT(*) > 1
    )
  ORDER BY size DESC, path
`);

const findSharedPartialCandidatesStmt = db.prepare(`
  SELECT f.path, f.size, f.modification_time, f.partial_checksum, f.full_checksum
  FROM scanned_files f
  WHERE f.scan_seq = @scanSeq
    AND f.has_read_error = 0
    AND f.partial_checksum IS NOT NULL
    AND f.full_checksum IS NULL
    AND f.size > @partialThreshold
    AND EXISTS (
      SELECT 1 FROM scanned_files o
      WHERE o.scan_seq = f.scan_seq
        AND o.has_read_error = 0
        AND o.size = f.size
        AND o.partial_checksum = f.partial_checksum
        AND o.path <> f.path
    )
  ORDER BY f.size DESC, f.path
`);

const recordChecksumsStmt = db.prepare(`
  UPDATE scanned_files
  SET partial_checksum = COALESCE(@partialChecksum, partial_checksum),
      full_checksum = COALESCE(@fullChecksum, full_checksum),
      checksummed_at = @now,
      has_read_error = 0
  WHERE path = @path
`);

const recordReadErrorStmt = db.prepare(`
  UPDATE scanned_files SET has_read_error = 1 WHERE path = @path
`);

const findSharedContentPathsStmt = db.prepare(`
  SELECT f.path FROM scanned_files f
  WHERE f.scan_seq = @scanSeq
    AND f.has_read_error = 0
    AND f.full_checksum IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM scanned_files o
      WHERE o.scan_seq = f.scan_seq
        AND o.has_read_error = 0
        AND o.full_checksum = f.full_checksum
        AND o.path <> f.path
    )
`);

// ---- phase 5: folders -----------------------------------------------------

const listDirectoriesDeepestFirstStmt = db.prepare(`
  SELECT path, parent_path, depth, has_incomplete_content
  FROM scanned_directories
  WHERE scan_seq = @scanSeq
  ORDER BY depth DESC, path
`);

const getChildFilesStmt = db.prepare(`
  SELECT path, size, full_checksum, has_read_error
  FROM scanned_files
  WHERE parent_path = @path AND scan_seq = @scanSeq
`);

const getChildDirectoriesStmt = db.prepare(`
  SELECT path, is_candidate, directory_checksum, subtree_size
  FROM scanned_directories
  WHERE parent_path = @path AND scan_seq = @scanSeq
`);

const recordDirectoryResultStmt = db.prepare(`
  UPDATE scanned_directories SET
    is_candidate = @isCandidate,
    directory_checksum = @directoryChecksum,
    subtree_size = @subtreeSize,
    child_count = @childCount
  WHERE path = @path
`);

// ---- phase 6: results -----------------------------------------------------

const findFileGroupsStmt = db.prepare(`
  SELECT full_checksum AS checksum, size, COUNT(*) AS occurrence_count
  FROM scanned_files
  WHERE scan_seq = @scanSeq AND has_read_error = 0 AND full_checksum IS NOT NULL
  GROUP BY full_checksum
  HAVING COUNT(*) > 1
`);

// Paths are fetched separately rather than via group_concat: a newline (or
// any other separator) is a legal character in a POSIX filename, so joining
// them into one string could not be reversed safely. The subquery keeps this
// to the duplicated files only — pulling every hashed path would be
// needlessly large on a big tree.
const findFileGroupPathsStmt = db.prepare(`
  SELECT full_checksum AS checksum, path
  FROM scanned_files
  WHERE scan_seq = @scanSeq AND has_read_error = 0 AND full_checksum IS NOT NULL
    AND full_checksum IN (
      SELECT full_checksum FROM scanned_files
      WHERE scan_seq = @scanSeq AND has_read_error = 0 AND full_checksum IS NOT NULL
      GROUP BY full_checksum HAVING COUNT(*) > 1
    )
  ORDER BY path
`);

const findDirectoryGroupsStmt = db.prepare(`
  SELECT directory_checksum AS checksum,
         MIN(subtree_size) AS size,
         MIN(child_count) AS child_count,
         COUNT(*) AS occurrence_count
  FROM scanned_directories
  WHERE scan_seq = @scanSeq AND directory_checksum IS NOT NULL
  GROUP BY directory_checksum
  HAVING COUNT(*) > 1
`);

const findDirectoryGroupPathsStmt = db.prepare(`
  SELECT directory_checksum AS checksum, path
  FROM scanned_directories
  WHERE scan_seq = @scanSeq AND directory_checksum IS NOT NULL
    AND directory_checksum IN (
      SELECT directory_checksum FROM scanned_directories
      WHERE scan_seq = @scanSeq AND directory_checksum IS NOT NULL
      GROUP BY directory_checksum HAVING COUNT(*) > 1
    )
  ORDER BY path
`);

const clearGroupsStmt = db.prepare(`DELETE FROM duplicate_groups`);
const clearOccurrencesStmt = db.prepare(`DELETE FROM duplicate_occurrences`);

const insertGroupStmt = db.prepare(`
  INSERT INTO duplicate_groups
    (checksum, kind, size, occurrence_count, is_empty, scan_seq)
  VALUES (@checksum, @kind, @size, @occurrenceCount, @isEmpty, @scanSeq)
  ON CONFLICT(checksum, kind) DO UPDATE SET
    size = excluded.size,
    occurrence_count = excluded.occurrence_count,
    is_empty = excluded.is_empty,
    scan_seq = excluded.scan_seq
`);

const insertOccurrenceStmt = db.prepare(`
  INSERT INTO duplicate_occurrences (checksum, kind, path, scan_seq)
  VALUES (@checksum, @kind, @path, @scanSeq)
  ON CONFLICT(checksum, kind, path) DO UPDATE SET scan_seq = excluded.scan_seq
`);

// ---- reads for the UI -----------------------------------------------------

// Every result read is scoped to the CURRENT scan_seq, so a scan that failed
// (or whose process was killed) after `beginScan` can never leave the previous
// root's results on screen — `clearResults` only reclaims the space later.
const CURRENT_SCAN_SEQ = `(SELECT scan_seq FROM scan_state WHERE id = 1)`;

// One statement per (field, direction). The ascending variants tie-break on
// `checksum DESC` on purpose: that makes them the exact reverse of the
// descending ones, which SQLite can serve by scanning the very same index
// backwards. Tie-breaking ascending on `checksum ASC` would mix directions
// within one ORDER BY and force a temp b-tree sort of the whole result set.
const listGroupsStmts: Record<`${SortBy}-${SortDir}`, Database.Statement> = {
  'size-desc': db.prepare(`
    SELECT checksum, kind, size, occurrence_count, is_empty
    FROM duplicate_groups
    WHERE scan_seq = ${CURRENT_SCAN_SEQ}
    ORDER BY size DESC, checksum ASC
    LIMIT @limit OFFSET @offset
  `),
  'size-asc': db.prepare(`
    SELECT checksum, kind, size, occurrence_count, is_empty
    FROM duplicate_groups
    WHERE scan_seq = ${CURRENT_SCAN_SEQ}
    ORDER BY size ASC, checksum DESC
    LIMIT @limit OFFSET @offset
  `),
  'occurrences-desc': db.prepare(`
    SELECT checksum, kind, size, occurrence_count, is_empty
    FROM duplicate_groups
    WHERE scan_seq = ${CURRENT_SCAN_SEQ}
    ORDER BY occurrence_count DESC, checksum ASC
    LIMIT @limit OFFSET @offset
  `),
  'occurrences-asc': db.prepare(`
    SELECT checksum, kind, size, occurrence_count, is_empty
    FROM duplicate_groups
    WHERE scan_seq = ${CURRENT_SCAN_SEQ}
    ORDER BY occurrence_count ASC, checksum DESC
    LIMIT @limit OFFSET @offset
  `),
};

const countGroupsStmt = db.prepare(`
  SELECT COUNT(*) AS total FROM duplicate_groups
  WHERE scan_seq = ${CURRENT_SCAN_SEQ}
`);

const listOccurrencesStmt = db.prepare(`
  SELECT path FROM duplicate_occurrences
  WHERE checksum = @checksum AND kind = @kind AND scan_seq = ${CURRENT_SCAN_SEQ}
  ORDER BY path
`);

// ---- reads for the by-directory view ---------------------------------------

// `is_candidate IS NOT NULL` is the "the folder pass ran for this row" signal,
// so `child_count = 0` can be trusted as "really empty". With folder detection
// off the column is never filled and nothing is hidden, which is the safe way
// round: better to show a directory than to hide one on a guess.
const listChildDirectoriesStmt = db.prepare(`
  SELECT path FROM scanned_directories
  WHERE parent_path = @path AND scan_seq = ${CURRENT_SCAN_SEQ}
    AND NOT (
      @excludeEmptyDirectories = 1
      AND is_candidate IS NOT NULL
      AND child_count = 0
    )
`);

// `path >= @from AND path < @to` is a prefix range, which SQLite serves from
// the index on duplicate_occurrences(path). A `LIKE 'prefix%'` would read the
// same rows only if `case_sensitive_like` were on, and would otherwise
// degrade to a full scan — the range form needs no such assumption. `@to` is
// the prefix with its trailing '/' bumped to '0' (the next codepoint), so it
// covers exactly the subtree and nothing else.
const aggregateDuplicatesByChildStmt = db.prepare(`
  SELECT
    CASE
      WHEN instr(substr(o.path, @prefixLength + 1), '/') > 0
      THEN substr(
        o.path,
        1,
        @prefixLength + instr(substr(o.path, @prefixLength + 1), '/') - 1
      )
      ELSE o.path
    END AS child_path,
    COUNT(*) AS count,
    SUM(g.size) AS size
  FROM duplicate_occurrences o
  JOIN duplicate_groups g
    ON g.checksum = o.checksum AND g.kind = o.kind
  WHERE o.scan_seq = ${CURRENT_SCAN_SEQ}
    AND o.path >= @from AND o.path < @to
    AND NOT (@excludeEmptyFiles = 1 AND o.kind = 'file' AND g.is_empty = 1)
    AND NOT (@excludeEmptyDirectories = 1 AND o.kind = 'directory' AND g.is_empty = 1)
  GROUP BY child_path
`);

const listDirectDuplicateChildrenStmt = db.prepare(`
  SELECT o.path, o.kind, o.checksum, g.size, g.occurrence_count, g.is_empty
  FROM duplicate_occurrences o
  JOIN duplicate_groups g
    ON g.checksum = o.checksum AND g.kind = o.kind
  WHERE o.scan_seq = ${CURRENT_SCAN_SEQ}
    AND o.path >= @from AND o.path < @to
    AND instr(substr(o.path, @prefixLength + 1), '/') = 0
    AND NOT (@excludeEmptyFiles = 1 AND o.kind = 'file' AND g.is_empty = 1)
    AND NOT (@excludeEmptyDirectories = 1 AND o.kind = 'directory' AND g.is_empty = 1)

`);

const getDuplicateTotalsStmt = db.prepare(`
  SELECT COUNT(*) AS count, COALESCE(SUM(g.size), 0) AS size
  FROM duplicate_occurrences o
  JOIN duplicate_groups g
    ON g.checksum = o.checksum AND g.kind = o.kind
  WHERE o.scan_seq = ${CURRENT_SCAN_SEQ}
    AND NOT (@excludeEmptyFiles = 1 AND o.kind = 'file' AND g.is_empty = 1)
    AND NOT (@excludeEmptyDirectories = 1 AND o.kind = 'directory' AND g.is_empty = 1)
`);

/** SQLite has no boolean type, so the flags cross the boundary as 0/1. */
function toFilterParams(filters: DuplicateFilters) {
  return {
    excludeEmptyFiles: filters.excludeEmptyFiles ? 1 : 0,
    excludeEmptyDirectories: filters.excludeEmptyDirectories ? 1 : 0,
  };
}

/** Half-open key range covering everything strictly beneath `path`. */
function subtreeRange(path: string): {
  from: string;
  to: string;
  prefixLength: number;
} {
  const prefix = path === '/' ? '/' : `${path}/`;
  return {
    from: prefix,
    // '/' + 1 === '0', so this is the first key past the subtree.
    to: `${prefix.slice(0, -1)}0`,
    prefixLength: prefix.length,
  };
}

// ---- deletion --------------------------------------------------------------

const findOccurrenceByPathStmt = db.prepare(`
  SELECT o.checksum, o.kind, g.size, g.occurrence_count
  FROM duplicate_occurrences o
  JOIN duplicate_groups g
    ON g.checksum = o.checksum AND g.kind = o.kind
  WHERE o.path = @path AND o.scan_seq = ${CURRENT_SCAN_SEQ}
`);

const deleteScannedFileStmt = db.prepare(
  `DELETE FROM scanned_files WHERE path = @path`,
);

const deleteOccurrenceAtPathStmt = db.prepare(
  `DELETE FROM duplicate_occurrences WHERE path = @path`,
);

const deleteScannedFilesUnderStmt = db.prepare(`
  DELETE FROM scanned_files
  WHERE path = @path OR path LIKE @likePattern ESCAPE '\\'
`);

const deleteScannedDirectoriesUnderStmt = db.prepare(`
  DELETE FROM scanned_directories
  WHERE path = @path OR path LIKE @likePattern ESCAPE '\\'
`);

// ---- ignore list ----------------------------------------------------------

const listIgnoredPathsStmt = db.prepare(`
  SELECT path, ignored_at FROM ignored_paths ORDER BY ignored_at DESC
`);

const listIgnoredPathValuesStmt = db.prepare(`SELECT path FROM ignored_paths`);

const setIgnoredStmt = db.prepare(`
  INSERT INTO ignored_paths (path, ignored_at) VALUES (@path, @now)
  ON CONFLICT(path) DO NOTHING
`);

const clearIgnoredStmt = db.prepare(
  `DELETE FROM ignored_paths WHERE path = @path`,
);

const findAffectedGroupsStmt = db.prepare(`
  SELECT DISTINCT checksum, kind FROM duplicate_occurrences
  WHERE path = @path OR path LIKE @likePattern ESCAPE '\\'
`);

const deleteOccurrencesUnderStmt = db.prepare(`
  DELETE FROM duplicate_occurrences
  WHERE path = @path OR path LIKE @likePattern ESCAPE '\\'
`);

const recountGroupStmt = db.prepare(`
  UPDATE duplicate_groups SET occurrence_count = (
    SELECT COUNT(*) FROM duplicate_occurrences o
    WHERE o.checksum = duplicate_groups.checksum AND o.kind = duplicate_groups.kind
  )
  WHERE checksum = @checksum AND kind = @kind
`);

const deleteGroupIfBelowTwoStmt = db.prepare(`
  DELETE FROM duplicate_groups
  WHERE checksum = @checksum AND kind = @kind AND occurrence_count < 2
`);

const deleteRemainingOccurrencesStmt = db.prepare(`
  DELETE FROM duplicate_occurrences
  WHERE checksum = @checksum AND kind = @kind
`);

function groupsWithPaths(
  groupRows: {
    checksum: string;
    size: number;
    occurrence_count: number;
    child_count?: number;
  }[],
  pathRows: { checksum: string; path: string }[],
  kind: GroupKind,
  isEmpty: (row: { checksum: string; child_count?: number }) => boolean,
): DuplicateGroupWithPaths[] {
  const wanted = new Map(groupRows.map((row) => [row.checksum, row]));
  const pathsByChecksum = new Map<string, string[]>();
  for (const row of pathRows) {
    if (!wanted.has(row.checksum)) continue;
    const paths = pathsByChecksum.get(row.checksum);
    if (paths) paths.push(row.path);
    else pathsByChecksum.set(row.checksum, [row.path]);
  }

  return groupRows.map((row) => ({
    checksum: row.checksum,
    kind,
    size: row.size,
    occurrenceCount: row.occurrence_count,
    isEmpty: isEmpty(row),
    paths: pathsByChecksum.get(row.checksum) ?? [],
  }));
}

/**
 * Removes every occurrence at or beneath `path` and repairs the groups they
 * belonged to, deleting any left with fewer than two copies. Shared by
 * "ignore this path" and "this directory was moved away": both make the same
 * subtree stop existing as far as the results are concerned.
 *
 * MUST run inside a transaction — the affected groups are read before their
 * occurrences are deleted, because afterwards there is nothing left to derive
 * them from.
 */
function pruneResultsUnder(path: string, likePattern: string): PruneCounts {
  const affected = findAffectedGroupsStmt.all({ path, likePattern }) as {
    checksum: string;
    kind: GroupKind;
  }[];
  let removedOccurrences = deleteOccurrencesUnderStmt.run({
    path,
    likePattern,
  }).changes;

  let removedGroups = 0;
  for (const group of affected) {
    recountGroupStmt.run(group);
    const deleted = deleteGroupIfBelowTwoStmt.run(group).changes;
    if (deleted > 0) {
      removedGroups += deleted;
      removedOccurrences += deleteRemainingOccurrencesStmt.run(group).changes;
    }
  }
  return { removedGroups, removedOccurrences };
}

export const duplicateRepositoryAdapter: DuplicateRepositoryPort = {
  getScanState() {
    return toScanState(getScanStateStmt.get() as ScanStateRow);
  },

  beginScan(rootPath, includeFolders) {
    beginScanStmt.run({
      rootPath,
      includeFolders: includeFolders ? 1 : 0,
      now: new Date().toISOString(),
    });
    return (getScanStateStmt.get() as ScanStateRow).scan_seq;
  },

  updateProgress(update) {
    const has = (key: keyof ScanProgress) => key in update;
    updateProgressStmt.run({
      setPhase: has('phase') ? 1 : 0,
      phase: update.phase ?? null,
      setActivePath: has('activePath') ? 1 : 0,
      activePath: update.activePath ?? null,
      processed: update.processed ?? null,
      total: update.total ?? null,
      unreadableCount: update.unreadableCount ?? null,
    });
  },

  finishScan(state, errorMessage) {
    finishScanStmt.run({
      state,
      errorMessage: errorMessage ?? null,
      now: new Date().toISOString(),
    });
  },

  reconcileInterruptedScan() {
    reconcileStmt.run({ now: new Date().toISOString() });
  },

  upsertFileFacts(facts: FileFacts[], scanSeq: number) {
    const tx = db.transaction((rows: FileFacts[]) => {
      for (const row of rows) upsertFileFactsStmt.run({ ...row, scanSeq });
    });
    tx(facts);
  },

  upsertDirectory(directory: DirectoryFacts, scanSeq: number) {
    upsertDirectoryStmt.run({
      path: directory.path,
      parentPath: directory.parentPath,
      depth: directory.depth,
      hasIncompleteContent: directory.hasIncompleteContent ? 1 : 0,
      scanSeq,
    });
  },

  findSharedSizeCandidates(scanSeq) {
    return (
      findSharedSizeCandidatesStmt.all({ scanSeq }) as FileCandidateRow[]
    ).map(toCandidate);
  },

  findSharedPartialCandidates(scanSeq, partialThreshold) {
    return (
      findSharedPartialCandidatesStmt.all({
        scanSeq,
        partialThreshold,
      }) as FileCandidateRow[]
    ).map(toCandidate);
  },

  recordChecksums(path: string, checksums: RecordedChecksums) {
    recordChecksumsStmt.run({
      path,
      partialChecksum: checksums.partialChecksum ?? null,
      fullChecksum: checksums.fullChecksum ?? null,
      now: new Date().toISOString(),
    });
  },

  recordReadError(path: string) {
    recordReadErrorStmt.run({ path });
  },

  findSharedContentPaths(scanSeq) {
    const rows = findSharedContentPathsStmt.all({ scanSeq }) as {
      path: string;
    }[];
    return new Set(rows.map((row) => row.path));
  },

  listDirectoriesDeepestFirst(scanSeq): DirectoryRow[] {
    const rows = listDirectoriesDeepestFirstStmt.all({ scanSeq }) as {
      path: string;
      parent_path: string | null;
      depth: number;
      has_incomplete_content: number;
    }[];
    return rows.map((row) => ({
      path: row.path,
      parentPath: row.parent_path,
      depth: row.depth,
      hasIncompleteContent: row.has_incomplete_content === 1,
    }));
  },

  getDirectChildren(path: string, scanSeq: number): DirectChildren {
    const fileRows = getChildFilesStmt.all({ path, scanSeq }) as {
      path: string;
      size: number;
      full_checksum: string | null;
      has_read_error: number;
    }[];
    const dirRows = getChildDirectoriesStmt.all({ path, scanSeq }) as {
      path: string;
      is_candidate: number | null;
      directory_checksum: string | null;
      subtree_size: number;
    }[];

    const basename = (childPath: string) =>
      childPath.slice(childPath.lastIndexOf('/') + 1);

    return {
      files: fileRows.map((row) => ({
        name: basename(row.path),
        path: row.path,
        size: row.size,
        fullChecksum: row.full_checksum,
        hasReadError: row.has_read_error === 1,
      })),
      directories: dirRows.map((row) => ({
        name: basename(row.path),
        path: row.path,
        isCandidate: row.is_candidate === 1,
        directoryChecksum: row.directory_checksum,
        subtreeSize: row.subtree_size,
      })),
    };
  },

  recordDirectoryResult(path: string, result: DirectoryResult) {
    recordDirectoryResultStmt.run({
      path,
      isCandidate: result.isCandidate ? 1 : 0,
      directoryChecksum: result.directoryChecksum,
      subtreeSize: result.subtreeSize,
      childCount: result.childCount,
    });
  },

  findDuplicateFileGroups(scanSeq) {
    const groupRows = findFileGroupsStmt.all({ scanSeq }) as {
      checksum: string;
      size: number;
      occurrence_count: number;
    }[];
    if (groupRows.length === 0) return [];
    const pathRows = findFileGroupPathsStmt.all({ scanSeq }) as {
      checksum: string;
      path: string;
    }[];
    // `isEmpty` is decided by the caller against EMPTY_CONTENT_CHECKSUM
    // (research.md Decision 12) — the adapter has no business knowing which
    // digest means "no bytes".
    return groupsWithPaths(groupRows, pathRows, 'file', () => false);
  },

  findDuplicateDirectoryGroups(scanSeq) {
    const groupRows = findDirectoryGroupsStmt.all({ scanSeq }) as {
      checksum: string;
      size: number;
      child_count: number;
      occurrence_count: number;
    }[];
    if (groupRows.length === 0) return [];
    const pathRows = findDirectoryGroupPathsStmt.all({ scanSeq }) as {
      checksum: string;
      path: string;
    }[];
    return groupsWithPaths(
      groupRows,
      pathRows,
      'directory',
      (row) => row.child_count === 0,
    );
  },

  clearResults() {
    const tx = db.transaction(() => {
      clearGroupsStmt.run();
      clearOccurrencesStmt.run();
    });
    tx();
  },

  saveGroups(groups: DuplicateGroupWithPaths[], scanSeq: number) {
    const tx = db.transaction((rows: DuplicateGroupWithPaths[]) => {
      for (const group of rows) {
        insertGroupStmt.run({
          checksum: group.checksum,
          kind: group.kind,
          size: group.size,
          occurrenceCount: group.occurrenceCount,
          isEmpty: group.isEmpty ? 1 : 0,
          scanSeq,
        });
        for (const path of group.paths) {
          insertOccurrenceStmt.run({
            checksum: group.checksum,
            kind: group.kind,
            path,
            scanSeq,
          });
        }
      }
    });
    tx(groups);
  },

  listGroups(query: GroupQuery) {
    const statement = listGroupsStmts[`${query.sortBy}-${query.sortDir}`];
    const rows = statement.all({
      limit: query.limit,
      offset: query.offset,
    }) as GroupRow[];
    const { total } = countGroupsStmt.get() as { total: number };
    const groups: DuplicateGroup[] = rows.map((row) => ({
      checksum: row.checksum,
      kind: row.kind,
      size: row.size,
      occurrenceCount: row.occurrence_count,
      isEmpty: row.is_empty === 1,
    }));
    return { groups, total };
  },

  listOccurrences(checksum: string, kind: GroupKind) {
    const rows = listOccurrencesStmt.all({ checksum, kind }) as {
      path: string;
    }[];
    return rows.map((row) => row.path);
  },

  countGroups() {
    return (countGroupsStmt.get() as { total: number }).total;
  },

  listChildDirectories(path: string, filters: DuplicateFilters) {
    const rows = listChildDirectoriesStmt.all({
      path,
      ...toFilterParams(filters),
    }) as { path: string }[];
    return rows.map((row) => row.path);
  },

  aggregateDuplicatesByChild(path: string, filters: DuplicateFilters) {
    const rows = aggregateDuplicatesByChildStmt.all({
      ...subtreeRange(path),
      ...toFilterParams(filters),
    }) as { child_path: string; count: number; size: number }[];
    return rows.map((row) => ({
      childPath: row.child_path,
      count: row.count,
      size: row.size,
    }));
  },

  listDirectDuplicateChildren(path: string, filters: DuplicateFilters) {
    const rows = listDirectDuplicateChildrenStmt.all({
      ...subtreeRange(path),
      ...toFilterParams(filters),
    }) as {
      path: string;
      kind: GroupKind;
      checksum: string;
      size: number;
      occurrence_count: number;
      is_empty: number;
    }[];
    return rows.map((row) => ({
      path: row.path,
      kind: row.kind,
      checksum: row.checksum,
      size: row.size,
      occurrenceCount: row.occurrence_count,
      isEmpty: row.is_empty === 1,
    }));
  },

  getDuplicateTotals(filters: DuplicateFilters) {
    return getDuplicateTotalsStmt.get(toFilterParams(filters)) as {
      count: number;
      size: number;
    };
  },

  findOccurrenceByPath(path: string) {
    const row = findOccurrenceByPathStmt.get({ path }) as
      | {
          checksum: string;
          kind: GroupKind;
          size: number;
          occurrence_count: number;
        }
      | undefined;
    if (!row) return null;
    return {
      checksum: row.checksum,
      kind: row.kind,
      size: row.size,
      occurrenceCount: row.occurrence_count,
    };
  },

  removeDeletedDirectory(path: string): PruneCounts {
    const likePattern = subtreeLikePattern(path);
    const tx = db.transaction((): PruneCounts => {
      const counts = pruneResultsUnder(path, likePattern);
      // The cached facts for everything under it go too: those paths do not
      // exist any more, and a later scan must not reuse their checksums.
      deleteScannedFilesUnderStmt.run({ path, likePattern });
      deleteScannedDirectoriesUnderStmt.run({ path, likePattern });
      return counts;
    });
    return tx();
  },

  removeDeletedFile(path: string): PruneCounts {
    const tx = db.transaction((): PruneCounts => {
      const affected = findOccurrenceByPathStmt.get({ path }) as
        { checksum: string; kind: GroupKind } | undefined;

      // The cached facts go too: leaving them would keep a checksum for a
      // path that no longer exists, and the by-directory view would keep
      // counting a file that is gone.
      deleteScannedFileStmt.run({ path });
      let removedOccurrences = deleteOccurrenceAtPathStmt.run({ path }).changes;
      if (!affected) return { removedGroups: 0, removedOccurrences };

      recountGroupStmt.run(affected);
      const removedGroups = deleteGroupIfBelowTwoStmt.run(affected).changes;
      if (removedGroups > 0) {
        // One copy left is not a duplicate any more, so the group and its
        // last occurrence leave the result set together — which is also what
        // makes that last file impossible to delete from this UI.
        removedOccurrences +=
          deleteRemainingOccurrencesStmt.run(affected).changes;
      }
      return { removedGroups, removedOccurrences };
    });
    return tx();
  },

  listIgnoredPaths(): IgnoredPath[] {
    const rows = listIgnoredPathsStmt.all() as {
      path: string;
      ignored_at: string;
    }[];
    return rows.map((row) => ({ path: row.path, ignoredAt: row.ignored_at }));
  },

  loadIgnoredPathSet() {
    const rows = listIgnoredPathValuesStmt.all() as { path: string }[];
    return new Set(rows.map((row) => row.path));
  },

  setIgnored(path: string, ignored: boolean): PruneCounts {
    if (!ignored) {
      clearIgnoredStmt.run({ path });
      // Un-ignoring never resurrects results — the content comes back on the
      // next scan (spec FR-027).
      return { removedGroups: 0, removedOccurrences: 0 };
    }

    const likePattern = subtreeLikePattern(path);
    const tx = db.transaction((): PruneCounts => {
      setIgnoredStmt.run({ path, now: new Date().toISOString() });

      // The affected groups must be captured BEFORE their occurrences are
      // deleted — afterwards there is nothing left to derive them from.
      const affected = findAffectedGroupsStmt.all({ path, likePattern }) as {
        checksum: string;
        kind: GroupKind;
      }[];
      let removedOccurrences = deleteOccurrencesUnderStmt.run({
        path,
        likePattern,
      }).changes;

      let removedGroups = 0;
      for (const group of affected) {
        recountGroupStmt.run(group);
        const deleted = deleteGroupIfBelowTwoStmt.run(group).changes;
        if (deleted > 0) {
          removedGroups += deleted;
          // A group below two occurrences no longer exists, so its remaining
          // lone occurrence must go too — the listing's invariant is that a
          // group always has at least two paths (spec FR-026).
          removedOccurrences +=
            deleteRemainingOccurrencesStmt.run(group).changes;
        }
      }

      return { removedGroups, removedOccurrences };
    });

    return tx();
  },
};
