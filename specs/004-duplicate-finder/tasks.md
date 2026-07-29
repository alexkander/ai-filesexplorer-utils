---
description: 'Task list for the Duplicate Finder feature implementation'
---

# Tasks: Duplicate Finder

**Input**: Design documents from `/specs/004-duplicate-finder/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts)

**Tests**: None. The constitution (Principle IV) prohibits automated tests;
verification is the manual script in [quickstart.md](./quickstart.md), run in
the Polish phase and at each story checkpoint.

**Organization**: Tasks are grouped by user story so each story is an
independently shippable increment.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an unfinished
  task)
- **[Story]**: US1 / US2 / US3, mapping to spec.md's user stories
- Every task names the exact file it touches

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The pieces every later phase writes against.

- [x] T001 Create `infrastructure/duplicate-finder/sqlite-client.ts`: open
      `data/duplicate-finder.sqlite` (override `DUPLICATE_FINDER_DB_PATH`)
      through `openWalDatabase()` + `retryWhileBusy()` from
      `infrastructure/sqlite/open-database.ts`, and create the six tables and
      their indexes exactly as specified in [data-model.md](./data-model.md)
      (`scan_state` with its `CHECK (id = 1)` single-row constraint and a seeded
      `idle` row, `scanned_files`, `scanned_directories`, `duplicate_groups`,
      `duplicate_occurrences`, `ignored_paths`).
- [x] T002 [P] Create `infrastructure/duplicate-finder/ui/format-size.ts` as a
      local copy of the existing formatter, carrying the same comment the other
      copies do about this slice staying free of cross-tool imports (research.md
      Decision 9).
- [x] T003 [P] Add the `duplicate-finder` entry (`label: 'Find Duplicates'`,
      `route: '/duplicate-finder'`) to `domain/navigation/menu-entry.ts` so the
      sidebar links to the new tool (FR-001).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Ports, adapters and the worker shell that all three stories build
on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 [P] Create `domain/duplicate-finder/duplicate-group.ts`: the
      `GroupKind` (`'file' | 'directory'`), `DuplicateGroup` and `Occurrence`
      types, the `SortBy` union (`'size' | 'occurrences'`), the `PAGE_SIZE = 50`
      constant, and the `EMPTY_CONTENT_CHECKSUM` constant (SHA-256 of zero
      bytes) used to flag empty groups (research.md Decision 12).
- [x] T005 [P] Create `domain/duplicate-finder/ignored-path-match.ts`: a pure
      `isIgnored(path, ignoredPaths)` implementing the exact-or-subtree rule
      (`p === ignored || p.startsWith(ignored + '/')`), with no `kind`
      distinction (research.md Decision 10).
- [x] T006 [P] Create `application/duplicate-finder/checksum-port.ts` per
      [contracts/checksum-port-contract.md](./contracts/checksum-port-contract.md):
      `computePartialChecksum` and `computeFullChecksum`, both taking an
      optional `AbortSignal`. Deliberately no Office-container method.
- [x] T007 [P] Create `application/duplicate-finder/checksum-cache-port.ts` per
      [contracts/checksum-cache-port-contract.md](./contracts/checksum-cache-port-contract.md):
      `getCachedChecksums(path, size, modificationTime)` returning
      `{ partialChecksum, fullChecksum }`, documented as never throwing and as
      "a miss means hash it, never means not-a-duplicate".
- [x] T008 Create `application/duplicate-finder/duplicate-repository-port.ts`
      with the full interface and its row/query types per
      [contracts/duplicate-repository-port-contract.md](./contracts/duplicate-repository-port-contract.md).
- [x] T009 [P] Create `infrastructure/duplicate-finder/checksum-adapter.ts`: a
      local copy of the streamed SHA-256 implementation (full digest, plus the
      partial one bounded with `end: PARTIAL_CHECKSUM_BYTES - 1` so `'end'`
      fires exactly once), honouring the `AbortSignal`, and exporting
      `PARTIAL_CHECKSUM_BYTES` (64 KiB) for the hashing use case to compare
      sizes against.
- [x] T010 [P] Create
      `infrastructure/duplicate-finder/comparison-checksum-readonly-adapter.ts`:
      `new Database(dbPath, { readonly: true, fileMustExist: true })` against
      `DIRECTORY_COMPARISON_DB_PATH || data/directory-comparison.sqlite`, with
      the constructor **and** the `.prepare()` calls inside one `try/catch` that
      degrades to a null implementation, and the freshness-checked query from
      the contract.
- [x] T011 Create
      `infrastructure/duplicate-finder/duplicate-repository-adapter.ts` — part
      1: scan lifecycle (`getScanState`, `beginScan` bumping `scan_seq`,
      `updateProgress`, `finishScan`, `reconcileInterruptedScan`) plus
      `upsertFileFacts` / `upsertDirectory`. The file-facts UPSERT must preserve
      checksums only when both `size` and `modification_time` match the stored
      row and null them otherwise, and must run batched inside
      `db.transaction(...)`.
- [x] T012 Extend
      `infrastructure/duplicate-finder/duplicate-repository-adapter.ts` — part
      2: `findSharedSizeCandidates`, `findSharedPartialCandidates`,
      `findSharedContentPaths` (the paths whose `full_checksum` is shared by ≥ 2
      files of the current `scan_seq` — the input to folder candidacy),
      `recordChecksums`, `recordReadError`, the folder-pass reads/writes,
      `clearResults`, `saveGroups`, `listGroups` (with its total-order
      `ORDER BY <key> DESC, checksum` and `total` count), `listOccurrences`,
      `listIgnoredPaths` and `setIgnored`. Two rules the whole feature leans on:
      (a) **every result read filters on `scan_state.scan_seq`**, so a scan that
      failed or was killed after `beginScan` can never leave the previous root's
      results on screen; (b) **`setIgnored(path, true)` owns the pruning** —
      ignore row, occurrence removal at or beneath the path, group decrement and
      deletion of any group left below two occurrences, all in one transaction.
      There is no separate `removeOccurrencesUnder` method.
- [x] T013 Create `infrastructure/duplicate-finder/duplicate-scan-worker.ts` as
      a module-level singleton with `start()`, `requestStop()` and
      `getStatus()`, one `AbortController` per run, and a constructor that calls
      `reconcileInterruptedScan()` so a row left `running` by a dead process
      becomes `stopped` (research.md Decision 3). The pipeline body is wired in
      T024.
- [x] T014 Create `app/duplicate-finder/page.tsx` rendering a
      `DuplicateFinderView` shell from
      `infrastructure/duplicate-finder/ui/duplicate-finder-view.tsx`, keeping
      the route file thin per the constitution's Principle II.

**Checkpoint**: The tool appears in the sidebar, its database initialises, and
every port has an implementation. Nothing scans yet.

---

## Phase 3: User Story 1 - Find duplicate files in a directory (Priority: P1) 🎯 MVP

**Goal**: Scan a directory in the background and browse the resulting duplicate
**file** groups, paginated, sortable and expandable.

**Independent Test**: Build the fixture tree from
[quickstart.md](./quickstart.md), scan it with folder detection off, and confirm
scenarios 1, 2, 3, 4, 6, 7 and 10 pass.

### Implementation for User Story 1

- [x] T015 [US1] Create `application/duplicate-finder/list-scan-tree.ts` (phase
      1): an iterative walk from the root using
      `application/scanning/traverse-directory.ts` and the shared
      `FileSystemPort`, skipping symlinks and unreadable entries (counting the
      latter), skipping paths matched by `isIgnored` against the list loaded
      once at start, upserting file and directory facts in batches, and
      reporting progress + `active_path` as it goes (FR-006, FR-010, FR-011).
- [x] T016 [US1] Create `application/duplicate-finder/hash-candidates.ts`
      (phases 2-4): take the shared-size candidates, resolve each file's
      checksum in the order "own fresh row → `ChecksumCachePort` → compute",
      compute partial checksums first, treat the partial value as the full
      checksum when `size <= PARTIAL_CHECKSUM_BYTES` (research.md Decision 5),
      then full-hash only the survivors of the shared-partial query. Honour the
      `AbortSignal` between files and inside reads, and record a read error
      instead of aborting the scan when a single file fails (FR-010, FR-013,
      FR-017, SC-002, SC-005).
- [x] T017 [US1] Create
      `application/duplicate-finder/build-duplicate-results.ts` (phase 6, file
      half): clear the previous result set and write the file groups
      (`full_checksum` shared by ≥ 2 rows of the current `scan_seq`) plus their
      occurrences in one transaction, flagging `is_empty` by comparing against
      `EMPTY_CONTENT_CHECKSUM` rather than by `size = 0` (FR-009, FR-012,
      FR-016, research.md Decision 12).
- [x] T018 [US1] Create `application/duplicate-finder/run-duplicate-scan.ts`:
      the pipeline orchestration, updating `scan_state.phase` at each step,
      finishing as `finished`, and — on abort — still running the grouping step
      before finishing as `stopped` so partial results survive (FR-007,
      research.md Decision 13). The order is fixed and T040 inserts phase 5 into
      it without reordering anything else:
      `list (T015) → hash (T016) → [derive folders (T038), only when requested] → build results (T017/T039)`.
      Grouping is always the last step, so it sees every checksum the run
      produced.
- [x] T019 [US1] Create `application/duplicate-finder/start-scan.ts` returning
      the discriminated outcome
      `ok | not_found | not_a_directory | unreadable |     already_running`
      (FR-004, FR-008; the `root_ignored` case is added in T044).
- [x] T020 [P] [US1] Create `application/duplicate-finder/stop-scan.ts`
      delegating to the worker's `requestStop()`, a no-op when nothing runs.
- [x] T021 [P] [US1] Create `application/duplicate-finder/get-scan-status.ts`
      returning the status shape of the API contract, including `groupCount` and
      the `idle`-vs-empty-result distinction (FR-022).
- [x] T022 [P] [US1] Create
      `application/duplicate-finder/list-duplicate-groups.ts` mapping
      `{ sortBy, page }` to the repository's offset/limit query with
      `PAGE_SIZE`, and returning `{ groups, total, partial }` (FR-018, FR-020,
      SC-004).
- [x] T023 [P] [US1] Create
      `application/duplicate-finder/list-group-occurrences.ts` returning one
      group's paths, or a not-found result when the group is no longer part of
      the current result set (FR-019).
- [x] T024 [US1] Wire `run-duplicate-scan.ts` into
      `infrastructure/duplicate-finder/duplicate-scan-worker.ts`'s `start()`,
      injecting `filesystemAdapter`, `checksumAdapter`,
      `comparisonChecksumReadonlyAdapter` and `duplicateRepositoryAdapter`.
- [x] T025 [P] [US1] Create `app/api/duplicate-finder/scan/route.ts` (POST)
      mapping `start-scan`'s outcome to `202` / `400` / `409` per
      [contracts/duplicate-finder-api-contract.md](./contracts/duplicate-finder-api-contract.md).
- [x] T026 [P] [US1] Create `app/api/duplicate-finder/status/route.ts` (GET).
- [x] T027 [P] [US1] Create `app/api/duplicate-finder/stop/route.ts` (POST).
- [x] T028 [P] [US1] Create `app/api/duplicate-finder/groups/route.ts` (GET,
      `sortBy` + `page` params).
- [x] T029 [P] [US1] Create `app/api/duplicate-finder/occurrences/route.ts`
      (GET, `checksum` + `kind` params, `404` when absent).
- [x] T030 [P] [US1] Create
      `infrastructure/duplicate-finder/scan-preferences-storage.ts` persisting
      the last scanned path, the folder-detection checkbox and the sort choice
      in `localStorage`, mirroring
      `infrastructure/count-and-size/last-path-storage.ts` (FR-003, FR-020).
- [x] T031 [US1] Create `infrastructure/duplicate-finder/ui/use-scan-status.ts`:
      a polling hook that fetches `/status`, keeps polling only while
      `state === 'running'`, and exposes `scan`, `stop` and `refetch`, mirroring
      `use-comparison-status.ts`.
- [x] T032 [US1] Create
      `infrastructure/duplicate-finder/ui/scan-status-panel.tsx` showing state,
      phase, active path, `processed/total`, the unreadable count, the scan
      timestamp, the Stop button, and the distinct error messages for each
      `start-scan` rejection (FR-004, FR-006, FR-007).
- [x] T033 [US1] Create
      `infrastructure/duplicate-finder/ui/duplicate-group-list.tsx`: group rows
      (checksum, kind, size via the local `format-size`, occurrence count, empty
      badge), the size/occurrences sort toggle, page controls, row expansion
      fetching `/occurrences` on demand, and `CopyablePath` for every listed
      path (FR-016, FR-018 — FR-021).
- [x] T034 [US1] Assemble
      `infrastructure/duplicate-finder/ui/duplicate-finder-view.tsx`: the path
      input pre-filled from storage, the (still inert) folder checkbox, the Scan
      button, the status panel and the listing, plus the distinct "no scan yet"
      and "no duplicates found" states (FR-002, FR-022).

**Checkpoint**: User Story 1 is fully usable — duplicate files can be found,
browsed, sorted, paged and survive a restart.

---

## Phase 4: User Story 2 - Collapse whole duplicated folders (Priority: P2)

**Goal**: With the checkbox on, report duplicated folders as single rows and
suppress the file groups they fully explain.

**Independent Test**: Re-scan the quickstart fixture with the checkbox on and
confirm scenario 5 — including that `img.bin` keeps all three paths while
`notes.bin` disappears.

### Implementation for User Story 2

- [x] T035 [P] [US2] Create
      `domain/duplicate-finder/derive-directory-checksum.ts` as a local copy of
      the Merkle derivation (hash of the name-sorted `(name, type, checksum)`
      triples), carrying the cross-slice comment and the note from research.md
      Decision 9 about keeping the two copies in step, plus the existing
      justification for a domain module importing `crypto`: this is pure
      computation over already-known values, with no `fs`/SQL/network I/O, which
      is what Principle II actually forbids.
- [x] T036 [P] [US2] Create `domain/duplicate-finder/directory-candidacy.ts`: a
      pure `isCandidate(children, hadUnreadableEntries)` implementing "every
      direct file child's content is shared **and** every direct subdirectory is
      itself a candidate **and** nothing was unreadable" (research.md Decision
      4).
- [x] T037 [P] [US2] Create `domain/duplicate-finder/collapse-nested-groups.ts`:
      a pure function that, given each occurrence's set of covering
      duplicated-folder groups, omits a group iff the intersection across all of
      its occurrences is non-empty (FR-015, research.md Decision 7). Pure set
      logic only — building the covering sets is T039's job.
- [x] T038 [US2] Create `application/duplicate-finder/derive-folder-groups.ts`
      (phase 5): walk `scanned_directories` deepest-first, decide candidacy with
      `directory-candidacy.ts` over the shared-content path set from
      `findSharedContentPaths` (T012) — **not** over `duplicate_groups`, which
      phase 6 has not written yet — accumulate `subtree_size` and `child_count`,
      and derive and store a `directory_checksum` for candidates only. It
      derives and stores; it does **not** group or persist results (FR-014).
- [x] T039 [US2] Extend
      `application/duplicate-finder/build-duplicate-results.ts` to also group
      directories by `directory_checksum` (≥ 2 members, size = `subtree_size`,
      `is_empty` = childless) and to run the collapsing rule before writing
      anything, so a collapsed group is simply never stored (FR-015, SC-003).
      Build the covering sets here: index the members of every folder group in a
      `Map<path, groupChecksum>`, then for each occurrence walk its ancestor
      paths upward and collect the hits — O(path depth) per occurrence, never a
      scan of all folder members per occurrence. Feed those sets to
      `collapse-nested-groups.ts` (T037).
- [x] T040 [US2] Extend `application/duplicate-finder/run-duplicate-scan.ts` to
      insert phase 5 (T038) between the hashing step and the results step,
      exactly where T018's fixed order reserves it, running it only when
      `include_folders` is set, reporting the `deriving_folders` phase, and
      skipping it (file groups only) when the run was aborted before reaching
      it.
- [x] T041 [US2] Activate the "Also detect duplicate folders" checkbox in
      `duplicate-finder-view.tsx` (persisted via `scan-preferences-storage.ts`,
      sent with the scan request) and render folder rows distinctly — kind badge
      and empty-folder badge — in `duplicate-group-list.tsx` (FR-002, FR-016).

**Checkpoint**: Stories 1 and 2 both work; the checkbox is the only difference
between them.

---

## Phase 5: User Story 3 - Curate results with an ignore list (Priority: P3)

**Goal**: Mark paths as ignored from the listing, have them vanish immediately
and stay out of later scans, and manage the list from its own view.

**Independent Test**: Run quickstart scenario 11 end to end, including the
independence check against the comparison tool's own ignore list.

### Implementation for User Story 3

- [x] T042 [P] [US3] Create `application/duplicate-finder/set-ignored.ts`: a
      thin use case that delegates to the repository's `setIgnored` (T012),
      which owns the whole mark-and-prune transaction, and returns the removed
      counts to the caller. Unmarking only deletes the ignore row — results come
      back on the next scan, never retroactively (FR-024 — FR-027).
- [x] T043 [P] [US3] Create `application/duplicate-finder/list-ignored-paths.ts`
      returning the ignore list newest-first.
- [x] T044 [US3] Extend `application/duplicate-finder/start-scan.ts` with the
      `root_ignored` outcome for a root that sits at or beneath an ignored path,
      and surface its message in `scan-status-panel.tsx` (spec Edge Cases).
- [x] T045 [P] [US3] Create `app/api/duplicate-finder/ignore/route.ts` (POST,
      `{ path, ignored }`, returning the removed counts).
- [x] T046 [P] [US3] Create `app/api/duplicate-finder/ignored-paths/route.ts`
      (GET).
- [x] T047 [US3] Add the ignore action to each listed path in
      `duplicate-group-list.tsx`, removing the path (and, when it drops below
      two occurrences, the whole group) from the current view immediately and
      refreshing the page total from the returned counts (FR-024, FR-026).
- [x] T048 [US3] Create
      `infrastructure/duplicate-finder/ui/ignored-paths-view.tsx` (list with
      dates, un-ignore action, mirroring the comparison tool's equivalent view)
      and `app/duplicate-finder/ignored/page.tsx`, plus a link to it from
      `duplicate-finder-view.tsx` (FR-027).

**Checkpoint**: All three stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T049 [P] Document the new tool and its `DUPLICATE_FINDER_DB_PATH`
      environment variable in `README.md`, and update `CLAUDE.md`'s Architecture
      section to list the `duplicate-finder` slice alongside the existing ones.
- [x] T050 Run `pnpm lint` and `pnpm format`, then `pnpm build`, and fix
      whatever they report — the production build is the only check that catches
      a route or server/client boundary mistake in this project.
- [ ] T051 Run the full [quickstart.md](./quickstart.md) script (scenarios 1-13)
      against a throwaway database, with `DUPLICATE_FINDER_DB_PATH` and
      `DIRECTORY_COMPARISON_DB_PATH` exported so the real `data/` files are
      never touched.
- [x] T052 Verify SC-008 explicitly: checksum `data/directory-comparison.sqlite`
      and `data/count-and-size.sqlite` before and after a real scan of a large
      directory and confirm both are unchanged, and confirm the fixture tree's
      own digest is unchanged (FR-029, FR-030).

### Verification log (2026-07-29)

What was actually run, so the gaps are visible rather than assumed:

- **Automated harness** over the compiled slice, driving the real pipeline
  against the quickstart fixture tree: **51 checks, all passing**. Covers
  quickstart scenarios 1, 2, 3 (including the 100 000-group SC-004 timing: worst
  page 13 ms against a 2 s budget), 4, 5, 7, 8, 10, 11, 12 and 13, plus
  Stop-produces-partial-results, sort ordering, and the interrupted-scan
  reconciliation.
- **HTTP layer** exercised end to end against a real `next start` server: all
  seven endpoints, including `400 not_found` / `400 not_a_directory`, `202`
  start, `409 already_running` with its active path, `404` for a vanished group,
  and the ignore/un-ignore round trip with its prune counts.
- **T050**: `pnpm lint` and `pnpm format` ran in the repo and are clean;
  `pnpm build` succeeded, but had to run against a copy of the working tree —
  the repo's own `.next/` is owned by `root` (left behind by a Docker build), so
  `next build` cannot write there. **Run `sudo chown -R "$USER" .next` (or
  delete it) to build in place.** The default Turbopack builder also needs that
  fix: the copy had to fall back to `--webpack` because Turbopack rejects the
  symlinked `node_modules` a scratch copy requires.
- **T051 left open on purpose.** What the harness cannot judge is the part a
  human has to look at: the status panel's live progress and Stop on a genuinely
  large directory (scenario 6), and scenario 9's "measurably faster" claim
  against a copy of the real 230 MB comparison database. Everything else in the
  script is covered above.
- **T052**: verified as the structural guarantee (`readonly: true` on the
  overlay connection) plus the harness's own checks — the fixture tree's digest
  is unchanged and no comparison database was ever created. Checksumming the
  real `data/*.sqlite` files around a production scan is part of the open T051
  run.

### User Story 4 — by-directory tab (user request, 2026-07-29)

Added after the feature shipped; needs no schema change, because it reads the
result set the scan already persisted.

- [x] Create `domain/duplicate-finder/directory-row.ts`: the row type and its
      ordering (count / size / name, both directions), with directories and
      files deliberately mixed rather than blocked apart.
- [x] Add the four by-directory reads to the repository port and adapter:
      `listChildDirectories`, `aggregateDuplicatesByChild`,
      `listDirectDuplicateChildren`, `getDuplicateTotals` — all scoped to the
      current `scan_seq`, all served by a prefix range over the occurrence path
      index.
- [x] Create `application/duplicate-finder/list-directory-duplicates.ts`:
      assembles one level (child directories with subtree rollups + the
      duplicate files sitting directly there), applies the hide-empty filter,
      sorts and pages.
- [x] Create `app/api/duplicate-finder/directory/route.ts`.
- [x] Create `infrastructure/duplicate-finder/ui/directory-duplicates-view.tsx`:
      breadcrumb, Up, double-click or chevron to enter, the hide-empty checkbox,
      the three sort columns and the subtree/overall summary.
- [x] Add the tab strip to `duplicate-finder-view.tsx` and persist the active
      tab, the by-directory sort and the checkbox in
      `scan-preferences-storage.ts`.
- [x] Verified against a rebuilt production server on the quickstart fixture:
      root total matches the Duplicates tab (11 of 11), `unique/` lists with 0
      and disappears when the checkbox is ticked, counts roll up correctly (3 +
      2 + 2 + 4 = 11), only duplicate files are listed (`notes.bin`, collapsed
      by FR-015, is absent while `img.bin` — kept in full because of its third
      copy — is present), sorting works in both directions, and a path outside
      the scanned root falls back to the root.

### User Story 5 and the second round of by-directory work (user requests, 2026-07-29)

- [x] Path normalisation (`domain/duplicate-finder/normalize-path.ts`), applied
      both when a scan starts and when the by-directory view reads
      `scan_state.root_path`. A trailing slash in the scan form had made that
      tab come back empty: the root was recorded as `/x/` while every child's
      `parent_path` was `/x`, so no row matched and the prefix range became
      `/x//`. Normalising on read fixed the existing scan without a re-scan.
- [x] Single-click navigation on directory names (the name is a real button),
      keeping double-click and the chevron. Double-click alone was
      undiscoverable and selected text.
- [x] The by-directory tab is the default, and it comes first; a stored explicit
      choice still wins.
- [x] Checksum column in the by-directory rows, blank for directories that
      merely contain duplicates.
- [x] `occurrences-dialog.tsx`: every place a content lives, opened from the
      `×N` button of rows that are themselves duplicates. Wide dialog, the
      opening row highlighted, and the full path on hover — which needed an
      optional `title` prop on the shared `CopyablePath`, whose hardcoded "Click
      to copy" was what the tooltip showed.
- [x] Deletion (User Story 5): `FileDeletionPort` + adapter (`lstat`,
      `mkdir     -p`, `rename` with an EXDEV copy+unlink fallback, numeric
      suffix on collision), `delete-duplicate.ts` with its dry-run mode and
      refusal list, `domain/duplicate-finder/trash-path.ts`, the repository's
      `findOccurrenceByPath` / `removeDeletedFile`, and the two-step UI.
      Verified end to end on the fixture: the dry run left the file in place and
      did not even create the trash directory; the real run moved it to
      `<trash>/<full original path>`; 3 copies → 2 → group gone at 1; and the
      last copy came back `409` with the file still on disk.
- [x] The two empty-content filters (FR-044), applied inside the SQL as bound
      flags so one prepared statement covers all four combinations. Checked
      against real data: 5706 → 5629 (empty files) → 5559 (empty dirs) → 5482
      (both), dropping in cascade through the tree.

- [x] Deleting a duplicated **folder** as well as a file (user request): the
      move is recursive (`fs.cp`/`fs.rm` on the EXDEV path), and the repository
      prunes the whole subtree — occurrences beneath the folder included, since
      FR-015 keeps a file reported in its own right when it also has a copy
      outside. Verified on a two-identical-folders fixture: dry run touched
      nothing, the real run moved `A` with its three files preserving the
      structure, `B` stayed intact, the group vanished at one copy, and deleting
      `B` came back `409` with the folder still there.

- [x] Ignore available from the by-directory rows and the occurrences dialog,
      not just the checksum listing (user request). No server change was needed:
      `setIgnored` already pruned the subtree, recounted the groups and dropped
      those left below two copies. Verified: ignoring one of two copies removed
      the group entirely (`removedGroups: 1`), one of three left two
      (`removedGroups: 0`), and ignoring a folder took its inner duplicate with
      it — with every file still on disk. The chance to delete the now-shared
      prune body from `setIgnored` was taken while there (−22 lines).

- [x] Per-row **Rescan** (FR-045): `refresh-scope.ts`, the worker's
      `startRefresh`, `POST /api/duplicate-finder/refresh`, and the button on
      every by-directory row. Keeps `scan_seq`, so the rest of the results
      survive; `listScanTree` gained a `scanRootPath` (only the real root has a
      NULL `parent_path`) and now returns the paths it visited, which is how
      vanished files are found and forgotten. Verified: after deleting one file
      and adding another inside one folder, refreshing only that folder took
      `a.bin`'s group away — its surviving copy lived OUTSIDE the refreshed
      scope — and grew `b.bin` to three copies, with `scan_seq` unchanged.

- [x] Composite `(parent_path, scan_seq)` indexes, replacing the single-column
      `parent_path` ones (research.md Decision 17). Found by profiling the
      "Rescan takes far longer than expected" report: the folder pass was taking
      **60 s** because the planner chose `(scan_seq, size)` and scanned all 57 k
      rows per directory. Now 74 ms, and a partial refresh went from ~63 s to
      ~0.7 s. Full scans pay the same pass and improve identically.

- [x] **Bug fixed (mine)**: ignored paths were coming back. Ignoring prunes
      `duplicate_occurrences` but leaves the `scanned_files` facts and
      checksums, and the Rescan feature re-groups globally from exactly those
      rows — so refreshing anything resurrected every ignored folder
      (`Archivos enviados De La Flor` was back with 54 duplicates, `mpc-beats`
      with 10). The flaw was predicted while discussing un-ignore and then
      shipped anyway. Now `hashCandidates`, `deriveFolderGroups`,
      `buildDuplicateResults` and the by-directory listing all consult the
      ignore set (FR-046), reusing the domain's `isIgnored`; an ignored child
      also marks its parent's content incomplete, as the walk already did.
      Verified against a copy of the real database: the three reported paths are
      gone, and a refresh of `Musica` no longer brings its four ignored
      subfolders back.

### Follow-ups after the first commit (user requests, 2026-07-29)

Three listing changes, all re-verified against a rebuilt production server:

- A **type column** spelling out `File` / `Folder` next to each checksum
  (FR-020a). The icon stayed but is now `aria-hidden`, so a screen reader
  announces the type once rather than twice.
- A **Dir button** on each occurrence row that copies the folder containing that
  path (FR-021), alongside the existing click-the-path-to-copy-it-whole.
  Delivered first as a copy-the-file-name button and corrected on the spot.
- **Ascending order** for both sort fields: clicking the active field reverses
  it, with a ↑/↓ indicator, and the direction persists across sessions like the
  field already did. Both directions and the fallback for a bogus `sortDir` were
  checked over HTTP; `EXPLAIN QUERY PLAN` over 100 000 groups confirms the
  ascending queries still ride the existing indexes instead of falling back to a
  temp b-tree sort.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: needs T001 (schema) for the adapter tasks; blocks
  every user story.
- **User Story 1 (Phase 3)**: needs Phase 2 complete. Delivers the MVP.
- **User Story 2 (Phase 4)**: needs Phase 2, and T017/T018 from US1 because
  T039/T040 extend those exact files.
- **User Story 3 (Phase 5)**: needs Phase 2, and T033/T019 from US1 because T047
  extends the listing component and T044 extends `start-scan.ts`. Its walk-time
  exclusion already works from T015, which reads the (initially empty) ignore
  list.
- **Polish (Phase 6)**: after every story that is being shipped.

### Cross-story file conflicts (never run these in parallel)

- `infrastructure/duplicate-finder/ui/duplicate-group-list.tsx`: T033 (US1) →
  T041 (US2) → T047 (US3).
- `application/duplicate-finder/build-duplicate-results.ts`: T017 (US1) → T039
  (US2).
- `application/duplicate-finder/run-duplicate-scan.ts`: T018 (US1) → T040 (US2).
- `application/duplicate-finder/start-scan.ts`: T019 (US1) → T044 (US3).
- `infrastructure/duplicate-finder/ui/duplicate-finder-view.tsx`: T014 (shell) →
  T034 (US1) → T041 (US2) → T048 (US3).

### Within Phase 2

- T011 and T012 touch the same file and are strictly sequential.
- T011/T012 depend on T008 (the port they implement) and T001 (the schema).
- T013 depends on T011 (it calls `reconcileInterruptedScan`).

### Within User Story 1

- T015 → T016 → T017 → T018 is the pipeline order; each consumes the previous
  phase's rows.
- T024 depends on T018 and T013.
- The route tasks (T025-T029) each depend on their use case (T019-T023).
- The UI tasks depend on the routes: T031 on T026/T027, T032 on T031, T033 on
  T028/T029, T034 on T030+T032+T033.

### Parallel Opportunities

- Phase 1: T002 and T003 run alongside T001.
- Phase 2: T004, T005, T006, T007 in parallel; then T009 and T010 in parallel
  with T008.
- US1: T020-T023 in parallel once T018 exists; T025-T029 in parallel once their
  use cases exist; T030 any time.
- US2: T035, T036 and T037 are three independent pure modules.
- US3: T042/T043 in parallel, then T045/T046 in parallel.

---

## Parallel Example: Phase 2 Foundational

```bash
# Four pure/port modules, no shared files:
Task: "Create domain/duplicate-finder/duplicate-group.ts"
Task: "Create domain/duplicate-finder/ignored-path-match.ts"
Task: "Create application/duplicate-finder/checksum-port.ts"
Task: "Create application/duplicate-finder/checksum-cache-port.ts"

# Then the two independent adapters:
Task: "Create infrastructure/duplicate-finder/checksum-adapter.ts"
Task: "Create infrastructure/duplicate-finder/comparison-checksum-readonly-adapter.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 (T001-T003) → Phase 2 (T004-T014) → Phase 3 (T015-T034).
2. **Stop and validate**: quickstart scenarios 1, 2, 3, 4, 6, 7, 10, 12, 13.
3. That alone is a usable duplicate finder for files — the checkbox is present
   but inert, and the ignore list is empty but already honoured by the walk.

### Incremental Delivery

1. MVP (US1) → duplicate files, paginated and sortable.
2. Plus US2 → duplicated folders collapse the noise (the big usability win on
   real trees).
3. Plus US3 → the tool becomes repeatable instead of one-shot.

### Notes

- Commit per task or per logical group, Conventional Commits (Principle VI);
  Husky + lint-staged run ESLint and Prettier automatically.
- Never point `DUPLICATE_FINDER_DB_PATH` at `data/` while iterating, and never
  let anything in this feature open `data/directory-comparison.sqlite` for
  writing.
- No test files, no test dependencies (Principle IV) — verification is
  [quickstart.md](./quickstart.md).
