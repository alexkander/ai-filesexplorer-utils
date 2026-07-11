# Implementation Plan: Count and Size Tool

**Branch**: `002-count-and-size` | **Date**: 2026-07-11 | **Spec**:
[spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-count-and-size/spec.md`

## Summary

Add a "Count and Size" tool: a filesystem browser starting at `/` where clicking
a directory navigates in and clicking a file does nothing, alongside a
recursive, asynchronous, single-active-worker scanner that computes each
directory's total file count and used space (its own direct files plus every
descendant directory's totals). Scan results, per-directory state, and
timestamps persist in an embedded SQLite database (`better-sqlite3`) so they
survive restarts, including Docker container recreation (which required adding a
volume to `docker-compose.prod.yml` that didn't exist before). Aggregated totals
and the 5-value display state are computed at read time via a recursive SQL
query over per-directory rows rather than propagated on write, keeping the
background worker's job simple: pop a path off an in-memory LIFO stack, list it,
record its own result, push its subdirectories. The browsing UI paginates large
directory listings and polls the currently viewed directory's status every 2s
while a scan affecting it is active. Each listed entry shows its own numbers
directly (a file's size; a scanned directory's state, count, size, and
last-scanned time — both humanized and in exact bytes), an Up button navigates
to the parent directory, and the current directory is kept as client-side state
— remembered via `localStorage` across visits, but deliberately never reflected
in the URL (research.md Decision 5, revised during a post-implementation
feedback round).

## Technical Context

**Language/Version**: TypeScript (`strict: true`) on Node.js 22, matching the
existing `tsconfig.json` and Dockerfile base images.

**Primary Dependencies**: Next.js 16.2.10 (App Router) + React 19.2.7 (already
in place). New: `better-sqlite3` (embedded SQLite driver — research.md Decision
1/8). No new UI dependency needed — the browsing list, status panel, and
Scan/Stop buttons are built with the shadcn/ui primitives already introduced by
001-dashboard-shell.

**Storage**: SQLite via `better-sqlite3`, one table (`directory_scan_nodes`),
file at `data/count-and-size.sqlite` (new, gitignored directory). See
`data-model.md` and `research.md` Decisions 1, 2, 7, 8.

**Testing**: N/A — this project does not use automated tests (Constitution
Principle IV). Manual end-to-end verification steps are in
[quickstart.md](./quickstart.md), covering local `pnpm dev`, Docker dev, and
Docker prod — the last one specifically validates that scan results survive full
container recreation, not just a process restart.

**Target Platform**: Web browser, served by the existing Next.js server
(Node 22) via the `dev` and `runner` Docker stages. A single, long-lived Node.js
process in every deployment mode (no serverless/edge, no clustering) — required
for the in-memory scan-worker singleton (FR-012) to correctly enforce "only one
active scan system-wide" without a cross-process lock.

**Project Type**: Single Next.js web application, extending the
`domain/`/`application/`/`infrastructure/` layering already established by
001-dashboard-shell with a new `count-and-size` slice in each, plus new
`app/count-and-size/` (page) and `app/api/count-and-size/` (Route Handlers)
directories.

**Performance Goals**: No specific latency target set by the spec (SC-002,
SC-007 only require the UI to stay responsive, not a numeric target). Pagination
(FR-001a, 200 entries/page) and 2-second status polling (FR-017a) are the
concrete mechanisms chosen to keep browsing/viewing responsive regardless of
tree size — see research.md Decision 6.

**Constraints**: Read-only (never modifies the filesystem — Constitution
Principle V's dry-run/confirmation requirement does not apply, per spec
Assumptions). Symlinks never followed (FR-015). Unreadable entries skipped, not
fatal, flagged on the containing directory (FR-016). Exactly one active scan
procedure system-wide (FR-012), LIFO-ordered (FR-014). Single-user, no-auth
(constitution's deployment model) — any path the OS user running the process can
read is in scope, starting at `/`.

**Scale/Scope**: Unbounded in principle — scanning is intended to work from `/`
on a real filesystem, so individual directories may have very large numbers of
direct entries (pagination handles browsing; the recursive scan itself has no
depth/size cap, matching the spec's "must be recursive" and "only one active
procedure" requirements rather than an artificial limit).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — see
note below._

| Principle                                                                                          | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I. Simplicity First (YAGNI)                                                                        | PASS   | No generic job-queue library, no configurable poll interval/page size, no persisted queue (research.md Decision 2) — each piece exists only because a specific FR requires it.                                                                                                                                                                                                                         |
| II. Hexagonal Architecture                                                                         | PASS   | `domain/count-and-size/` (pure state derivation, ignore rules, stack) has zero `fs`/SQL/Next.js imports; `application/count-and-size/` defines `FileSystemPort` + `ScanRepositoryPort` and orchestrates use cases against them only; `infrastructure/count-and-size/` holds the only `fs`, `better-sqlite3`, and Route Handler code. `app/` stays thin (parses path/query params, calls one use case). |
| III. SOLID                                                                                         | PASS   | `FileSystemPort` and `ScanRepositoryPort` are two small, single-purpose interfaces (interface segregation) rather than one combined port; new ignore rules or a different DB could each be swapped behind their own port without touching use cases (open/closed, dependency inversion).                                                                                                               |
| IV. No Automated Tests                                                                             | PASS   | No test files/tasks planned; `quickstart.md` carries manual verification, including the container-recreation persistence check.                                                                                                                                                                                                                                                                        |
| V. Safe-by-Default Destructive Operations                                                          | N/A    | Read-only tool — never deletes/moves/overwrites/merges files (spec Assumptions).                                                                                                                                                                                                                                                                                                                       |
| VI. Conventional Commits                                                                           | PASS   | Enforced at commit time as with prior work; no plan-level impact.                                                                                                                                                                                                                                                                                                                                      |
| Tech constraints (Next.js/React/TS strict, shadcn/ui+Tailwind, pnpm, English, single-user/no-auth) | PASS   | Reuses the existing shadcn/ui + Tailwind setup, no new UI framework; `better-sqlite3` added via `pnpm add` per the Development Workflow rule; no auth added.                                                                                                                                                                                                                                           |

No violations. Complexity Tracking table is omitted (nothing to justify).

**Post-Phase-1 re-check**: Confirmed — `data-model.md`'s single persisted entity
plus read-time aggregation, and the two ports in `contracts/`, introduce no new
dependencies or deviations beyond what's listed above. One spec-level correction
was made during planning (see `research.md` Decision 0): FR-011 and a User Story
3 acceptance scenario in `spec.md` described "incomplete" as mutually exclusive
with the Completed state, which is unsatisfiable with the spec's own 5-state
enumeration; both were corrected to describe "incomplete" as a flag shown
alongside Completed. This is a clarity fix, not a scope change — no re-run of
`/speckit-clarify` is needed.

## Project Structure

### Documentation (this feature)

```text
specs/002-count-and-size/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── filesystem-port-contract.md
│   ├── scan-repository-port-contract.md
│   └── count-and-size-api-contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
domain/
└── count-and-size/
    ├── directory-scan-node.ts       # DirectoryScanNode, OwnOutcome types
    ├── derive-directory-view.ts     # Pure: (node, descendantNodes) -> DirectoryView
    ├── should-ignore-entry.ts       # Pure: (RawEntry) -> ignore? + reason (symlink/unreadable)
    └── scan-stack.ts                # Pure LIFO stack push/pop/contains

application/
└── count-and-size/
    ├── filesystem-port.ts           # FileSystemPort interface
    ├── scan-repository-port.ts      # ScanRepositoryPort interface
    ├── list-directory.ts            # Use case: paginated listing + hasScanData
    ├── get-directory-status.ts      # Use case: DirectoryView for one path
    ├── start-scan.ts                # Use case: enqueue a path
    ├── stop-scan.ts                 # Use case: stop the active scan
    └── process-directory.ts         # Use case: the worker's per-node step

infrastructure/
├── count-and-size/
│   ├── filesystem-adapter.ts        # Implements FileSystemPort (fs/promises)
│   ├── sqlite-client.ts             # Opens data/count-and-size.sqlite, creates schema
│   ├── scan-repository-adapter.ts   # Implements ScanRepositoryPort (better-sqlite3)
│   ├── scan-worker.ts               # Singleton: in-memory stack + loop + startup reconciliation
│   ├── last-path-storage.ts         # localStorage read/write for the remembered path (research.md Decision 5)
│   └── ui/
│       ├── count-and-size-explorer.tsx  # Owns currentPath client state; Up button; wires the two below
│       ├── directory-browser.tsx    # Listing + pagination + onNavigate callback (no URL involvement)
│       ├── scan-status-panel.tsx    # State/incomplete/last-scanned + Scan/Stop buttons + polling
│       ├── format-size.ts           # Shared humanized + exact-byte size formatting (spec FR-005b)
│       ├── state-labels.ts          # Shared DirectoryState -> display label map
│       └── components/              # Additional shadcn/ui primitives if needed (e.g. badge, progress)
└── ui/                              # (existing) sidebar/header, unchanged except new MenuEntry

app/
├── count-and-size/
│   └── page.tsx                     # Fixed route (no path segments) — thin, renders CountAndSizeExplorer
└── api/
    └── count-and-size/
        ├── list/route.ts
        ├── status/route.ts
        ├── scan/route.ts
        └── stop/route.ts

domain/navigation/menu-entry.ts      # (existing, edited) + { key: 'count-and-size', label: 'Count and Size', route: '/count-and-size' }

data/                                 # New, gitignored — holds count-and-size.sqlite
docker-compose.prod.yml               # Edited — add named volume for /app/data (research.md Decision 7)
```

**Structure Decision**: Single project, same as 001-dashboard-shell — no
frontend/backend split. This feature is the first to populate `app/api/`, and
the first to add a runtime dependency (`better-sqlite3`) beyond the UI stack.
The `count-and-size` slice follows the exact `domain/application/infrastructure`
pattern 001-dashboard-shell established, so this is also the first feature to
prove that pattern scales to a second tool (validating 001's SC-005 for real,
per that spec's quickstart note).

## Complexity Tracking

_No violations — table intentionally omitted._
