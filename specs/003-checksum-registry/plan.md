# Implementation Plan: Directory Comparison Tool

**Branch**: `003-checksum-registry` | **Date**: 2026-07-12 | **Spec**:
[spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-checksum-registry/spec.md`

## Summary

Add a "Directory Comparison" tool: two independent directory browsers (left and
right panes), each starting at `/`, with an optional "Move sync" toggle that
mirrors navigation between them, and an explicit "Compare" action that
recursively checksums both currently-shown directories and shows a color-coded
per-entry status (Not compared / Matching / Differs / Only on this side /
Scanning / Error). "Compare" runs as two chained background passes (research.md
Decision 3): **Pass 1** reuses the feature-agnostic scan engine already
extracted for Count and Size (`domain/scanning`, `application/scanning`,
`infrastructure/scanning`) to list both sides' subtrees and record each file's
size/modification time — no hashing yet. **Pass 2** walks the now-listed pair
bottom-up (deepest first) and applies a cascading, short-circuiting comparison —
matching entry names, then file size, then a partial-content hash, then a
full-content SHA-256, stopping at the first proof of a difference — so a
directory pair is only ever fully content-hashed when it's actually necessary to
confirm every descendant matches; an unchanged, already-Matching subtree is
skipped entirely on a later incremental "Compare". Both passes persist to the
tool's own SQLite database, entirely separate from Count and Size's. No
duplicate registry, cross-tree search, or deletion action is included — this
spec is comparison-only (see spec.md Clarifications).

## Technical Context

**Language/Version**: TypeScript (`strict: true`) on Node.js 22, matching the
existing `tsconfig.json` and Dockerfile base images.

**Primary Dependencies**: No new dependency. Reuses `better-sqlite3` (already
added for Count and Size) for persistence, and Node's built-in `crypto`
(`createHash('sha256')`) + `fs.createReadStream` for checksums — streamed, not
loaded fully into memory. Reuses the shared scan engine (`domain/scanning`,
`application/scanning`, `infrastructure/scanning`) extracted from Count and Size
(PR #6) unchanged. UI is built with the shadcn/ui primitives already in place.

**Storage**: SQLite via `better-sqlite3`, own file at
`data/directory-comparison.sqlite` (separate from `data/count-and-size.sqlite` —
spec Assumptions), two tables: `directory_comparison_nodes` and
`file_checksums`. See `data-model.md` and `research.md` Decision 1.

**Testing**: N/A — this project does not use automated tests (Constitution
Principle IV). Manual end-to-end verification steps are in
[quickstart.md](./quickstart.md).

**Target Platform**: Web browser, served by the existing Next.js server (Node
22). A single, long-lived Node.js process — required for the in-memory
`ScanEngine` singleton (reused from `infrastructure/scanning/`) to correctly
enforce "only one active comparison scan in this tool" (FR-010) without a
cross-process lock, same precedent as Count and Size.

**Project Type**: Single Next.js web application, adding a new
`directory-comparison` slice to the existing
`domain/`/`application/`/`infrastructure/` layering, plus
`app/directory-comparison/` (page) and `app/api/directory-comparison/` (Route
Handlers).

**Performance Goals**: No numeric latency target (spec SC-002/SC-006 require
color-coded feedback and responsive cancellation, not a target number). The
cascading checksum strategy (size → partial hash → full hash) and reused FR-001a
pagination are the concrete mechanisms for staying responsive on large trees and
large files (spec SC-004).

**Constraints**: Read-only (Constitution Principle V's dry-run/confirmation
requirement does not apply — spec Assumptions). Symlinks never followed
(FR-011). Unreadable entries skipped, flagged, and — stricter than Count and
Size — propagate an Error status up to the compared root with no computable
directory checksum for any ancestor while it applies (FR-011a). Exactly one
active comparison scan within this tool at a time (FR-010), independent of Count
and Size's own scan. Single-user, no-auth (constitution's deployment model).

**Scale/Scope**: Unbounded in principle, same as Count and Size — either pane
may browse from `/` over a real filesystem with very large directories (FR-001's
inherited pagination) and the recursive comparison has no depth/size cap.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — see
note below._

| Principle                                                                                          | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Simplicity First (YAGNI)                                                                        | PASS   | No new dependency (reuses `better-sqlite3` + Node's built-in `crypto`); no comparison-history feature (spec Assumptions); partial-hash stage reuses SHA-256 on a byte prefix rather than adding a second hash algorithm (research.md Decision 4).                                                                                                                                                                                                                                |
| II. Hexagonal Architecture                                                                         | PASS   | `domain/directory-comparison/` (cascading-comparison decision logic, Merkle directory-checksum derivation) has zero `fs`/SQL/Next.js imports; `application/directory-comparison/` defines `ChecksumPort` + `ComparisonRepositoryPort` and orchestrates use cases against them plus the shared `application/scanning/` ports; `infrastructure/directory-comparison/` holds the only `fs`, `crypto`, `better-sqlite3`, and Route Handler code for this feature. `app/` stays thin. |
| III. SOLID                                                                                         | PASS   | `ChecksumPort` is a new, single-purpose port (content hashing) kept separate from the shared `FileSystemPort` (listing) — interface segregation; Count and Size's adapter is never asked to implement a method it doesn't need. `ComparisonRepositoryPort` is scoped to this feature's own schema, substitutable independently of Count and Size's `ScanRepositoryPort`.                                                                                                         |
| IV. No Automated Tests                                                                             | PASS   | No test files/tasks planned; `quickstart.md` carries manual verification.                                                                                                                                                                                                                                                                                                                                                                                                        |
| V. Safe-by-Default Destructive Operations                                                          | N/A    | Read-only tool — never deletes/moves/overwrites/merges files (spec Assumptions).                                                                                                                                                                                                                                                                                                                                                                                                 |
| VI. Conventional Commits                                                                           | PASS   | Enforced at commit time; no plan-level impact.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Tech constraints (Next.js/React/TS strict, shadcn/ui+Tailwind, pnpm, English, single-user/no-auth) | PASS   | No new UI framework; no new runtime dependency at all; no auth added.                                                                                                                                                                                                                                                                                                                                                                                                            |

No violations. Complexity Tracking table is omitted (nothing to justify).

**Post-Phase-1 re-check**: Confirmed — `data-model.md`'s two persisted entities
plus read-time comparison derivation, and the two new ports in `contracts/`,
introduce no dependency or deviation beyond what's listed above. Reusing the
shared `infrastructure/scanning/filesystem-adapter.ts` (relocated from
`infrastructure/count-and-size/` in this pass, research.md Decision 6) is a
small tidy-up, not a new port or new behavior.

## Project Structure

### Documentation (this feature)

```text
specs/003-checksum-registry/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── checksum-port-contract.md
│   ├── comparison-repository-port-contract.md
│   └── directory-comparison-api-contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
domain/
├── directory-comparison/
│   ├── directory-comparison-node.ts   # DirectoryComparisonNode (extends scanning's ScanNodeStatus) + optional checksum
│   ├── file-checksum-entry.ts         # FileChecksumEntry type (path, size, mtime, partial/full checksum — both nullable)
│   ├── entry-comparison-result.ts     # EntryComparisonResult type (the 6 FR-007 statuses) + pairing-by-name logic
│   ├── checksum-cascade.ts            # Pure: given two sides' known size/partial/full values, decide the next
│   │                                   # cascade step or a final verdict (Matching/Differs) — no I/O (research.md Decision 3)
│   └── derive-directory-checksum.ts   # Pure: (sorted matching children [{name,type,checksum}]) -> Merkle checksum,
│                                       # only called once every child pair is confirmed Matching (research.md Decision 3)
└── scanning/                          # (existing, unchanged) shared tree-walk primitives

application/
├── directory-comparison/
│   ├── checksum-port.ts               # ChecksumPort interface (partial/full content hashing)
│   ├── comparison-repository-port.ts  # ComparisonRepositoryPort interface
│   ├── list-directory.ts              # Use case: paginated listing for one pane (no comparison data)
│   ├── get-comparison-view.ts         # Use case: EntryComparisonResult list for (leftPath, rightPath) — read-only,
│   │                                   # reflects whatever Pass 1/2 have persisted so far (live during Scanning)
│   ├── start-comparison.ts            # Use case: Pass 1 (enqueue both roots on the shared ScanEngine),
│   │                                   # then chains into Pass 2 once Pass 1 settles; mode: 'incremental' | 'full'
│   ├── stop-comparison.ts             # Use case: stop whichever pass is active
│   ├── list-entries.ts                # Pass 1's per-node step: traverseDirectory (shared) + persist direct
│   │                                   # files' size/mtime + subdirectory rows — no hashing (research.md Decision 3)
│   └── compare-subtree.ts             # Pass 2: bottom-up (deepest first) cascading comparison over the two
│                                       # already-listed subtrees; calls ChecksumPort only as the cascade requires
└── scanning/                          # (existing, unchanged) FileSystemPort, ScanSchedulerPort, traverseDirectory

infrastructure/
├── directory-comparison/
│   ├── checksum-adapter.ts            # Implements ChecksumPort (fs.createReadStream + crypto, streamed)
│   ├── sqlite-client.ts               # Opens data/directory-comparison.sqlite, creates schema
│   ├── comparison-repository-adapter.ts # Implements ComparisonRepositoryPort (better-sqlite3)
│   ├── structural-scan-worker.ts      # Singleton: instantiates the shared ScanEngine (Pass 1) with this
│   │                                   # feature's adapters and list-entries.ts as its per-node step
│   ├── comparison-pass-worker.ts      # Singleton: lightweight bottom-up worker for Pass 2 (own cancelable
│   │                                   # single-active-run loop, chained after Pass 1 by start-comparison.ts)
│   ├── panes-storage.ts               # localStorage read/write for left/right paths + Move sync setting
│   └── ui/
│       ├── directory-comparison-explorer.tsx # Owns leftPath/rightPath/moveSync client state; wires the two panes
│       ├── comparison-pane.tsx        # One side's listing + pagination + onNavigate (mirrors directory-browser.tsx,
│       │                               # shows EntryComparisonResult status dot instead of count/size)
│       ├── comparison-status-panel.tsx # Compare/Force-full-re-compare/Stop buttons + overall state
│       ├── comparison-status-colors.ts # Not compared/Matching/Differs/Only-on-this-side/Scanning/Error -> color
│       └── components/                # Additional shadcn/ui primitives if needed
├── scanning/
│   ├── scan-engine.ts                 # (existing, unchanged)
│   └── filesystem-adapter.ts          # Relocated from infrastructure/count-and-size/ (research.md Decision 6) —
│                                       # implements FileSystemPort via fs/promises; now shared by both tools
└── count-and-size/                    # (existing) filesystem-adapter.ts removed from here, re-imports the
                                        # relocated infrastructure/scanning/filesystem-adapter.ts instead

app/
├── directory-comparison/
│   └── page.tsx                       # Fixed route — thin, renders DirectoryComparisonExplorer
└── api/
    └── directory-comparison/
        ├── list/route.ts
        ├── status/route.ts
        ├── compare/route.ts
        └── stop/route.ts

domain/navigation/menu-entry.ts        # (existing, edited) + { key: 'directory-comparison', label: 'Compare Directories', route: '/directory-comparison' }

data/                                  # (existing, gitignored) — also holds directory-comparison.sqlite
```

**Structure Decision**: Single project, same pattern as Count and Size — a new
`directory-comparison` slice following the exact
`domain/application/infrastructure` layering, its own SQLite database, and its
own `app/api/` routes. The one cross-cutting change is relocating
`filesystem-adapter.ts` from `infrastructure/count-and-size/` into the
already-shared `infrastructure/scanning/` (it was 100% generic already — this
closes a gap left by the prior scan-engine extraction, research.md Decision 6)
so both tools use the same `FileSystemPort` implementation instead of
duplicating ~20 lines of `fs.readdir`/`stat` logic.

## Complexity Tracking

_No violations — table intentionally omitted._
