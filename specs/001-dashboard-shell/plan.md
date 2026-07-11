# Implementation Plan: Dashboard Main View (Header, Sidebar & Home)

**Branch**: `001-dashboard-shell` | **Date**: 2026-07-11 | **Spec**:
[spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-dashboard-shell/spec.md`

## Summary

Build the persistent application shell — a full-width, ~96px header and a fixed
left sidebar — that wraps every route, plus the initial Home placeholder view.
The header title shows "AppName — Section"; the sidebar starts with a single
"Home" entry that highlights itself when its route is active; a help icon on the
header's right side opens a dismissible popover with the app name, version, and
short commit hash. This is also the first feature to introduce Tailwind CSS and
shadcn/ui to the project (mandated by the constitution's Technology & Language
Constraints, not yet set up), and the first to apply the constitution's
hexagonal architecture (`domain/` / `application/` / `infrastructure/`) to
`app/`. Both the sidebar's menu list and the header's right-side actions area
are built as open extension points: this feature ships each with the minimum
content needed to be useful (one entry, one action), and expects their contents
to keep changing across future specs as new tools and header actions are added.

## Technical Context

**Language/Version**: TypeScript (`strict: true`) on Node.js 22, matching the
existing `tsconfig.json` and Dockerfile base images.

**Primary Dependencies**: Next.js 16.2.10 (App Router) + React 19.2.7 (already
in place). New for this feature: Tailwind CSS and shadcn/ui (Radix-based
`Popover`/`Button` primitives) plus its companion icon set `lucide-react` —
required by the constitution's Technology & Language Constraints and not yet
present in `package.json`.

**Storage**: N/A — no persistence. Build info (version, commit hash) is resolved
at build/dev-server-start time from `package.json` and git metadata; the menu
list is a static in-code list.

**Testing**: N/A — this project does not use automated tests (Constitution
Principle IV). Manual end-to-end verification steps are in
[quickstart.md](./quickstart.md), covering local `pnpm dev`, Docker dev
(`./scripts/dev.sh`), and Docker prod (`./scripts/prod.sh`), since the three
environments differ in whether `.git` is available (see research.md, Decision
4).

**Target Platform**: Web browser, served by the existing Next.js server
(Node 22) via the `dev` and `runner` Docker stages already defined in the
Dockerfile. Desktop viewports are the primary target (spec Assumptions); no
dedicated mobile layout is in scope.

**Project Type**: Single Next.js web application (no separate frontend/backend
split), restructured to introduce `domain/`, `application/`, and
`infrastructure/` alongside the existing `app/`, per Constitution Principle II.

**Performance Goals**: None beyond standard SSR/CSR page-load expectations; the
spec sets no explicit latency target (SC-001 only requires the shell to render
with no extra user action).

**Constraints**: Header ~96px tall, full viewport width, no centered max-width
anywhere in the shell (FR-002, FR-014, FR-015); commit-hash resolution must work
identically across local dev, Docker dev, and Docker prod despite `.git` not
being present in the Docker build context by default (see research.md, Decision
4); single-user/no-auth per the constitution's deployment model.

**Scale/Scope**: Single user, one sidebar entry ("Home") and one header action
(help icon) today. Both lists are designed to grow across future specs — new
tools by appending to the sidebar's static list (SC-005), new header actions by
adding to the header's right-side container — without touching the header
layout, sidebar layout, or existing entries/actions either way.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — see
note below._

| Principle                                                                                          | Status | Notes                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I. Simplicity First (YAGNI)                                                                        | PASS   | No collapsible sidebar, no speculative multi-level menu support, no config system beyond a static list — matches the spec's clarified scope.                                                                                                                 |
| II. Hexagonal Architecture                                                                         | PASS   | `domain/navigation` (pure route-matching + `MenuEntry` data), `application/build-info` (port + use case), `infrastructure/build-info` + `infrastructure/ui` (adapters, Next.js/React components). `app/` stays thin (layout composition + route pages only). |
| III. SOLID                                                                                         | PASS   | `BuildInfoPort` is a single-purpose interface (dependency inversion); the route-matching function has one responsibility and is open to new `MenuEntry` values without modification.                                                                         |
| IV. No Automated Tests                                                                             | PASS   | No test files/tasks planned; `quickstart.md` carries manual verification instead.                                                                                                                                                                            |
| V. Safe-by-Default Destructive Operations                                                          | N/A    | This feature performs no file deletion/move/merge.                                                                                                                                                                                                           |
| VI. Conventional Commits                                                                           | PASS   | Enforced at commit time as with prior work; no plan-level impact.                                                                                                                                                                                            |
| Tech constraints (Next.js/React/TS strict, shadcn/ui+Tailwind, pnpm, English, single-user/no-auth) | PASS   | shadcn/ui + Tailwind are introduced (first use in the repo) exactly as the constitution requires, not as an extra framework; no auth added.                                                                                                                  |

No violations. Complexity Tracking table is omitted (nothing to justify).

**Post-Phase-1 re-check**: Confirmed — the `domain/application/infrastructure`
split and port design in `data-model.md`/`contracts/` introduce no new
dependencies or deviations beyond what's listed above.

## Project Structure

### Documentation (this feature)

```text
specs/001-dashboard-shell/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   ├── menu-entry-contract.md
│   └── build-info-port-contract.md
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
domain/
└── navigation/
    ├── menu-entry.ts          # MenuEntry type + the static entry list (currently just Home)
    └── find-active-entry.ts   # Pure function: pathname + entries -> active MenuEntry | undefined

application/
└── build-info/
    ├── build-info-port.ts     # BuildInfo type + BuildInfoPort interface
    └── get-build-info.ts      # Thin use case: calls the injected BuildInfoPort

infrastructure/
├── build-info/
│   └── build-info-adapter.ts  # Implements BuildInfoPort: package.json version + git commit hash
└── ui/
    ├── dashboard-shell.tsx    # Composes Header + Sidebar + content slot
    ├── header.tsx             # Title (app name + section) + right-side actions area
    ├── sidebar.tsx            # Renders MenuEntry list, highlights the active one
    ├── help-popover.tsx       # Help icon + shadcn/ui Popover showing BuildInfo
    └── components/            # shadcn/ui primitives (button.tsx, popover.tsx, ...)

app/
├── layout.tsx                 # Thin: renders <DashboardShell>{children}</DashboardShell>
├── page.tsx                   # Home route: "Hello World" placeholder
└── globals.css                # Tailwind entry point (new)

lib/
└── utils.ts                   # shadcn's `cn()` class-merging helper (new)

components.json                 # shadcn/ui CLI config (new)
postcss.config.mjs              # Tailwind v4 PostCSS plugin config (new)
```

**Structure Decision**: Single project — this is a self-hosted single-app tool,
so there is no frontend/backend split (Option 2/3 from the template are unused).
The existing flat `app/` directory is joined by `domain/`, `application/`, and
`infrastructure/` at the repository root, matching Constitution Principle II's
required dependency direction (`infrastructure → application → domain`, `app/`
depends on `application/`+`infrastructure/ui` only). This is the first feature
in the repo to populate these three directories.

## Complexity Tracking

_No violations — table intentionally omitted._
