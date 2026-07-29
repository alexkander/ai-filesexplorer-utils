# Feature Specification: Duplicate Finder

**Feature Branch**: `004-duplicate-finder`

**Created**: 2026-07-29

**Status**: Draft

**Input**: User description: "Duplicate finder: a new view to find duplicate
content inside a single directory. New page reachable from the dashboard shell's
sidebar, with a text input for the directory path to scan, a checkbox 'Also
detect duplicate folders' (off by default), and a 'Scan' button. Files are
always analysed; folders are analysed as duplicates only when the checkbox is
checked (Merkle-style directory checksum over the sorted list of child name,
type and checksum). The result is a paginated listing of checksums, each row
showing the checksum and how many times it appears; each row expands to show
every path where that content appears. The user can sort the listing by size or
by number of occurrences. When folder duplicate detection is on and a whole
folder is reported as duplicated, the duplicate files inside that folder are
collapsed rather than listed separately. Zero-byte files and empty folders are
not excluded from the scan; they are visually marked so the user can tell them
apart from the rest. From the results listing the user can mark any file or
folder as ignored for duplicate search; ignoring a folder excludes its entire
subtree from future scans, and a dedicated sub-view lists the ignored paths and
lets the user un-ignore them. The scan runs in a background worker with a status
panel showing progress and a Stop button, and results are persisted so they
survive a page reload or a server restart. The feature keeps its own database
and must never write to the directory comparison tool's database, although it
may read that tool's already-computed file checksums in read-only mode and reuse
them when the cached size and modification time still match the filesystem.
Hashing uses a size-first cascade: group candidates by file size, only hash
sizes shared by two or more files, compute a partial checksum of the first bytes
first and the full checksum only when the partial ones match, so a file with a
unique size is never read. Symlinks are never followed. No destructive
filesystem operation is part of this feature: marking a path as ignored is the
only mutation, and it only touches this feature's own data."

## Clarifications

### Session 2026-07-29

Resolved with the user before drafting; no open questions remain:

- Q: What counts as a duplicate — files only, or folders too? → A: Files always;
  folders only when the user checks a dedicated checkbox on the scan form.
- Q: Where do the checksums live? → A: In this feature's own store. It may read
  the directory comparison tool's existing checksums read-only (reusing one only
  when size and modification time still match), but it MUST NOT write there.
  Rationale: that store is large and expensive to rebuild, its rows are
  invalidated and deleted by the comparison tool's own lifecycle, and a shared
  schema would couple two features' migrations and write locks.
- Q: How aggressive should hashing be? → A: Size-first cascade (unique size →
  never read; shared size → partial checksum first; full checksum only when the
  partial ones match).
- Q: What happens to files inside a folder reported as duplicated? → A: Collapse
  them, so the user sees "this folder appears twice" instead of its thousands of
  repeated files.
- Q: What can the user do from the results listing? → A: Mark files or folders
  as ignored for duplicate search. No delete/move in this feature.
- Q: What does ignoring a folder mean? → A: It excludes that folder and its
  entire subtree, in this feature's own ignore list (independent from the
  comparison tool's list).
- Q: How does the Scan button behave? → A: Background worker with a progress
  panel and a Stop button; results persist across reloads and restarts.
- Q: How is the listing ordered? → A: The user can sort by size or by number of
  occurrences.
- Q: Are zero-byte files and empty folders excluded? → A: No — they are scanned
  and reported, but visually marked so they are distinguishable from the rest.

This feature is the "global duplicate registry" that
`specs/003-checksum-registry/spec.md` explicitly deferred ("A global duplicate
registry/search across the whole filesystem [...] deferred to a later spec that
can build on this tool's checksum-computation infrastructure"), narrowed to a
single user-chosen directory and with deletion still out of scope.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Find duplicate files in a directory (Priority: P1)

The user opens the Find Duplicates page, types the path of a directory they
suspect holds redundant copies, presses Scan, watches the progress panel while
the scan runs, and ends up with a paginated listing of content checksums: one
row per group of identical files, showing how many times that content appears
and how big it is. Expanding a row reveals every path holding that content, so
the user can see exactly where the copies live.

**Why this priority**: This is the entire point of the feature. Without it there
is no value at all; every other story refines or extends this listing.

**Independent Test**: Point the scan at a directory containing a handful of
known duplicated files and confirm each duplicated content appears exactly once
in the listing, with the right occurrence count and the right set of paths.

**Acceptance Scenarios**:

1. **Given** a directory containing `a.jpg` and `copies/a-copy.jpg` with
   byte-identical content, **When** the user scans that directory, **Then** the
   listing contains one group with an occurrence count of 2 whose expanded paths
   are exactly those two files.
2. **Given** a directory where every file has a distinct size, **When** the user
   scans it, **Then** the scan reports no duplicates and completes without
   reading the content of any file.
3. **Given** a scan in progress, **When** the user presses Stop, **Then** the
   scan halts, the panel reports a stopped state, and whatever groups were
   already found remain visible and labelled as partial results.
4. **Given** a completed scan, **When** the user reloads the page or the server
   is restarted, **Then** the same results are shown again without re-scanning.
5. **Given** a listing with more than 50 groups, **When** the user navigates to
   the next page, **Then** the following 50 groups are shown in the same sort
   order.
6. **Given** a completed scan, **When** the user switches the sort selector
   between size and number of occurrences, **Then** the listing re-orders
   accordingly and returns to the first page.

---

### User Story 2 - Collapse whole duplicated folders (Priority: P2)

The user ticks "Also detect duplicate folders" before scanning. Now entire
folders whose recursive content and structure are identical are reported as a
single group, and the individual duplicated files inside them are no longer
listed separately, so a folder copied wholesale shows up as one actionable row
instead of thousands of noise rows.

**Why this priority**: It turns an unreadable listing into an actionable one
whenever the user has copied whole folders around, which is the common real
case. It depends on Story 1's listing already existing.

**Independent Test**: Scan a directory holding two byte-identical folder trees
with the checkbox on, and confirm a single folder group is reported and none of
the files inside those trees produce their own group.

**Acceptance Scenarios**:

1. **Given** `photos/2024` and `backup/2024` with identical recursive content
   and structure, **When** the user scans with the checkbox on, **Then** the
   listing contains one folder group with those two paths, and no group for the
   files contained in them.
2. **Given** the same directory, **When** the user scans with the checkbox off,
   **Then** no folder group is reported and each duplicated file inside is
   listed as its own group.
3. **Given** `photos/2024` and `backup/2024` are duplicated folders and a third
   copy of one file inside them also exists at `downloads/img.jpg`, **When** the
   user scans with the checkbox on, **Then** that file's group is still listed
   in full (all three paths), because the folder duplicate does not explain all
   of its occurrences.
4. **Given** two folders that hold the same files under different names,
   **When** the user scans with the checkbox on, **Then** they are NOT reported
   as duplicated folders, because folder identity is sensitive to child names.

---

### User Story 3 - Curate results with an ignore list (Priority: P3)

While reviewing the results, the user finds paths they never want reported — an
intentional backup folder, a cache directory, a template file that is
legitimately copied everywhere. They mark those paths as ignored straight from
the listing, which removes them from view and keeps them out of every later
scan. A separate view lists everything they have ignored so they can undo it.

**Why this priority**: It makes the tool usable repeatedly instead of once —
without it, every re-scan resurfaces the same known-good duplicates. It is still
secondary to producing a correct listing in the first place.

**Independent Test**: Ignore a folder from the listing, re-scan the same
directory, and confirm no reported path lies beneath it; then un-ignore it from
the ignored-paths view, re-scan, and confirm the paths come back.

**Acceptance Scenarios**:

1. **Given** a results listing, **When** the user marks a path as ignored,
   **Then** that path disappears from the current listing, and any group left
   with fewer than two occurrences disappears with it.
2. **Given** a folder marked as ignored, **When** the user re-scans a directory
   containing it, **Then** no reported path lies inside that folder.
3. **Given** the ignored-paths view, **When** the user un-ignores an entry,
   **Then** it disappears from that view and its content is reported again by
   the next scan.
4. **Given** paths ignored in the directory comparison tool, **When** the user
   scans here, **Then** those paths are still reported — the two ignore lists
   are independent.

---

### User Story 4 - See where the duplicates pile up (Priority: P2)

Added after the first implementation pass, at the user's request.

The checksum listing answers "what is duplicated", but not "which folder is the
problem". A second tab walks the scanned tree the way a file browser does — one
directory at a time, starting at the scanned root — and puts two numbers on
every directory: how many duplicates live anywhere beneath it, and how many
bytes they take. Directories with nothing duplicated are still listed, showing
0, so a clean folder is visibly clean rather than absent; a checkbox hides them
once the user has seen enough. Files appear only when they are themselves one of
the duplicates found.

**Why this priority**: on a real tree the checksum listing is thousands of rows
with no geography. This is what turns it into "delete `backup/2019`, that is 40
GB of the 52 GB". It is P2 rather than P1 because it presents results the scan
already produced — it needs Story 1, and adds no scanning of its own.

**Independent Test**: after a scan, open the second tab, confirm the root shows
the same total as the Duplicates tab, walk into the fullest directory, and
confirm its children's counts add up to its own.

**Acceptance Scenarios**:

1. **Given** a completed scan, **When** the user opens the by-directory tab,
   **Then** the scanned root is shown with a count equal to the total number of
   duplicates found.
2. **Given** a directory whose subtree holds no duplicates, **When** the user
   lists its parent, **Then** it is present with a count of 0 — and **When** the
   "hide directories without duplicates" checkbox is ticked, **Then** it
   disappears.
3. **Given** a directory holding a mix of files, **When** the user opens it,
   **Then** only the files that are duplicates are listed, each with the number
   of times its content appears in the scan.
4. **Given** any directory level, **When** the user sorts by duplicate count or
   by duplicate size, **Then** the rows re-order accordingly, and clicking the
   active column again reverses them.
5. **Given** a path marked as ignored, **When** the user re-scans and returns to
   this tab, **Then** the counts of every directory above it have dropped
   accordingly — both tabs read the same result set.

---

### User Story 5 - Delete a duplicate copy (Priority: P3)

Added after the feature shipped, at the user's request — and the first thing in
this tool that touches the user's files.

From the dialog listing where a content lives, each copy offers a Delete button.
Pressing it does not delete anything yet: it asks the server what would happen
and shows the answer — where the file would go, how many bytes that frees, and
whether this was the second-to-last copy — and only a second, explicit click
carries it out. "Delete" then means **move**: the file is relocated under the
trash root with its whole original path recreated, so getting it back is a `mv`
away.

**Why this priority**: it closes the loop — finding duplicates is only useful if
you can act on them — but it is P3 because it depends on everything else being
right first, and because acting on the wrong file is the one mistake this tool
could make that the user cannot undo by re-scanning.

**Independent Test**: with a content duplicated three times, delete one copy and
confirm the file is gone from its original path, present under the trash root at
the same relative structure, and reported as two copies afterwards.

**Acceptance Scenarios**:

1. **Given** a content with three copies, **When** the user presses Delete on
   one, **Then** nothing changes on disk until the preview is confirmed, and the
   preview states the destination and the bytes freed.
2. **Given** that preview, **When** the user confirms, **Then** the file is
   moved to `<trash>/<its full original path>`, disappears from the dialog, and
   the by-directory counts and sizes above it drop accordingly.
3. **Given** a content down to two copies, **When** the user deletes one,
   **Then** the remaining copy stops being a duplicate: the group leaves the
   results and the dialog closes.
4. **Given** a content with a single copy left, **When** anything asks to delete
   it, **Then** the system refuses — the last copy is never deletable.
5. **Given** a symlink, a directory, a path outside the scanned root, or a scan
   in progress, **When** a deletion is requested, **Then** it is refused with
   the reason.

---

### Edge Cases

- **Path does not exist, is not a directory, or cannot be read**: the scan does
  not start and the user is told which of those it was.
- **Scan root lies inside an ignored subtree**: the scan completes reporting no
  duplicates, and the user is told the root itself is ignored.
- **Empty directory**: the scan completes with an explicit "no duplicates found"
  state rather than a blank listing.
- **Zero-byte files**: every empty file shares the same content, so they can
  form a single enormous group. They are reported, but marked so the user does
  not mistake them for real redundant data.
- **Empty folders**: with folder detection on, all empty folders are identical
  to each other and are marked the same way.
- **A file cannot be read mid-hash** (permissions, I/O error, disappeared): the
  scan skips it, counts it, and keeps going; the count is surfaced in the status
  panel.
- **Files change while the scan runs**: the scan reports what it observed; a
  re-scan is the way to refresh. Results are stamped with when the scan ran.
- **Symlinks**: never followed and never reported, so a symlink pointing at a
  file inside the scanned tree never inflates a group.
- **Hard links**: two paths sharing one inode have identical content and are
  reported as duplicates like any other pair.
- **An ignored path no longer exists on disk**: it stays in the ignored-paths
  view (harmless) and can be un-ignored from there.
- **Groups with thousands of occurrences**: expanding one must stay responsive
  and must not require loading every other group's paths.
- **A new scan is requested while one is running**: the running scan is not
  disturbed; the user is told to stop it first.

## Requirements _(mandatory)_

### Functional Requirements

#### Scan form and lifecycle

- **FR-001**: The system MUST expose a dedicated Find Duplicates view reachable
  from the dashboard shell's sidebar.
- **FR-002**: The view MUST offer a text input for the directory path to scan, a
  checkbox to also detect duplicate folders (unchecked by default), and a Scan
  button.
- **FR-003**: The system MUST remember the last scanned path and the last state
  of the folder-detection checkbox, and pre-fill them when the view is reopened.
- **FR-004**: The system MUST reject a scan whose path does not exist, is not a
  directory, or cannot be read, and MUST tell the user which of those applies
  without starting a scan.
- **FR-005**: A scan MUST run in the background: the user can navigate away,
  reload, or close the page and come back to a scan that is still progressing.
- **FR-006**: While a scan runs, the system MUST show its state (running,
  finished, stopped, failed), the path currently being processed, a
  processed/total counter, and the number of entries skipped because they could
  not be read.
- **FR-007**: The user MUST be able to stop a running scan, including while a
  large file is being read, and the results found so far MUST remain visible and
  be labelled as partial.
- **FR-008**: The system MUST run at most one scan at a time and MUST tell the
  user to stop the running one rather than silently queueing or cancelling it.
- **FR-009**: Re-scanning MUST replace the previous results of that scan rather
  than accumulate on top of them.
- **FR-010**: A failure that affects a single entry (unreadable file or folder)
  MUST NOT abort the scan.

#### Duplicate detection

- **FR-011**: The system MUST traverse the scanned directory recursively and
  MUST NOT follow symlinks.
- **FR-012**: The system MUST report a group of duplicate files for every
  content checksum shared by two or more files inside the scanned directory.
- **FR-013**: The system MUST NOT read the content of a file whose size is
  unique within the scanned directory, and MUST NOT read a file in full when a
  checksum of its first bytes already distinguishes it from every other
  same-sized candidate.
- **FR-014**: The system MUST report groups of duplicate folders — folders whose
  recursive content and structure are identical, i.e. the same child names, of
  the same kind, with the same content — only when the user checked the
  folder-detection checkbox for that scan.
- **FR-015**: When folder detection is on, the system MUST omit a file or folder
  group when every one of its occurrences lies inside the members of a single
  reported duplicated-folder group (the folder duplicate fully explains it), and
  MUST keep the group in full otherwise, so an extra copy living outside the
  duplicated folders is never hidden.
- **FR-016**: The system MUST include zero-byte files and empty folders in the
  results and MUST mark them visually so they are distinguishable from other
  groups at a glance.
- **FR-017**: The system MUST reuse a checksum already computed by the directory
  comparison tool only when the recorded size and modification time still match
  what the filesystem reports; the absence of a reusable checksum MUST cause the
  file to be hashed, never to be treated as non-duplicate.

#### Results listing

- **FR-018**: The results MUST be presented as a paginated listing of groups,
  each row showing the checksum, whether it is a file or a folder group, the
  size of one occurrence, and how many times that content appears.
- **FR-019**: A group row MUST expand to reveal every path where that content
  appears.
- **FR-020**: The user MUST be able to sort the listing by size or by number of
  occurrences, in either direction, and both the chosen field and direction MUST
  be remembered across sessions. (Direction added after the first implementation
  pass, at the user's request — descending answers "what should I clean up
  first", ascending answers "what is safe to dismiss".)
- **FR-020a**: Each group row MUST state whether it is a file or a folder in
  words, not by icon alone (user request) — the two kinds behave differently,
  since a folder group collapses the duplicate files inside it.
- **FR-021**: The user MUST be able to copy any reported path to the clipboard,
  and separately to copy just the folder that contains it (user request) — that
  is what you need to go open the location.
- **FR-022**: The system MUST show an explicit "no duplicates found" state, and
  MUST distinguish it from "no scan has been run yet".
- **FR-023**: The results, including the timestamp of the scan that produced
  them, MUST survive a page reload and a server restart.

#### By-directory view (User Story 4)

- **FR-031**: The results MUST be presented in two tabs — the by-directory view
  and the checksum listing — and the chosen tab MUST be remembered across
  sessions. The by-directory view is the default (user request): "which folder
  is the problem" is the question worth opening on.
- **FR-032**: Every directory row MUST show how many duplicates lie anywhere
  beneath it and how many bytes those duplicates occupy, and the view MUST state
  the current subtree's share of the scan's total.
- **FR-033**: Files MUST be listed only when they are themselves one of the
  duplicates found; ordinary files MUST NOT appear.
- **FR-034**: A directory holding no duplicates MUST still be listed, showing 0,
  and a checkbox MUST hide every such directory when the user asks for it.
- **FR-035**: The listing MUST be sortable by duplicate count, by duplicate size
  and by name, in either direction, and the choice MUST be remembered across
  sessions.
- **FR-036**: Navigation MUST start at the scanned root and move one directory
  at a time, with a breadcrumb back to the root, and MUST NOT go above the root
  — no results exist there.
- **FR-037**: Both tabs MUST read the same persisted result set, so ignoring a
  path lowers the by-directory counts exactly as it removes rows from the
  checksum listing.

**Counting rule**: a duplicated folder counts as one duplicate item carrying its
whole subtree's size. Its inner files are already collapsed out of the result
set (FR-015), so nothing is counted twice — except in the one case FR-015
deliberately keeps: a file inside a duplicated folder that ALSO has a copy
outside it stays reported in its own right, and therefore contributes its bytes
both on its own and inside its folder's subtree size. That is a consequence of
reporting both facts, not an accounting error, and it only arises for content
duplicated across the folder boundary.

- **FR-044**: The by-directory view MUST offer two independent filters — leave
  out empty files, and leave out empty directories — and each MUST remove that
  content from the counts and sizes as well as from the rows, since an empty
  file is technically a duplicate of every other empty file and almost never
  what the user is looking for. Both MUST be remembered across sessions. Hiding
  the _row_ of a truly childless directory depends on the folder pass having
  run; with folder detection off no row is hidden, because guessing would risk
  hiding a directory that has content.

#### Deleting a duplicate copy (User Story 5)

- **FR-038**: From the occurrences dialog, each copy MUST offer to delete that
  copy, and only for files — folders are never removed, since that would mean a
  recursive delete.
- **FR-039**: Deleting MUST be a two-step operation (constitution Principle V):
  a dry-run that reports exactly what would change and touches nothing, then an
  explicit confirmation of that preview. The preview MUST state the destination,
  the bytes freed at the original location, and whether the group is about to
  leave the results.
- **FR-040**: The system MUST refuse to delete the last remaining copy of a
  content (user rule). Once a single copy is left, the content is not duplicated
  any more, its group leaves the results, and no deletion of that file may be
  offered or accepted.
- **FR-041**: The system MUST only delete paths the current scan reported, and
  MUST refuse symlinks, directories, anything outside the scanned root, anything
  already inside the trash area, and any request made while a scan is running.
- **FR-042**: Deleting MUST move the file into a trash area, recreating its full
  original path underneath — `/a/b/c/d.txt` becomes `<trash>/a/b/c/d.txt` — so
  the operation is reversible by hand. Nothing may be overwritten there: a name
  already taken gets a numeric suffix. The trash root defaults to the app's
  `data/` directory (`/app/data` in the container) and is overridable with
  `DUPLICATE_FINDER_TRASH_DIR`.
- **FR-043**: After a deletion the results MUST be recomputed: the occurrence
  disappears, the group's count drops, the group itself disappears when fewer
  than two copies remain, and both the dialog and the by-directory listing MUST
  reflect that without a re-scan.

#### Ignore list

- **FR-024**: The user MUST be able to mark any reported file or folder path as
  ignored, directly from the results listing.
- **FR-025**: An ignored folder MUST exclude that folder and everything beneath
  it from subsequent scans; an ignored file MUST exclude only that file.
- **FR-026**: Marking a path as ignored MUST remove it from the current results
  immediately, and MUST remove its group entirely when fewer than two
  occurrences remain.
- **FR-027**: The system MUST offer a dedicated view listing every ignored path
  with the date it was ignored, from which the user can un-ignore it; an
  un-ignored path MUST be reported again by the next scan.
- **FR-028**: This feature's ignore list MUST be independent of the directory
  comparison tool's ignore list — marking a path in one MUST NOT affect the
  other.

#### Safety

- **FR-029**: The feature MUST NOT modify, rename or erase anything on the
  scanned filesystem. The single exception is the deletion of a duplicate copy
  (User Story 5), which is a **move into the trash area**, never an erase —
  revised from the original "no filesystem mutation at all" at the user's
  request.
- **FR-030**: The feature MUST NOT write to the directory comparison tool's
  stored data; it may only read from it.

### Key Entities

- **Scan run**: one execution of a scan — the scanned root path, whether folder
  detection was on, its state (running, finished, stopped, failed), progress
  counters, the number of unreadable entries, and when it started and ended.
- **Duplicate group**: one content checksum found two or more times within a
  scan — its kind (file or folder), the size of a single occurrence, the number
  of occurrences, and whether it represents empty content.
- **Occurrence**: one path belonging to a duplicate group.
- **File fact**: what the scan knows about a scanned file — its path, size,
  modification time and, once computed, its content checksum — so a later scan
  can reuse it instead of reading the file again.
- **Ignored path**: a path the user excluded from duplicate search, with the
  date it was ignored and whether it excludes a whole subtree.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user who knows the path can start a scan in at most three
  interactions (type the path, optionally tick the checkbox, press Scan).
- **SC-002**: Scanning a directory in which no two files share a size completes
  without reading the content of a single file — the elapsed time is that of
  listing the tree, not of reading it.
- **SC-003**: Two folders duplicated with 5,000 files inside produce exactly one
  row in the listing instead of 5,000.
- **SC-004**: Any page of the listing appears within 2 seconds regardless of how
  many groups the scan found, including with 100,000 groups.
- **SC-005**: Pressing Stop halts the scan within 2 seconds, even while a
  multi-gigabyte file is being read.
- **SC-006**: Reopening the view after a server restart shows the last scan's
  results with no re-scan and no user action.
- **SC-007**: After ignoring a folder, a re-scan of the same root reports zero
  paths beneath that folder.
- **SC-008**: 100% of scans leave the scanned filesystem and the directory
  comparison tool's stored data byte-for-byte unchanged.
- **SC-009**: A second scan of an unchanged directory completes measurably
  faster than the first, because no file is read twice.

## Assumptions

- The view lives at `/duplicate-finder` and is labelled "Find Duplicates" in the
  sidebar; the ignored-paths view lives beneath it, mirroring the existing
  ignored-paths view of the directory comparison tool.
- The listing shows 50 groups per page and is sorted by size, descending, until
  the user chooses otherwise.
- Expanding a group lists all of its occurrences; groups are expected to hold
  tens of paths, not thousands, so occurrence lists are not paginated
  themselves.
- "Same content" means an identical content checksum; the theoretical
  possibility of a checksum collision is accepted without a byte-by-byte
  confirmation pass, consistent with the directory comparison tool.
- A folder's own name is not part of its identity: two identically-named folders
  with different content are not duplicates, and two differently-named folders
  with identical content are.
- Hard links are treated as ordinary paths — two hard links to one inode are
  reported as duplicates.
- Deleting, moving, or merging duplicates is explicitly out of scope for this
  feature and is deferred to a later spec, as is exporting the results.
- Only one directory root is scanned at a time; comparing two arbitrary
  directories remains the directory comparison tool's job.
- The feature keeps its own stored data, separate from the other tools', so it
  can be reset independently, and reads the comparison tool's checksums purely
  as an optional accelerator that may be entirely absent.
- The user is the single operator of a self-hosted app with direct filesystem
  access, so no permission model beyond the operating system's own applies.
