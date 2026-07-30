import Database from 'better-sqlite3';
import path from 'path';
import type {
  CachedChecksums,
  ChecksumCachePort,
} from '@/application/duplicate-finder/checksum-cache-port';

// Same path/env-var convention as directory-comparison's own
// sqlite-client.ts — pointing DIRECTORY_COMPARISON_DB_PATH at a scratch DB
// (e.g. while testing) redirects this read-only view too, consistently.
const dbPath =
  process.env.DIRECTORY_COMPARISON_DB_PATH ||
  path.join(process.cwd(), 'data', 'directory-comparison.sqlite');

// `readonly: true` is enforced at the driver level — any attempted write
// throws — which is what makes spec FR-030 ("never writes to the comparison
// tool's data") a structural guarantee rather than a review promise.
// `fileMustExist: true` means opening throws if that tool has never been
// run; caught below so this feature degrades to "no cached checksums"
// instead of failing to start.
//
// The `.prepare()` call is inside the SAME try/catch as the constructor
// (not left to throw on its own): a fresh build/first run can hit a narrow
// window where the file exists (better-sqlite3 creates it the instant
// `new Database()` runs) but that tool's own sqlite-client.ts, evaluated
// concurrently by Next's build in a different route's module graph, hasn't
// executed its `CREATE TABLE` statements yet — `file_checksums` genuinely
// doesn't exist even though the file does, and `.prepare()` against a
// missing table throws immediately, unlike a query against an
// existing-but-empty table.
let getChecksumsStmt: Database.Statement | undefined;
try {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  getChecksumsStmt = db.prepare(`
    SELECT partial_checksum, full_checksum
    FROM file_checksums
    WHERE path = ?
      AND size = ?
      AND modification_time = ?
      AND has_read_error = 0
  `);
} catch {
  getChecksumsStmt = undefined;
}

const NO_CHECKSUMS: CachedChecksums = {
  partialChecksum: null,
  fullChecksum: null,
};

/**
 * Reads checksums the directory comparison tool already computed, and only
 * when the facts it recorded still match what this scan just observed
 * (research.md Decision 6). Both tools store `modification_time` as an ISO
 * 8601 string produced by the same `stats.mtime.toISOString()` call in
 * `infrastructure/scanning/filesystem-adapter.ts`, so the equality above is
 * a valid comparison with no parsing involved.
 *
 * The stored `full_checksum` is a raw SHA-256 of the file's bytes — that
 * tool's Office-container normalisation is computed on demand elsewhere and
 * never persisted here — so a cached value and a freshly computed one are
 * the same kind of thing.
 */
export const comparisonChecksumReadonlyAdapter: ChecksumCachePort = {
  getCachedChecksums(
    targetPath: string,
    size: number,
    modificationTime: string,
  ): CachedChecksums {
    if (!getChecksumsStmt) return NO_CHECKSUMS;
    try {
      const row = getChecksumsStmt.get(targetPath, size, modificationTime) as
        | { partial_checksum: string | null; full_checksum: string | null }
        | undefined;
      if (!row) return NO_CHECKSUMS;
      return {
        partialChecksum: row.partial_checksum,
        fullChecksum: row.full_checksum,
      };
    } catch {
      // Defensive: a schema mismatch, a mid-write lock, or any other read
      // failure against another tool's database degrades to "hash it
      // yourself" rather than breaking this tool's scan.
      return NO_CHECKSUMS;
    }
  },
};
