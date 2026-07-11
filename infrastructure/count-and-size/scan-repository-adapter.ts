import { db } from './sqlite-client';
import type { ScanRepositoryPort } from '@/application/count-and-size/scan-repository-port';
import type { DirectoryScanNode } from '@/domain/count-and-size/directory-scan-node';

interface Row {
  path: string;
  parent_path: string | null;
  depth: number;
  own_outcome: string;
  direct_file_count: number;
  direct_file_size: number;
  has_unreadable_entries: number;
  error_message: string | null;
  own_finished_at: string | null;
}

function toNode(row: Row): DirectoryScanNode {
  return {
    path: row.path,
    parentPath: row.parent_path,
    depth: row.depth,
    ownOutcome: row.own_outcome as DirectoryScanNode['ownOutcome'],
    directFileCount: row.direct_file_count,
    directFileSize: row.direct_file_size,
    hasUnreadableEntries: Boolean(row.has_unreadable_entries),
    errorMessage: row.error_message,
    ownFinishedAt: row.own_finished_at,
  };
}

const upsertStmt = db.prepare(`
  INSERT INTO directory_scan_nodes
    (path, parent_path, depth, own_outcome, direct_file_count, direct_file_size, has_unreadable_entries, error_message, own_finished_at)
  VALUES (@path, @parentPath, @depth, 'pending', 0, 0, 0, NULL, NULL)
  ON CONFLICT(path) DO UPDATE SET
    parent_path = excluded.parent_path,
    depth = excluded.depth,
    own_outcome = 'pending',
    direct_file_count = 0,
    direct_file_size = 0,
    has_unreadable_entries = 0,
    error_message = NULL,
    own_finished_at = NULL
`);

// Both guarded with `AND own_outcome = 'pending'`: if a Stop request already
// flipped this row to 'stopped' while the async listing was in flight, this
// write must not resurrect it back to 'done'/'error' (research.md-adjacent
// race between stop-scan.ts and the worker's in-flight processDirectory).
const recordDoneStmt = db.prepare(`
  UPDATE directory_scan_nodes
  SET own_outcome = 'done', direct_file_count = @directFileCount,
      direct_file_size = @directFileSize,
      has_unreadable_entries = @hasUnreadableEntries,
      error_message = NULL, own_finished_at = @now
  WHERE path = @path AND own_outcome = 'pending'
`);

const recordErrorStmt = db.prepare(`
  UPDATE directory_scan_nodes
  SET own_outcome = 'error', error_message = @errorMessage, own_finished_at = @now
  WHERE path = @path AND own_outcome = 'pending'
`);

const markStoppedStmt = db.prepare(`
  UPDATE directory_scan_nodes
  SET own_outcome = 'stopped', own_finished_at = @now
  WHERE path = @path
`);

const findPendingStmt = db.prepare(
  `SELECT path FROM directory_scan_nodes WHERE own_outcome = 'pending'`,
);

const getSubtreeStmt = db.prepare(`
  WITH RECURSIVE subtree(path) AS (
    SELECT path FROM directory_scan_nodes WHERE path = ?
    UNION ALL
    SELECT d.path FROM directory_scan_nodes d
      JOIN subtree s ON d.parent_path = s.path
  )
  SELECT n.* FROM directory_scan_nodes n JOIN subtree s ON n.path = s.path
`);

export const scanRepositoryAdapter: ScanRepositoryPort = {
  upsertPending(path, parentPath, depth) {
    upsertStmt.run({ path, parentPath, depth });
  },

  recordOwnResult(path, result) {
    const now = new Date().toISOString();
    if (result.outcome === 'done') {
      recordDoneStmt.run({
        path,
        directFileCount: result.directFileCount,
        directFileSize: result.directFileSize,
        hasUnreadableEntries: result.hasUnreadableEntries ? 1 : 0,
        now,
      });
    } else {
      recordErrorStmt.run({ path, errorMessage: result.errorMessage, now });
    }
  },

  markStopped(paths) {
    const now = new Date().toISOString();
    const tx = db.transaction((targets: string[]) => {
      for (const path of targets) markStoppedStmt.run({ path, now });
    });
    tx(paths);
  },

  findAllPendingPaths() {
    return (findPendingStmt.all() as { path: string }[]).map((r) => r.path);
  },

  getSubtree(targetPath) {
    const rows = getSubtreeStmt.all(targetPath) as Row[];
    const self = rows.find((r) => r.path === targetPath);
    if (!self) return [];
    const rest = rows.filter((r) => r.path !== targetPath);
    return [toNode(self), ...rest.map(toNode)];
  },
};
