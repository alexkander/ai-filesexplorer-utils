# Research: Duplicate Finder

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**:
2026-07-29

Phase 0 output. Every "NEEDS CLARIFICATION" from the plan's Technical Context is
resolved below; the decisions the user already settled during `/speckit-specify`
are recorded here with the reasoning that supports them, so `/speckit-tasks` and
`/speckit-implement` do not re-open them.

## Decision 1 — Own database, plus a read-only overlay on the comparison tool's

**Decision**: Persist everything in `data/duplicate-finder.sqlite`, opened by
this feature's own `infrastructure/duplicate-finder/sqlite-client.ts` and
overridable via `DUPLICATE_FINDER_DB_PATH`. Read
`data/directory-comparison.sqlite` only through a dedicated adapter opened with
`new Database(path, { readonly: true, fileMustExist: true })`, wrapped in the
same try/catch-to-null degradation that
`infrastructure/count-and-size/directory-comparison-readonly-adapter.ts` already
uses.

**Rationale**:

- The comparison database is ~230 MB with a ~28 MB WAL and represents hours of
  hashing. Sharing a schema would put this feature's `DELETE`/`UPDATE`
  statements one typo away from that data; a separate file means the duplicate
  finder can be reset with a single `rm` and its blast radius stops at its own
  file.
- `sqlite-client.ts` creates its schema at module scope and already carries a
  hand-rolled `ALTER TABLE` migration. A second feature's tables in that file
  would couple two features' migrations and startup ordering.
- `DIRECTORY_COMPARISON_DB_PATH` redirects the whole file, so a scratch database
  for one feature would silently redirect the other's data too.
- WAL gives many readers and **one** writer _per file_. A duplicate scan
  inserting millions of rows while a comparison pass runs would contend for the
  same write lock; the repo already carries scar tissue from that
  (`infrastructure/sqlite/open-database.ts` exists solely because of
  `SQLITE_BUSY`). Separate files mean separate locks and separate WALs.
- `readonly: true` is enforced by the driver, so FR-030 ("must not write to the
  comparison tool's data") is guaranteed structurally rather than by review.

**Alternatives considered**:

- _Store the new tables inside `directory-comparison.sqlite`_ — rejected for the
  five reasons above.
- _Reuse the `file_checksums` table itself as this feature's store_ — rejected
  outright: the comparison tool invalidates and deletes rows on its own schedule
  (`clearFileChecksumsInSubtreeStmt` nulls checksums, `deleteFilesInSubtreeStmt`
  removes rows after a move/delete, and its UPSERT nulls a checksum whenever
  size or mtime changes). Results would silently degrade. In the other
  direction, writing full checksums for files the comparison tool never asked
  for would change that tool's cascade behaviour.
- _No cross-tool reads at all_ — viable but wasteful: the user's real
  directories are largely already hashed by the comparison tool, and the reuse
  rule below is strictly safe.

## Decision 2 — A purpose-built worker, not another `ScanEngine`

**Decision**: Drive the scan from a module-level singleton
`duplicate-scan-worker.ts` exposing `start()`, `requestStop()` and
`getStatus()`, holding one `AbortController` per run — the same shape as
`comparison-pass-worker.ts` and `checksum-match-worker.ts`. Reuse
`application/scanning/traverse-directory.ts` and
`infrastructure/scanning/filesystem-adapter.ts` for the listing phase only.

**Rationale**: `ScanEngine` models a resumable forest of independent per-node
scans whose state lives in `own_outcome = 'pending'` rows, with LIFO scheduling
and per-subtree stop bookkeeping. This feature is a single linear pipeline over
a single root, where phases 2-6 are not per-directory at all. Feature 003 hit
the same wall for its Pass 2 and reached the same conclusion ("a small,
purpose-built worker — not another ScanEngine"). The genuinely reusable pieces —
symlink/unreadable handling and the `listChildren` adapter — are consumed
directly.

**Alternatives considered**: _Fit the pipeline into `ScanEngine`_ — rejected:
phases 3-6 have no per-directory unit of work to schedule, and the engine's
`pending`-row protocol would have to be emulated with rows that mean nothing to
this feature.

## Decision 3 — Scan state lives in SQLite, and a `running` row is reconciled at startup

**Decision**: Keep the authoritative scan state in a single-row `scan_state`
table (state, phase, counters, active path, timestamps), updated by the worker
as it progresses. The worker's constructor reconciles a row left in `running` by
a dead process to `stopped`, mirroring `ScanEngine`'s `findAllPendingPaths()` →
`markStopped()` startup pass.

**Rationale**: FR-023 requires results _and_ their context to survive a restart,
and SC-006 requires the view to come back with no user action. In-memory state
alone would show "running" forever after a crash, with no worker behind it.
Writing progress to SQLite also means the `/status` route is a plain read with
no coupling to the worker's internals beyond the currently-active path.

**Alternatives considered**: _In-memory status only, results in SQLite_ —
rejected: a restart mid-scan would leave results that claim to be complete, and
nothing would tell the user the scan had died.

## Decision 4 — Folder detection prunes on "every descendant file is shared", so unique-sized files are still never read

**Decision**: When folder detection is on, compute directory checksums only for
**candidate** directories, where `candidate(D)` = every direct file child's
content belongs to a file duplicate group (occurs ≥ 2 times), every direct
subdirectory is itself a candidate, and `D` had no unreadable entries. Evaluate
bottom-up (deepest first). Only candidates get a Merkle checksum.

**Rationale**: This is the decision that makes FR-013 and FR-014 coexist. A
naive Merkle implementation needs a full checksum for _every_ file, which would
force reading every byte of the tree and destroy the size cascade. The pruning
rule is exact, not heuristic, in the direction that matters: if `D` and `D'` are
distinct duplicated directories inside the scanned root, then every file `f` in
`D` has a distinct twin `f'` in `D'` with identical content, so `f`'s content
necessarily occurs at least twice. Contrapositive: a directory containing any
file whose content occurs once cannot be duplicated, and can be pruned without
hashing anything extra. Every file a candidate directory needs a full checksum
for is, by construction, already in a duplicate group and therefore already
hashed by phase 4.

The condition is necessary but not sufficient (two same-content files could both
live inside the same directory), which is fine: candidacy only decides _whether
to derive a checksum_; the actual verdict still comes from comparing the derived
checksums.

**Alternatives considered**:

- _Hash every file when the checkbox is on_ — rejected: it violates FR-013 and
  SC-002 and turns an opt-in refinement into a full-tree read.
- _Compare directories pairwise like the comparison tool does_ — rejected: that
  tool compares two known roots; here every directory is a potential partner of
  every other, so a content-addressed checksum is the right shape.

## Decision 5 — The partial checksum _is_ the full checksum for small files

**Decision**: Keep the comparison tool's 64 KB prefix threshold. When a file's
size is ≤ the threshold, record the value computed in phase 3 as **both** the
partial and the full checksum and skip phase 4 for that file.

**Rationale**: The partial checksum streams bytes `[0, 65535]`; for a file no
larger than that, the stream covers the whole file, so the digest is bit-for-bit
the digest a full hash would produce. Re-reading such a file in phase 4 would
double the I/O on exactly the population where the per-file overhead dominates
(a tree of small files). Recording the value under both columns also feeds the
cross-scan cache (SC-009) with no extra work.

**Alternatives considered**: _Always run phase 4 for correctness symmetry_ —
rejected: it is provably the same digest, and the second read is pure waste.

## Decision 6 — Checksum reuse is valid only on an exact size + modification-time match

**Decision**: Before hashing, look for a usable checksum in this order: (1) this
feature's own `scanned_files` row for that path, (2) the comparison tool's
`file_checksums` row for that path. Accept either only when the recorded `size`
and `modification_time` both equal what the current walk observed, and when the
row is not flagged with a read error. Any miss means "hash it now" — never "not
a duplicate".

**Rationale**: Both databases store `modification_time` as an ISO 8601 string
produced by the same code path (`stats.mtime.toISOString()` in
`infrastructure/scanning/filesystem-adapter.ts`), so string equality is a valid
comparison with no parsing or timezone handling. The comparison tool nulls its
own checksums whenever size or mtime changes, so a surviving row with matching
facts is exactly as trustworthy as one of ours.

The "miss ⇒ hash" rule matters more than it looks: `file_checksums` is a
_partial_ cache, not a registry. Its cascade frequently stops at the partial
checksum, and a file that never had a counterpart to compare against may have no
checksum at all. Treating a null `full_checksum` as "this file has no
duplicates" would silently drop real results.

**Alternatives considered**:

- _Trust the cached checksum on a path match alone_ — rejected: an edited file
  keeps its path and would be grouped with its own stale twin.
- _Verify a random sample by re-hashing_ — rejected as unjustified complexity
  (Principle I); the size+mtime rule is the same one the comparison tool relies
  on today.

## Decision 7 — Collapsing is "one folder group explains _every_ occurrence", implemented as a covering-set intersection

**Decision**: For each occurrence path, compute the set of duplicated-folder
groups that have a member which is a strict ancestor of it. Omit a group iff the
intersection of those sets across all of its occurrences is non-empty.

**Rationale**: The obvious reading of "collapse the files inside a duplicated
folder" — drop any occurrence located inside a duplicated folder — loses data.
If `photos/2024` and `backup/2024` are duplicates and a third copy of one of
their files also sits in `downloads/`, dropping the two inside occurrences
leaves a one-occurrence group that then disappears, hiding a real duplicate the
user could act on. Requiring a _single_ folder group to explain _all_
occurrences keeps that group intact and in full, while still collapsing the pure
case (spec User Story 2, scenarios 1 and 3). Nested duplicated folders fall out
of the same rule for free: `photos/2024/raw` and `backup/2024/raw` are both
covered by the `2024` group, so the inner folder group is omitted too.

**Alternatives considered**:

- _Drop every occurrence inside any duplicated folder_ — rejected: loses the
  outside copy, as above.
- _Show everything and let the UI nest it_ — rejected: the user explicitly asked
  for collapsing, and a 5 000-row listing for one copied folder is the problem
  being solved (SC-003).

## Decision 8 — One result set at a time, versioned by a monotonic `scan_seq`

**Decision**: Keep exactly one set of results — the latest scan's. Stamp
`scanned_files`, `scanned_directories` and the derived group tables with a
monotonically increasing `scan_seq`; the listing queries filter on the current
value, and a new scan bumps it. Group/occurrence rows from previous scans are
deleted at the start of a new scan; `scanned_files` rows are kept as the
cross-scan checksum cache.

**Rationale**: FR-009 asks for replacement, not accumulation, and no requirement
mentions comparing two scans. A `scan_seq` counter avoids the alternative's
table-wide `UPDATE ... SET in_current_scan = 0` over millions of rows at the
start of every scan, while still letting stale rows serve as cache hits.

**Alternatives considered**: _A `scan_runs` table with history and a foreign
key_ — rejected under Principle I: no requirement needs it, and it would double
the size of the largest tables.

## Decision 9 — Local copies instead of cross-slice imports

**Decision**: Re-create `derive-directory-checksum.ts` (domain), the streamed
partial/full checksum adapter and `format-size.ts` inside this feature's slice
instead of importing them from `directory-comparison/`. Each copy carries the
same comment the existing copies do, naming this rule.

**Rationale**: This is the codebase's established convention, stated explicitly
in `infrastructure/directory-comparison/ui/format-size.ts`: "Kept as a local
copy rather than importing Count and Size's own copy — this feature slice stays
free of cross-tool imports (the only intentional exception is the shared
`scanning` module)". Following it keeps the slices independently deletable and
avoids a shared "checksum utilities" module that no requirement asks for
(Principle I).

**Trade-off and revisit condition**: the Merkle derivation would then exist in
two places, and a change to its hashed representation must be applied to both or
the two tools' directory checksums silently diverge. That is acceptable while
neither tool reads the other's directory checksums — which is the case here, as
this feature's overlay reads `file_checksums` only. **If a future feature ever
needs to compare directory checksums across the two tools, promote the
derivation into a shared `domain/checksum/` module in that change**, the same
way `filesystem-adapter.ts` was promoted into `infrastructure/scanning/` during
feature 003.

**Alternatives considered**: _Import the comparison tool's modules directly_ —
rejected: it inverts the convention and makes the comparison slice undeletable
without breaking this one. _Promote them to shared modules now_ — rejected:
premature, and it would edit feature 003's files for a benefit nothing currently
needs.

## Decision 10 — The ignore list stores paths only; matching is exact-or-prefix

**Decision**: `ignored_paths(path PRIMARY KEY, ignored_at)`. A path `p` is
excluded when `p = ignored` or `p` starts with `ignored + '/'`. No kind column.

**Rationale**: FR-025 wants a file to exclude itself and a folder to exclude its
subtree. A file has no descendants, so the subtree rule collapses to the exact
rule for it automatically — the distinction the requirement draws is a
consequence of what the path _is_, not extra state to store. The comparison
tool's `ignored_paths` deliberately keys on exact paths for a different reason
(pairing by name), so the two tables stay independent as FR-028 requires.

**Alternatives considered**: _A `kind` column_ — rejected as redundant state
that can disagree with the filesystem. _Glob patterns_ — rejected under
Principle I; nothing asks for them.

## Decision 11 — Paginate and sort in SQL; fetch occurrences on demand

**Decision**: `/api/duplicate-finder/groups` runs
`ORDER BY <size|occurrence_count> DESC, checksum LIMIT 50 OFFSET ?` against
`duplicate_groups`; expanding a row calls `/api/duplicate-finder/occurrences`
for that one checksum.

**Rationale**: SC-004 requires a page within 2 s at 100 000 groups. Count and
Size sorts and slices in the application layer over an already-loaded row set,
which is fine for one directory's children but would mean loading every group
here. Keeping the occurrence lists out of the page payload also keeps a group
with thousands of paths from bloating every page that happens to contain it. The
`checksum` tiebreaker makes the order total, so paging never skips or repeats a
row when two groups share a size.

**Alternatives considered**: _Return groups with their occurrences inlined_ —
rejected on payload size. _Keyset pagination_ — rejected as premature; offsets
over an indexed 100 k-row table are well within budget.

## Decision 12 — "Empty" is decided by the empty-content digest, not by `size = 0`

**Decision**: Flag a file group as empty when its checksum equals the SHA-256 of
zero bytes; flag a directory group as empty when its members have no children.

**Rationale**: FR-016 exists so the user can dismiss the giant zero-byte group
at a glance. Deriving the flag from the digest rather than from the reported
size makes it immune to the unreliable-size quirk feature 003 documented at
length (rclone's Google Drive mount reports size 0 for Office files edited in
Drive's compatibility mode). Such a file has real content, so it hashes to a
real digest and is correctly _not_ marked empty — and it also cannot form a
false duplicate group with genuinely empty files, because phase 3 reads its
actual bytes.

**Alternatives considered**: _`size = 0`_ — rejected: on the user's Drive mounts
it mislabels real files as empty. _Excluding empty files from the scan_ —
rejected: the user explicitly asked for them to be reported and marked.

## Decision 13 — Stop still produces (partial) results

**Decision**: On Stop, abort the in-flight read, then still run the grouping and
persistence phases over whatever checksums exist, and record the state as
`stopped`. Folder groups are only derived if phase 5 had completed; otherwise
the results are file groups only. The listing labels the whole result set as
partial.

**Rationale**: FR-007 requires the results found so far to remain visible.
Grouping is a handful of SQL statements over rows that already exist, so the
"finish the cheap part" path costs milliseconds and turns a cancelled scan into
something useful instead of an empty screen. Passing the `AbortSignal` all the
way into `fs.createReadStream` is what makes SC-005's 2-second bound hold while
a multi-gigabyte file is being read — the same mechanism `compare-subtree.ts`
already relies on.

**Alternatives considered**: _Discard everything on Stop_ — rejected: it throws
away expensive work and contradicts FR-007.

## Decision 14 — Validate the root before starting, and report which failure it was

**Decision**: `start-scan` checks the path through the filesystem port and
returns a discriminated outcome (`not_found` / `not_a_directory` / `unreadable`
/ `already_running` / `root_ignored` / `ok`) that the Route Handler maps to a
400/409 with a message.

**Rationale**: FR-004 requires telling the user _which_ problem occurred, and
FR-008 requires refusing a second concurrent scan rather than queueing it. A
discriminated outcome keeps that decision in the application layer, where the
spec's rules live, instead of in the Route Handler. `root_ignored` covers the
spec's edge case where the chosen root sits inside an ignored subtree and would
otherwise produce a confusing empty result.

**Alternatives considered**: _Throwing errors and mapping messages in the route_
— rejected: it pushes policy into `app/`, which the constitution requires to
stay thin.

## Decision 15 — An ignored child makes its ancestors non-candidates (found during implementation)

**Decision**: A directory whose listing skipped an ignored entry is recorded
with `has_incomplete_content = 1`, exactly like one with an unreadable entry, so
no Merkle checksum is derived for it or for any of its ancestors.

**Rationale**: This surfaced while writing phase 1, not while planning. The
ignore list filters entries out of what the scan records, and a filtered
directory is not the directory that is on disk. Without this rule, ignoring
`A/x.bin` would make `A = {a}` in the database while `A` really is `{a, x.bin}`
— and a genuinely different directory `A' = {a}` elsewhere would then be
reported as its duplicate. That is a **false positive on the one operation the
user might act on**, which is worse than the cost of the rule: folder detection
quietly stops working for the ancestors of anything ignored.

The column was renamed from `has_unreadable_entries` to `has_incomplete_content`
in the same change, because it no longer means "an entry was unreadable" — it
means "what this row records is not the whole truth about this directory".

**Alternatives considered**: _Let the checksum be derived anyway_ — rejected:
silently wrong results. _Track ignored children separately and subtract them
from the comparison_ — rejected under Principle I: it would require the twin
directory to be evaluated against the same ignore set at derivation time, which
is exactly the pairwise comparison a content-addressed checksum exists to avoid.

## Decision 16 — A feature-local `PathInspectionPort` for the three start-scan rejections (found during implementation)

**Decision**: Add `application/duplicate-finder/path-inspection-port.ts` (one
method, `inspect(path) → 'missing' | 'file' | 'directory' | 'unreadable'`) with
an `fs.stat` + `fs.access` adapter, instead of extending the shared
`FileSystemPort`.

**Rationale**: FR-004 requires telling the user _which_ of three problems the
path has, and the shared port cannot: its `listChildren` maps both `ENOENT` and
`ENOTDIR` to the same `not_found` outcome, so "that is a file, not a directory"
is indistinguishable from "that does not exist". Widening a port shared by two
other tools for one consumer's need is what interface segregation exists to
prevent; a one-method port in the slice that needs it costs less and touches
nothing else.

**Alternatives considered**: _Add a method to `FileSystemPort`_ — rejected as
above. _Infer the difference from `listChildren`'s failure_ — impossible, the
information is already lost by then.

## Decision 17 — Index on (parent_path, scan_seq), not on parent_path alone (found while profiling)

**Decision**: Index `scanned_files` and `scanned_directories` on
`(parent_path, scan_seq)`, and drop the single-column `(parent_path)` indexes
they supersede.

**Rationale**: the folder-derivation pass reads one directory's children at a
time (`WHERE parent_path = ? AND scan_seq = ?`). With only `(parent_path)` and
`(scan_seq, size)` available, SQLite chose the latter — and since `scan_seq` has
exactly ONE value in the table, "SEARCH USING INDEX idx_scanned_files_scan_size
(scan_seq=?)" means visiting all 57 352 rows of the scan and filtering
`parent_path` in memory. Once per directory. 2160 directories × 57 k rows ≈ 124
million row visits.

Measured on the real database:

|                               | Folder pass over 2160 directories |
| ----------------------------- | --------------------------------- |
| Before                        | **60 120 ms**                     |
| After                         | **74 ms**                         |
| Cost of creating both indexes | 38 ms                             |

End to end, a partial refresh went from ~63 s to ~0.7 s, and a full scan pays
the same pass, so it benefits identically — the 71 s the user's 2169-directory
scan took was almost entirely this.

The lesson worth keeping: an index whose leading column is a constant across the
whole table is not a filter, it is a full scan with extra steps, and the planner
will still prefer it over a genuinely selective single-column index. An index
that satisfies every constraint of the query removes the choice.

**Alternatives considered**: _`ANALYZE` so the planner has real statistics_ —
would probably fix the choice, but it needs re-running as the data grows and
leaves the pathological plan one stale statistic away; the composite index makes
the good plan the only plan. _`INDEXED BY` to force it_ — same effect, but it
hard-codes an index name into the SQL and fails loudly if the schema changes.
