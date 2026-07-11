---
description: 'Task list for Count and Size Tool'
---

# Tasks: Count and Size Tool

**Input**: Design documents from `/specs/002-count-and-size/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: This project's constitution (Principle IV) prohibits automated tests.
No test tasks are included below — verification is manual, via `quickstart.md`
(Polish phase, T036).

**Organization**: Tasks are grouped by user story (from spec.md) to enable
independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete
  task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are relative to the repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bring in the one new runtime dependency and prepare the two
deployment-config gaps `research.md` identified before any code depends on them.

- [x] T001 Run `pnpm add better-sqlite3` (updates `package.json` and
      `pnpm-lock.yaml` together — never hand-edit `package.json` alone;
      research.md Decision 1/8). (Required
      `pnpm approve-builds     better-sqlite3` to allow its install script to
      run under pnpm's default block-scripts policy; resolved via prebuilt
      binary, no compiler toolchain needed locally.)
- [x] T002 [P] Add `data/` to `.gitignore` at the repo root (the SQLite database
      file's directory; research.md Decision 7).
- [x] T003 [P] Add a named volume mounted at `/app/data` to the `web` service in
      `docker-compose.prod.yml` (currently has no volumes at all — without this,
      scan results are lost on every container recreation; research.md Decision
      7).

**Checkpoint**: Dependency installed; prod persistence and `data/` tracking gaps
closed before any code writes there.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The domain types/pure-logic, ports, and adapters every user story
reads from and/or writes to (the persisted `DirectoryScanNode` and its
derivation into a `DirectoryView` — data-model.md).

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Create the `domain/count-and-size/`, `application/count-and-size/`,
      `infrastructure/count-and-size/`, and `infrastructure/count-and-size/ui/`
      directory scaffolding, per `plan.md`'s Project Structure.
- [x] T005 [P] Create `domain/count-and-size/directory-scan-node.ts`: the
      `DirectoryScanNode` type and `OwnOutcome` union
      (`'pending' | 'error' |     'stopped' | 'done'`) (data-model.md
      DirectoryScanNode). (Depends on T004.)
- [x] T006 [P] Create `domain/count-and-size/path-info.ts`: pure
      `getParentPath(path)` (returns `null` for `"/"`) and `getDepth(path)`
      functions operating on absolute path strings (spec FR-020). (Depends on
      T004.)
- [x] T007 [P] Create `domain/count-and-size/should-ignore-entry.ts`: a pure
      predicate given a `RawEntry`-shaped value (kind: file/directory/
      symlink/unreadable) returning whether to ignore it during scanning and why
      (symlink vs. unreadable) (spec FR-015, FR-016;
      contracts/filesystem-port-contract.md). (Depends on T004.)
- [x] T008 [P] Create `domain/count-and-size/scan-stack.ts`: a pure LIFO stack
      (`push`, `pop`, `contains`) over path strings (spec FR-013, FR-014;
      data-model.md ScanWorker state). (Depends on T004.)
- [x] T009 Create `domain/count-and-size/derive-directory-view.ts`: the pure
      `deriveDirectoryView(node, descendantNodes)` function producing
      `{ state, incomplete, aggregatedCount, aggregatedSize, lastScannedAt,     hasUnreadableEntries }`
      per the derivation rules in data-model.md's `DirectoryView` table (spec
      FR-005, FR-008, FR-009, FR-010, FR-011). (Depends on T004, T005.)
- [x] T010 [P] Create `application/count-and-size/filesystem-port.ts`: the
      `RawEntry`, `ListChildrenResult`, `ListChildrenOutcome` types and the
      `FileSystemPort` interface (contracts/filesystem-port-contract.md).
      (Depends on T004.) (Fixed a data-model.md/contract inconsistency found
      while implementing: `FilesystemEntry.type` must include
      `'symlink' | 'unreadable'`, not just `'file' | 'directory'` —
      FR-015/FR-016 only govern scanning, not browsing.)
- [x] T011 Create `application/count-and-size/scan-repository-port.ts`: the
      `ScanRepositoryPort` interface (`upsertPending`, `recordOwnResult`,
      `markStopped`, `findAllPendingPaths`, `getSubtree`, `getDirectChildren`)
      (contracts/scan-repository-port-contract.md). (Depends on T004, T005.)
- [x] T012 [P] Create `application/count-and-size/scan-scheduler-port.ts`: a
      small `ScanSchedulerPort` interface (`enqueue(path, parentPath, depth)`,
      `requestStop()`, `getActivePath()`) so `application/` use cases can
      trigger/stop the background worker without depending on `infrastructure/`
      directly (Constitution Principle II — dependency direction stays
      infrastructure → application → domain). (Depends on T004.)
- [x] T013 Create `infrastructure/count-and-size/filesystem-adapter.ts`
      implementing `FileSystemPort` via
      `fs.promises.readdir(path, {     withFileTypes: true })` +
      `Dirent.isSymbolicLink()` for symlink detection and `fs.promises.stat()`
      for file sizes, catching `EACCES`/`EPERM`/`ENOENT` per entry as
      `kind: 'unreadable'` and on the top-level call as
      `{ ok: false, reason: 'unreadable' }` (research.md Decision 3). (Depends
      on T010.)
- [x] T014 [P] Create `infrastructure/count-and-size/sqlite-client.ts`: creates
      the `data/` directory if missing, opens `data/count-and-size.sqlite` via
      `better-sqlite3`, and runs a
      `CREATE     TABLE IF NOT EXISTS directory_scan_nodes (...)` migration
      matching data-model.md's `DirectoryScanNode` fields, with `path` as
      primary key and an index on `parentPath`. (Depends on T001, T002.) (Also
      required `pnpm add -D @types/better-sqlite3` — the package ships no
      bundled declaration file.)
- [x] T015 Create `infrastructure/count-and-size/scan-repository-adapter.ts`
      implementing `ScanRepositoryPort` via `better-sqlite3`: `getSubtree` and
      `getDirectChildren` use a recursive CTE over `parentPath` (research.md
      Decision 1); `upsertPending` fully replaces any existing row for that path
      (spec FR-021). (Depends on T011, T014.)
- [x] T016 [P] Update `domain/navigation/menu-entry.ts`: append
      `{ key:     'count-and-size', label: 'Count and Size', route: '/count-and-size' }`
      to `menuEntries` (validates 001-dashboard-shell's SC-005 — a second tool
      added without touching the header/sidebar).

**Checkpoint**: Domain layer, both ports, and both adapters compile with no
circular or reversed dependencies; ready for use cases.

---

## Phase 3: User Story 1 - Browse the filesystem and see scan status at a glance (Priority: P1) 🎯 MVP

**Goal**: A user can browse from `/` down through any directory chain
(directories clickable, files inert), see per-subdirectory scan-data
availability, and see the current directory's last-scanned timestamp or "not
scanned yet" — entirely read-only, no scan has to have ever run.

**Independent Test**: `pnpm dev`, open `/count-and-size` with no scans ever run.
Click into a few nested directories and back; every listing shows directories
(clickable) and files (inert), no availability indicator on never-scanned
subdirectories, and "not scanned yet" for the current directory.

### Implementation for User Story 1

- [x] T017 [US1] Create `application/count-and-size/list-directory.ts`: a use
      case taking
      `(path, offset, limit, FileSystemPort,     ScanRepositoryPort)` that lists
      `path`'s direct children via `FileSystemPort.listChildren`, attaches
      `hasScanData` to each directory entry via
      `ScanRepositoryPort.getDirectChildren`, and returns a page of
      `FilesystemEntry[]` plus `hasMore` (spec FR-001, FR-001a, FR-004;
      data-model.md FilesystemEntry; contracts/count-and-size-api-contract.md
      `GET /list`). (Depends on T010, T011.)
- [x] T018 [US1] Create `application/count-and-size/get-directory-status.ts`: a
      use case taking `(path, ScanRepositoryPort)` that calls `getSubtree(path)`
      and feeds the result into `deriveDirectoryView` to return a
      `DirectoryView` (or the `not_scanned` shape when the subtree is empty)
      (spec FR-005, FR-008, FR-009, FR-011;
      contracts/count-and-size-api-contract.md `GET     /status`). (Depends on
      T009, T011.)
- [x] T019 [P] [US1] Create `app/api/count-and-size/list/route.ts`: `GET` Route
      Handler parsing `path`/`offset`/`limit` query params, wiring the concrete
      `filesystem-adapter` and `scan-repository-adapter`, calling
      `list-directory.ts`, returning `404`/`403` per
      contracts/count-and-size-api-contract.md. (Depends on T013, T015, T017.)
- [x] T020 [P] [US1] Create `app/api/count-and-size/status/route.ts`: `GET`
      Route Handler parsing `path`, wiring `scan-repository-adapter`, calling
      `get-directory-status.ts`. (Depends on T015, T018.)
- [x] T021 [US1] Create `infrastructure/count-and-size/ui/directory-browser.tsx`
      (`'use client'`): fetches `GET /api/count-and-size/list`, renders entries
      with directories as `Link`/router-push navigation (updates the URL path
      segments) and files as plain inert text/rows, renders the per-directory
      availability indicator only when `hasScanData` is true (nothing
      otherwise), and loads more entries as the user scrolls near the bottom
      (spec FR-001, FR-001a, FR-002, FR-003, FR-004). (Depends on T019.)
- [x] T022 [US1] Create `infrastructure/count-and-size/ui/scan-status-panel.tsx`
      (`'use client'`): fetches `GET /api/count-and-size/status` for the current
      path and renders the derived state label and `lastScannedAt` as an ISO
      8601 string, or "not scanned yet" when `state === "not_scanned"` (spec
      FR-005). Scan/Stop buttons and polling are added by later stories (T028,
      T029, T034) — this task is read-only display only. (Depends on T020.)
- [x] T023 [US1] Create `app/count-and-size/[[...path]]/page.tsx`: parses the
      optional catch-all URL segments into an absolute filesystem path (empty
      segments → `"/"`), and renders `<DirectoryBrowser>` + `<ScanStatusPanel>`
      for that path (research.md Decision 5). (Depends on T016, T021, T022.)

**Checkpoint**: User Story 1 is fully functional and independently testable —
browsing, availability indicators, and "not scanned yet" all work with zero
scans having run (quickstart.md steps 1–4, 10).

---

## Phase 4: User Story 2 - Run a scan and see aggregated results (Priority: P2)

**Goal**: From any directory, pressing Scan recursively computes and persists
that directory's total file count and used space, running asynchronously
(browsing elsewhere stays responsive) and refreshing the viewed directory's
status automatically until it completes.

**Independent Test**: From a directory with no prior scan, press "Scan". State
moves from Not scanned → Scanning → Completed without a manual refresh;
count/size/timestamp appear once done; browsing other directories in the
meantime is unaffected.

### Implementation for User Story 2

- [x] T024 [US2] Create `application/count-and-size/process-directory.ts`: a use
      case taking `(path, FileSystemPort, ScanRepositoryPort)` — the worker's
      per-node step. Calls `listChildren`; on failure, calls
      `recordOwnResult(path, { outcome: 'error', ... })` and returns no
      children. On success, applies `shouldIgnoreEntry` per entry (skipping
      symlinks/unreadable, setting `hasUnreadableEntries`), sums direct file
      count/size, calls `recordOwnResult(path, { outcome: 'done', ... })`, calls
      `upsertPending` for each subdirectory child, and returns those child paths
      (spec FR-007, FR-015, FR-016). (Depends on T007, T010, T011.)
- [x] T025 [US2] Create `infrastructure/count-and-size/scan-worker.ts`: a
      module-level singleton implementing `ScanSchedulerPort`, holding an
      in-memory `ScanStack` (T008) and `activePath`.
      `enqueue(path,     parentPath, depth)` pushes and, if idle, starts an
      async loop that pops a path, calls `process-directory.ts` (wired with the
      concrete `filesystem-adapter` + `scan-repository-adapter`), and pushes any
      returned child paths, continuing until the stack is empty (spec FR-012,
      FR-013, FR-014, FR-017). On module load, runs startup reconciliation:
      `ScanRepositoryPort.findAllPendingPaths()` → `markStopped(...)` (spec
      FR-019; research.md Decision 2). Exports a ready-to-use singleton
      instance. (Depends on T008, T012, T013, T015, T024.)
- [x] T026 [US2] Create `application/count-and-size/start-scan.ts`: a use case
      taking `(path, ScanRepositoryPort, ScanSchedulerPort)` that computes
      `parentPath`/`depth` via `path-info.ts`, calls
      `upsertPending(path, parentPath, depth)` (overwriting any prior data —
      spec FR-021), and calls `scheduler.enqueue(path, parentPath, depth)` (spec
      FR-006). (Depends on T006, T011, T012.)
- [x] T027 [P] [US2] Create `app/api/count-and-size/scan/route.ts`: `POST` Route
      Handler reading `{ path }` from the body, wiring the concrete
      `scan-repository-adapter` and the `scan-worker` singleton, calling
      `start-scan.ts`, returning `202 { accepted: true }` immediately
      (contracts/count-and-size-api-contract.md `POST /scan`). (Depends on T025,
      T026.)
- [x] T028 [US2] Update `infrastructure/count-and-size/ui/scan-status-panel.tsx`
      to add a "Scan" button, always rendered regardless of current state,
      calling `POST /api/count-and-size/scan` with the current path (spec
      FR-006). (Depends on T022, T027.)
- [x] T029 [US2] Update `infrastructure/count-and-size/ui/scan-status-panel.tsx`
      to poll `GET /api/count-and-size/status` every 2 seconds while the current
      path's derived `state` is `"scanning"`, stopping automatically once it
      reaches a terminal state (spec FR-017a; research.md Decision 6). (Depends
      on T028, T020.)

**Checkpoint**: User Stories 1 AND 2 both work independently — scanning produces
correct aggregated totals and live-refreshes without a manual reload
(quickstart.md steps 5–9, 11–13).

---

## Phase 5: User Story 3 - Trust incomplete or interrupted results (Priority: P3)

**Goal**: The user can tell when a directory's numbers don't represent the full
picture (unreadable entries, a failed/stopped descendant) and can explicitly
stop an active scan.

**Independent Test**: Scan a directory containing an unreadable file/folder —
it's flagged. Press Stop mid-scan — the active procedure and its already-spawned
descendants become Stopped, and the totals shown reflect whatever completed
before stopping.

### Implementation for User Story 3

- [x] T030 [US3] Update `infrastructure/count-and-size/ui/scan-status-panel.tsx`
      to render the `incomplete` and `hasUnreadableEntries` flags from
      `GET     /status` as distinct, visible indicators alongside the state
      label (spec FR-011, FR-016; User Story 3 AC1, AC3). (Depends on T022,
      T018.)
- [x] T031 [US3] Create `application/count-and-size/stop-scan.ts`: a use case
      taking `(ScanRepositoryPort, ScanSchedulerPort)` that calls
      `scheduler.getActivePath()` + `scheduler.requestStop()`, and marks the
      active path plus any already-`pending` descendants (via
      `getSubtree(activePath)`) as stopped through
      `ScanRepositoryPort.markStopped` (spec FR-018). (Depends on T011, T012.)
- [x] T032 [US3] Update `infrastructure/count-and-size/scan-worker.ts` to
      implement `requestStop()`: sets a stop flag checked between stack pops,
      clears the remaining in-memory stack, and lets `stop-scan.ts`'s
      `markStopped` call cover both the active path and the just-cleared queued
      descendants (spec FR-018; Edge Cases — Stop applies to the whole in-flight
      subtree, not just the top directory). (Depends on T025, T031.)
      (Implemented as part of T025, since `ScanSchedulerPort` required a full
      `requestStop()` implementation from the start — `requestStop()` also had
      to guard against a race where an in-flight `processDirectory` call's
      `recordOwnResult('done')` could resurrect a node just marked `stopped`;
      fixed with a `WHERE own_outcome =     'pending'` guard added to
      `scan-repository-adapter.ts`'s update statements.)
- [x] T033 [P] [US3] Create `app/api/count-and-size/stop/route.ts`: `POST` Route
      Handler wiring `scan-repository-adapter` + the `scan-worker` singleton,
      calling `stop-scan.ts`, returning `{ stopped: boolean }`
      (contracts/count-and-size-api-contract.md `POST /stop`). (Depends on T031,
      T032.)
- [x] T034 [US3] Update `infrastructure/count-and-size/ui/scan-status-panel.tsx`
      to add a "Stop" button, enabled only while `state === "scanning"`, calling
      `POST /api/count-and-size/stop` (spec FR-018). (Depends on T029, T033.)

**Checkpoint**: All three user stories are independently functional —
incomplete/unreadable indicators and Stop work without affecting browsing or
scanning from User Stories 1–2 (quickstart.md steps 8, 9, 11; Docker prod
crash-reconciliation check).

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Repo-wide conventions and final validation.

- [x] T035 [P] Run `pnpm lint:fix` and `pnpm format` across all new/changed
      files (repo's Husky/lint-staged conventions).
- [x] T036 Run the full `quickstart.md` validation: local `pnpm dev`, Docker dev
      (`./scripts/dev.sh`), and Docker prod (`./scripts/prod.sh`) — including
      the container-recreation persistence check and the hard-kill-mid-scan
      reconciliation check, both specific to this feature (research.md Decisions
      2, 7). All passed: browsing/pagination/scan/stop/incomplete-flag verified
      in local dev against real fixture directories (including the Stop-scope
      bug found and fixed — see T031-T034 note); Docker dev confirmed the
      bind-mounted `data/` persists to the host; Docker prod confirmed the new
      named volume survives full container recreation (`down`/`up` — identical
      scan results and timestamp after recreation) and that a hard `docker kill`
      mid-scan reconciles to `completed`/`incomplete` on restart rather than
      sticking at `scanning` forever (FR-019).
- [x] T037 [P] Verify `better-sqlite3` builds/runs cleanly in the Alpine
      `deps`/`runner` stages during the Docker prod build in T036 (research.md
      Decision 8); if the prebuilt `linux-musl-x64` binary is unavailable, add
      `RUN apk add --no-cache python3 make g++` to the `deps` stage in
      `Dockerfile` so `node-gyp` can compile it from source. Confirmed: the
      prebuilt binary resolved via `prebuild-install` on both `node:22-alpine`
      (prod) and `node:22-bookworm-slim` (dev) — no compiler toolchain needed in
      either stage. `pnpm approve-builds better-sqlite3` was required once
      (T001) and persisted its approval to `pnpm-workspace.yaml`'s
      `allowBuilds`, so `pnpm install --frozen-lockfile` in the Docker builds
      didn't need any manual step.

---

## Phase 7: Post-Implementation Revision (user feedback round)

**Purpose**: Four UX changes requested after initial implementation was
reviewed: up-navigation, removing the path from the URL while remembering it
client-side, richer per-entry listing data, and dual humanized/byte size
display. Spec updated with FR-002a, revised FR-004/FR-005, FR-005a, FR-005b.

- [x] T038 [P] Create `infrastructure/count-and-size/ui/format-size.ts`:
      `formatSize(bytes)` returning both the humanized value and the exact byte
      count, e.g. "40.6 MB (42,592,198 B)" (spec FR-005b). Replaces the
      humanized-only `formatBytes` previously inlined in
      `scan-status-panel.tsx`.
- [x] T039 [P] Create `infrastructure/count-and-size/ui/state-labels.ts`: shared
      `DirectoryState -> label` map, extracted so both `scan-status-panel.tsx`
      and the now-richer `directory-browser.tsx` use the same labels.
- [x] T040 Update `application/count-and-size/list-directory.ts`: each directory
      entry now carries its full `scanStatus` (`DirectoryView`, via
      `getSubtree` + `deriveDirectoryView`) instead of a `hasScanData` boolean;
      each file entry carries its own `size` (spec FR-004, research.md Decision
      5a). (Depends on T009, T011.)
- [x] T041 Remove `ScanRepositoryPort.getDirectChildren` and its
      `scan-repository-adapter.ts` implementation — dead code after T040, which
      now calls `getSubtree` per listed directory instead.
- [x] T042 Rewrite `infrastructure/count-and-size/ui/directory-browser.tsx`:
      directory navigation becomes an `onNavigate(path)` callback prop instead
      of a `next/link` `href` (no more URL involvement); each row renders its
      file size or its directory's state/count/size/last-scanned/
      incomplete/unreadable-entries info when present (spec FR-004).
- [x] T043 Create `infrastructure/count-and-size/last-path-storage.ts`:
      `loadLastPath()`/`saveLastPath()` over a `localStorage` key (spec FR-005a;
      research.md Decision 5, revised).
- [x] T044 Create
      `infrastructure/count-and-size/ui/count-and-size-explorer.tsx`: owns
      `currentPath` as client state (starts at `/` for SSR, hydrated from
      `loadLastPath()` post-mount, persisted via `saveLastPath()` on every
      change); renders an "Up" button (disabled at `/`, via
      `domain/count-and-size/path-info.ts`'s `getParentPath`), the current path
      as plain text (not a link), `ScanStatusPanel`, and `DirectoryBrowser`
      (spec FR-002a, FR-005a).
- [x] T045 Replace `app/count-and-size/[[...path]]/page.tsx` (catch-all) with a
      fixed `app/count-and-size/page.tsx` rendering `CountAndSizeExplorer`;
      delete `infrastructure/count-and-size/path-url.ts` (its
      `pathToUrl`/`segmentsToPath` helpers are no longer needed with no path
      segments to map).
- [x] T046 Update `infrastructure/count-and-size/ui/scan-status-panel.tsx` to
      use the shared `formatSize`/`STATE_LABELS` from T038/T039 instead of its
      own local copies.

**Checkpoint**: Verified manually — Up button navigates correctly and is
disabled at `/`; the browser URL stays at `/count-and-size` regardless of depth
browsed; the last-visited directory survives a page reload (via `localStorage`);
listing rows show full stats for scanned directories and exact byte counts
alongside humanized sizes for both files and directories.
`pnpm exec tsc --noEmit` and `pnpm exec eslint .` both clean.

---

## Phase 8: Incremental Scan Default + Force Full Rescan (revision)

**Purpose**: Split the single always-full "Scan" action into an incremental
default (skips subtree paths already Completed-and-not-incomplete) plus a new
explicit "Force full rescan" action that keeps the old always-rescan behavior.
Spec updated with revised FR-021, new FR-021a/FR-021b, revised User Story 2
acceptance scenarios 5/6 + new 5a/5b/5c, new SC-008. Design: research.md
Decisions 10–11, data-model.md "Done-subtree set" section.

- [x] T047 [P] Create `domain/count-and-size/derive-done-set.ts`: pure
      `deriveDoneSet(nodes: DirectoryScanNode[]): Set<string>` — bottom-up over
      the subtree (leaves first, via `parentPath`), a path is "done" iff its own
      `ownOutcome === 'done'`, `hasUnreadableEntries === false`, and every child
      path present in `nodes` is itself "done" (data-model.md "Done-subtree
      set"; spec FR-021). (Depends on T005.)
- [x] T048 Update `domain/count-and-size/scan-stack.ts`: change the stack's
      element type from a bare path `string` to
      `{ path: string; mode: 'incremental' | 'full'; doneSet?: ReadonlySet<string> }`
      (data-model.md `ScanStackEntry`); `push`/`pop`/`contains` operate on the
      new shape (`contains` compares by `.path`). (Depends on T008.)
- [x] T049 Update `application/count-and-size/start-scan.ts`: add a
      `mode: 'incremental' | 'full'` parameter (default `'incremental'`). For
      `'full'`, unchanged existing behavior. For `'incremental'`, call
      `scanRepository.getSubtree(path)`, run it through `deriveDoneSet` (T047);
      if `path` itself is already in the resulting set, return without calling
      `upsertPending`/`enqueue` (nothing outstanding); otherwise call
      `upsertPending` as before and
      `scheduler.enqueue({ path, mode:     'incremental', doneSet })`
      (research.md Decision 10). (Depends on T026, T047.)
- [x] T050 Update `application/count-and-size/process-directory.ts`: accept the
      popped `ScanStackEntry`'s `mode`/`doneSet` alongside `path`. When pushing
      each discovered subdirectory child for the caller to enqueue: if
      `mode === 'incremental'` and `doneSet?.has(childPath)`, skip it entirely
      (no `upsertPending`, not returned as a child to enqueue); otherwise call
      `upsertPending` and include it, carrying the same `mode`/`doneSet` forward
      unchanged. `mode: 'full'` children are always included, exactly as before
      this revision. (Depends on T024, T048.)
- [x] T051 Update `infrastructure/count-and-size/scan-worker.ts`: `enqueue`
      takes a `ScanStackEntry` (or `path` + `mode` + optional `doneSet`) instead
      of a bare path; the pop/process/push loop threads the entry's `mode`/
      `doneSet` into `process-directory.ts` (T050) and onto whatever child
      entries it returns. (Depends on T025, T048, T050.)
- [x] T052 [P] Update `app/api/count-and-size/scan/route.ts`: read an optional
      `mode` field from the request body (`'incremental' | 'full'`, default
      `'incremental'` if absent or invalid), pass it through to `start-scan.ts`
      (T049) (contracts/count-and-size-api-contract.md `POST /scan`). (Depends
      on T027, T049.)
- [x] T053 Update `infrastructure/count-and-size/ui/use-directory-status.ts`:
      `scan()` accepts an optional `mode` argument and includes it in the
      `POST     /api/count-and-size/scan` body when provided (omitted → server
      default `'incremental'`). (Depends on T028.)
- [x] T054 Update `infrastructure/count-and-size/ui/scan-status-panel.tsx`: add
      a "Force full rescan" button next to "Scan", calling `scan('full')`
      (T053); same enabled/disabled rule "Scan" already has
      (`disabled={starting}` — only while its own request is in flight, not
      merely because `state ===     "scanning"`; spec FR-021b). The existing
      "Scan" button's label/behavior is otherwise unchanged (calls `scan()` with
      no mode, i.e. incremental). (Depends on T034, T053.)

**Checkpoint**: Re-run `quickstart.md` steps 13–15 (local dev) and step 6
(Docker prod, post-crash resume) — incremental "Scan" is a no-op when already
complete, only redoes changed/outstanding parts otherwise, "Force full rescan"
still redoes everything, and a post-crash "Scan" resumes only what the crash
left Stopped.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion (T014 needs `data/` +
  the dependency from T001/T002) — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: Depends on Foundational completion. No dependency
  on US2/US3.
- **User Story 2 (Phase 4)**: Depends on Foundational completion, and extends a
  file US1 created (`scan-status-panel.tsx`) — implement after US1.
- **User Story 3 (Phase 5)**: Depends on Foundational and on US2's worker
  (`scan-worker.ts`, `scan-status-panel.tsx`) — implement after US2.
- **Polish (Phase 6)**: Depends on all three user stories being complete.
- **Incremental Scan Default + Force Full Rescan (Phase 8)**: Depends on Phase
  4/5 (`start-scan.ts`, `process-directory.ts`, `scan-worker.ts`,
  `scan-status-panel.tsx` all already exist) — this phase edits them in place,
  same pattern as Phase 7.

### Within Each User Story

- Domain/port-only use cases (e.g. T017, T018, T024, T026, T031) before the
  Route Handlers and adapters that wire them to concrete implementations.
- Route Handlers before the UI components that call them.
- `scan-status-panel.tsx` is built incrementally: read-only in US1 (T022), gains
  the Scan button + polling in US2 (T028, T029), gains incomplete/unreadable
  indicators and the Stop button in US3 (T030, T034) — each edit is additive,
  not a rewrite.

### Parallel Opportunities

- T002 and T003 (Setup) — different files, independent of T001.
- T005, T006, T007, T008, T010, T012, T014, T016 (Foundational) — different
  files, each depends only on already-complete prerequisites, not on each other.
- T019 and T020 (US1) — different files, both depend only on already-done
  Foundational + their own use case.
- T027 (US2) and T033 (US3, once its own deps are met) — different files.
- T035 and T037 (Polish) — different concerns, independent of each other.

---

## Parallel Example: Foundational Phase

```bash
# After T004 (directory scaffolding) completes, launch these together:
Task: "Create domain/count-and-size/directory-scan-node.ts per T005"
Task: "Create domain/count-and-size/path-info.ts per T006"
Task: "Create domain/count-and-size/should-ignore-entry.ts per T007"
Task: "Create domain/count-and-size/scan-stack.ts per T008"
Task: "Create application/count-and-size/filesystem-port.ts per T010"
Task: "Create application/count-and-size/scan-scheduler-port.ts per T012"
Task: "Create infrastructure/count-and-size/sqlite-client.ts per T014"
Task: "Update domain/navigation/menu-entry.ts per T016"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup.
2. Complete Phase 2: Foundational (ports, adapters, domain derivation).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: run `quickstart.md`'s local-dev steps 1–4, 10 manually
   (browsing, indicators, "not scanned yet", large-listing pagination) — note
   aggregated counts/timestamps will show "not scanned yet" everywhere at this
   point, since scanning doesn't exist yet.
5. Demo if ready — a working, read-only filesystem browser with scan-status
   awareness.

### Incremental Delivery

1. Setup + Foundational → ports/adapters/domain ready.
2. Add User Story 1 → validate independently → demo (MVP: browse-only).
3. Add User Story 2 → validate independently → demo (scanning produces real
   numbers, live progress).
4. Add User Story 3 → validate independently, including the Docker prod
   crash-recovery and container-recreation checks → demo (trustworthy,
   stoppable, restart-safe results).
5. Phase 6 Polish → full `quickstart.md` run across all three environments,
   lint/format pass, Alpine build verification.

---

## Notes

- [P] tasks touch different files with no unmet dependency.
- [Story] label maps each task to its user story for traceability.
- No automated tests exist or are planned (Constitution Principle IV) —
  `quickstart.md` (T036) is the verification step.
- Commit after each task or logical group, using Conventional Commits
  (Constitution Principle VI).
- Stop at any checkpoint to validate a story independently before moving on.
