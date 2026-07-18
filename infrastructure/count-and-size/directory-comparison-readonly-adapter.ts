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
//
// The `.prepare()` calls below are wrapped in the SAME try/catch as the
// constructor (not left to throw on their own) — found necessary post-
// implementation: a fresh build/first run can hit a narrow window where
// the file exists (better-sqlite3 creates it the instant `new Database()`
// runs) but directory-comparison's own sqlite-client.ts, evaluated
// concurrently by Next's build in a different route's module graph,
// hasn't executed its `CREATE TABLE` statements yet — `file_checksums`
// genuinely doesn't exist yet even though the file does, and `.prepare()`
// against a missing table throws immediately, unlike a query against an
// existing-but-empty table.
let getFileChecksumStmt: Database.Statement | undefined;
let getDirChecksumStmt: Database.Statement | undefined;
try {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  getFileChecksumStmt = db.prepare(
    `SELECT full_checksum FROM file_checksums WHERE path = ?`,
  );
  getDirChecksumStmt = db.prepare(
    `SELECT directory_checksum FROM directory_comparison_nodes WHERE path = ?`,
  );
} catch {
  getFileChecksumStmt = undefined;
  getDirChecksumStmt = undefined;
}

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
