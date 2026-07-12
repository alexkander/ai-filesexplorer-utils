---
description: 'Task list for Directory Comparison Tool'
---

# Tasks: Directory Comparison Tool

**Input**: Design documents from `/specs/003-checksum-registry/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: This project's constitution (Principle IV) prohibits automated tests.
No test tasks are included below — verification is manual, via `quickstart.md`
(Polish phase, T038).

**Organization**: Tasks are grouped by user story (from spec.md) to enable
independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete
  task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are relative to the repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Close the one gap left by the prior scan-engine extraction (PR #6)
before any new code depends on it (research.md Decision 6). No new runtime
dependency is needed for this feature.

- [ ] T001 [P] Move `infrastructure/count-and-size/filesystem-adapter.ts` to
      `infrastructure/scanning/filesystem-adapter.ts` (no content changes — it
      was already generic `fs.readdir`/`stat` logic with zero count/size
      awareness). Update `infrastructure/count-and-size/scan-worker.ts`'s import
      accordingly (research.md Decision 6).
- [ ] T002 Create the `domain/directory-comparison/`,
      `application/directory-comparison/`,
      `infrastructure/directory-comparison/`, and
      `infrastructure/directory-comparison/ui/` directory scaffolding, per
      `plan.md`'s Project Structure.

**Checkpoint**: Shared `filesystem-adapter.ts` reused by both tools; scaffolding
ready.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The one thing every user story needs — the tool being reachable at
all. (Unlike Count and Size, this feature's persistence/domain types are only
needed starting at User Story 3 — Compare — since User Stories 1 and 2 are pure
browsing/navigation with no comparison data; see each story's own tasks below.)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T003 [P] Update `domain/navigation/menu-entry.ts`: append
      `{ key: 'directory-comparison', label: 'Compare Directories', route: '/directory-comparison' }`
      to `menuEntries`.

**Checkpoint**: Tool is registered in the dashboard shell's navigation; ready
for User Story 1.

---

## Phase 3: User Story 1 - Browse two directories side by side (Priority: P1) 🎯 MVP

**Goal**: Two independent directory browsers (left and right panes), each
starting at `/`, navigable the same way as Count and Size — directories
clickable, files inert, an Up action per pane.

**Independent Test**: `pnpm dev`, open `/directory-comparison`. Both panes show
`/`. Navigate each pane into different subdirectories independently — neither
affects the other. Clicking a file does nothing.

### Implementation for User Story 1

- [ ] T004 [US1] Create `application/directory-comparison/list-directory.ts`: a
      use case taking `(path, offset, limit, FileSystemPort)` that lists
      `path`'s direct children via the shared `FileSystemPort.listChildren` and
      returns a page of entries plus `hasMore` — no comparison data (spec
      FR-001, FR-001a; contracts/directory-comparison-api-contract.md
      `GET /list`). (Depends on T001.)
- [ ] T005 [P] [US1] Create `app/api/directory-comparison/list/route.ts`: `GET`
      Route Handler parsing `path`/`offset`/`limit` query params, wiring the
      relocated `filesystemAdapter`, calling `list-directory.ts`, returning
      `404`/`403` per contracts/directory-comparison-api-contract.md. (Depends
      on T004.)
- [ ] T006 [P] [US1] Create
      `infrastructure/directory-comparison/panes-storage.ts`:
      `loadPanes()`/`savePanes({ leftPath, rightPath })` over a `localStorage`
      key, defaulting both paths to `/` (research.md Decision 9; `moveSync`
      field added in User Story 2). (Depends on T002.)
- [ ] T007 [US1] Create
      `infrastructure/directory-comparison/ui/comparison-pane.tsx`
      (`'use client'`): fetches `GET /api/directory-comparison/list` for its own
      `path`, renders directory entries as clickable (calling an
      `onNavigate(path)` prop) and file entries as inert, loads more entries as
      the user scrolls (spec FR-001, FR-001a). No comparison-status rendering
      yet (added in User Story 3). (Depends on T005.)
- [ ] T008 [US1] Create
      `infrastructure/directory-comparison/ui/directory-comparison-explorer.tsx`
      (`'use client'`): owns `leftPath`/`rightPath` client state, hydrated from
      `panes-storage.ts` post-mount (starts at `/` for SSR, same
      hydration-mismatch-safe pattern as Count and Size's
      `count-and-size-explorer.tsx`), persisted on every change; renders two
      `<ComparisonPane>` side by side, each with its own Up button (disabled at
      `/`) (spec FR-001). (Depends on T006, T007.)
- [ ] T009 [US1] Create `app/directory-comparison/page.tsx`: fixed route, thin,
      renders `<DirectoryComparisonExplorer>`. (Depends on T003, T008.)

**Checkpoint**: User Story 1 is fully functional and independently testable —
both panes browse independently, files are inert (quickstart.md step 2).

---

## Phase 4: User Story 2 - Keep both sides in sync while browsing (Priority: P2)

**Goal**: A "Move sync" toggle that mirrors navigation (enter a same-named
subdirectory, or go up) from either pane onto the other.

**Independent Test**: Turn Move sync on; navigate into a same-named subdirectory
on the left — the right pane follows. Navigate into a subdirectory that doesn't
exist on the right — it shows "not found" without crashing, and Move sync stays
on.

### Implementation for User Story 2

- [ ] T010 [US2] Update `infrastructure/directory-comparison/panes-storage.ts`:
      add a `moveSync: boolean` field (default `false`) to the persisted shape,
      loaded/saved alongside the two paths (spec FR-002). (Depends on T006.)
- [ ] T011 [US2] Update
      `infrastructure/directory-comparison/ui/comparison-pane.tsx`: when
      `GET /list` returns `404` for the current `path` (only reachable via a
      synced navigation attempt, since this tool never lets a pane navigate
      anywhere but a real listed entry on its own), render a clear "not found"
      state instead of a blank/broken listing (spec FR-002a). (Depends on T007.)
- [ ] T012 [US2] Update
      `infrastructure/directory-comparison/ui/directory-comparison-explorer.tsx`:
      add the Move sync toggle (persisted via T010); when on, wrap each pane's
      `onNavigate` so entering a subdirectory or going up on one side also
      applies the equivalent relative move to the other side (spec FR-002).
      Turning the toggle on does not itself trigger a navigation (FR-002b). A
      synced move landing a pane in "not found" (T011) does not turn Move sync
      off — subsequent navigations on either side keep syncing (FR-002c).
      (Depends on T008, T010, T011.)

**Checkpoint**: User Stories 1 AND 2 both work independently — synced and
unsynced browsing, and the "not found" edge case, all behave correctly
(quickstart.md steps 3–5).

---

## Phase 5: User Story 3 - Compare the two selected directories (Priority: P3)

**Goal**: A "Compare" action that recursively checksums both currently-shown
directories and shows a color-coded per-entry status (Not compared / Matching /
Differs / Only on this side / Scanning / Error), incremental by default with a
"Force full re-compare" escape hatch and an explicit Stop.

**Independent Test**: Point the two panes at an identical pair of directories
except for one differing file and one file that only exists on one side. Press
Compare. The differing file ends up `Differs`, the lone file
`Only on this side`, everything else `Matching`.

### Domain (pure — no I/O)

- [ ] T013 [P] [US3] Create
      `domain/directory-comparison/directory-comparison-node.ts`:
      `DirectoryComparisonNode` extending
      `domain/scanning/scan-node-status.ts`'s `ScanNodeStatus`, plus a
      `directoryChecksum: string | null` field (data-model.md
      `DirectoryComparisonNode`). (Depends on T002.)
- [ ] T014 [P] [US3] Create
      `domain/directory-comparison/file-checksum-entry.ts`: the
      `FileChecksumEntry` type (data-model.md `FileChecksumEntry`). (Depends on
      T002.)
- [ ] T015 [P] [US3] Create `domain/directory-comparison/checksum-cascade.ts`: a
      pure function, given a left/right file pair's known
      `size`/`partialChecksum`/`fullChecksum` values (each possibly not yet
      computed), returning either the next cascade stage still needed or a final
      `matching`/`differs` verdict (research.md Decision 3's cascade: size →
      partial hash → full hash, short-circuiting on the first mismatch).
      (Depends on T002.)
- [ ] T016 [US3] Create
      `domain/directory-comparison/entry-comparison-result.ts`: the
      `EntryComparisonResult` type (the 6 FR-007 statuses) and a pure
      pairing-by-name function over two sides' direct entries (spec FR-006,
      FR-007; data-model.md `EntryComparisonResult`). (Depends on T013, T014,
      T015.)
- [ ] T017 [US3] Create
      `domain/directory-comparison/derive-directory-checksum.ts`: a pure
      Merkle-style compose function — given a sorted-by-name list of
      `{ name, type, checksum }` for a directory's direct entries, returns the
      directory's checksum (research.md Decision 3, only ever called once every
      child pair is confirmed `matching`). (Depends on T013.)

### Application ports

- [ ] T018 [P] [US3] Create `application/directory-comparison/checksum-port.ts`:
      the `ChecksumPort` interface (contracts/checksum-port-contract.md).
      (Depends on T002.)
- [ ] T019 [US3] Create
      `application/directory-comparison/comparison-repository-port.ts`: the
      `ComparisonRepositoryPort` interface
      (contracts/comparison-repository-port-contract.md). (Depends on T013,
      T014.)

### Infrastructure adapters

- [ ] T020 [P] [US3] Create
      `infrastructure/directory-comparison/checksum-adapter.ts` implementing
      `ChecksumPort`: `fs.createReadStream` piped through
      `crypto.createHash('sha256')`; `computePartialChecksum` destroys the
      stream after 64 KiB (research.md Decision 4). (Depends on T018.)
- [ ] T021 [P] [US3] Create
      `infrastructure/directory-comparison/sqlite-client.ts`: creates `data/` if
      missing, opens `data/directory-comparison.sqlite` (env override
      `DIRECTORY_COMPARISON_DB_PATH`) via `better-sqlite3`, and runs
      `CREATE TABLE IF NOT EXISTS` migrations for `directory_comparison_nodes`
      and `file_checksums` matching data-model.md (research.md Decision 1).
      (Depends on T002.)
- [ ] T022 [US3] Create
      `infrastructure/directory-comparison/comparison-repository-adapter.ts`
      implementing `ComparisonRepositoryPort` via `better-sqlite3`. (Depends on
      T019, T021.)

### Pass 1 — structural listing

- [ ] T023 [US3] Create `application/directory-comparison/list-entries.ts`: Pass
      1's per-node step — calls the shared `traverseDirectory`, then
      `upsertFileFacts` for each direct file (size/mtime only, no hashing),
      `upsertPendingDirectory` for each subdirectory, and
      `recordDirectoryOwnResult` for this directory (research.md Decision 2).
      (Depends on T001, T022.)
- [ ] T024 [US3] Create
      `infrastructure/directory-comparison/structural-scan-worker.ts`: a
      singleton instantiating the shared
      `infrastructure/scanning/scan-engine.ts`'s `ScanEngine` with
      `comparison-repository-adapter.ts` and `list-entries.ts` as its per-node
      step (research.md Decision 2). (Depends on T023.)

### Pass 2 — bottom-up cascading comparison

- [ ] T025 [US3] Create `application/directory-comparison/compare-subtree.ts`:
      Pass 2 — walks the two already-listed subtrees bottom-up
      (depth-descending, same technique as `deriveDoneSet`), pairing direct
      entries by name (`entry-comparison-result.ts`), applying
      `checksum-cascade.ts` per file pair (calling `ChecksumPort` only as the
      cascade requires), recursing into directory pairs, and calling
      `derive-directory-checksum.ts` + persisting via `recordDirectoryChecksum`
      only once a directory pair fully resolves `matching` (research.md Decision
      3). Sets `hasUnreadableEntries`/error status and propagates it to
      ancestors when a file's content can't be read (spec FR-011, FR-011a).
      (Depends on T015, T016, T017, T018, T020, T022.)
- [ ] T026 [US3] Create
      `infrastructure/directory-comparison/comparison-pass-worker.ts`: a
      lightweight singleton running `compare-subtree.ts` over a given
      `{ leftRoot, rightRoot }`, tracking `activePair`/`activePath` (for
      `/status` to report live progress) and a cancellation flag checked between
      each directory pair (research.md Decision 5; spec FR-013). (Depends on
      T025.)

### Orchestration and read-side

- [ ] T027 [US3] Create `application/directory-comparison/start-comparison.ts`:
      enqueues both roots on `structural-scan-worker.ts` (Pass 1;
      `mode: 'incremental' |     'full'`, reusing `deriveDoneSet` per side —
      spec FR-006, FR-008), then starts `comparison-pass-worker.ts` (Pass 2)
      once Pass 1 settles for both roots. `mode: 'full'` (the "Force full
      re-compare" action, spec FR-009) always covers both sides together and
      clears cached checksums first. (Depends on T024, T026.)
- [ ] T028 [US3] Create `application/directory-comparison/stop-comparison.ts`:
      cancels whichever pass (structural or comparison) is currently active for
      a given pair's roots (spec FR-013). (Depends on T024, T026.)
- [ ] T029 [US3] Create
      `application/directory-comparison/get-comparison-view.ts`: read-only use
      case returning `EntryComparisonResult[]` for `(leftPath,     rightPath)`'s
      direct entries, derived fresh from whatever
      `directory_comparison_nodes`/`file_checksums` rows currently exist —
      reflects live progress while a pass is active (spec FR-007; data-model.md
      `EntryComparisonResult`; research.md Decision 7). (Depends on T016, T022.)

### API routes

- [ ] T030 [P] [US3] Create `app/api/directory-comparison/status/route.ts`:
      `GET` Route Handler parsing `left`/`right` query params, wiring
      `comparison-repository-adapter.ts`, calling `get-comparison-view.ts`,
      including which pass (if any) is currently active
      (contracts/directory-comparison-api-contract.md `GET /status`). (Depends
      on T024, T026, T029.)
- [ ] T031 [P] [US3] Create `app/api/directory-comparison/compare/route.ts`:
      `POST` Route Handler reading `{ leftPath, rightPath, mode? }`, calling
      `start-comparison.ts`, returning `202 { accepted: true }` immediately
      (contracts/directory-comparison-api-contract.md `POST /compare`). (Depends
      on T027.)
- [ ] T032 [P] [US3] Create `app/api/directory-comparison/stop/route.ts`: `POST`
      Route Handler reading `{ leftPath, rightPath }`, calling
      `stop-comparison.ts`, returning `{ stopped: boolean }`
      (contracts/directory-comparison-api-contract.md `POST /stop`). (Depends on
      T028.)

### UI

- [ ] T033 [P] [US3] Create
      `infrastructure/directory-comparison/ui/comparison-status-colors.ts`: a
      `Record<EntryComparisonResult['status'], string>` color map for the 6
      statuses (spec FR-007), same pattern as Count and Size's
      `STATUS_DOT_COLORS`.
- [ ] T034 [US3] Update
      `infrastructure/directory-comparison/ui/comparison-pane.tsx`: poll
      `GET /api/directory-comparison/status` for the current pair while either
      side is mid-pass, render each entry's status dot via
      `comparison-status-colors.ts`, with the state name available on hover
      (spec FR-007). (Depends on T007, T030, T033.)
- [ ] T035 [US3] Create
      `infrastructure/directory-comparison/ui/comparison-status-panel.tsx`
      (`'use client'`): "Compare", "Force full re-compare", and "Stop" buttons
      (mirrors Count and Size's `scan-status-panel.tsx` layout) plus overall
      pass state text (spec FR-003, FR-009, FR-013). (Depends on T031, T032.)
- [ ] T036 [US3] Update
      `infrastructure/directory-comparison/ui/directory-comparison-explorer.tsx`:
      render `<ComparisonStatusPanel>` wired to the current `leftPath`/
      `rightPath`, refreshing both panes' polling on Compare/Stop (spec Story
      3). (Depends on T008, T034, T035.)

**Checkpoint**: All three user stories are independently functional —
Matching/Differs/Only-on-this-side/Scanning/Error all render correctly,
incremental vs. force-full and Stop all work (quickstart.md steps 6–16).

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Repo-wide conventions and final validation.

- [ ] T037 [P] Run `pnpm lint:fix` and `pnpm format` across all new/changed
      files (repo's Husky/lint-staged conventions).
- [ ] T038 Run the full `quickstart.md` validation: local `pnpm dev`, Docker dev
      (`./scripts/dev.sh`), and Docker prod (`./scripts/prod.sh`) — including
      the cascade-avoids-unnecessary-reads check (step 8) and the
      unreadable-entry-propagates-Error check (step 9), both specific to this
      feature's riskiest design decision (research.md Decision 3).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user
  stories.
- **User Stories (Phase 3+)**: All depend on Foundational phase completion.
  - User Story 1 has no dependency on User Stories 2 or 3.
  - User Story 2 depends on User Story 1 (needs the two panes to exist) but not
    on User Story 3.
  - User Story 3 depends on User Story 1 (needs panes to select directories in)
    but not on User Story 2 (Move sync is a browsing convenience, not a
    prerequisite for Compare — spec Story 3's "Why this priority").
- **Polish (Final Phase)**: Depends on all desired user stories being complete.

### Within User Story 3

- Domain (T013–T017) before application ports (T018–T019) before infrastructure
  adapters (T020–T022) before Pass 1 (T023–T024) before Pass 2 (T025–T026)
  before orchestration/read (T027–T029) before API routes (T030–T032) before UI
  (T033–T036).

### Parallel Opportunities

- T001 (Setup) has no dependency on T002 — both can start immediately.
- Within User Story 3's domain layer, T013/T014/T015 are independent files and
  can run in parallel; T018 is independent of the domain layer.
- Within User Story 3's adapters, T020 and T021 are independent files.
- The three API routes (T030, T031, T032) are independent files once their
  respective use cases exist.
- Different user stories can be worked on in parallel by different people once
  Foundational is done, though US2 and US3 both build on US1's panes existing
  first.

---

## Parallel Example: User Story 3 domain layer

```bash
# Launch together once T002 (scaffolding) is done:
Task: "Create domain/directory-comparison/directory-comparison-node.ts"
Task: "Create domain/directory-comparison/file-checksum-entry.ts"
Task: "Create domain/directory-comparison/checksum-cascade.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: `pnpm dev`, browse both panes independently
5. Deploy/demo if ready — a two-pane file browser is already useful on its own

### Incremental Delivery

1. Setup + Foundational → tool reachable, empty two-pane browser
2. Add User Story 1 → independent browsing works → demo
3. Add User Story 2 → Move sync works → demo
4. Add User Story 3 → Compare works, including the cascade and error propagation
   → demo (this is the story that delivers the tool's actual payoff)

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps task to specific user story for traceability.
- User Story 3 is intentionally the largest phase — it's where nearly all of
  research.md's design decisions (2–7, 11) actually get implemented; User
  Stories 1 and 2 are comparatively thin, pure client-side/browsing work.
- Verify manually per `quickstart.md` at each checkpoint before moving on.
- Commit after each task or logical group.
