# Contract: ComparisonRepositoryPort

The port `application/directory-comparison/` use cases depend on for reading and
writing `DirectoryComparisonNode` and `FileChecksumEntry` rows (see
`data-model.md`). Defined in
`application/directory-comparison/comparison-repository-port.ts`.

## Shape

```ts
import type { ScanNodeStatus } from '@/domain/scanning/scan-node-status';

interface DirectoryComparisonNode extends ScanNodeStatus {
  directoryChecksum: string | null;
}

interface FileChecksumEntry {
  path: string;
  size: number;
  modificationTime: string; // ISO 8601
  partialChecksum: string | null;
  fullChecksum: string | null;
  checksummedAt: string | null; // ISO 8601
  // Set by recordContentReadFailure(path) called with THIS file's own path
  // — distinct from a sibling file's status, unlike the directory-level
  // hasUnreadableEntries flag. Reset to false on relisting with a changed
  // size/mtime.
  hasReadError: boolean;
}

interface ComparisonRepositoryPort {
  // Pass 1 (structural listing) — same shape/semantics as Count and Size's
  // ScanRepositoryPort.upsertPending/markStopped/findAllPendingPaths.
  upsertPendingDirectory(
    path: string,
    parentPath: string | null,
    depth: number,
  ): void;
  recordDirectoryOwnResult(
    path: string,
    result:
      { outcome: 'done'; hasUnreadableEntries: boolean } | { outcome: 'error' },
  ): void;
  upsertFileFacts(path: string, size: number, modificationTime: string): void; // resets checksums to null if size/mtime changed (research.md Decision 11)
  // Pass 1 only. Removes a file's row entirely — called for a
  // previously-listed child that no longer appears in a fresh listing (the
  // file was deleted/renamed/replaced by a directory since the last
  // "Compare"), so it stops being a phantom pairing candidate for Pass 2
  // (found missing during manual verification: a deleted file's stale row
  // otherwise lingers forever and Pass 2 keeps comparing against it).
  deleteFile(path: string): void;
  // Pass 1 only. Same rationale as deleteFile, but for a whole subdirectory
  // that vanished (or was replaced by a file of the same name) — removes
  // its own row and every descendant directory/file row beneath it.
  deleteDirectorySubtree(path: string): void;
  markStopped(paths: string[]): void;
  findAllPendingPaths(): string[];

  // Shared by Pass 1 and Pass 2, and by read-time comparison-view derivation.
  getSubtree(path: string): DirectoryComparisonNode[]; // self + descendants, self first
  getDirectChildren(path: string): {
    directories: DirectoryComparisonNode[];
    files: FileChecksumEntry[];
  };

  // Pass 2 only.
  recordChecksums(
    path: string,
    checksums: { partialChecksum?: string; fullChecksum?: string },
  ): void;
  recordDirectoryChecksum(path: string, checksum: string | null): void; // null clears a stale value (e.g. a child changed)

  // Pass 2 only. Called with a FILE's own path: sets that file's
  // hasReadError. Called with a DIRECTORY's own path (propagating up the
  // ancestor chain, FR-011a): sets hasUnreadableEntries on that directory —
  // WITHOUT touching ownOutcome, which stays Pass-1-owned (research.md
  // Decision 3; found missing during /speckit-analyze review). A path is
  // never both a file and a directory, so one call always affects exactly
  // one row in exactly one of the two tables.
  recordContentReadFailure(path: string): void;

  // Pass 2 only, `mode: 'full'` (research.md Decision 11): clears
  // partialChecksum/fullChecksum on every file_checksums row and
  // directoryChecksum on every directory_comparison_nodes row in the given
  // subtree, forcing the cascade to redo everything on both sides. Called
  // once per root by start-comparison.ts before Pass 2 runs.
  clearChecksumsInSubtree(path: string): void;
}
```

## Use cases that depend on this port

- `list-entries.ts` (Pass 1 per-node step): `upsertPendingDirectory`,
  `recordDirectoryOwnResult`, `upsertFileFacts` for each direct file,
  `deleteFile`/`deleteDirectorySubtree` for any previously-known child no longer
  present (or whose kind changed) in the fresh listing.
- `compare-subtree.ts` (Pass 2): `getDirectChildren` at each level (bottom-up),
  `recordChecksums` as the cascade computes partial/full checksums,
  `recordDirectoryChecksum` once a directory pair resolves,
  `recordContentReadFailure` (with the failing file's own path) when
  `ChecksumPort` throws for a file that was listed successfully but couldn't
  actually be read, and again (with each ancestor directory's path, on that
  side) to propagate the resulting Error status up to the compared root (spec
  FR-011, FR-011a).
- `get-comparison-view.ts`: `getDirectChildren` for the currently-viewed pair's
  direct entries, feeding
  `domain/directory-comparison/entry-comparison-result.ts`.
- `start-comparison.ts` / `stop-comparison.ts`: `getSubtree`,
  `findAllPendingPaths`, `markStopped` — same roles as Count and Size's
  `start-scan.ts`/`stop-scan.ts`.

## Implementation

- **`infrastructure/directory-comparison/comparison-repository-adapter.ts`**
  (the only implementation): `better-sqlite3` against
  `directory_comparison_nodes` and `file_checksums`.

## Rules a consumer can rely on

- All methods are synchronous (`better-sqlite3`'s API) — use cases remain
  `async` overall only because of interleaved `FileSystemPort`/`ChecksumPort`
  calls.
- `upsertFileFacts` MUST clear `partialChecksum`/`fullChecksum` to `null`
  whenever the new `size`/`modificationTime` differ from the row's previous
  values — callers never need to separately invalidate stale checksums.
- `getSubtree`/`getDirectChildren` always include the queried path's own row
  first when present.
