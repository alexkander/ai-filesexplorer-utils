import Database from 'better-sqlite3';
import path from 'path';
import type { ChecksumInfoPort } from '@/application/count-and-size/checksum-info-port';

// Same path/env-var convention as directory-comparison's own
// sqlite-client.ts — pointing DIRECTORY_COMPARISON_DB_PATH at a scratch DB
// (e.g. while testing) redirects this read-only view too, consistently.
const dbPath =
  process.env.DIRECTORY_COMPARISON_DB_PATH ||
  path.join(process.cwd(), 'data', 'directory-comparison.sqlite');

// `readonly: true` is enforced at the driver level — any attempted write
// throws — mirrors directory-comparison's own count-and-size-readonly-
// adapter.ts, which established this one-way read-only overlay pattern in
// the other direction. `fileMustExist: true` means opening throws if
// directory-comparison has never been run yet; caught below so this
// feature degrades to "no data available" instead of failing to start.
let db: Database.Database | null = null;
try {
  db = new Database(dbPath, { readonly: true, fileMustExist: true });
} catch {
  db = null;
}

const getFileChecksumStmt = db?.prepare(
  `SELECT full_checksum FROM file_checksums WHERE path = ?`,
);
const getDirChecksumStmt = db?.prepare(
  `SELECT directory_checksum FROM directory_comparison_nodes WHERE path = ?`,
);

export const directoryComparisonReadonlyAdapter: ChecksumInfoPort = {
  getChecksum(targetPath: string): string | null {
    if (!getFileChecksumStmt || !getDirChecksumStmt) return null;
    try {
      // A path is never both a file and a directory, so at most one of
      // these two lookups ever finds a row.
      const fileRow = getFileChecksumStmt.get(targetPath) as
        { full_checksum: string | null } | undefined;
      if (fileRow) return fileRow.full_checksum;

      const dirRow = getDirChecksumStmt.get(targetPath) as
        { directory_checksum: string | null } | undefined;
      return dirRow?.directory_checksum ?? null;
    } catch {
      // Defensive: a schema mismatch, a mid-write lock, or any other read
      // failure against another tool's database degrades to "no data"
      // rather than breaking this tool's own listing.
      return null;
    }
  },
};
