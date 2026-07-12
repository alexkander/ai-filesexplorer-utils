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
}
```

## Use cases that depend on this port

- `list-entries.ts` (Pass 1 per-node step): `upsertPendingDirectory`,
  `recordDirectoryOwnResult`, `upsertFileFacts` for each direct file.
- `compare-subtree.ts` (Pass 2): `getDirectChildren` at each level (bottom-up),
  `recordChecksums` as the cascade computes partial/full checksums,
  `recordDirectoryChecksum` once a directory pair resolves.
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
