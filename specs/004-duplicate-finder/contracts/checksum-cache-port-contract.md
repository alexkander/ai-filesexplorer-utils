# Contract: ChecksumCachePort

An optional, read-only accelerator: "has some other tool already hashed this
exact file, unchanged?". Defined in
`application/duplicate-finder/checksum-cache-port.ts`.

This is the only point where the duplicate finder touches another feature's
data, and it can only read (FR-030). The one-way read-only overlay pattern is
established in both directions already —
`infrastructure/count-and-size/directory-comparison-readonly-adapter.ts` and
`infrastructure/directory-comparison/count-and-size-readonly-adapter.ts`.

## Shape

```ts
export interface CachedChecksums {
  partialChecksum: string | null;
  fullChecksum: string | null;
}

interface ChecksumCachePort {
  /** Checksums another tool already computed for `path`, but ONLY if the
   * facts it recorded still match what this scan just observed. Any
   * mismatch, missing row, read error flag, or unavailable source returns
   * nulls. Never throws. */
  getCachedChecksums(
    path: string,
    size: number,
    modificationTime: string,
  ): CachedChecksums;
}
```

## Rules a consumer can rely on

- **A miss is never an answer.** `{ partialChecksum: null, fullChecksum: null }`
  means "hash it", never "this file has no duplicates". The backing table is a
  partial cache: the comparison tool's cascade routinely stops at the partial
  checksum, and a file it never had a counterpart for may have no checksum at
  all. Treating a null as "unique" would silently drop real duplicates
  (research.md Decision 6).
- **Freshness is enforced inside the port**, not by the caller: a row is only
  returned when its recorded `size` and `modification_time` both equal the
  arguments, and `has_read_error` is 0.
- **Comparable timestamps**: both sides store ISO 8601 strings produced by
  `stats.mtime.toISOString()` in
  `infrastructure/scanning/filesystem-adapter.ts`, so plain string equality is
  correct — no parsing, no timezone handling.
- **Same digest, comparable value**: the returned `fullChecksum` is a raw
  SHA-256 of the file's bytes. The comparison tool's Office-container
  normalisation is computed on demand in `list-entries.ts` and is never
  persisted into `file_checksums`, so a cached value and a freshly computed one
  are the same kind of thing.
- **Never throws, always degrades**: a missing database file, a schema that does
  not have the table yet (a real window during `next build`, which evaluates
  route module graphs in parallel processes), a lock, or any other failure comes
  back as nulls. The feature works fine with the comparison tool never having
  been run.
- **Cannot write.** The connection is opened with `readonly: true`, so the
  driver itself rejects any write. This is a structural guarantee of FR-030, not
  a convention.

## Use cases that depend on this port

- `application/duplicate-finder/hash-candidates.ts` — consulted after this
  feature's own `scanned_files` row and before calling `ChecksumPort`.

## Implementation

`infrastructure/duplicate-finder/comparison-checksum-readonly-adapter.ts` —
`new Database(dbPath, { readonly: true, fileMustExist: true })` against
`process.env.DIRECTORY_COMPARISON_DB_PATH || data/directory-comparison.sqlite`,
with the constructor **and** the `.prepare()` calls inside one `try/catch` (the
existing adapters document why: the file can exist while its tables do not yet).
Statement:

```sql
SELECT partial_checksum, full_checksum
FROM file_checksums
WHERE path = ? AND size = ? AND modification_time = ? AND has_read_error = 0
```

A null implementation (always returning nulls) is a valid substitute and is what
the adapter degrades to when the source database is unavailable.
