# Feature Specification: Directory Comparison Tool

**Feature Branch**: `003-checksum-registry`

**Created**: 2026-07-12

**Status**: Draft

**Input**: User description: "Checksum registry and duplicate finder tool. Goal:
let the user index nearly all their files so they can find and eliminate
duplicate files/directories. Scope: a new tool, separate from the existing
count-and-size tool, following the same domain/application/infrastructure
per-feature slice convention. Recursively scans a directory and computes a
content checksum (SHA-256) for every file, producing a registry (file path +
checksum). Efficient checksum strategy for files: a cascading filter to avoid
hashing full content unnecessarily — group by file size first, then a fast
partial hash of the first bytes as a second filter, and only compute the full
SHA-256 for files that still match after both filters. Cache checksums keyed by
path with size/mtime, and only recompute when size or mtime changed since the
last scan. Also computes a checksum per directory, derived bottom-up from its
immediate children only (Merkle-tree style): hash of the sorted list of (child
name, child type, child checksum). Sensitive to both structure and content.
Persist directory checksums and only recompute the checksums along the path from
a changed file up to the root when something changes. Own SQLite database,
separate from count-and-size's. UI: its own page/section reachable from the
dashboard shell's sidebar, with its own scan/stop controls (incremental by
default, force-full-rescan option). A view that surfaces duplicate files and
duplicate directories found via matching checksums, so the user can review and
decide what to delete, with confirmation since it's destructive —
scanning/indexing must never delete anything on its own. Out of scope: the
separate 'compare two arbitrary directories' tool already tracked as TODO T001."

## Clarifications

### Session 2026-07-12 (revision)

- Q: The original scope built a cross-tree checksum registry with duplicate-
  finder views (find duplicate files anywhere in the indexed tree, delete them,
  find duplicate directories anywhere) intended to search the whole filesystem
  for matches. On reflection, is that still the right shape for this spec? → A:
  No — replace it with a side-by-side, two-pane directory comparison tool (the
  tool originally tracked separately as TODO T001): the user browses two
  directories independently (or with synchronized navigation via a "Move sync"
  toggle) and explicitly triggers a "Compare" action that computes and compares
  checksums between the two currently selected directories and everything
  beneath them. A global duplicate registry/search across the whole filesystem,
  and any deletion action, are deferred to a later spec that can build on this
  tool's checksum-computation infrastructure — they are no longer part of this
  spec. User Stories, Functional Requirements, Key Entities, Success Criteria,
  and Assumptions below are revised accordingly; the checksum computation
  strategy itself (cascading file comparison, Merkle-style directory checksums,
  incremental scanning) carries over unchanged from the original design.

### Session 2026-07-12 (clarification)

- Q: Does "Force full re-compare" apply to both panes together, or can each side
  be force-recomputed independently? → A: Always both sides together, as a
  single action — there is no per-side force-recompute. FR-009 is revised to
  make this explicit.
- Q: When Move sync is on and a synced navigation lands the mirrored pane in a
  "not found" state (FR-002a), and the user then manually navigates that pane
  elsewhere, does Move sync stay on for future moves, or turn off automatically?
  → A: Stays on — it's explicit user-controlled state; a sync failure on one
  move MUST NOT silently disable it. FR-002c is added to make this explicit.

Two additional gaps were resolved directly (not asked, since existing precedent
in `specs/002-count-and-size/spec.md` already settles them unambiguously) rather
than spent as clarification questions:

- FR-001 now explicitly inherits Count and Size's pagination/lazy-loading
  behavior (its FR-001a) for either pane's listing, since FR-001 already ties
  this tool's browsing UX to "the same way as the Count and Size tool" and large
  directories can appear on either side.
- FR-007 gained a sixth status, **Not compared**, for entries that have never
  had a comparison run — mirroring Count and Size's FR-004c, which gives "not
  scanned" its own distinct color rather than folding it into "Scanning."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Browse two directories side by side (Priority: P1)

A user opens the tool and sees two independent directory browsers, left and
right, each starting at the root ("/") — the same browsing experience as the
Count and Size tool, duplicated into two independently navigable panes.

**Why this priority**: This is the foundational UI every other story depends on.
It delivers value on its own (a two-pane file browser) even before any
comparison ever runs.

**Independent Test**: Open the tool. Confirm both panes show the root listing,
and that navigating into a directory or back out on one side has no effect on
the other side.

**Acceptance Scenarios**:

1. **Given** the user opens the tool, **When** it loads, **Then** both the left
   and right panes show the contents of the root directory ("/").
2. **Given** a pane's listing, **When** the user clicks a directory entry in
   that pane, **Then** only that pane navigates into it.
3. **Given** a pane's listing, **When** the user clicks a file entry, **Then**
   nothing happens.
4. **Given** either pane, **When** the user uses that pane's up/back navigation,
   **Then** only that pane navigates to its own parent directory.

---

### User Story 2 - Keep both sides in sync while browsing (Priority: P2)

A "Move sync" toggle lets the user link the two panes' navigation together:
while it's on, moving into a subdirectory (or up to the parent) on either side
automatically applies the same relative move to the other side, so exploring two
trees that are supposed to mirror each other doesn't require manually repeating
every step on both panes.

**Why this priority**: This is what makes comparing two large, deep trees
practical rather than tedious, but the tool is still usable without it (Story 1
already allows manual side-by-side browsing).

**Independent Test**: Turn Move sync on. Navigate into a subdirectory on the
left pane and confirm the right pane navigates into its own same-named
subdirectory. Turn Move sync off and confirm navigating either pane no longer
affects the other.

**Acceptance Scenarios**:

1. **Given** Move sync is on, **When** the user navigates into subdirectory "X"
   on one pane, **Then** the other pane also navigates into its own "X" child of
   whatever directory it currently shows.
2. **Given** Move sync is on, **When** the user navigates up to the parent on
   one pane, **Then** the other pane also navigates up to its own parent.
3. **Given** Move sync is on and the corresponding entry doesn't exist on the
   other side, **When** the synced navigation happens, **Then** that pane shows
   a clear "not found" state instead of silently staying put or failing
   destructively.
4. **Given** Move sync is off, **When** the user navigates either pane, **Then**
   the other pane is unaffected.
5. **Given** the two panes are already showing differently-structured paths,
   **When** the user turns Move sync on, **Then** neither pane immediately
   re-navigates — syncing takes effect starting with the next navigation action,
   not retroactively.

---

### User Story 3 - Compare the two selected directories (Priority: P3)

From whatever pair of directories the two panes currently show, the user presses
"Compare" to compute and compare checksums for both directories and everything
beneath them, so they can see — with a color-coded status per entry — exactly
which files and subdirectories match, differ, or exist on only one side.

**Why this priority**: This is the payoff of the whole tool. It depends on Story
1 (something to compare) but not on Story 2 (Move sync is a browsing
convenience, not a prerequisite for comparing whatever the two panes happen to
show).

**Independent Test**: Point the left pane at a directory and the right pane at
an identical copy of it, except for one file with different content and one file
that only exists on the left. Press Compare and confirm the differing file shows
a "Differs" status, the left-only file shows an "Only on this side" status, and
every other entry shows "Matching".

**Acceptance Scenarios**:

1. **Given** both panes show a directory, **When** the user presses "Compare",
   **Then** a recursive checksum computation starts for both directories and
   everything beneath them.
2. **Given** a comparison is in progress, **When** the user views either pane's
   listing, **Then** each direct entry shows one of: Matching, Differs, Only on
   this side, Scanning, or Error — visually distinguished by color.
3. **Given** a comparison completes, **When** the user views the listing,
   **Then** every direct entry in both panes shows a final status, determined by
   pairing entries with the same name between the two sides and comparing their
   checksums.
4. **Given** a comparison already covered a subdirectory, **When** the user (or
   Move sync) navigates into that subdirectory afterward, **Then** its
   already-computed comparison status is shown immediately, without needing to
   press Compare again at that level.
5. **Given** a pair was already compared and nothing changed on disk, **When**
   the user presses "Compare" again, **Then** no checksums are recomputed
   (incremental by default, same behavior as Count and Size's "Scan").
6. **Given** the user wants to redo a comparison from scratch, **When** they use
   the separate "Force full re-compare" action, **Then** every checksum for both
   subtrees is recomputed, ignoring any prior cached results.
7. **Given** a comparison is active, **When** the user presses Stop, **Then**
   the comparison is cancelled for both sides and any not-yet-processed entries
   are left in their prior status (or "Not compared" if this is the first
   comparison).
8. **Given** a file's content cannot be fully read during comparison (permission
   change or I/O error after being listed), **When** that happens, **Then** that
   entry — and every ancestor directory up to the compared root, on that side —
   shows an Error status instead of a false Matching or Differs verdict.

---

### Edge Cases

- What happens when the user presses "Compare" while another comparison is
  already active in this tool? Only one comparison scan is active within this
  tool at a time; the new request is enqueued rather than run concurrently or
  discarded, mirroring Count and Size's single-active-scan behavior (scoped
  independently per tool — an active Count and Size scan doesn't block this
  tool's comparisons or vice versa).
- What status does an entry show before any comparison has ever run for it? "Not
  compared" — distinct from "Scanning," which only applies once a comparison
  covering that entry has actually started.
- What happens when Move sync is on, a synced move lands one pane in a "not
  found" state, and the user then navigates that pane manually? Move sync stays
  on; it is never auto-disabled by a sync failure.
- What happens when an entry exists on only one side? It shows its own "Only on
  this side" status — never conflated with "Differs", which means both sides
  have it but with different content.
- What happens when Move sync is on and the user presses "up" while a pane is
  already at the root ("/")? That pane stays at the root (no-op), and the other
  pane's synced "up" move still applies to its own current directory
  independently.
- What happens when both panes are pointed at the very same absolute directory?
  Comparing it against itself is allowed and trivially reports every entry as
  Matching.
- What happens to symlinks or entries that can't be listed at all? Symlinks are
  ignored (not followed, not checksummed); unreadable entries are skipped and
  the containing directory is flagged as having unreadable entries on that side,
  contributing an Error status.
- What happens when the user turns Move sync on while the two panes are already
  looking at unrelated paths? Nothing re-navigates immediately; syncing only
  applies starting with the next navigation action.
- What happens if the application restarts or crashes mid-comparison? In-flight
  portions are surfaced as Stopped rather than silently resumed; pressing
  "Compare" again later only reprocesses what's outstanding.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST show two independent directory browsers (left and
  right panes), each starting at the root ("/"), navigable the same way as the
  Count and Size tool (click a directory to enter it, clicking a file has no
  effect, an up action to go to the parent) — including that tool's
  pagination/lazy-loading behavior for a listing with an unusually large number
  of direct entries, applied independently to each pane.
- **FR-002**: A "Move sync" toggle MUST be available. While on, any navigation
  action (entering a subdirectory, or moving up to the parent) performed on
  either pane MUST also apply the equivalent relative move to the other pane.
- **FR-002a**: When Move sync is on and the corresponding path doesn't exist on
  the other side, that pane MUST show a clear "not found" state rather than
  silently failing or leaving stale content displayed.
- **FR-002b**: Turning Move sync on MUST NOT itself trigger a navigation on
  either pane; it MUST only affect navigation actions taken after it was turned
  on.
- **FR-002c**: Move sync remaining on after a synced navigation produced a "not
  found" state (FR-002a) MUST NOT be automatically turned off. If the user then
  navigates the affected pane manually, Move sync MUST remain in effect for
  subsequent navigation actions on either pane.
- **FR-003**: A "Compare" action MUST be available whenever both panes show a
  directory. Triggering it MUST start a recursive checksum computation and
  comparison of both currently-shown directories and everything beneath them.
- **FR-004**: Before computing a file's full-content checksum, the system MUST
  first rule out files that cannot possibly match using cheaper comparisons (at
  minimum, file size, then a fast partial-content hash), and MUST only perform a
  full-content comparison for files that remain plausible matches after those
  cheaper comparisons.
- **FR-005**: Each directory's own checksum MUST be derived only from its direct
  entries (each child file's checksum, each child subdirectory's own checksum,
  and their names/types), not by re-reading the full recursive contents of the
  subtree on every computation.
- **FR-006**: Entries MUST be paired between the two sides by name — an entry on
  one side is compared against the entry of the same name at the corresponding
  position on the other side, if one exists.
- **FR-007**: Every entry MUST show one of the following statuses, each visually
  distinguished by its own color: **Not compared** (no comparison has ever run
  for this entry), **Matching** (both sides present, identical checksum),
  **Differs** (both sides present, checksums differ), **Only on this side** (no
  counterpart on the other side), **Scanning** (comparison still in progress for
  this entry), or **Error** (couldn't be read or checksummed).
- **FR-008**: The default "Compare" action MUST behave incrementally: it MUST
  skip recomputing a file's checksum when its size and modification time are
  unchanged since it was last computed, and MUST skip a subdirectory whose
  comparison already completed successfully and remains unaffected by any change
  beneath it.
- **FR-009**: A separate, explicit "Force full re-compare" action MUST be
  available as a single action covering both panes together — triggering it MUST
  ignore all prior cached checksums for both currently compared subtrees and
  recompute everything from scratch on both sides; there is no variant that
  force-recomputes only one side.
- **FR-010**: The system MUST support only one actively-running comparison scan
  at a time within this tool; requests made while one is active MUST be
  enqueued, not run concurrently or discarded. This constraint is scoped to this
  tool's own comparison scans and is independent of any scan running in the
  Count and Size tool.
- **FR-011**: Symbolic links MUST be ignored during comparison — not followed,
  not checksummed. Files or subdirectories that cannot be read MUST be skipped,
  and the containing directory MUST be flagged as having unreadable entries.
  This applies both when an entry cannot be listed at all and when a file's
  content cannot be fully read while computing its checksum after having been
  listed successfully.
- **FR-011a**: A directory flagged as having unreadable entries, or containing a
  descendant so flagged, MUST NOT have a directory checksum computed for it —
  such a directory MUST instead show an Error status, and that status MUST
  propagate to every ancestor up to the compared root on that side, none of
  which can have a trustworthy checksum either while it applies.
- **FR-012**: Comparison scanning MUST run asynchronously and MUST NOT block
  browsing or other interaction with the tool while in progress.
- **FR-013**: The system MUST provide an explicit Stop action for an active
  comparison; using it MUST cancel further processing on both sides without
  losing already-computed results.
- **FR-014**: If the application restarts or crashes while a comparison is in
  progress, the affected portions MUST be surfaced as Stopped rather than
  silently resumed or shown as still running.
- **FR-015**: Computed checksums (file and directory) and comparison state MUST
  be persisted, independently of the Count and Size tool's own persisted data,
  so an incremental "Compare" can skip unchanged entries across sessions and
  application restarts.
- **FR-016**: Navigating into a subdirectory that was already covered by a
  completed comparison MUST show its precomputed status immediately, without
  requiring the user to press "Compare" again at that level.
- **FR-017**: The tool MUST be reachable as its own section from the dashboard
  shell's navigation, distinct from the Count and Size tool.
- **FR-018** (added post-implementation, user request): For an entry whose
  status is "Only on this side," the system MUST offer an action to copy that
  entry (recursively, if a directory) to the corresponding location on the other
  side. This action MUST require explicit user confirmation before running, and
  MUST refuse to run — rather than overwrite, merge, or delete anything — if the
  destination path already exists by the time the copy would start.

### Key Entities

- **File Checksum Entry**: One checksummed file. Tracks: path, size,
  modification time as of last computation, content checksum, and last-computed
  timestamp. Used to skip recomputation (FR-008).
- **Directory Comparison Node**: The comparison state and result for one
  directory on one side. Tracks: directory path, state (Not compared / Comparing
  / Completed / Error / Stopped), depth, its own directory checksum (derived
  from direct entries, absent whenever the node is incomplete), whether it has
  unreadable entries, and the last-computed timestamp. Related to its parent's
  node and to one node per child directory.
- **Comparison Pair**: The left path and right path currently selected for
  comparison, together with the overall state of comparing them. Ephemeral —
  reflects only what the two panes currently show, not a persisted history of
  past pairs (see Assumptions).
- **Entry Comparison Result**: The per-entry outcome shown in the listing — one
  of Not compared, Matching, Differs, Only on this side, Scanning, or Error —
  derived by pairing left and right entries by name (FR-006) and comparing their
  checksums.
- **Move Sync Setting**: Whether the two panes' navigation is currently linked
  (FR-002).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can browse two directories independently, and, with Move
  sync on, explore two mirrored trees while only navigating one side manually.
- **SC-002**: After pressing "Compare", a user can tell — for every entry in
  both panes, at a glance via color — whether it matches, differs, exists on
  only one side, is still being compared, or hit an error, without opening any
  file.
- **SC-003**: Comparing two directories with no differences reports every entry
  as Matching.
- **SC-004**: For a pair of directories containing large files with no same-size
  counterpart, comparison never reads those files' full content.
- **SC-005**: Re-comparing an already fully-compared, unchanged pair does no
  redundant work — no file content is re-read and no checksum is recomputed.
- **SC-006**: Cancelling an active comparison stops further computation
  immediately without losing or corrupting previously computed results.
- **SC-007**: Interrupting the application mid-comparison and restarting it does
  not lose previously computed checksums; resuming a comparison only processes
  what was left outstanding.

## Assumptions

- Entries are paired between the two sides strictly by name at the corresponding
  relative position within the compared directories — not by any content-based
  fuzzy matching.
- "Only on this side" is kept as a status distinct from "Differs" (both sides
  present, different content), since collapsing them would lose information a
  user needs to decide what to do next.
- Toggling Move sync on does not itself cause a navigation; it only takes effect
  starting with the next navigation action, so switching it on while the two
  panes are unrelated doesn't cause a surprising jump.
- The checksum comparison strategy (cascade: file size, then a partial- content
  hash, then a full-content SHA-256 checksum only for files still matching after
  both), the Merkle-tree-style directory checksum (structure- and-content
  sensitive, derived bottom-up from immediate children), and reuse of the shared
  scan/traverse/stop/resume engine already built for Count and Size all carry
  over unchanged from the original design.
- Persistence uses its own embedded SQLite database, separate from the Count and
  Size tool's.
- A global duplicate registry/search across the whole filesystem, and any file
  deletion action, are out of scope for this spec — deferred to a later feature
  that can build on this tool's checksum-computation infrastructure.
- This tool's scanning/comparison machinery is entirely read-only: it never
  deletes, moves, or modifies files, so the project's dry-run/confirmation
  requirement for destructive operations does not apply to it. The one exception
  (FR-018, added post-implementation) is the "copy to the other side" action for
  "Only on this side" entries — a narrow, additive-only write capability (never
  overwrites, moves, merges, or deletes) that still requires explicit user
  confirmation per the project's safety principle, even though it isn't strictly
  a "destructive" operation as that principle defines the term.
- Hard links are treated as ordinary files, consistent with Count and Size's
  precedent — detecting and special-casing shared inodes is out of scope.
- There is no comparison history feature: the tool doesn't remember or list
  previously compared pairs, only whatever the two panes currently show.
  Underlying file/directory checksums still persist per path independently of
  any particular pairing (FR-015), so revisiting an already-computed path on
  either side in a later comparison still benefits from FR-008's incremental
  skip — only a genuinely new path needs computing.
- No automated tests are included, per the project's manual-verification-only
  principle; correctness is verified by running the app and exercising the
  browsing, sync, compare, cancel, and incremental/full-recompare flows
  end-to-end.
