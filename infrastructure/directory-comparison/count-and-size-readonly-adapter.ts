import Database from 'better-sqlite3';
import path from 'path';
import type {
  SizeInfo,
  SizeInfoPort,
} from '@/application/directory-comparison/size-info-port';

// Same path/env-var convention as Count and Size's own sqlite-client.ts —
// pointing COUNT_AND_SIZE_DB_PATH at a scratch DB (e.g. while testing)
// redirects this read-only view too, consistently.
const dbPath =
  process.env.COUNT_AND_SIZE_DB_PATH ||
  path.join(process.cwd(), 'data', 'count-and-size.sqlite');

// `readonly: true` is enforced at the driver level — any attempted write
// throws — the strongest guarantee available that this adapter can never
// modify Count and Size's database, not just a convention this code
// happens to follow (spec FR-019, user request: "solo lectura").
// `fileMustExist: true` means opening throws if Count and Size has never
// been run yet; caught below so this feature degrades to "no data
// available" instead of failing to start.
let db: Database.Database | null = null;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch {
  db = null;
}

const getAggregateStmt = db?.prepare(`
  WITH RECURSIVE subtree(path) AS (
    SELECT path FROM directory_scan_nodes WHERE path = ?
    UNION ALL
    SELECT d.path FROM directory_scan_nodes d
      JOIN subtree s ON d.parent_path = s.path
  )
  SELECT
    COUNT(*) AS node_count,
    COALESCE(SUM(n.direct_file_count), 0) AS total_count,
    COALESCE(SUM(n.direct_file_size), 0) AS total_size,
    MIN(CASE
      WHEN n.own_outcome = 'done' AND n.has_unreadable_entries = 0 THEN 1
      ELSE 0
    END) AS all_complete
  FROM directory_scan_nodes n JOIN subtree s ON n.path = s.path
`);

interface AggregateRow {
  node_count: number;
  total_count: number;
  total_size: number;
  all_complete: number | null;
}

export const countAndSizeReadonlyAdapter: SizeInfoPort = {
  getSizeInfo(targetPath: string): SizeInfo | null {
    if (!getAggregateStmt) return null;
    try {
      const row = getAggregateStmt.get(targetPath) as AggregateRow;
      if (row.node_count === 0) return null;
      return {
        fileCount: row.total_count,
        totalSize: row.total_size,
        incomplete: row.all_complete !== 1,
      };
    } catch {
      // Defensive: a schema mismatch, a mid-write lock, or any other
      // read failure against another tool's database degrades to "no
      // data" rather than breaking this tool's own listing.
      return null;
    }
  },
};
