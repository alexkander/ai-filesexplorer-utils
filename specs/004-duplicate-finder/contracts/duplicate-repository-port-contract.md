# Contract: DuplicateRepositoryPort

This feature's persistence contract, defined in
`application/duplicate-finder/duplicate-repository-port.ts` and implemented once
by `infrastructure/duplicate-finder/duplicate-repository-adapter.ts` over
`data/duplicate-finder.sqlite` ([data-model.md](../data-model.md)).

Scoped to this feature's own schema — it is not a general-purpose store and is
substitutable independently of the other tools' repository ports (Principle
III).

## Shape

```ts
interface DuplicateRepositoryPort {
  // ---- scan lifecycle -------------------------------------------------
  getScanState(): ScanState;
  beginScan(rootPath: string, includeFolders: boolean): number; // returns the new scan_seq
  updateProgress(update: Partial<ScanProgress>): void;
  finishScan(state: 'finished' | 'stopped' | 'failed', message?: string): void;
  /** Startup reconciliation: a row left `running` by a dead process. */
  reconcileInterruptedScan(): void;

  // ---- phase 1: listing ----------------------------------------------
  upsertFileFacts(facts: FileFacts[], scanSeq: number): void;
  upsertDirectory(dir: DirectoryFacts, scanSeq: number): void;

  // ---- phases 2-4: hashing -------------------------------------------
  findSharedSizeCandidates(scanSeq: number): FileCandidate[];
  findSharedPartialCandidates(scanSeq: number): FileCandidate[];
  recordChecksums(path: string, checksums: RecordedChecksums): void;
  recordReadError(path: string): void;
  /** Paths whose full checksum is shared by >= 2 files of this scan — the
   * input to folder candidacy, available BEFORE any group is persisted. */
  findSharedContentPaths(scanSeq: number): Set<string>;

  // ---- phase 5: folders ----------------------------------------------
  listDirectoriesDeepestFirst(scanSeq: number): DirectoryRow[];
  getDirectChildren(path: string, scanSeq: number): DirectChildren;
  recordDirectoryResult(path: string, result: DirectoryResult): void;

  // ---- phase 6: results ----------------------------------------------
  findDuplicateFileGroups(scanSeq: number): DuplicateGroupWithPaths[];
  findDuplicateDirectoryGroups(scanSeq: number): DuplicateGroupWithPaths[];
  clearResults(): void;
  saveGroups(groups: DuplicateGroupWithPaths[], scanSeq: number): void;

  // ---- reads for the UI ----------------------------------------------
  listGroups(query: GroupQuery): { groups: DuplicateGroup[]; total: number };
  listOccurrences(checksum: string, kind: GroupKind): string[];
  countGroups(): number;

  // ---- ignore list ---------------------------------------------------
  listIgnoredPaths(): IgnoredPath[];
  loadIgnoredPathSet(): Set<string>;
  setIgnored(path: string, ignored: boolean): PruneCounts;
}
```

`GroupQuery` is
`{ sortBy: 'size' | 'occurrences'; sortDir: 'asc' | 'desc'; offset: number; limit: number }`.

Shape notes settled during implementation:

- `findSharedPartialCandidates` takes the partial-read threshold as its second
  argument. The threshold is a property of the checksum adapter, so hard-coding
  it in a SQL statement would put the same constant in two places.
- The grouping queries (`findDuplicateFileGroups` /
  `findDuplicateDirectoryGroups`) return each group **with its paths**, because
  a group is meaningless to the collapsing rule without them. They deliberately
  do not decide `isEmpty` for files: which digest means "no bytes" is a domain
  fact (`EMPTY_CONTENT_CHECKSUM`), not a storage one.
- `loadIgnoredPathSet` exists next to `listIgnoredPaths` because the scan needs
  a `Set` to match against once per entry, while the ignored-paths view needs
  the rows with their dates.
- `countGroups` backs the status endpoint's `groupCount`, which is what tells
  "no scan has been run yet" apart from "this scan found nothing" (FR-022).

## Rules a consumer can rely on

- **Batched writes are transactional.** `upsertFileFacts` and `saveGroups` run
  inside a single `db.transaction(...)`, so a crash mid-phase never leaves a
  half-written result set. `better-sqlite3` is synchronous, so this needs no
  locking beyond SQLite's own.
- **Checksums survive a re-scan, stale facts do not.** `upsertFileFacts`
  preserves `partial_checksum`/`full_checksum`/`checksummed_at` only when both
  the incoming `size` and `modification_time` equal the stored ones, and nulls
  them otherwise. That single rule is what makes SC-009 (a second scan is
  faster) safe.
- **`findSharedSizeCandidates` never returns a file with a unique size**, and
  `findSharedPartialCandidates` never returns one whose
  `(size, partial_checksum)` pair is unique or whose size is at or below the
  partial threshold (those already have their full checksum — research.md
  Decision 5). The cascade guarantee of FR-013 lives in these two queries.
- **`saveGroups` never writes a group with fewer than two occurrences**, and
  `listGroups` never returns one. The invariant holds after `setIgnored` too.
- **`setIgnored(path, true)` owns the whole mark-and-prune operation**: it
  writes the ignore row, removes every occurrence at or beneath `path`,
  decrements the affected groups, deletes any group left below two occurrences
  (FR-026) and returns the removed counts — all in one transaction. There is
  deliberately no separate `removeOccurrencesUnder`: splitting the write across
  two calls would let a caller leave the ignore row and the result set out of
  step. `setIgnored(path, false)` only removes the ignore row — it never
  resurrects results, which is why FR-027 says an un-ignored path comes back on
  the _next_ scan.
- **Every result read is scoped to the current scan.** `listGroups`,
  `listOccurrences` and the group `total` all filter on `scan_state.scan_seq`,
  so results written by an earlier scan of a different root are invisible the
  moment `beginScan` bumps the counter — including when a scan fails, or the
  process dies, before phase 6 ever runs. `clearResults` physically removes them
  at the start of the next successful grouping pass; the `scan_seq` filter is
  what makes the window in between safe.
- **`listGroups` is ordered totally**: the sort key plus `checksum` as a
  tiebreaker, so paging never skips or repeats a row when two groups tie
  (research.md Decision 11). `total` accompanies the page so the UI can render
  page controls without a second round trip.
- **Ascending is the exact reverse of descending**, tie-break included:
  `ORDER BY size DESC, checksum ASC` versus `ORDER BY size ASC, checksum DESC`.
  That is deliberate — SQLite serves the reversed form by scanning the same
  index backwards, whereas tie-breaking ascending on `checksum ASC` mixes
  directions within one `ORDER BY` and forces a temp b-tree sort of the whole
  result set (confirmed with `EXPLAIN QUERY PLAN` against 100 000 groups).
- **`clearResults` only clears the derived tables** (`duplicate_groups`,
  `duplicate_occurrences`). It never touches `scanned_files`, which is the
  cross-scan cache.
- **The port never touches the filesystem**, and never opens any database other
  than this feature's own.
