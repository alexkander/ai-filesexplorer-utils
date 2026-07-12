# Phase 1 Data Model: Directory Comparison Tool

Two entities are persisted (`FileChecksumEntry`, `DirectoryComparisonNode`),
keyed purely by absolute path — neither knows which comparison pair it was
computed as part of (research.md Decision 1/7). Everything the user sees —
per-entry Matching/Differs/etc. status, the listing — is derived at read time
from these two tables plus a live `fs` listing.

## FileChecksumEntry (persisted — SQLite table `file_checksums`)

One row per file path this tool has ever listed, on either side of any
comparison.

| Field              | Type                        | Notes                                                                                                                                                                                                                                                                                                         |
| ------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`             | `string` (PK)               | Absolute, canonical filesystem path.                                                                                                                                                                                                                                                                          |
| `size`             | `integer` (bytes)           | Set by Pass 1 (listing) — always known once the row exists.                                                                                                                                                                                                                                                   |
| `modificationTime` | `string (ISO 8601)`         | Set by Pass 1. Used with `size` to decide, on a later incremental "Compare", whether a cached checksum is still valid (research.md Decision 11).                                                                                                                                                              |
| `partialChecksum`  | `string \| null`            | SHA-256 hex of the first 64 KiB. `null` until Pass 2 actually needs it for a comparison (research.md Decision 3).                                                                                                                                                                                             |
| `fullChecksum`     | `string \| null`            | SHA-256 hex of the whole file. `null` until Pass 2 actually needs it.                                                                                                                                                                                                                                         |
| `checksummedAt`    | `string (ISO 8601) \| null` | When `partialChecksum`/`fullChecksum` were last (re)computed. `null` while both are `null`.                                                                                                                                                                                                                   |
| `hasReadError`     | `boolean`                   | `true` if Pass 2 tried and failed to read this specific file's content while checksumming (FR-011). Distinct from a sibling file's own status — unlike the directory-level `hasUnreadableEntries`, this is per-file. Reset to `false` whenever the file is relisted with a changed `size`/`modificationTime`. |

**Validation rules**:

- `path` MUST be an absolute path.
- `partialChecksum`/`fullChecksum` MUST both be recomputed (not reused) if
  `size` or `modificationTime` differs from the values recorded when they were
  last computed (research.md Decision 11).
- `fullChecksum` is never computed without `partialChecksum` already having been
  computed and having matched the other side's (research.md Decision 3's cascade
  order).

**Lifecycle**: A row is created/overwritten by Pass 1 every time the file is
(re)listed (size/mtime refreshed, checksums reset to `null` if size or mtime
changed since the previous row). Pass 2 may fill in
`partialChecksum`/`fullChecksum` afterward, only if the cascade for some
comparison actually reaches that stage for this file.

## DirectoryComparisonNode (persisted — SQLite table `directory_comparison_nodes`)

One row per directory path this tool has ever visited, on either side of any
comparison. Mirrors Count and Size's `DirectoryScanNode` (it extends the shared
`domain/scanning/scan-node-status.ts` `ScanNodeStatus` shape — `path`,
`parentPath`, `depth`, `ownOutcome`, `hasUnreadableEntries`) minus count/size
fields, plus a directory checksum.

| Field                  | Type                                          | Notes                                                                                                                                                                                                                                                                                                              |
| ---------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `path`                 | `string` (PK)                                 | Absolute path.                                                                                                                                                                                                                                                                                                     |
| `parentPath`           | `string \| null`                              | `null` only for `/`.                                                                                                                                                                                                                                                                                               |
| `depth`                | `integer`                                     | Distance from root `/`. Used by Pass 2's bottom-up (depth-descending) ordering — same technique as `deriveDoneSet`.                                                                                                                                                                                                |
| `ownOutcome`           | `'pending' \| 'error' \| 'stopped' \| 'done'` | Pass 1's own listing outcome for this directory (FR-011). Never reflects Pass 2 or descendants.                                                                                                                                                                                                                    |
| `hasUnreadableEntries` | `boolean`                                     | `true` if any direct child couldn't be listed (set by Pass 1's `recordDirectoryOwnResult`), or a direct file's content couldn't be read when Pass 2 tried to checksum it (set by Pass 2's separate `recordContentReadFailure`, which never touches `ownOutcome` — research.md Decision 3; FR-011).                 |
| `directoryChecksum`    | `string \| null`                              | Merkle-style hash of this directory's direct entries (name, type, checksum), written by Pass 2 **only** once every direct entry pair resolved `Matching` (research.md Decision 3). `null` otherwise — including for directories that resolved `Differs`, and for `hasUnreadableEntries`/incomplete ones (FR-011a). |
| `ownFinishedAt`        | `string (ISO 8601) \| null`                   | When `ownOutcome` left `'pending'` (Pass 1 only).                                                                                                                                                                                                                                                                  |

**Validation rules**:

- `directoryChecksum` MUST be `null` whenever `hasUnreadableEntries` is `true`
  for this node or any descendant (FR-011a), and MUST also be `null` whenever
  this directory's own comparison resolved `Differs` via a short-circuit that
  didn't require fully resolving every child (research.md Decision 3) — a
  non-`null` value is only ever written alongside a fully-confirmed `Matching`
  verdict for that specific pairing.
- `depth` MUST equal `parentPath === null ? 0 : parent.depth + 1`.

**Lifecycle** (own outcome, Pass 1 — independent of Pass 2):

```
(no row) --startComparison or spawned as child--> pending
pending --own listing succeeds--> done
pending --own listing fails (unreadable dir itself)--> error
pending --Stop pressed, or app restarts while pending--> stopped
done/error/stopped --Compare pressed again on a pair including this path--> pending (row refreshed)
```

`directoryChecksum` is set/cleared independently by Pass 2, after `ownOutcome`
reaches `done` for this node and every descendant.

## EntryComparisonResult (derived — never persisted)

What `GET /api/directory-comparison/status` returns per direct entry under the
currently-selected `(leftPath, rightPath)` pair (spec FR-007, Key Entity "Entry
Comparison Result"), computed fresh from both sides'
`DirectoryComparisonNode`/`FileChecksumEntry` rows.

**Pairing source**: which entries exist to pair (FR-006) is read from the _live
filesystem_ (`FileSystemPort.listChildren`), not from the comparison repository
— a pair that has never been Compared yet has no repository rows at all, but its
entries must still show `not_compared` rather than being silently omitted (found
missing during manual verification). The repository is only consulted, per
already-paired entry, for whatever checksum/outcome data actually exists.

| Field    | Type                                                                                                | Derivation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`   | `string`                                                                                            | Entry name, used to pair left/right (FR-006).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `kind`   | `'file' \| 'directory'`                                                                             | From whichever side has the entry (both, if paired).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `status` | `'not_compared' \| 'matching' \| 'differs' \| 'only_left' \| 'only_right' \| 'scanning' \| 'error'` | `only_left`/`only_right` if no counterpart row exists on the other side. `scanning` if Pass 1 or Pass 2 currently has this path as its active unit of work — for a directory entry, also when an active path is anywhere within its subtree (its own subtree "contains" the work); for a file entry, only an exact match (compare-subtree.ts reports the specific file pair being hashed once content actually needs reading, not just its containing directory) — see research.md Decision 3's addendum. `error` if, on either side: a file entry's own `hasReadError` is `true`; a directory entry's own `hasUnreadableEntries` is `true` (already inclusive of descendant issues — Pass 2 propagates the flag up the ancestor chain as it unwinds, FR-011a); or a directory entry's own `ownOutcome` is `'error'` (the directory itself couldn't be listed by Pass 1 — found missing during `/speckit-analyze` review: this case was previously falling through to `not_compared`, hiding a genuine read failure). Otherwise: for a file, compare `fullChecksum` (or the earliest cascade stage that already proved a difference) between sides; for a directory, `matching` iff its `directoryChecksum` is set and equal on both sides, `differs` otherwise once Pass 2 has resolved it, else `not_compared` — this last bucket also covers `ownOutcome === 'stopped'` (FR-014): there is no distinct "Stopped" entry status in FR-007's 6-value enum, so an interrupted comparison is deliberately indistinguishable from "never compared" here; pressing "Compare" again simply reprocesses it. |

This is exactly `domain/directory-comparison/entry-comparison-result.ts`'s
pairing-by-name logic (FR-006) combined with `checksum-cascade.ts`'s per-file
verdict (research.md Decision 3) — pure functions, no I/O.

## Pane state (in-memory client-side only — not an entity, not persisted server-side)

`infrastructure/directory-comparison/ui/directory-comparison-explorer.tsx` holds
`leftPath`, `rightPath`, `moveSync: boolean`, hydrated from `localStorage` via
`panes-storage.ts` (research.md Decision 9). This directly realizes the spec's
"Comparison Pair" and "Move Sync Setting" key entities — both explicitly
ephemeral (spec Assumptions).

## Comparison pass state (in-memory only — not persisted)

Two singletons, mirroring Count and Size's `ScanWorker` state section:

- `structural-scan-worker.ts` (Pass 1): the shared `ScanEngine`'s usual
  `activePath`/`stack` (research.md Decision 2) — unchanged shape from Count and
  Size.
- `comparison-pass-worker.ts` (Pass 2, research.md Decision 5):

```ts
interface ComparisonPassState {
  activePair: { leftRoot: string; rightRoot: string } | null;
  activePath: { left: string; right: string } | null; // the directory pair currently being resolved
  cancelled: boolean; // checked between each directory pair processed
}
```

Deliberately not persisted — same rationale as Count and Size's Decision 2:
anything mid-pass when the app restarts is surfaced as Stopped (FR-014), never
auto-resumed, so there is nothing for a persisted queue to recover.
