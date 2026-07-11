# Feature Specification: Count and Size Tool

**Feature Branch**: `002-count-and-size`

**Created**: 2026-07-11

**Status**: Draft

**Input**: User description: "Create a spec to add a tool called 'count and
size' that lists the directories of a specific folder and shows the space used
by that directory. It must show a directory listing starting from the root
'/'. Clicking a directory navigates into it and lists its contents. Clicking
on files has no effect. While inside any directory, it must show alongside it
whether count-and-size information is available for that directory; if not
available, nothing is shown. For the current directory, it must also show when
it was last scanned (date and time in ISO format), or 'not scanned yet' if it
has never been scanned. At all times there must be a 'Scan' button that starts
scanning the directory and its first level of subdirectories. Scanning creates
an asynchronous procedure that: counts and computes the space of the direct
files in the current directory, and creates an equivalent procedure for each
subdirectory. A directory's count + used space is the sum of all child
directories plus what is computed from its direct files. A procedure can be in
the following states: Completed (it and all its subdirectories finished
scanning), Scanning (an inner directory's procedure is not yet completed, or
its own files haven't finished being computed), Error, Not scanned (scanning
has not started), Stopped (scanning was stopped). The whole scan must be
recursive. Only one procedure can be active at a time. Links created with `ln`
must be ignored. Files and folders that cannot be read must be ignored, but
the containing folder must indicate that it has unreadable entries. While a
procedure is running, it must watch its direct child procedures — if they are
active or waiting, it must also remain waiting. Once all children are
completed correctly, it sums everything and marks itself completed; if any
child ends up inactive/incomplete for any reason, or some directory is missing
computation, it still sums everything available but marks the directory as
incomplete. Each procedure must track the directory's depth level. The order
in which procedures are resolved must be a stack (LIFO). Procedures must not
block the UI; they must be asynchronous. Propose how to persist all this
information."

## Clarifications

### Session 2026-07-11

- Q: How should count-and-size results (per-directory totals, timestamps,
  procedure states) be persisted, given no persistence layer exists in the
  project today? → A: Embedded SQLite database — one row per scanned
  directory, surviving application restarts without loading the whole tree
  into memory.
- Q: Is the "Stopped" procedure state reachable only through an involuntary
  interruption (server restart/crash), or does the UI also need an explicit
  Stop/Cancel action? → A: Both — an explicit Stop/Cancel action is available
  in the UI, and an involuntary interruption also leaves in-flight procedures
  as Stopped.
- Q: When the user presses Scan on a directory that already has prior (full or
  partial) data, does it rescan everything from scratch, or only fill in
  what's missing? → A: Full rescan — the entire subtree is scanned again,
  overwriting previous results.
- Q: A procedure that has been created (requested via Scan, or spawned as a
  child) but is still waiting its turn in the stack — which of the 5 states
  should it show as? → A: Scanning — a procedure shows Scanning as soon as it
  is created/queued, even before the worker actually starts processing it.
- Q: How should the browsing listing behave for a directory with an unusually
  large number of direct entries (tens of thousands+)? → A: Paginate /
  lazy-load entries as the user scrolls or pages, so the listing stays
  responsive regardless of directory size.
- Q: While a scan is actively running, does the currently-viewed directory's
  status/data auto-update, or does the user need to manually refresh? → A:
  The currently-viewed directory auto-refreshes periodically (polling) while
  a scan affecting it is active; this does not extend to a full real-time
  push architecture for the whole tree.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Browse the filesystem and see scan status at a glance (Priority: P1)

A user opens the Count and Size tool and browses the filesystem starting at
the root ("/"), clicking into directories to explore their contents. At every
point, they can immediately tell whether count-and-size data exists for the
directory they're looking at, and when it was last computed.

**Why this priority**: This is the foundational browsing experience the rest
of the tool is built on. It delivers value on its own (a directory explorer
with scan-status awareness) even before any scan has ever been run, and every
other story depends on it.

**Independent Test**: Open the tool with no scans ever having been run. Starting
at "/", click into a few nested directories and back out. Verify each listing
shows directories (clickable) and files (not clickable), that directories with
no scan data show no availability indicator, and that the current directory
shows "not scanned yet".

**Acceptance Scenarios**:

1. **Given** the user opens the tool, **When** the page loads, **Then** it
   shows the contents of the root directory ("/") as a list of files and
   directories.
2. **Given** a directory listing is shown, **When** the user clicks a
   directory entry, **Then** the view navigates into that directory and shows
   its contents.
3. **Given** a directory listing is shown, **When** the user clicks a file
   entry, **Then** nothing happens.
4. **Given** the user is viewing any directory, **When** that directory has
   never been scanned, **Then** the view shows a "not scanned yet" indicator
   instead of a last-scanned date.
5. **Given** a directory listing contains subdirectories, **When** a
   subdirectory has no count-and-size data available, **Then** no
   availability indicator is shown next to it.

---

### User Story 2 - Run a scan and see aggregated results (Priority: P2)

From any directory, the user starts a scan and watches it compute, in the
background, the total file count and used space for that directory and all of
its descendants — without losing the ability to keep browsing elsewhere while
it runs.

**Why this priority**: This is the core value the tool is named for. It
builds directly on User Story 1's browsing view to actually produce and
display the count-and-size numbers.

**Independent Test**: From a directory with no prior scan, press "Scan".
Confirm the state moves from Not scanned to Scanning and eventually to
Completed, that the user can navigate to other directories while it runs, and
that once done, the directory shows a total file count, total used space, and
an ISO 8601 last-scanned timestamp.

**Acceptance Scenarios**:

1. **Given** a directory has never been scanned, **When** the user presses
   "Scan", **Then** a scan procedure starts for that directory and an
   equivalent procedure is created for each of its subdirectories,
   recursively.
2. **Given** a scan is in progress for a directory, **When** the user
   navigates to a different, unrelated directory, **Then** browsing remains
   fully responsive and unaffected by the ongoing scan.
2a. **Given** the user stays on a directory whose scan is actively in
    progress, **When** time passes without the user taking any action,
    **Then** the displayed status/data periodically refreshes on its own to
    reflect progress, without requiring a manual page reload.
3. **Given** a directory's scan and all of its descendant procedures complete
   successfully, **When** the user views that directory, **Then** it shows a
   total file count and total used space equal to the sum of its direct
   files plus all descendant directories' totals, along with the current ISO
   8601 timestamp as "last scanned".
4. **Given** a scan is already active somewhere in the tree, **When** the
   user presses "Scan" on another directory, **Then** the new request is
   queued rather than run at the same time as the active one.
5. **Given** a directory already has prior scan data, **When** the user
   presses "Scan" on it again, **Then** its entire subtree is scanned again
   from scratch and the previous results are overwritten once the new scan
   completes.

---

### User Story 3 - Trust incomplete or interrupted results (Priority: P3)

While or after scanning, the user can tell when a directory's numbers don't
represent the full picture — because part of the scan errored, was stopped,
hit unreadable files, or is still waiting on a descendant — instead of seeing
a number that looks final but silently isn't.

**Why this priority**: This is what makes the numbers from User Story 2
trustworthy. It's not required for the tool to compute and show a number, but
it's required for the user to know when to trust that number.

**Independent Test**: Start a scan on a directory that contains at least one
unreadable file or subdirectory, and separately, press Stop while a scan is
in progress. Confirm both cases leave a visible indicator (unreadable entries
present / incomplete / stopped) alongside whatever best-effort totals were
computed.

**Acceptance Scenarios**:

1. **Given** a directory contains a file or subdirectory that cannot be read,
   **When** its scan procedure runs, **Then** that entry is skipped and the
   directory is flagged as containing unreadable entries.
2. **Given** a directory's procedure has one or more descendant procedures
   still Scanning or Not scanned, **When** the user views that directory,
   **Then** it shows the Scanning state.
3. **Given** a directory's procedure has a descendant that ended in Error or
   Stopped, **When** all other descendants finish, **Then** the directory is
   marked incomplete (not Completed) while still reporting the sum of
   whatever data is available.
4. **Given** a scan is actively running, **When** the user presses
   Stop/Cancel, **Then** the running procedure and its already-spawned
   in-flight descendant procedures transition to the Stopped state.
5. **Given** a procedure is in the Scanning state, **When** the application
   restarts or crashes and is brought back up, **Then** that procedure is
   shown as Stopped rather than silently resuming or still showing Scanning.

---

### Edge Cases

- What happens when a directory is deleted or renamed on disk after being
  scanned? The last known data and its (now stale) timestamp continue to be
  shown; the tool does not auto-detect or auto-refresh staleness.
- What happens when the user presses Scan on a directory that is an ancestor
  or descendant of a directory already queued or actively scanning? No
  duplicate or overlapping procedures are created for the same directory.
- What happens when the directory being scanned is itself unreadable at the
  moment its own procedure starts? That procedure ends in the Error state
  immediately, contributing zero to any parent's totals.
- What happens when a directory contains only ignored entries (symlinks,
  unreadable files) and nothing else? It completes with a total count and
  size of zero, flagged as containing unreadable entries if applicable.
- What happens when the user presses Stop on a top-level scan that has
  already spawned several nested descendant procedures? Stopping applies to
  the whole in-flight subtree, not only the top directory.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST show a browsable listing of filesystem entries
  (files and directories) starting at the root ("/").
- **FR-001a**: A directory listing with an unusually large number of direct
  entries MUST be paginated or lazily loaded (e.g., as the user scrolls or
  pages), rather than loading and rendering every entry at once, so browsing
  remains responsive regardless of directory size.
- **FR-002**: Clicking a directory entry in a listing MUST navigate into that
  directory and display its contents.
- **FR-003**: Clicking a file entry in a listing MUST have no effect.
- **FR-004**: For each subdirectory shown in a listing, the system MUST
  indicate, next to it, whether count-and-size data is currently available;
  when not available, no such indicator MUST be shown for that entry.
- **FR-005**: For the directory currently being viewed, the system MUST show
  when it was last scanned as an ISO 8601 date and time, or a "not scanned
  yet" indicator if it has never been scanned.
- **FR-006**: A "Scan" action MUST be available at all times, for any
  directory currently being viewed, regardless of whether it has existing
  data.
- **FR-007**: Starting a scan on a directory MUST compute the count and total
  size of that directory's direct files, and MUST create an equivalent scan
  procedure for each of its subdirectories, recursively.
- **FR-008**: A directory's total count and total used size MUST equal the
  sum of its own direct files' count/size plus the totals reported by each of
  its child directory procedures.
- **FR-009**: Each scan procedure MUST be in exactly one of the following
  states at any time: Not scanned, Scanning, Completed, Error, or Stopped.
- **FR-010**: A procedure MUST show the Scanning state from the moment it is
  created (requested via Scan, or spawned as a child of another procedure) —
  including while it is still waiting its turn in the queue — through until
  its own direct files finish being computed and every one of its descendant
  procedures has completed; there is no separate "queued" indicator distinct
  from Scanning.
- **FR-011**: A procedure MUST be marked Completed only when it and every one
  of its descendant procedures completed successfully; if any descendant ends
  in Error or Stopped, or is otherwise missing/incomplete, the procedure MUST
  instead be marked incomplete while still reporting the best-effort sum of
  whatever count/size data is available.
- **FR-012**: The system MUST support only one actively-running scan
  procedure system-wide at any time.
- **FR-013**: A scan request made while another scan is active or other scans
  are pending MUST be enqueued rather than run concurrently or discarded.
- **FR-014**: Pending scan procedures MUST be resolved in a stack (last-in,
  first-out) order.
- **FR-015**: Symbolic links MUST be ignored during scanning — not followed,
  not counted, not sized.
- **FR-016**: Files or subdirectories that cannot be read MUST be skipped
  during scanning, and the containing directory's procedure MUST indicate
  that it contains unreadable entries.
- **FR-017**: Scanning MUST run asynchronously and MUST NOT block navigation
  or other interaction with the tool's UI while in progress.
- **FR-017a**: While the directory currently being viewed has an active (or
  recently active) scan procedure anywhere in its own tree, the system MUST
  periodically refresh that directory's displayed status and data so the
  user sees progress without needing to manually reload the page. This
  auto-refresh applies only to the directory currently in view, not to the
  whole tree at once.
- **FR-018**: The system MUST provide an explicit Stop/Cancel action for an
  active scan; using it MUST transition the running procedure and its
  already-spawned in-flight descendant procedures to the Stopped state.
- **FR-019**: If the application is restarted or crashes while a procedure is
  in the Scanning state, that procedure and its in-flight descendants MUST be
  surfaced as Stopped rather than silently resumed or left showing a
  misleading Scanning status.
- **FR-020**: Each scan procedure MUST record the depth level of its
  directory (its distance from the root "/").
- **FR-021**: Starting a scan on a directory that already has prior (complete
  or partial) data MUST perform a full rescan of that directory's entire
  subtree, overwriting the previous results once the new scan completes.
- **FR-022**: All count/size results, per-directory procedure state,
  last-scanned timestamps, and depth level MUST be persisted so they remain
  available after an application restart.

### Key Entities

- **Directory Scan Procedure**: The count-and-size computation for one
  directory. Tracks: directory path, state (Not scanned / Scanning /
  Completed / Error / Stopped), depth level, direct file count and size,
  aggregated (total, including descendants) count and size, whether it has
  unreadable entries, and the last-scanned timestamp (ISO 8601). Related to
  its parent directory's procedure and to one procedure per child directory.
- **Filesystem Entry**: A single row in a directory listing — a file or a
  directory. Tracks: name, type (file/directory), and, for directories, a
  reference to its latest Directory Scan Procedure (if any), used to render
  the availability indicator.
- **Scan Queue**: The ordered backlog of directory scan procedures waiting to
  run, resolved in stack (LIFO) order, with only one procedure actively
  running system-wide at a time.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: From any directory in the tree, a user can tell — without
  navigating away — whether count-and-size data exists for it and, if so,
  when it was last computed, or that it has never been scanned.
- **SC-002**: A user can start a scan on any directory and continue browsing
  other parts of the tree while that scan runs, with the UI remaining
  responsive throughout.
- **SC-003**: After a scan completes successfully, the displayed count and
  size for a directory reflect the full recursive contents of that directory
  (all descendant files, excluding ignored symlinks and unreadable entries).
- **SC-004**: When a scan is interrupted, errors, or leaves any part of the
  subtree incomplete, the user is clearly told the result is incomplete
  rather than being shown a number that silently understates reality.
- **SC-005**: When multiple scans are requested over time, all of them are
  eventually processed — none are silently lost — while at most one runs at
  a time.
- **SC-006**: Previously computed count-and-size results and their
  timestamps remain available immediately after restarting the application,
  without needing to rescan.
- **SC-007**: Browsing into a directory with a very large number of direct
  entries remains responsive — the page does not freeze or become unusable
  while the listing loads.

## Assumptions

- "Count" means the number of files (directories themselves are not counted)
  contained directly and recursively within a directory; "size" means the
  total bytes used by those files.
- Symbolic links are ignored entirely and never followed. Hard links are
  treated as ordinary files — the filesystem does not distinguish them
  without extra inode-tracking, which is out of scope (YAGNI).
- Persistence is implemented with an embedded SQLite database (per project
  decision), storing one row per scanned directory (path, state, depth,
  direct/aggregated count & size, unreadable-entries flag, last-scanned
  timestamp) plus the pending scan queue, so results and in-progress state
  survive application restarts.
- The Stop action stops the requested procedure and all of its
  already-spawned in-flight descendant procedures; any descendant not yet
  started when Stop is pressed simply never starts and remains Not scanned.
- Per the project's single-user, self-hosted deployment model, the tool has
  direct read access to the local filesystem starting at "/", limited only by
  the OS-level permissions of the account running the application; no
  authentication or per-user access control applies.
- This is a read-only tool — it never deletes, moves, or modifies files — so
  the project's dry-run/confirmation requirement for destructive operations
  does not apply to it.
- Pressing Scan on a directory scans that directory's direct files and
  spawns child procedures for its immediate subdirectories; those child
  procedures recursively do the same for their own descendants, so a single
  Scan click ultimately scans the directory's entire subtree.
- No automated tests are included, per the project's manual-verification-only
  principle.
