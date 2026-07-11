# Phase 1 Data Model: Count and Size Tool

One entity is persisted (`DirectoryScanNode`); everything else the user sees
— aggregated totals, the 5-value display state, the incomplete flag, the
listing the user browses — is computed on demand from persisted nodes plus a
live `fs` read. See `research.md` Decision 1 for why aggregation happens at
read time instead of being stored.

## DirectoryScanNode (persisted — SQLite table `directory_scan_nodes`)

Represents one directory's *own* scan outcome (spec Key Entity: "Directory
Scan Procedure" — this is its persisted core; the rest of that entity's
described attributes, like aggregated count/size and display state, are
derived — see `DirectoryView` below).

| Field                  | Type                                       | Notes                                                                                                                                          |
| ---------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `path`                 | `string` (PK)                               | Absolute, canonical filesystem path. Unique identity (FR-020: rescanning overwrites the row for the same path).                                   |
| `parentPath`           | `string \| null`                            | `null` only for `/`. Used to build the subtree for aggregation (Decision 1) and to compute `depth` (FR-020 of spec... see FR-020 numbering below). |
| `depth`                | `integer`                                   | Distance from root `/` (FR-020). `/` itself is depth 0.                                                                                            |
| `ownOutcome`           | `'pending' \| 'error' \| 'stopped' \| 'done'` | The raw result of *this node's own* direct-file scan step only — never reflects descendants. `'pending'` covers both queued-and-waiting and actively-running (research.md Decision 0/2; spec FR-010). |
| `directFileCount`      | `integer`                                   | Count of this directory's direct, non-ignored files. `0` until `ownOutcome` leaves `'pending'`.                                                    |
| `directFileSize`       | `integer` (bytes)                           | Total size of this directory's direct, non-ignored files.                                                                                          |
| `hasUnreadableEntries` | `boolean`                                   | `true` if any direct child (file or subdirectory) could not be read and was skipped (FR-016).                                                      |
| `errorMessage`         | `string \| null`                            | Set only when `ownOutcome = 'error'` (e.g. the directory itself was unreadable) — informational only, not otherwise displayed by the spec.         |
| `ownFinishedAt`        | `string (ISO 8601) \| null`                 | When `ownOutcome` left `'pending'`. `null` while pending.                                                                                           |

**Validation rules**:

- `path` MUST be an absolute path; `parentPath` MUST equal the parent
  directory of `path` (or `null` iff `path === '/'`).
- `depth` MUST equal `parentPath === null ? 0 : parent.depth + 1`.
- `directFileCount`/`directFileSize` MUST be `0` while `ownOutcome ===
  'pending'` and MUST NOT change once `ownOutcome` leaves `'pending'` (a
  directory's own facts are fixed once computed; only a full rescan, which
  overwrites the row, changes them — FR-020/FR-021).

**Lifecycle** (per node, independent of its descendants):

```
(no row) --startScan or spawned as child--> pending
pending --own listing succeeds--> done
pending --own listing fails (unreadable dir itself)--> error
pending --Stop pressed, or app restarts while pending--> stopped
done/error/stopped --Scan pressed again on this path--> pending (row overwritten, FR-021)
```

**Relationships**: Self-referential tree via `parentPath`. A node's children
are all rows with `parentPath` equal to its `path`. A full subtree (self +
all descendants currently in the table) is fetched with a SQL recursive CTE.

## DirectoryView (derived — never persisted)

What FR-004/FR-005/FR-008/FR-009/FR-011 actually require to be *shown* for a
given path, computed on every request by combining that path's
`DirectoryScanNode` (if any) with all of its descendant nodes.

| Field                | Type                                                      | Derivation                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`               | `'not_scanned' \| 'scanning' \| 'completed' \| 'error' \| 'stopped'` | `not_scanned` if no row exists. Else, if any node in the subtree (self or descendant) has `ownOutcome = 'pending'` → `scanning`. Else, self's own `ownOutcome` maps directly: `error`→`error`, `stopped`→`stopped`, `done`→`completed`. |
| `incomplete`          | `boolean`                                                   | `false` only when `state === 'completed'` AND every node in the subtree has `ownOutcome = 'done'` AND `hasUnreadableEntries = false`. `true` whenever `state === 'completed'` but that condition fails. Meaningless (omit/ignore) for other states. |
| `aggregatedCount`     | `integer`                                                   | `SUM(directFileCount)` over self + all descendant nodes present in the subtree.                                                                                                                            |
| `aggregatedSize`      | `integer` (bytes)                                           | `SUM(directFileSize)` over self + all descendant nodes present in the subtree.                                                                                                                            |
| `lastScannedAt`       | `string (ISO 8601) \| null`                                 | `MAX(ownFinishedAt)` over self + all descendant nodes present in the subtree (`null` if none has finished yet, which the UI renders as "not scanned yet" per FR-005).                                     |
| `hasUnreadableEntries`| `boolean`                                                   | This node's own `hasUnreadableEntries` (not aggregated — FR-016 flags the specific containing directory, not its ancestors).                                                                                |

This is exactly `domain/count-and-size/derive-directory-view.ts` (Decision
9): a pure function of `(node, descendantNodes)` with no I/O.

## FilesystemEntry (transient — one page of a directory listing)

What `GET /api/count-and-size/list` returns per row (spec Key Entity
"Filesystem Entry"), combining a live `fs` listing with each subdirectory's
latest `DirectoryView.state` for the availability indicator (FR-004).

| Field         | Type                     | Notes                                                                                                    |
| ------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `name`        | `string`                 | Entry's base name (not full path).                                                                         |
| `type`        | `'file' \| 'directory'`  | Symlinks are excluded entirely from listings, per FR-015 — not shown as a third type.                       |
| `hasScanData` | `boolean`                | Directories only. `true` iff a `DirectoryScanNode` row exists for this entry's path (state ≠ `not_scanned`). When `false`, the client renders no indicator at all (FR-004). |

**Pagination** (FR-001a): the endpoint takes `offset`/`limit` and returns
`{ entries: FilesystemEntry[], hasMore: boolean }`; see `research.md`
Decision 6.

## ScanWorker state (in-memory only — not an entity, not persisted)

The running process holds exactly one mutable singleton
(`infrastructure/count-and-size/scan-worker.ts`):

- `activePath: string | null` — the path currently being processed, or
  `null` if idle (FR-012: at most one).
- `stack: string[]` — pending paths, LIFO (FR-013/FR-014); pushed to when a
  directory finishes its own listing and reports its subdirectories, or when
  `startScan` is called on an idle worker.

Deliberately not persisted — see `research.md` Decision 2. This directly
realizes the spec's "Scan Queue" key entity, minus durability.
