import { db } from './sqlite-client';
import type {
  ComparisonRepositoryPort,
  DirectoryComparisonNode,
  FileChecksumEntry,
} from '@/application/directory-comparison/comparison-repository-port';
import { getParentPath } from '@/domain/scanning/path-info';

interface DirRow {
  path: string;
  parent_path: string | null;
  depth: number;
  own_outcome: string;
  has_unreadable_entries: number;
  directory_checksum: string | null;
  own_finished_at: string | null;
  resolved_by_pass2: number;
}

interface FileRow {
  path: string;
  parent_path: string;
  size: number;
  modification_time: string;
  partial_checksum: string | null;
  full_checksum: string | null;
  checksummed_at: string | null;
  has_read_error: number;
}

function toNode(row: DirRow): DirectoryComparisonNode {
  return {
    path: row.path,
    parentPath: row.parent_path,
    depth: row.depth,
    ownOutcome: row.own_outcome as DirectoryComparisonNode['ownOutcome'],
    hasUnreadableEntries: Boolean(row.has_unreadable_entries),
    directoryChecksum: row.directory_checksum,
    resolvedByPass2: Boolean(row.resolved_by_pass2),
  };
}

function toFileEntry(row: FileRow): FileChecksumEntry {
  return {
    path: row.path,
    size: row.size,
    modificationTime: row.modification_time,
    partialChecksum: row.partial_checksum,
    fullChecksum: row.full_checksum,
    checksummedAt: row.checksummed_at,
    hasReadError: Boolean(row.has_read_error),
  };
}

// LIKE with an escaped path prefix — path values are absolute filesystem
// paths, not user-controlled LIKE patterns, but '%'/'_' can still appear in
// real file/directory names, so they're escaped.
function subtreeLikePattern(path: string): string {
  const escaped = path.replace(/[%_]/g, '\\$&');
  return (escaped === '/' ? '' : escaped) + '/%';
}

// resolved_by_pass2 is deliberately NOT touched in the ON CONFLICT branch —
// a fresh Pass 1 relisting must not erase Pass 2's last real conclusion for
// an existing node (FR-016); it's only reset by clearChecksumsInSubtree
// (mode: 'full') or set fresh here (0) the first time a row is created.
const upsertPendingDirectoryStmt = db.prepare(`
  INSERT INTO directory_comparison_nodes
    (path, parent_path, depth, own_outcome, has_unreadable_entries, directory_checksum, own_finished_at, resolved_by_pass2)
  VALUES (@path, @parentPath, @depth, 'pending', 0, NULL, NULL, 0)
  ON CONFLICT(path) DO UPDATE SET
    parent_path = excluded.parent_path,
    depth = excluded.depth,
    own_outcome = 'pending',
    has_unreadable_entries = 0,
    own_finished_at = NULL
`);

// Guarded with `AND own_outcome = 'pending'` — same race-safety rationale as
// Count and Size's scan-repository-adapter.ts: a Stop requested while this
// node's listing was in flight must not resurrect it back to 'done'/'error'.
const recordDoneStmt = db.prepare(`
  UPDATE directory_comparison_nodes
  SET own_outcome = 'done', has_unreadable_entries = @hasUnreadableEntries, own_finished_at = @now
  WHERE path = @path AND own_outcome = 'pending'
`);

const recordErrorStmt = db.prepare(`
  UPDATE directory_comparison_nodes
  SET own_outcome = 'error', own_finished_at = @now
  WHERE path = @path AND own_outcome = 'pending'
`);

const markDirStoppedStmt = db.prepare(`
  UPDATE directory_comparison_nodes
  SET own_outcome = 'stopped', own_finished_at = @now
  WHERE path = @path
`);

const findPendingDirStmt = db.prepare(
  `SELECT path FROM directory_comparison_nodes WHERE own_outcome = 'pending'`,
);

const getSubtreeStmt = db.prepare(`
  WITH RECURSIVE subtree(path) AS (
    SELECT path FROM directory_comparison_nodes WHERE path = ?
    UNION ALL
    SELECT d.path FROM directory_comparison_nodes d
      JOIN subtree s ON d.parent_path = s.path
  )
  SELECT n.* FROM directory_comparison_nodes n JOIN subtree s ON n.path = s.path
`);

const getNodeStmt = db.prepare(
  `SELECT * FROM directory_comparison_nodes WHERE path = ?`,
);

const getChildDirsStmt = db.prepare(
  `SELECT * FROM directory_comparison_nodes WHERE parent_path = ?`,
);
const getChildFilesStmt = db.prepare(
  `SELECT * FROM file_checksums WHERE parent_path = ?`,
);

const upsertFileFactsStmt = db.prepare(`
  INSERT INTO file_checksums
    (path, parent_path, size, modification_time, partial_checksum, full_checksum, checksummed_at, has_read_error)
  VALUES (@path, @parentPath, @size, @modificationTime, NULL, NULL, NULL, 0)
  ON CONFLICT(path) DO UPDATE SET
    parent_path = excluded.parent_path,
    size = excluded.size,
    modification_time = excluded.modification_time,
    partial_checksum = CASE
      WHEN file_checksums.size = excluded.size
        AND file_checksums.modification_time = excluded.modification_time
      THEN file_checksums.partial_checksum ELSE NULL END,
    full_checksum = CASE
      WHEN file_checksums.size = excluded.size
        AND file_checksums.modification_time = excluded.modification_time
      THEN file_checksums.full_checksum ELSE NULL END,
    checksummed_at = CASE
      WHEN file_checksums.size = excluded.size
        AND file_checksums.modification_time = excluded.modification_time
      THEN file_checksums.checksummed_at ELSE NULL END,
    has_read_error = CASE
      WHEN file_checksums.size = excluded.size
        AND file_checksums.modification_time = excluded.modification_time
      THEN file_checksums.has_read_error ELSE 0 END
`);

const recordChecksumsStmt = db.prepare(`
  UPDATE file_checksums
  SET partial_checksum = COALESCE(@partialChecksum, partial_checksum),
      full_checksum = COALESCE(@fullChecksum, full_checksum),
      checksummed_at = @now,
      has_read_error = 0
  WHERE path = @path
`);

const recordDirectoryChecksumStmt = db.prepare(`
  UPDATE directory_comparison_nodes
  SET directory_checksum = @checksum, resolved_by_pass2 = 1
  WHERE path = @path
`);

const recordDirReadFailureStmt = db.prepare(`
  UPDATE directory_comparison_nodes
  SET has_unreadable_entries = 1
  WHERE path = @path
`);

const recordFileReadFailureStmt = db.prepare(`
  UPDATE file_checksums
  SET has_read_error = 1
  WHERE path = @path
`);

const clearFileChecksumsInSubtreeStmt = db.prepare(`
  UPDATE file_checksums
  SET partial_checksum = NULL, full_checksum = NULL, checksummed_at = NULL
  WHERE path = @path OR path LIKE @likePattern ESCAPE '\\'
`);

const clearDirChecksumsInSubtreeStmt = db.prepare(`
  UPDATE directory_comparison_nodes
  SET directory_checksum = NULL, resolved_by_pass2 = 0
  WHERE path = @path OR path LIKE @likePattern ESCAPE '\\'
`);

const markSubtreeResolvedStmt = db.prepare(`
  UPDATE directory_comparison_nodes
  SET resolved_by_pass2 = 1
  WHERE (path = @path OR path LIKE @likePattern ESCAPE '\\')
    AND directory_checksum IS NOT NULL
`);

const deleteFileStmt = db.prepare(
  `DELETE FROM file_checksums WHERE path = @path`,
);

const deleteDirNodesInSubtreeStmt = db.prepare(`
  DELETE FROM directory_comparison_nodes
  WHERE path = @path OR path LIKE @likePattern ESCAPE '\\'
`);

const deleteFilesInSubtreeStmt = db.prepare(`
  DELETE FROM file_checksums
  WHERE path = @path OR path LIKE @likePattern ESCAPE '\\'
`);

const isIgnoredStmt = db.prepare(`SELECT 1 FROM ignored_paths WHERE path = ?`);
const setIgnoredStmt = db.prepare(`
  INSERT INTO ignored_paths (path, ignored_at) VALUES (@path, @now)
  ON CONFLICT(path) DO NOTHING
`);
const clearIgnoredStmt = db.prepare(
  `DELETE FROM ignored_paths WHERE path = @path`,
);
const listIgnoredPathsStmt = db.prepare(
  `SELECT path, ignored_at FROM ignored_paths ORDER BY ignored_at DESC`,
);

const recordUnreliableSizeFileStmt = db.prepare(`
  INSERT INTO unreliable_size_files (path, size, detected_at)
  VALUES (@path, @size, @now)
  ON CONFLICT(path) DO UPDATE SET size = excluded.size
`);
const clearUnreliableSizeFileStmt = db.prepare(
  `DELETE FROM unreliable_size_files WHERE path = @path`,
);
const listUnreliableSizeFilesStmt = db.prepare(
  `SELECT path, size, detected_at FROM unreliable_size_files ORDER BY detected_at DESC`,
);
const isUnreliableSizeFileStmt = db.prepare(
  `SELECT 1 FROM unreliable_size_files WHERE path = ?`,
);

export const comparisonRepositoryAdapter: ComparisonRepositoryPort = {
  upsertPendingDirectory(path, parentPath, depth) {
    upsertPendingDirectoryStmt.run({ path, parentPath, depth });
  },

  recordDirectoryOwnResult(path, result) {
    const now = new Date().toISOString();
    if (result.outcome === 'done') {
      recordDoneStmt.run({
        path,
        hasUnreadableEntries: result.hasUnreadableEntries ? 1 : 0,
        now,
      });
    } else {
      recordErrorStmt.run({ path, now });
    }
  },

  upsertFileFacts(path, size, modificationTime) {
    upsertFileFactsStmt.run({
      path,
      parentPath: getParentPath(path),
      size,
      modificationTime,
    });
  },

  markStopped(paths) {
    const now = new Date().toISOString();
    const tx = db.transaction((targets: string[]) => {
      for (const path of targets) markDirStoppedStmt.run({ path, now });
    });
    tx(paths);
  },

  findAllPendingPaths() {
    return (findPendingDirStmt.all() as { path: string }[]).map((r) => r.path);
  },

  getSubtree(targetPath) {
    const rows = getSubtreeStmt.all(targetPath) as DirRow[];
    const self = rows.find((r) => r.path === targetPath);
    if (!self) return [];
    const rest = rows.filter((r) => r.path !== targetPath);
    return [toNode(self), ...rest.map(toNode)];
  },

  getNode(path) {
    const row = getNodeStmt.get(path) as DirRow | undefined;
    return row ? toNode(row) : null;
  },

  getDirectChildren(path) {
    const directories = (getChildDirsStmt.all(path) as DirRow[]).map(toNode);
    const files = (getChildFilesStmt.all(path) as FileRow[]).map(toFileEntry);
    return { directories, files };
  },

  recordChecksums(path, checksums) {
    const now = new Date().toISOString();
    recordChecksumsStmt.run({
      path,
      partialChecksum: checksums.partialChecksum ?? null,
      fullChecksum: checksums.fullChecksum ?? null,
      now,
    });
  },

  recordDirectoryChecksum(path, checksum) {
    recordDirectoryChecksumStmt.run({ path, checksum });
  },

  recordContentReadFailure(path) {
    // A path is never both a file and a directory, so exactly one of these
    // two updates ever affects a row — the other is a harmless no-op.
    recordFileReadFailureStmt.run({ path });
    recordDirReadFailureStmt.run({ path });
  },

  clearChecksumsInSubtree(path) {
    const likePattern = subtreeLikePattern(path);
    clearFileChecksumsInSubtreeStmt.run({ path, likePattern });
    clearDirChecksumsInSubtreeStmt.run({ path, likePattern });
  },

  markSubtreeResolved(path) {
    const likePattern = subtreeLikePattern(path);
    markSubtreeResolvedStmt.run({ path, likePattern });
  },

  deleteFile(path) {
    deleteFileStmt.run({ path });
  },

  deleteDirectorySubtree(path) {
    const likePattern = subtreeLikePattern(path);
    deleteFilesInSubtreeStmt.run({ path, likePattern });
    deleteDirNodesInSubtreeStmt.run({ path, likePattern });
  },

  isIgnored(path) {
    return isIgnoredStmt.get(path) !== undefined;
  },

  setIgnored(path, ignored) {
    if (ignored) {
      setIgnoredStmt.run({ path, now: new Date().toISOString() });
    } else {
      clearIgnoredStmt.run({ path });
    }
  },

  listIgnoredPaths() {
    const rows = listIgnoredPathsStmt.all() as {
      path: string;
      ignored_at: string;
    }[];
    return rows.map((r) => ({ path: r.path, ignoredAt: r.ignored_at }));
  },

  recordUnreliableSizeFile(path, size) {
    recordUnreliableSizeFileStmt.run({
      path,
      size,
      now: new Date().toISOString(),
    });
  },

  clearUnreliableSizeFile(path) {
    clearUnreliableSizeFileStmt.run({ path });
  },

  listUnreliableSizeFiles() {
    const rows = listUnreliableSizeFilesStmt.all() as {
      path: string;
      size: number;
      detected_at: string;
    }[];
    return rows.map((r) => ({
      path: r.path,
      size: r.size,
      detectedAt: r.detected_at,
    }));
  },

  isUnreliableSizeFile(path) {
    return isUnreliableSizeFileStmt.get(path) !== undefined;
  },
};
