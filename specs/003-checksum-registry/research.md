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
later file change). Enqueuing both roots of the **same** comparison on this one
engine instance needs no extra coordination — the two subtrees interleave
arbitrarily on the same stack, which is fine because Pass 1 does no cross-side
comparison. (This alone does **not** fully satisfy FR-010 across **different**
"Compare" requests — see Decision 12 for the piece that does.) When
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

**Addendum — per-file progress (added post-implementation)**: `compareSubtree`'s
`onProgress` callback was originally called only once per directory pair (at the
top of each recursive call). Found insufficient during manual verification: a
single large file with no cheap way to prove a difference (same size, same
partial hash) can take many seconds to fully hash, during which the UI had no
way to distinguish "actively reading this exact file" from "queued, will get to
it soon" for every other unresolved sibling in the same directory.
`compareFilePair` now also calls `onProgress` with the specific file pair's
paths, but only once the cascade actually needs to read content
(`need_partial`/`need_full`) — never for a pair that resolves via size alone,
keeping SC-004's "never touch a file that doesn't need reading" guarantee
intact. `get-comparison-view.ts` uses this for an exact-path match on file
entries (not a subtree-containment check like it uses for directories), so only
the one file genuinely being hashed shows `scanning`.

**Addendum — per-pane, relative active-path display (added
post-implementation)**: `GET /status`'s `activePath` was initially rendered as
one combined line (`comparison-status-panel.tsx`, absolute `left ↔ right` paths)
in the shared top toolbar. Moved into each pane's own header instead —
`left`/`right` each show their own active path, computed relative to that pane's
own currently-displayed directory (`directory-comparison-explorer.tsx`'s
`activePathForSide`), not the tool-wide absolute path. The API response shape is
unchanged; only which component renders it, and how, moved.

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

**Revision (found during manual verification)**: which entries exist to _pair_
(FR-006) is **not** taken from the repository as originally stated above — a
pair that has never been Compared yet has zero repository rows for either side,
which made `/status` return an empty entry list instead of every live entry
shown as `not_compared` (violating FR-007's "before any Compare has ever run"
requirement). Pairing is instead read from a live `FileSystemPort.listChildren`
call on each side; the repository is still consulted exactly as described above,
but only per already-paired entry, for whatever checksum/outcome data happens to
exist. See `data-model.md`'s "Pairing source" note.

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

## Decision 12: `ComparisonQueue` serializes whole "Compare" pipelines across different requests

**Decision (added post-implementation)**: Decision 2's claim that sharing
`ScanEngine` satisfies FR-010 "with no new coordination code" only covers one
comparison's own two roots interleaving on the same stack — it says nothing
about **two different** `POST /compare` requests (different pairs) arriving
close together. A new class, `ComparisonQueue`
(`application/directory-comparison/start-comparison.ts`, instantiated as a
singleton in `infrastructure/directory-comparison/comparison-queue.ts`), owns a
simple FIFO queue of `{ leftPath, rightPath, mode }` requests and runs them one
at a time: enqueue both roots on `structuralScanWorker`, poll
`comparisonRepositoryAdapter.getSubtree()` until neither root has a `'pending'`
node left (Pass 1 settled), then `await comparisonPassWorker.run(...)` (Pass 2)
before starting the next queued request. This is the actual mechanism that
satisfies FR-010 ("only one active comparison scan... requests enqueued, not run
concurrently or discarded") for the cross-request case; `comparisonPassWorker`
itself (Decision 5) intentionally has no queue of its own — it only supports one
`run()` at a time by contract, relying entirely on `ComparisonQueue` never
calling it again before the previous call resolves.

**Rationale**: FR-010 is explicit that a second `POST /compare` while one is
active "MUST be enqueued, not run concurrently or discarded" — this has to hold
regardless of whether the two requests share any path. Without
`ComparisonQueue`, two different pairs' Pass 1 roots would correctly interleave
on the shared engine (harmless), but their Pass 2 runs (`comparisonPassWorker`,
a single mutable-state singleton) would race and corrupt each other's
`activePair`/ `activePath`/cancellation-key bookkeeping.

**Alternatives considered**: Giving `comparisonPassWorker` its own internal
queue instead (rejected — `ComparisonQueue` already needs to sequence the
Pass-1-settle wait before Pass 2 can even start, so a second, separate queue one
layer down would be redundant bookkeeping for the same "one full pipeline at a
time" invariant).

## Decision 13: Extending the shared `FileSystemPort` for this feature's needs

**Decision (added post-implementation)**: Two additive changes were made to
`application/scanning/filesystem-port.ts` (shared with Count and Size, spec 002)
to support this feature:

- `RawEntry` gained an optional `modificationTime?: string` field (ISO 8601,
  files only), populated by `infrastructure/scanning/filesystem-adapter.ts` from
  `fs.Stats.mtime`. Needed because `FileChecksumEntry.modificationTime`
  (Decision 11's incremental-validity check) has no other source — Count and
  Size never needed a file's mtime, only its size.
- `ListChildrenOutcome`'s failure `reason` was split from a single
  `'unreadable'` value into `'not_found' | 'unreadable'`, so `GET /list` can
  return the `404`/`403` split its contract already specified. Count and Size's
  own `GET /list` route ignores the distinction and keeps returning a single
  `404` for either reason, so this is non-breaking for it.

**Rationale**: Both fields are optional/additive — no existing caller
(`application/count-and-size/*`) reads either new field, so Count and Size's
behavior is unchanged. Mirrors Decision 6's precedent of extending/relocating
shared `scanning` infrastructure rather than forking a second near-duplicate
implementation.

**Alternatives considered**: A second, feature-owned `FileSystemPort`
implementation with the extra fields (rejected — duplicates ~20 lines of
`fs.readdir`/`stat` logic for two small additive fields, the exact Constitution
Principle I violation Decision 6 already rejected once).

## Decision 14: `CopyPort` — a narrow, additive-only write action (added post-implementation)

**Decision**: For an "Only on this side" entry (spec FR-018, user request), a
Copy button (`comparison-pane.tsx`) offers to copy it — recursively, if a
directory — to the corresponding path on the other side. A new port,
`application/directory-comparison/copy-port.ts`
(`copy(sourcePath, destinationPath): Promise<CopyOutcome>`), kept entirely
separate from `FileSystemPort` (read-only, shared with Count and Size) and
`ChecksumPort` (content hashing) — interface segregation, since this is a
different capability (writing) with a different risk profile. Implemented by
`infrastructure/directory-comparison/copy-adapter.ts` via `fs.promises.cp` (Node
built-in, no new dependency),
`{ recursive: true, errorOnExist: true, force: false }` — refuses to overwrite
anything, backed up by an explicit pre-check that the destination doesn't
already exist. The UI (`directory-comparison-explorer.tsx`) requires a
`window.confirm()` before ever calling `POST /api/directory-comparison/copy`,
and bumps the destination pane's own refresh token afterward so the new entry
shows up without a full page reload.

**Rationale**: This is the first (and, per spec FR-018's scope, only)
filesystem-writing action in this tool — everything else (Pass 1, Pass 2,
`GET /list`, `GET /status`) is strictly read-only. Constitution Principle V
("Safe-by-Default Destructive Operations") literally covers "deletes, moves,
overwrites, or merges" — a copy that refuses to run if the destination exists
does none of those, so it isn't strictly in scope. The confirmation prompt is
still included anyway, matching the principle's spirit: this writes to the
user's real files, and a wrong click (wrong entry, wrong direction) is exactly
the kind of mistake a confirmation step catches cheaply. No separate dry-run
preview screen was built — for a single named entry (not a bulk merge), the
confirm dialog's message (`source path → destination path`) already states the
entire scope of what will happen, so a dedicated preview UI would be pure
ceremony for no added clarity (Constitution Principle I).

**Alternatives considered**: Allowing the copy to overwrite an existing
destination (rejected — destination existing at all breaks the "Only on this
side" premise the button is offered under: if the compare's live-filesystem
listing said the name doesn't exist on the other side, but the actual copy
attempt finds it does, something changed concurrently, and silently overwriting
would be a real overwrite of a Principle-V-protected kind). Reusing
`FileSystemPort` for this by adding a `copy` method to it (rejected —
`FileSystemPort` is shared with Count and Size, which has no use for a write
capability at all; adding it there would violate interface segregation,
Constitution Principle III, for the sake of avoiding one small new port).

## Decision 15: Stop (FR-013) — two independent bugs found and fixed post-implementation

**Bug 1 — cancellation never reached an in-progress file's checksum read**:
`compare-subtree.ts`'s `isCancelled()` callback (its original form) was only
checked between pairs — at the top of `compareSubtree` and before each loop
iteration — never inside `compareFilePair`'s own cascade loop or during the
`await` on a `ChecksumPort` call. Found via manual verification: comparing two 5
GB identical files, pressing Stop mid-hash had **zero** effect — the compare ran
to completion (several more seconds) as if Stop had never been pressed. **Fix**:
replaced the boolean callback with a real `AbortSignal`, threaded all the way
into `ChecksumPort.computePartialChecksum`/`computeFullChecksum`
(`infrastructure/directory-comparison/checksum-adapter.ts` passes it straight to
`fs.createReadStream`'s own `signal` option, which destroys the stream and
rejects immediately on abort). `comparisonPassWorker.run()` now owns an
`AbortController` per run, aborted by `requestStop`. `compare-subtree.ts`'s
`computeStageOrError` distinguishes an abort-caused rejection from a genuine
read failure via `signal.aborted`, so a cancelled file is never falsely flagged
with `hasReadError` (FR-011 is about real I/O failures, not Stop).

**Bug 2 — `requestStop` required an exact root-path match**:
`comparisonPassWorker.requestStop(leftRoot, rightRoot)` compared its arguments
for exact equality against `activePair`. Since the Stop button's own visibility
(`get-comparison-view.ts`'s `comparisonActive`) uses a looser `isWithinSubtree`
check (shows Stop whenever the active path is anywhere within the _currently
viewed_ pane paths, not only when viewing the exact original roots), a user who
pressed "Compare" and then navigated a pane up to an ancestor directory would
see a Stop button that silently did nothing when clicked. **Fix**: `requestStop`
(and `stop-comparison.ts`'s `pass2WasActive` computation, for a consistent
`{ stopped: boolean }` response) now use the same `isWithinSubtree`-based,
either-side-qualifies check the button's visibility already used — added
`isWithinSubtree` to `domain/scanning/path-info.ts` as a shared utility
(previously duplicated locally in `get-comparison-view.ts` and
`directory-comparison-explorer.tsx`; both now import it instead).

**Side effect surfaced by Bug 1's fix, found and fixed in the same pass**: once
Stop could actually interrupt a directory pair mid-comparison, a genuinely new
issue became easy to trigger: the cancelled (or simply not-yet-reached, in a
still-running compare) directory showed `Differs` instead of `Not compared`.
Root cause: `directoryChecksum === null` was being treated as synonymous with
"confirmed Differs" in `get-comparison-view.ts`, but it's also the value for a
pair Pass 2 has never actually concluded anything about — the schema had no way
to distinguish the two. **Fix**: added `resolvedByPass2: boolean` to
`DirectoryComparisonNode` (`resolved_by_pass2` column, migrated via
`ALTER TABLE` for existing databases), set `true` by `recordDirectoryChecksum`
(called for both the Matching and Differs outcomes), left untouched by Pass 1
relistings (sticky, per FR-016 — a fresh listing shouldn't erase Pass 2's last
real conclusion), and reset to `false` only by `clearChecksumsInSubtree`
(`mode: 'full'`) or when a row is first created. `get-comparison-view.ts` now
checks `resolvedByPass2` before falling back to the `directoryChecksum`
matching/differs comparison.

**Rationale**: All three fixes directly serve FR-013 ("using it MUST cancel
further processing... without losing already-computed results") and FR-014's
"unresolved entries left in their prior status" — none of this was reachable as
clearly before Bug 1's fix made Stop responsive enough to actually observe
mid-file cancellation in practice.

**Alternatives considered**: For Bug 2, making the Stop button's visibility
check exact-match too (rejected — that changes user-facing behavior for the
worse: today's looser matching is what lets a user navigate up a level while
comparing and still stop it, which is the more useful default). For the
`resolvedByPass2` fix, deriving "confirmed Differs vs. never compared" at read
time by recursively inspecting descendants instead of persisting a flag
(rejected — would require an unbounded-depth query on every `GET /status` call
just to render one directory entry's dot color; the flag costs one extra column
and is set for free at the same moment `recordDirectoryChecksum` already runs).

## Decision 16: `activePath` shown relative to the comparison's own roots, not the viewed panes' paths

**Decision (added post-implementation, user request)**: Decision 3's addendum
(per-pane relative active-path display) originally computed each pane's relative
path against that pane's own currently-displayed directory
(`leftPath`/`rightPath`) — meaning the indicator disappeared entirely the moment
the user navigated a pane away from the directories actually being compared
(e.g. to browse something else while a large "Compare" runs in the background).
Fixed by exposing the comparison's own roots directly: a new
`ComparisonQueue.getActivePair(): { leftRoot; rightRoot } | null` (the pair
`runOne` is currently processing — spans both Pass 1 and Pass 2, unlike
`structuralScanWorker`'s or `comparisonPassWorker`'s own narrower per-pass
state), threaded through `getComparisonView` as a new `activePair` field on
`ComparisonView`. `directory-comparison-explorer.tsx`'s `activePathForSide` now
computes each side's relative path against `activePair.leftRoot`/ `rightRoot`
unconditionally, never against the pane's own path — so the indicator stays
visible and accurate regardless of navigation on either side.

**Rationale**: The whole point of this indicator (Decision 3's addendum) was to
answer "is it actually doing something, and where" without requiring the user to
stay parked on the exact directories being compared — gating it on the viewed
pane's own path defeated that purpose for the most common case where it matters
(a long-running compare on a large tree, browsed away from during the wait).

**Alternatives considered**: Keeping the pane-relative computation as a fallback
when the viewed path happens to match (rejected — added complexity for no
benefit; showing the same value regardless of navigation is simpler and equally
correct, since `activePair` is authoritative either way).

## Decision 17: Read-only Count and Size overlay via a second, separate SQLite connection

**Decision (added post-implementation, user request)**: Directory entries now
show Count and Size's own aggregated file count/size, when that tool has scanned
the exact path, as a read-only overlay in `GET /list`'s response. A new port,
`application/directory-comparison/size-info-port.ts`
(`getSizeInfo(path): SizeInfo | null`), implemented by
`infrastructure/directory-comparison/count-and-size-readonly-adapter.ts`, which
opens a **second** `better-sqlite3` connection directly to
`COUNT_AND_SIZE_DB_PATH` (same env var/default path Count and Size's own
`sqlite-client.ts` uses) with `{ readonly: true, fileMustExist: true }`.
`list-directory.ts` calls it once per directory entry on the returned page. The
aggregation query (recursive CTE summing `direct_file_count`/ `direct_file_size`
over the subtree, plus a `MIN(...)` trick for the `incomplete` flag) is written
directly in the adapter rather than importing
`domain/count-and-size/derive-directory-view.ts` — a deliberate, small
duplication of ~15 lines to avoid a cross-feature-slice dependency (every other
tool boundary in this codebase only shares the intentionally-generic
`domain/scanning` module; `derive-directory-view.ts` is Count-and-Size-specific
by both name and by operating on that tool's own `DirectoryScanNode` shape).

**Rationale**: `readonly: true` is enforced by the SQLite driver itself, not
merely by this adapter's code never issuing a write statement — the strongest
guarantee available for the user's explicit "solo lectura" requirement, and
verified directly (a write attempt against a `{readonly:true}` connection throws
`SQLITE_READONLY`, confirmed during manual verification). Opening a plain second
connection (rather than, say, routing through Count and Size's own
application/domain layers) keeps this a pure infrastructure-layer integration
between two independent SQLite files — consistent with how this whole feature
already keeps its own database (`data/directory-comparison.sqlite`) entirely
separate from Count and Size's (FR-015/Decision 1). A missing Count-and-Size
database (never run yet) is caught at module load and degrades to a no-op port
(`getSizeInfo` always returns `null`) rather than crashing this tool.

**Alternatives considered**: Importing `deriveDirectoryView`/
`DirectoryScanNode` from `domain/count-and-size/` directly (rejected — a
cross-feature-slice domain import breaks the per-tool-independence convention
this codebase has followed throughout, e.g. Decision 13's `FileSystemPort`
extension and Decision 14's rejection of reusing `FileSystemPort` for `CopyPort`
both cite the same principle). Writing this as a shared cross-tool module under
`domain/scanning/` like the tree-walk primitives (rejected —
`derive-directory-view.ts`'s aggregation logic isn't feature-agnostic the way
`ScanStack`/`traverseDirectory` are; it's inherently about Count and Size's own
count/size semantics, so generalizing it for one read-only consumer would be
over-engineering, Constitution Principle I).

## Decision 18: Stop button visibility/label also made pane-independent, to match Decision 16

**Decision (added post-implementation, user request — "porque no veo el boton de
stop?")**: Decision 16 made the per-pane `activePath` text unconditionally
visible regardless of navigation, but left the Stop button's visibility and the
"Comparing…"/"Listing…"/"Idle" label in `comparison-status-panel.tsx` gated on
`view.passActive` — which is still scoped to whether the _currently viewed_ pane
pair is what's active (`isWithinSubtree(activePath, leftPath/rightPath)`). Net
effect: a user who navigated a pane away from the compared roots (now much more
likely to happen, precisely because the Decision 16 text stays visible when they
do) would see "currently processing: X" but the label would say "Idle" and no
Stop button would render — no way to cancel work they could plainly see was
running. Fixed in two places:

- `comparison-status-panel.tsx`: both the label and the Stop button's visibility
  now derive from `view.activePath?.pass` (system-wide, like Decision 16) via a
  small `currentPass()` helper, instead of the pane-scoped `view.passActive`.
- `use-comparison-status.ts`'s `stop()`: now POSTs `view.activePair.leftRoot`/
  `rightRoot` (the comparison's actual roots) instead of the viewed panes'
  `leftPath`/`rightPath`. Necessary because the button can now be clicked from a
  pane pair unrelated to the active comparison — sending the viewed pair would
  hit `stopComparison`'s `isWithinSubtree` guard (Decision 15's Bug 2 fix) and
  silently no-op, reintroducing the same class of bug Decision 15 fixed, just
  from a different trigger. Falls back to `leftPath`/`rightPath` only when
  `activePair` is null (defensive; the button isn't shown in that state anyway).

**Rationale**: The active-path indicator and the Stop control are two views of
the same fact ("is a comparison running, and can I cancel it") — they must
agree. Scoping one to the viewed pane and the other to the whole tool inevitably
produces a state where the UI shows visible progress with no way to act on it.

**Verified**: live, via `curl` against the same `GET /status`/`POST /stop`
contract the frontend consumes — started a "full" compare on two 4GB identical
files, polled until `status: "scanning"`, then POSTed `/stop` with the
comparison's own roots (as the fixed `stop()` now does) while simulating having
navigated to an unrelated pane pair. Returned `{"stopped": true}` in ~20ms, and
a follow-up `GET /status` for the compared pair showed `not_compared` (not a
false "differs" — Decision 15's `resolvedByPass2` fix still holds). `pnpm lint`
and `pnpm build` also pass.
