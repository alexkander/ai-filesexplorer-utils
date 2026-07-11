# Contract: ScanRepositoryPort

The port `application/count-and-size/` use cases depend on for reading and
writing `DirectoryScanNode` rows (see `data-model.md`). Defined in
`application/count-and-size/scan-repository-port.ts`.

## Shape

```ts
type OwnOutcome = 'pending' | 'error' | 'stopped' | 'done';

interface DirectoryScanNode {
  path: string;
  parentPath: string | null;
  depth: number;
  ownOutcome: OwnOutcome;
  directFileCount: number;
  directFileSize: number;
  hasUnreadableEntries: boolean;
  errorMessage: string | null;
  ownFinishedAt: string | null; // ISO 8601
}

interface ScanRepositoryPort {
  // Insert or fully overwrite the row for `path` (FR-021: rescanning
  // overwrites prior data). Used when a path is (re)enqueued: writes
  // ownOutcome: 'pending' and resets the rest to defaults.
  upsertPending(path: string, parentPath: string | null, depth: number): void;

  // Called by the worker once a node's own listing step concludes.
  recordOwnResult(
    path: string,
    result:
      | {
          outcome: 'done';
          directFileCount: number;
          directFileSize: number;
          hasUnreadableEntries: boolean;
        }
      | { outcome: 'error'; errorMessage: string },
  ): void;

  // Mark a specific set of paths (the active path + its already-created
  // in-flight descendants) as stopped — used by both the explicit Stop
  // action (FR-018) and startup reconciliation (FR-019).
  markStopped(paths: string[]): void;

  // Startup reconciliation (research.md Decision 2): find every row still
  // 'pending' from a previous process and return their paths so the caller
  // can markStopped(...) them.
  findAllPendingPaths(): string[];

  // Fetch one node plus every node in its subtree (self included), for
  // DirectoryView derivation (data-model.md) and for the Scan/Stop use
  // cases to know which descendants already have rows.
  getSubtree(path: string): DirectoryScanNode[]; // empty array if `path`
  // has no row (not_scanned)
}
```

## Use cases that depend on this port

- `process-directory.ts`: `recordOwnResult`, plus `upsertPending` for each
  discovered subdirectory before pushing it onto the in-memory stack.
- `start-scan.ts`: `upsertPending` for the requested root path.
- `stop-scan.ts`: `markStopped` for the active path and any already-`pending`
  descendants found via `getSubtree`.
- `get-directory-status.ts` / `list-directory.ts`: both call `getSubtree` — once
  for the viewed directory, and once per listed subdirectory with scan data
  (research.md Decision 5a) — feeding
  `domain/count-and-size/derive-directory-view.ts`.
- The worker singleton's startup routine: `findAllPendingPaths` + `markStopped`
  (FR-019).

## Implementation

- **`infrastructure/count-and-size/scan-repository-adapter.ts`** (the only
  implementation): `better-sqlite3` against the `directory_scan_nodes` table.
  `getSubtree` is a single recursive CTE query (research.md Decision 1) —
  callers never need to know it isn't a persisted aggregate.

## Rules a consumer can rely on

- All methods are synchronous (matches `better-sqlite3`'s synchronous API) — use
  cases that call them remain `async` overall only because of the
  `FileSystemPort` calls interleaved with them.
- `getSubtree(path)` always includes `path`'s own row first (if it exists) —
  callers don't need to special-case "self vs. descendants".
- `upsertPending` fully replaces any prior row for that path — no field from a
  previous scan leaks into the new one (FR-021).
