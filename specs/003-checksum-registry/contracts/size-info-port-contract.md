# Contract: SizeInfoPort

Added post-implementation (spec FR-019, user request). The port
`list-directory.ts` optionally depends on for a read-only file count/size
overlay sourced from the **separate** Count and Size tool's own database.
Defined in `application/directory-comparison/size-info-port.ts`.

## Shape

```ts
interface SizeInfo {
  fileCount: number;
  totalSize: number;
  // true if any directory in the subtree Count and Size measured hasn't
  // finished successfully (still scanning, errored, stopped, or has
  // unreadable entries) — mirrors that tool's own "incomplete" flag.
  incomplete: boolean;
}

interface SizeInfoPort {
  // null means Count and Size has never scanned this exact path (or its
  // database doesn't exist at all) — not an error.
  getSizeInfo(path: string): SizeInfo | null;
}
```

## Use cases that depend on this port

- `list-directory.ts`: calls `getSizeInfo(entry.path)` for each directory entry
  on the returned page (files never get a lookup — Count and Size doesn't track
  per-file data, only per-directory aggregates), attaching the result as
  `ListedEntry.sizeInfo` when non-null.

## Implementation

- **`infrastructure/directory-comparison/count-and-size-readonly-adapter.ts`**
  (the only implementation): opens `COUNT_AND_SIZE_DB_PATH` (same env var and
  default path Count and Size's own `sqlite-client.ts` uses — pointing it at a
  scratch DB during testing redirects this adapter too) via `better-sqlite3`
  with `{ readonly: true, fileMustExist: true }`. `readonly: true` is enforced
  by the SQLite driver itself — any attempted write throws — the strongest
  guarantee available that this adapter can never modify Count and Size's
  database, not merely a convention this code happens to follow.
  `fileMustExist: true` means opening throws if Count and Size has never been
  run; caught at module load, falling back to a no-op implementation
  (`getSizeInfo` always returns `null`) so this feature degrades gracefully
  instead of failing to start. Runs a single recursive-CTE aggregate query per
  lookup (`SUM(direct_file_count)`, `SUM(direct_file_size)` over the path's
  subtree in `directory_scan_nodes`, plus a `MIN(...)` trick to derive
  `incomplete`), mirroring — but not importing — the aggregation
  `domain/count-and-size/derive-directory-view.ts` does for that tool's own UI
  (see research.md's addendum on this decision for why it's not reused
  directly).

## Rules a consumer can rely on

- Never throws — any read failure (schema mismatch, mid-write lock on the other
  tool's WAL file, the database simply not existing) resolves to `null`, exactly
  like "this path was never scanned."
- Never writes to Count and Size's database, enforced at the SQLite driver
  level, not just by this adapter's own code never issuing a write statement.
- A lookup for a path Count and Size scanned but is still actively scanning
  (partial data) still returns a non-null `SizeInfo`, with `incomplete: true` —
  this port doesn't distinguish "still scanning" from "finished with some
  unreadable entries somewhere in the subtree"; both set `incomplete: true`,
  matching Count and Size's own `DirectoryView`'s `incomplete` semantics.
