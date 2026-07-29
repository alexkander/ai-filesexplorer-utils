# Implementation Plan: Duplicate Finder

**Branch**: `004-duplicate-finder` | **Date**: 2026-07-29 | **Spec**:
[spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-duplicate-finder/spec.md`

## Summary

Add a "Find Duplicates" tool: one directory path, an optional "Also detect
duplicate folders" checkbox, and a Scan button that starts a single background
pipeline over that subtree, followed by a paginated listing of duplicate groups
(one row per repeated content checksum, expandable into the paths where it
appears) that the user can sort by size or occurrence count and curate through a
per-feature ignore list.

The scan is a **six-phase pipeline** driven by a purpose-built worker singleton
(research.md Decision 2), each phase narrowing the candidate set so content is
read as late and as rarely as possible:

1. **List** — walk the subtree with the shared `application/scanning`
   `traverseDirectory` helper, skipping symlinks, unreadable entries and ignored
   subtrees, recording each file's size + modification time.
2. **Size filter** — pure SQL `GROUP BY size HAVING COUNT(*) > 1`. A file whose
   size is unique in the subtree is never opened (FR-013, SC-002).
3. **Partial hash** — 64 KB prefix checksum for same-size candidates, then
   `GROUP BY size, partial_checksum HAVING COUNT(*) > 1`. Files at or below the
   prefix threshold are fully covered by this single read and skip phase 4
   entirely (research.md Decision 5).
4. **Full hash** — full SHA-256 only for what survives, reusing a checksum
   already recorded by this tool or read from the directory comparison tool's
   database in read-only mode when size + modification time still match
   (research.md Decision 6). Grouping by full checksum yields the **file**
   duplicate groups.
5. **Folder derivation** (only when the checkbox was ticked) — bottom-up over
   the recorded directories. A directory can only have a duplicate if every
   descendant file's content occurs at least twice, which prunes almost
   everything for free and, crucially, keeps phase 2's "never read a
   unique-sized file" guarantee intact (research.md Decision 4). Surviving
   candidates get a Merkle checksum over their name-sorted children; grouping by
   it yields the **folder** duplicate groups.
6. **Collapse & persist** — drop every group whose occurrences are all explained
   by one folder group (FR-015), then write groups and occurrences in a single
   transaction.

Everything is persisted in this feature's own SQLite database at
`data/duplicate-finder.sqlite`, so results and the scan's own state survive a
reload or a restart; the directory comparison tool's database is only ever
opened read-only. No new runtime dependency, and no filesystem mutation of any
kind.

## Technical Context

**Language/Version**: TypeScript (`strict: true`) on Node.js 22, matching the
existing `tsconfig.json` and Dockerfile base images.

**Primary Dependencies**: No new dependency. Reuses `better-sqlite3` for
persistence and Node's built-in `crypto` (`createHash('sha256')`) +
`fs.createReadStream` for streamed hashing. Reuses the shared scan module
(`domain/scanning`, `application/scanning`, `infrastructure/scanning`) — the one
cross-slice import the codebase intentionally allows. UI is built from the
shadcn/ui primitives already in `infrastructure/ui/components` plus a native
checkbox, the same pattern the directory comparison explorer already uses for
its toggles.

**Storage**: SQLite via `better-sqlite3`, own file at
`data/duplicate-finder.sqlite` (override: `DUPLICATE_FINDER_DB_PATH`), six
tables: `scan_state`, `scanned_files`, `scanned_directories`,
`duplicate_groups`, `duplicate_occurrences`, `ignored_paths`. Plus a read-only
overlay on `data/directory-comparison.sqlite` used purely as a hash accelerator.
See [data-model.md](./data-model.md).

**Testing**: N/A — this project does not use automated tests (Constitution
Principle IV). Manual end-to-end verification steps are in
[quickstart.md](./quickstart.md).

**Target Platform**: Web browser, served by the existing Next.js server (Node
22). A single, long-lived Node.js process — required for the in-memory worker
singleton to enforce "at most one scan at a time" (FR-008) without a
cross-process lock, same precedent as the other two tools.

**Project Type**: Single Next.js web application, adding a `duplicate-finder`
slice to the existing `domain/`/`application/`/`infrastructure/` layering, plus
`app/duplicate-finder/` (pages) and `app/api/duplicate-finder/` (Route
Handlers).

**Performance Goals**: SC-002 (a subtree with no two same-sized files completes
without a single content read), SC-004 (any listing page within 2 s at 100 000
groups — served by an indexed `ORDER BY ... LIMIT/OFFSET`, never by loading all
groups), SC-005 (Stop honoured within 2 s even mid-file — the abort signal
reaches the read stream), SC-009 (a re-scan of an unchanged tree reuses every
recorded checksum).

**Constraints**: Strictly read-only on the scanned filesystem, so Principle V's
dry-run/confirmation gate does not apply (FR-029). Never writes to the directory
comparison tool's database (FR-030) — it is opened with `readonly: true` so the
driver itself enforces it. Symlinks never followed (FR-011). Exactly one scan at
a time within this tool (FR-008), independent of the other tools' scans.
Single-user, no-auth.

**Scale/Scope**: Unbounded in principle — the scanned root may hold millions of
files. The design keeps memory bounded by pushing every set operation into SQL
(grouping, pagination, subtree exclusion) rather than materialising candidate
lists in the worker.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — see
note below._

| Principle                                                                                            | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Simplicity First (YAGNI)                                                                          | PASS   | No new dependency. One result set at a time instead of a scan-history model (research.md Decision 8). No delete/move/export. Sorting is two buttons rather than a new Select primitive. The folder-candidacy pruning replaces what would otherwise be a second full-hash pass rather than adding a caching layer.                                                                                                                                    |
| II. Hexagonal Architecture                                                                           | PASS   | `domain/duplicate-finder/` holds only pure rules (Merkle derivation, folder candidacy, the collapsing rule, ignore matching) with no `fs`/SQL/React imports; `application/duplicate-finder/` defines three ports (`ChecksumPort`, `DuplicateRepositoryPort`, `ChecksumCachePort`) and the use cases over them; `infrastructure/duplicate-finder/` holds the only `fs`, `crypto`, `better-sqlite3` and React code. `app/` routes and pages stay thin. |
| III. SOLID                                                                                           | PASS   | `ChecksumPort` deliberately omits the comparison tool's Office-container method (interface segregation — this feature never needs it). `ChecksumCachePort` is a single-method read-only capability, substitutable by a null implementation when the other tool's database is absent. Phases are separate use-case modules, so a change to the hashing cascade does not touch the grouping or collapsing code.                                        |
| IV. No Automated Tests                                                                               | PASS   | No test files, no test tasks; [quickstart.md](./quickstart.md) carries the manual verification script.                                                                                                                                                                                                                                                                                                                                               |
| V. Safe-by-Default Destructive Operations                                                            | N/A    | The feature never creates, moves, renames, overwrites or deletes anything on the scanned filesystem (FR-029). The only mutations are rows in its own database.                                                                                                                                                                                                                                                                                       |
| VI. Conventional Commits                                                                             | PASS   | Enforced at commit time; no plan-level impact.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Tech constraints (Next.js/React/TS strict, shadcn/ui + Tailwind, pnpm, English, single-user/no-auth) | PASS   | No new UI library and no new runtime dependency, so `pnpm-lock.yaml` is untouched. All artifacts and UI copy in English. No auth.                                                                                                                                                                                                                                                                                                                    |

No violations. The Complexity Tracking table is omitted (nothing to justify).

**Cross-slice duplication note**: `derive-directory-checksum.ts`, the streamed
checksum adapter and `format-size.ts` are re-created as local copies inside this
slice rather than imported from `directory-comparison/`. That is the codebase's
existing, explicitly documented convention — see the comment in
`infrastructure/directory-comparison/ui/format-size.ts` ("this feature slice
stays free of cross-tool imports (the only intentional exception is the shared
`scanning` module)") — and research.md Decision 9 records the trade-off and the
one condition under which it should be revisited.

**Post-Phase-1 re-check**: Confirmed. [data-model.md](./data-model.md)'s six
tables are all local to this feature; the only cross-feature access is the
read-only overlay, which cannot write by construction. The three ports in
[contracts/](./contracts) add no dependency and no deviation from the table
above.

## Project Structure

### Documentation (this feature)

```text
specs/004-duplicate-finder/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── checklists/
│   └── requirements.md  # /speckit-specify output
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── checksum-port-contract.md
│   ├── checksum-cache-port-contract.md
│   ├── duplicate-repository-port-contract.md
│   └── duplicate-finder-api-contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
domain/
├── duplicate-finder/
│   ├── derive-directory-checksum.ts   # Merkle hash over name-sorted children (local copy)
│   ├── directory-candidacy.ts         # "can this directory possibly have a twin?" pruning rule
│   ├── collapse-nested-groups.ts      # FR-015: which groups a folder group fully explains
│   ├── duplicate-group.ts             # group/occurrence types + sort keys
│   └── ignored-path-match.ts          # exact-or-subtree matching used during the walk
├── scanning/                          # reused unchanged (shared module)
└── navigation/menu-entry.ts           # + "Find Duplicates" entry

application/
├── duplicate-finder/
│   ├── checksum-port.ts               # partial + full content hashing
│   ├── checksum-cache-port.ts         # read-only lookup of an already-computed checksum
│   ├── duplicate-repository-port.ts   # this feature's persistence contract
│   ├── path-inspection-port.ts        # missing/file/directory/unreadable (research.md Decision 16)
│   ├── scan-worker-port.ts            # the background runner, as the use cases see it
│   ├── run-duplicate-scan.ts          # the six-phase pipeline orchestration
│   ├── list-scan-tree.ts              # phase 1
│   ├── hash-candidates.ts             # phases 2-4
│   ├── derive-folder-groups.ts        # phase 5
│   ├── build-duplicate-results.ts     # phase 6 (collapse + persist)
│   ├── start-scan.ts / stop-scan.ts / get-scan-status.ts
│   ├── list-duplicate-groups.ts       # paginated + sorted listing
│   ├── list-group-occurrences.ts      # paths for one expanded group
│   ├── set-ignored.ts                 # mark/unmark + prune current results
│   └── list-ignored-paths.ts
└── scanning/                          # reused unchanged (shared module)

infrastructure/
├── duplicate-finder/
│   ├── sqlite-client.ts               # data/duplicate-finder.sqlite + schema
│   ├── duplicate-repository-adapter.ts
│   ├── checksum-adapter.ts            # streamed SHA-256, partial + full (local copy)
│   ├── comparison-checksum-readonly-adapter.ts  # read-only overlay, never writes
│   ├── path-inspection-adapter.ts     # fs.stat + fs.access behind PathInspectionPort
│   ├── duplicate-scan-worker.ts       # singleton: phases, progress, AbortController
│   ├── scan-preferences-storage.ts    # last path + folder checkbox + sort (localStorage)
│   └── ui/
│       ├── duplicate-finder-view.tsx  # form + status panel + listing
│       ├── scan-status-panel.tsx
│       ├── duplicate-group-list.tsx   # rows, expansion, ignore action, pagination
│       ├── ignored-paths-view.tsx
│       ├── use-scan-status.ts         # polling hook
│       └── format-size.ts             # local copy (see cross-slice note)
└── scanning/                          # reused unchanged (shared module)

app/
├── duplicate-finder/
│   ├── page.tsx
│   └── ignored/page.tsx
└── api/duplicate-finder/
    ├── scan/route.ts          # POST  start
    ├── status/route.ts        # GET   state + progress
    ├── stop/route.ts          # POST  cancel
    ├── groups/route.ts        # GET   paginated + sorted groups
    ├── occurrences/route.ts   # GET   paths of one group
    ├── ignore/route.ts        # POST  mark / unmark
    └── ignored-paths/route.ts # GET   the ignore list
```

**Structure Decision**: The existing per-feature vertical slice, identical in
shape to `count-and-size` and `directory-comparison`: a pure `domain/` slice, an
`application/` slice owning its ports and use cases, an `infrastructure/` slice
holding the SQLite client, adapters, worker and React components, and a thin
`app/` layer of pages and Route Handlers. The only shared code is the
feature-agnostic `scanning` module, which this feature consumes exactly as the
other two do.
