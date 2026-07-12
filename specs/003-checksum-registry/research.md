# Phase 0 Research: Directory Comparison Tool

All Technical Context items are resolved below; no `NEEDS CLARIFICATION` markers
remain.

## Decision 1: SQLite via `better-sqlite3`, own database, two tables

**Decision**: Persist to `data/directory-comparison.sqlite` (env override
`DIRECTORY_COMPARISON_DB_PATH`, same pattern as Count and Size's
`COUNT_AND_SIZE_DB_PATH`), entirely separate from `data/count-and-size.sqlite`.
Two tables:

- `directory_comparison_nodes` — one row per directory ever visited by this tool
  on either side. Mirrors Count and Size's `directory_scan_nodes` shape (`path`,
  `parent_path`, `depth`, `own_outcome`, `has_unreadable_entries`,
  `own_finished_at`) minus the count/size columns, plus a nullable
  `directory_checksum` column (see Decision 3 for why it's nullable).
- `file_checksums` — one row per file path ever visited: `path` (PK), `size`,
  `modification_time`, nullable `partial_checksum`, nullable `full_checksum`,
  `computed_at`.

Both tables are keyed purely by absolute `path`, with no column identifying
"which side" or "which comparison pair" a row belongs to — a path visited once
(as part of any comparison) is reusable by any later comparison that happens to
involve it again (spec Assumptions: no comparison-history feature, but per-path
checksums persist independently of pairing).

**Rationale**: Matches Count and Size's Decision 1 precedent (own embedded
SQLite, `better-sqlite3`, no new dependency) and the spec's explicit requirement
(FR-015) that this tool's persistence stay independent of Count and Size's.

**Alternatives considered**: A single combined table with a nullable "checksum"
column covering both files and directories (rejected — files and directories
have genuinely different fields, e.g. two-stage partial/full checksums only make
sense for files; interface segregation favors two narrow tables over one wide
one with many always-null columns).

## Decision 2: Reuse the shared `ScanEngine` unchanged for structural listing (Pass 1)

**Decision**: `structural-scan-worker.ts` instantiates
`infrastructure/scanning/scan-engine.ts`'s `ScanEngine` exactly as Count and
Size does, with `comparison-repository-adapter.ts` and a per-node step
(`application/directory-comparison/list-entries.ts`) that calls the shared
`traverseDirectory` and then only: persists a `file_checksums` row per direct
file (`size`/`modification_time` known from listing;
`partial_checksum`/`full_checksum` left `null` — no hashing here),
`upsertPending`s each subdirectory, and records the directory's own
`done`/`error` outcome. `start-comparison.ts` calls `enqueue()` on this one
engine instance for **both** the left and right root paths, always with
`mode: 'full'` — Pass 1 always re-lists everything in scope on every "Compare,"
regardless of the incremental/full choice the user made (see Decision 11 for
why: unlike Count and Size, this feature cannot skip re-listing a subdirectory
just because it succeeded before, since doing so would prevent ever detecting a
later file change). Enqueuing both roots on this one engine instance still
satisfies FR-010 ("only one active comparison scan within this tool") with no
new coordination code; the two subtrees interleave arbitrarily on the same
stack, which is fine because Pass 1 does no cross-side comparison. When
`leftPath === rightPath` (comparing a directory against itself, spec Edge
Cases), the same path is enqueued twice in the same run;
`upsertPendingDirectory`/`upsertFileFacts` are ordinary SQL upserts keyed by
`path`, so the second write simply overwrites the first with equivalent data —
safe, no duplicate-key error, no special-casing needed.

**Rationale**: This is exactly what the scan-engine extraction (PR #6) was built
for — a second feature supplying its own per-node step without duplicating
traversal/stop/resume machinery. Pass 1 deliberately does **not** reuse
`ScanEngine`'s incremental (`doneSet`-based) skip-relisting capability the way
Count and Size does — see Decision 11 for why that specific optimization is
wrong for this feature.

**Alternatives considered**: Two separate `ScanEngine` instances, one per side
(rejected — would need extra coordination to enforce "one active operation"
across two singletons, for no benefit, since Pass 1's per-node work never needs
to look at the other side anyway).

## Decision 3: Two-pass design — structural listing, then a bottom-up cascading comparison

**Decision**: "Compare" is one user-facing action but two chained internal
passes:

- **Pass 1** (Decision 2): list both subtrees; persist file sizes/mtimes; no
  content read.
- **Pass 2** (`compare-subtree.ts`, run by `comparison-pass-worker.ts`, started
  automatically once Pass 1 settles for both roots): walks the two now-listed
  subtrees **bottom-up**, deepest directories first (same depth-descending
  technique `domain/scanning/derive-done-set.ts` already uses), applying a
  **cascading, short-circuiting** comparison at every level:
  1. Pair direct entries by name (FR-006). Any name present on only one side is
     immediately `Only on this side` — no read of any kind.
  2. For a paired **file**: if sizes differ → `Differs`, done (no hash ever
     computed for that file — this is what makes SC-004 hold: a file with no
     same-size counterpart on the other side is never even partially-hashed). If
     sizes match, compute (or reuse a cached) partial checksum for both sides
     via `ChecksumPort`; differ → `Differs`, done. If partial checksums match,
     compute (or reuse) the full checksum for both sides; compare → `Matching`
     or `Differs`.
  3. For a paired **directory**: recurse into this same algorithm one level
     deeper first. The directory pair is `Matching` **iff every** direct child
     pair resolved `Matching` and neither side has an extra/missing entry;
     otherwise `Differs`.
  4. **Only when a directory pair resolves `Matching`** does Pass 2 compute and
     persist that directory's `directory_checksum` (Merkle-style: hash of the
     sorted `(name, type, checksum)` list of its direct entries,
     `derive-directory-checksum.ts`) — identically on both sides, since a
     `Matching` verdict means the two sides' entry lists and every child
     checksum are already known to be identical. A directory pair that resolves
     `Differs` via an early short-circuit (e.g. one file's size already proved a
     mismatch three levels down) never gets a computed `directory_checksum` on
     either side — it stays `null` (same "absent but the status is still
     definite" shape FR-011a already uses for unreadable/incomplete
     directories), because computing one would require fully hashing content
     that was never necessary to read to already know the answer.

**Rationale**: This is the crux of reconciling two requirements that are in
tension if taken naively: FR-004/FR-005 describe a directory checksum "derived
only from its direct entries" (implying a real Merkle hash value per directory,
useful for future incremental re-comparison, FR-008), while FR-003 and SC-004
require that a file with no same-size counterpart is **never** read for content
— including never being folded into some ancestor directory's hash. A literal
"always compute a full Merkle hash for every directory, then compare hashes"
implementation would violate SC-004, because building any directory's hash would
require the full checksum of every descendant file, defeating the whole
cascading-comparison point. Cryptographic hash equality and "every descendant
matches, recursively" are mathematically equivalent notions of "identical
content" — so the recursive short-circuiting check produces exactly the same
`Matching`/`Differs` verdicts a full-Merkle-then-compare approach would, while
doing strictly less (or equal) hashing work, and it still leaves a real,
reusable `directory_checksum` behind for the one case (confirmed `Matching`)
where that value is actually cheap to obtain as a byproduct and actually useful
(FR-008 incremental skip on a later "Compare" of the same, still-unchanged
pair).

**Alternatives considered**: Compute a comparison-independent
`directory_checksum` for every directory unconditionally, on both sides, before
comparing (rejected — violates SC-004 as explained above; also pointless extra
work for pairs that already differ at a shallow level). Doing Pass 2 as a second
lap through the same top-down `ScanEngine` (rejected — `ScanEngine`'s walk order
is top-down, single-path-at-a-time, and Pass 2 fundamentally needs both sides'
already-listed data at each level before it can proceed bottom-up; forcing it
into the top-down shape would need a directory to be "revisited" after all its
children finish, which the existing engine has no mechanism for — see Decision
5).

## Decision 4: `ChecksumPort` — streamed SHA-256, one algorithm for both stages

**Decision**: A new port, `application/directory-comparison/checksum-port.ts`:

```ts
interface ChecksumPort {
  computePartialChecksum(path: string): Promise<string>;
  computeFullChecksum(path: string): Promise<string>;
}
```

Implemented in `infrastructure/directory-comparison/checksum-adapter.ts` using
`fs.createReadStream` piped into `crypto.createHash('sha256')` —
`computePartialChecksum` reads only the first 64 KiB (stream destroyed after
that many bytes), `computeFullChecksum` streams the whole file. Both return a
hex digest.

**Rationale**: SHA-256 for both stages avoids adding a second hashing dependency
(e.g. a non-cryptographic fast hash like xxHash) purely for the partial stage —
Node's built-in `crypto` is already sufficient, keeping Constitution Principle I
intact (no new dependency at all for this feature). 64 KiB is large enough to
almost always distinguish genuinely different files cheaply (most file-format
headers/magic bytes and initial content differ within the first few KB) while
staying tiny relative to any file large enough for the cascade to matter.
Streaming (not `fs.readFile`) keeps memory flat regardless of file size,
satisfying SC-004's spirit even for the full-checksum stage on large files that
do turn out to need it.

**Alternatives considered**: A separate fast, non-cryptographic checksum (e.g.
CRC32/xxHash) for the partial stage (rejected — new dependency for marginal
speed gain on 64 KiB reads, which are already fast with SHA-256; YAGNI). Reading
the whole file into memory with `fs.readFileSync` before hashing (rejected —
defeats the point of avoiding full reads for files that don't need it, and risks
large memory spikes on big media files).

## Decision 5: Pass 2 is its own lightweight worker, not another `ScanEngine`

**Decision**: `comparison-pass-worker.ts` is a small, purpose-built singleton —
not an instance of the shared `ScanEngine` class — that: holds
`activeParticipants: {leftRoot, rightRoot} | null` (mirrors `getActivePath()`'s
role for `/status` polling), walks the two subtrees' already-persisted
`directory_comparison_nodes`/`file_checksums` rows bottom-up (depth-descending),
checks a cancellation flag between each directory pair (FR-013), and is started
by `start-comparison.ts` immediately after Pass 1's `ScanEngine` reports
`getActivePath() === null` for this comparison's two roots.

**Rationale**: The shared `ScanEngine`/`ScanStack` (Decision 2) is correctly
generic for **top-down, single-path-at-a-time** traversal — every tool built on
it so far (Count and Size, this tool's own Pass 1) fits that shape. Pass 2 does
not: it needs a directory's children already resolved before it can process that
directory, i.e. bottom-up, and it needs **two** paths (one per side) in view
simultaneously to pair entries. Forcing this into `ScanEngine`'s shape would
require a fundamentally different traversal primitive, which would stop being
the same generic engine Count and Size relies on — better to keep `ScanEngine`
unchanged and general, and give Pass 2 its own small, purpose-specific loop.

**Alternatives considered**: Generalizing `ScanEngine` to support a "revisit
parent after children complete" callback (rejected — no other current tool needs
this, and Constitution Principle I says not to build generality ahead of a
second real need; Count and Size's own aggregation already proved read-time
computation over a flat query is sufficient for its needs, so retrofitting
bottom-up composition into the shared engine for this one feature isn't
justified).

## Decision 6: Relocate `filesystem-adapter.ts` into `infrastructure/scanning/`

**Decision**: Move `infrastructure/count-and-size/filesystem-adapter.ts` to
`infrastructure/scanning/filesystem-adapter.ts` (no content changes — it was
already 100% generic `fs.readdir`/`stat` logic with zero count/size awareness).
Both Count and Size and this feature import the same `filesystemAdapter`
singleton for Pass 1's traversal and for plain browsing/listing
(`list-directory.ts`).

**Rationale**: This adapter was missed in the PR #6 scan-engine extraction —
it's exactly as generic as `ScanStack`/`ScanEngine`/`traverseDirectory`, which
were all moved to `infrastructure/scanning/`/`application/scanning/` at the
time. Reusing the single existing implementation avoids duplicating ~20 lines of
`fs.readdir`+`Dirent`+`stat` logic a second time for no behavioral difference
(Constitution Principle I).

**Alternatives considered**: A second, near-identical adapter under
`infrastructure/directory-comparison/` (rejected — pure duplication of
already-shared, already-generic code).

## Decision 7: Comparison view computed at read time; no persisted "comparison pair"

**Decision**: `get-comparison-view.ts` (backing
`GET /api/directory-comparison/status`) takes `(leftPath, rightPath)` and, for
each direct entry under them, returns an `EntryComparisonResult` derived fresh
from whatever `directory_comparison_nodes`/`file_checksums` rows currently exist
for both sides — the same "derive at read time from persisted per-node facts"
pattern Count and Size uses for `DirectoryView` (its Decision 1). No table
stores "the result of comparing A against B" — only each side's own
structural/checksum facts are persisted, keyed by path alone. The
currently-selected left/right pair is pure client-side state
(`panes-storage.ts`), never sent to a "start a named comparison" endpoint that
would need a durable identity.

**Rationale**: Directly implements the spec's Assumption that "Comparison Pair"
is ephemeral, and reuses an already-proven pattern (Count and Size Decision 1)
rather than inventing a new one. It also means switching which two directories
are being compared never invalidates or duplicates already-computed checksums
for paths that happen to recur in a new pairing — they're simply reused
(FR-008).

**Alternatives considered**: A persisted `comparison_pairs` table recording each
requested (left, right) pair and its outcome (rejected — no spec requirement for
comparison history, and Constitution Principle I).

## Decision 8: Route Handlers for the tool's API surface

**Decision**: `app/api/directory-comparison/`: `GET /list` (paginated listing
for one pane, no comparison data — Story 1), `GET /status` (current
`EntryComparisonResult`s for a `(left, right)` pair plus overall Pass 1/2
progress, used for the initial view and for polling), `POST /compare` (start
both passes for a pair; `mode: 'incremental' | 'full'`), `POST /stop` (cancel
whichever pass is active).

**Rationale**: Mirrors Count and Size's Decision 4 exactly (same reasoning:
poll-able `GET`s for live status, plain `POST`s for the two mutating actions) —
proven pattern, no reason to deviate.

## Decision 9: Pane paths and Move sync remembered client-side

**Decision**: `infrastructure/directory-comparison/panes-storage.ts` persists
`{ leftPath, rightPath, moveSync }` to `localStorage`, hydrated in an effect on
mount (hydration-mismatch-safe, same pattern as Count and Size's
`last-path-storage.ts`/`sort-preference-storage.ts`). Neither path nor the
toggle state is reflected in the URL, consistent with Count and Size's FR-005a
precedent.

**Rationale**: Same rationale as Count and Size Decision 5 — a single-user,
client-rendered UI convenience value, not scan data; no new server-side
persistence surface warranted.

## Decision 10: Pagination reuses Count and Size's parameters

**Decision**: `GET /list` accepts `offset`/`limit` (default `limit` 200, same as
Count and Size — spec FR-001 explicitly inherits FR-001a), returning
`{ entries, hasMore }`. Applied independently per pane.

**Rationale**: Consistency with the tool the spec explicitly ties this one's
browsing UX to; no reason to pick different constants.

## Decision 11: Incremental vs. full — Pass 1 always relists; the skip lives entirely in Pass 2

**Decision (revised)**: Pass 1 does **not** implement an incremental mode at all
— it always fully re-lists every directory in the requested subtree on every
"Compare" (`upsertFileFacts` for every direct file, refreshing
`size`/`modificationTime`; `recordDirectoryOwnResult` for every directory),
regardless of whether the user chose the default "Compare" or "Force full
re-compare." This is cheap (`readdir`+`stat` only, no content read) and is
required to detect on-disk changes at all — `FR-008` requires skipping a file's
checksum recomputation only when its size/mtime are _unchanged since last
computed_, and skipping a subdirectory only when it _"remains unaffected by any
change beneath it"_; both phrases require freshly re-checking disk state on
every "Compare," not trusting that a prior successful listing is still accurate.

`mode: 'incremental'` (default, spec FR-008) vs. `mode: 'full'` (the "Force full
re-compare" action, spec FR-009 — always both sides together) only changes
**Pass 2's** behavior, after Pass 1's fresh listing:

- `'incremental'`: for each directory pair, walking bottom-up, Pass 2 treats a
  cached `directory_checksum` as still valid — and skips re-deriving it —
  **iff**, for every direct entry: a file's `checksummedAt` is not older than
  its (just-refreshed by Pass 1) `modificationTime`, and a subdirectory's own
  `directory_checksum` is itself still valid by this same check (recursively)
  and non-`null`. If valid on both sides and equal, the pair is `Matching`
  without recomputing anything. The first invalid or missing entry at any level
  ends the shortcut for that pair — the ordinary cascade (Decision 3) then runs
  for whatever wasn't already confirmed valid, exactly the entries actually
  affected by a change, not the whole subtree.
- `'full'`: clears `partialChecksum`/`fullChecksum` on every `file_checksums`
  row and `directoryChecksum` on every `directory_comparison_nodes` row in both
  subtrees before Pass 2 runs, forcing the cascade to redo everything.

**Rationale**: Directly implements FR-006/FR-008/FR-009 — and specifically
avoids a bug the original version of this decision had: reusing `ScanEngine`'s
`doneSet`-based skip-relisting (as Count and Size's own "Scan" does) would mean
a directory, once successfully listed, is **never re-listed again** on a later
"Compare" — Count and Size's own spec explicitly accepts this as a known
limitation for its use case ("a subdirectory that stays
Completed-and-not-incomplete is never revisited even if its on-disk contents
change later"). That's fine for Count and Size, whose numbers don't need to
detect content changes — but it directly breaks this feature's core promise:
FR-008 and the whole point of "Compare" require noticing when a file changed.
Keeping Pass 1 unconditional and moving the actual skip logic into Pass 2 (which
already has to inspect every level's data to build `EntryComparisonResult`s)
achieves the same "no redundant work" goal (SC-005) without that gap.

**Alternatives considered**: Reusing `deriveDoneSet` for Pass 1 as originally
planned (rejected — see Rationale; found during `/speckit-analyze` review as a
correctness bug, not merely a style choice). Making Pass 1 itself decide what's
"changed" and only tell Pass 2 about affected paths (rejected — would duplicate
the validity check Pass 2 already needs to do bottom-up for its own cascade;
simpler to let Pass 2 read Pass 1's always-fresh facts directly than to invent a
separate change-notification channel between the two passes).
