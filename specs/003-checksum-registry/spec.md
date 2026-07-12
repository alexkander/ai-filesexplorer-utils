# Feature Specification: Checksum Registry and Duplicate Finder

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

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Build a checksum registry by indexing a directory (Priority: P1)

A user picks a directory (browsing the same way as the existing Count and Size
tool) and starts an index. The tool computes a content checksum for every file
in that directory's subtree and a derived checksum for every subdirectory, so
that identical content can later be recognized regardless of where it lives.

**Why this priority**: Nothing else in this feature is possible without an index
existing first. This is the foundation every other story is built on, and — like
Count and Size — it must be resumable and non-blocking to be usable on a large
personal file collection.

**Independent Test**: From a directory that has never been indexed, press
"Scan". Confirm indexing proceeds in the background, the user can keep browsing
elsewhere while it runs, and once finished every file in the subtree has a
recorded checksum and every directory has a recorded checksum derived from its
contents.

**Acceptance Scenarios**:

1. **Given** a directory has never been indexed, **When** the user presses
   "Scan", **Then** an indexing procedure starts for that directory and
   recursively for every subdirectory, computing a content checksum for each
   direct file.
2. **Given** an indexing procedure is running, **When** the user navigates to an
   unrelated directory or leaves the tool, **Then** indexing continues in the
   background and the rest of the application remains responsive.
3. **Given** an indexing procedure completes for a directory, **When** the user
   views that directory, **Then** it shows a checksum derived from its direct
   entries' checksums and a last-indexed timestamp.
4. **Given** a directory was already fully indexed and nothing under it changed
   on disk, **When** the user presses "Scan" again, **Then** no file content is
   re-read and no checksums are recomputed.
5. **Given** a directory was already fully indexed and one file under it changed
   (different size or modification time), **When** the user presses "Scan"
   again, **Then** only that file's checksum is recomputed, and only the
   directory checksums along the path from that file up to the indexed root are
   recomputed — unrelated siblings and their subtrees are left untouched.
6. **Given** the user wants to redo an index from scratch, **When** they use the
   separate "Force full rescan" action, **Then** every file and directory
   checksum in that subtree is recomputed, overwriting prior results.
7. **Given** an indexing procedure is active, **When** the user presses Stop,
   **Then** the running procedure and its already-spawned in-flight descendants
   transition to a Stopped state without deleting or altering any file.
8. **Given** a file was listed successfully but its content cannot be fully read
   while computing its checksum (e.g. a permission change or I/O error after
   listing), **When** indexing processes that file, **Then** the file is
   skipped, its containing directory is flagged as having unreadable entries and
   incomplete, and no directory checksum is computed for that directory or any
   of its ancestors up to the indexed root.

---

### User Story 2 - Find duplicate files (Priority: P2)

A user opens a view listing every group of files that share identical content,
discovered from the index, so they can see at a glance where the same file
exists in multiple places.

**Why this priority**: This is the direct payoff of indexing — the point where
"I have a registry of checksums" becomes "I can see what's wasting space." It
doesn't require the deletion action (Story 3) to already be valuable as a
read-only report.

**Independent Test**: Index a directory containing at least one pair of files
with identical content and one pair with identical size but different content.
Open the duplicates view and confirm only the identical-content pair is listed
as a duplicate group, each with its full path.

**Acceptance Scenarios**:

1. **Given** the registry contains two or more files with the same content
   checksum, **When** the user opens the duplicates view, **Then** those files
   are shown together as one duplicate group, each entry showing its full path
   and size.
2. **Given** the registry contains files that share the same size but not the
   same content, **When** the user opens the duplicates view, **Then** those
   files are not shown as a duplicate group.
3. **Given** the indexed tree contains no duplicate files at all, **When** the
   user opens the duplicates view, **Then** it clearly indicates that no
   duplicates were found rather than showing an empty, unexplained list.
4. **Given** a directory has not been indexed yet, **When** the user opens the
   duplicates view, **Then** files under that directory are not considered (the
   view only reflects what has been indexed).

---

### User Story 3 - Safely delete duplicate files (Priority: P3)

From the duplicates view, a user selects which copies of a duplicate group to
remove, previews exactly what will be deleted, and confirms before anything
actually happens.

**Why this priority**: This is what turns "finding duplicates" into "reclaiming
space," but it is the highest-risk part of the feature — it must never run ahead
of the read-only reporting in Story 2, and per the project's safety principle
for destructive operations, it must always be preview-first.

**Independent Test**: From a duplicate group of two files, select one for
deletion, confirm the preview shows exactly that one file and no others, then
confirm deletion and verify only that file is removed from disk and from the
registry.

**Acceptance Scenarios**:

1. **Given** a duplicate group is shown, **When** the user selects one or more
   of its files for deletion, **Then** the tool defaults to pre-selecting all
   but one file in the group (the user can change any selection before
   proceeding).
2. **Given** one or more files are selected for deletion, **When** the user
   proceeds, **Then** a preview lists exactly the files that would be deleted
   and none are deleted yet.
3. **Given** a deletion preview is shown, **When** the user confirms it,
   **Then** exactly the previewed files are deleted from disk and removed from
   the registry.
4. **Given** a deletion preview is shown, **When** the user cancels instead of
   confirming, **Then** no file is deleted and no registry entry changes.
5. **Given** a previewed file no longer exists on disk by the time the user
   confirms (e.g. deleted externally in the meantime), **When** deletion runs,
   **Then** that entry is skipped without failing the deletion of the other
   previewed files, and the registry is updated to reflect it's gone.
6. **Given** indexing or scanning is running, **When** it operates, **Then** it
   never deletes or modifies any file — deletion only ever happens through this
   explicit, user-confirmed action.

---

### User Story 4 - Find duplicate directories (Priority: P4)

A user opens a view listing every pair of directories whose entire contents —
every file name, every subdirectory, and all their content — are identical, so
whole duplicated folder trees (e.g. an accidental double copy of a photo album)
can be found without comparing them file by file.

**Why this priority**: This is a natural extension of Story 2 once directory
checksums exist, but it delivers less immediate value on its own — most personal
duplicate clutter is individual files, not entire identical folder trees — so it
can follow after the file-level view is in place.

**Independent Test**: Index two separate directory trees that are exact copies
of each other (same file names, structure, and content) alongside a third,
similar-looking directory that differs by one file. Open the
duplicate-directories view and confirm only the first pair is listed.

**Acceptance Scenarios**:

1. **Given** two indexed directories have the same directory checksum, **When**
   the user opens the duplicate-directories view, **Then** they are shown
   together as one duplicate group with their full paths.
2. **Given** two indexed directories contain the same files but under different
   names, or in a different substructure, **When** the user views duplicate
   directories, **Then** they are not shown as a duplicate group.
3. **Given** a directory is part of a reported duplicate-directory group,
   **When** the user views the duplicate-files view (Story 2), **Then** the
   files inside that directory still appear there too if they match other files
   elsewhere — the two views are independent and neither suppresses entries
   already covered by the other.

---

### Edge Cases

- What happens when a file is modified after being indexed but before the user
  acts on a duplicates report? The report reflects the registry as of the last
  index, not the file's current state — the tool does not auto-detect staleness,
  consistent with Count and Size's behavior.
- What happens when the directory being indexed is itself unreadable when its
  own procedure starts? That procedure ends in Error, contributing nothing to
  any parent's directory checksum.
- What happens when a file passes directory listing but its content fails to be
  read while computing its checksum (permission change, I/O error, or the file
  disappearing mid-read)? It is treated the same as an unreadable entry:
  skipped, and its containing directory and every ancestor up to the indexed
  root is flagged incomplete with no computable directory checksum, rather than
  silently producing a checksum that omits it (FR-009, FR-009a).
- What happens when two directories are both incomplete (e.g. each missing an
  unrelated unreadable file)? They are never shown as a duplicate pair — only
  directories with an actual computed checksum can match (FR-009b).
- What happens to zero-byte files? They are treated like any other file; if two
  or more share the same (empty) content, they are reported as duplicates.
- What happens when the user presses "Scan" on a directory that is an ancestor
  or descendant of one already queued or actively indexing? No duplicate or
  overlapping procedures are created for the same directory, mirroring Count and
  Size's behavior.
- What happens if the application restarts or crashes mid-index? In-flight
  procedures are surfaced as Stopped, not silently resumed or left showing a
  misleading in-progress state; a later "Scan" resumes only what's outstanding.
- What happens when deleting one file from a duplicate group leaves only one
  file remaining in that group? The group simply stops being reported as a
  duplicate the next time the duplicates view is loaded.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST let the user start an indexing procedure rooted at
  a directory, using the same directory-browsing experience as the Count and
  Size tool.
- **FR-002**: Indexing MUST compute a content checksum for every direct file in
  the indexed directory and MUST recursively create an equivalent indexing
  procedure for every subdirectory.
- **FR-003**: Before computing a file's full-content checksum, the system MUST
  first rule out files that cannot possibly share content using cheaper
  comparisons (at minimum, file size), and MUST only perform a full-content
  comparison for files that remain plausible matches after those cheaper
  comparisons — so files with no same-size counterpart never have their full
  content read.
- **FR-004**: Each directory's checksum MUST be derived only from its direct
  entries (each child file's checksum, each child subdirectory's own checksum,
  and their names/types) — not by re-reading the full recursive contents of the
  subtree on every computation.
- **FR-005**: A directory checksum MUST change if anything in its subtree
  changes — a different file, a renamed entry, a different substructure, or
  different content — and MUST stay the same only when every name, type, and
  content match exactly.
- **FR-006**: The default "Scan" action MUST behave incrementally: it MUST skip
  recomputing a file's checksum when that file's size and modification time are
  unchanged since it was last indexed, and MUST skip an entire subdirectory
  whose last indexing procedure completed successfully and remains unaffected by
  any change beneath it.
- **FR-007**: A separate, explicit "Force full rescan" action MUST be available
  that ignores all prior indexing state for the selected directory's subtree and
  recomputes every checksum in it from scratch.
- **FR-008**: The system MUST support only one actively-running indexing
  procedure system-wide at a time; requests made while one is active MUST be
  enqueued, not run concurrently or discarded.
- **FR-009**: Symbolic links MUST be ignored during indexing — not followed, not
  checksummed. Files or subdirectories that cannot be read MUST be skipped, and
  the containing directory MUST be flagged as having unreadable entries. This
  applies both when an entry cannot be listed at all (permissions, broken entry)
  and when a file's content cannot be fully read while computing its checksum
  after having been listed successfully (e.g. a permission change or I/O error)
  — either case is skipped and flagged the same way.
- **FR-009a**: A directory flagged as having unreadable entries (FR-009), or
  containing a descendant so flagged, MUST NOT have a directory checksum
  computed — a checksum derived from an incomplete set of children would
  misrepresent that directory's true content. Such a directory MUST instead be
  flagged incomplete, and that flag MUST propagate to every ancestor up to the
  indexed root, none of which can have a trustworthy directory checksum either
  while it applies.
- **FR-009b**: The duplicate-directories view (FR-014) MUST only compare
  directories that have a computed checksum; an incomplete directory (FR-009a)
  MUST NOT appear in any duplicate-directory group and MUST NOT be treated as
  matching (or not matching) any other directory, including another incomplete
  one.
- **FR-010**: Indexing MUST run asynchronously and MUST NOT block browsing or
  other interaction with the tool while in progress.
- **FR-011**: The system MUST provide an explicit Stop action for an active
  indexing procedure; using it MUST transition the running procedure and its
  in-flight descendants to a Stopped state.
- **FR-012**: If the application restarts or crashes while an indexing procedure
  is in progress, that procedure and its in-flight descendants MUST be surfaced
  as Stopped rather than silently resumed or shown as still running.
- **FR-013**: The system MUST provide a view listing every group of two or more
  indexed files that share an identical content checksum, showing each file's
  full path and size.
- **FR-014**: The system MUST provide a separate view listing every group of two
  or more indexed directories that share an identical directory checksum,
  showing each directory's full path.
- **FR-015**: From a duplicate file group, the user MUST be able to select which
  of its files to delete; the system MUST pre-select all but one file in the
  group as a starting suggestion, which the user MUST be able to change before
  proceeding.
- **FR-016**: Before deleting any selected file, the system MUST show a preview
  listing exactly the files that would be deleted, and MUST require the user to
  explicitly confirm that preview before any deletion occurs.
- **FR-017**: Deletion MUST only occur through the explicit, previewed,
  user-confirmed action in FR-016; indexing, scanning, or viewing duplicates
  MUST NOT delete or modify any file as a side effect.
- **FR-018**: If a previewed file no longer exists on disk when the user
  confirms deletion, the system MUST skip it without failing the deletion of the
  other previewed files, and MUST update the registry to reflect that it's gone.
- **FR-019**: All checksums (file and directory), indexing procedure state, and
  last-indexed timestamps MUST be persisted so they remain available after an
  application restart, independently of the Count and Size tool's own persisted
  data.
- **FR-020**: The tool MUST be reachable as its own section from the dashboard
  shell's navigation, distinct from the Count and Size tool.

### Key Entities

- **File Checksum Entry**: One indexed file. Tracks: path, size, modification
  time as of last index, content checksum, and last-indexed timestamp. Used to
  skip recomputation (FR-006) and to find file-level duplicate groups (FR-013).
- **Directory Index Node**: The indexing procedure and result for one directory.
  Tracks: directory path, state (mirroring Count and Size's Not indexed /
  Indexing / Completed / Error / Stopped), depth, its own directory checksum
  (derived from direct entries, absent whenever the node is incomplete), whether
  it has unreadable entries, whether it is incomplete (itself or any descendant
  has unreadable entries — FR-009a), and the last-indexed timestamp. Related to
  its parent's node and to one node per child directory.
- **Duplicate File Group**: A set of two or more File Checksum Entries sharing
  the same content checksum.
- **Duplicate Directory Group**: A set of two or more Directory Index Nodes
  sharing the same directory checksum.
- **Deletion Preview**: The user-reviewed, not-yet-executed set of files
  selected for removal from a Duplicate File Group.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: After indexing a directory, a user can view every group of files
  with identical content within it, without having to compare any files
  manually.
- **SC-002**: For a tree containing large files with no same-size counterpart
  anywhere else in the tree, indexing never reads those files' full content —
  comparison is resolved from cheaper checks alone.
- **SC-003**: A user can identify whole duplicated directory trees (same
  structure and content) without opening and comparing their contents directory
  by directory.
- **SC-004**: No file is ever deleted by this tool without the user first seeing
  an exact preview of what would be removed and explicitly confirming it.
- **SC-005**: Re-running an index on an already fully-indexed, unchanged
  directory does no redundant work — no file content is re-read and no checksum
  is recomputed.
- **SC-006**: Interrupting the application mid-index and restarting it does not
  lose previously computed checksums; resuming an index only processes what was
  left outstanding.

## Assumptions

- The checksum comparison strategy is a cascade: same file size first, then a
  fast partial-content hash, then a full-content checksum (SHA-256) only for
  files still matching after both — chosen so indexing large personal file
  collections (including large media files) doesn't require reading every byte
  of every file.
- Directory checksums are structure-and-content sensitive (Merkle-tree style,
  like Git tree objects): two directories are only considered duplicates when
  every child name, type, and content match exactly, not merely when they
  contain the same content under different names or organization.
- Persistence uses its own embedded SQLite database, separate from the Count and
  Size tool's, so neither tool's data can be corrupted or blocked by the other.
- This tool reuses the same underlying scan/traverse/stop/resume mechanics
  already built for Count and Size, since both need identical tree-walking
  behavior; only the per-file/per-directory computation differs.
- The duplicate-files view and duplicate-directories view are independent and do
  not suppress or collapse entries covered by the other — a file inside a
  reported duplicate directory still appears in the file-level view too, per
  Story 4's acceptance scenario 3.
- Hard links are treated as ordinary files, consistent with Count and Size's
  precedent — detecting and special-casing shared inodes is out of scope.
- Registry entries for files or directories removed from disk since the last
  index are not automatically pruned; they remain until the next index that
  covers that subtree, consistent with Count and Size's no-auto-staleness-
  detection precedent — except entries removed via this tool's own deletion
  action (FR-018), which are updated immediately.
- No automated tests are included, per the project's manual-verification-only
  principle; correctness is verified by running the app and exercising the scan,
  duplicate-view, and deletion flows end-to-end.
- The separate "compare two arbitrary directories" tool (tracked as TODO T001)
  is a later, different feature that would consume this registry; it is out of
  scope for this spec.
