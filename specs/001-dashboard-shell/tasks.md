---
description: 'Task list for Dashboard Main View (Header, Sidebar & Home)'
---

# Tasks: Dashboard Main View (Header, Sidebar & Home)

**Input**: Design documents from `/specs/001-dashboard-shell/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: This project's constitution (Principle IV) prohibits automated tests.
No test tasks are included below — verification is manual, via `quickstart.md`
(Polish phase, T025).

**Organization**: Tasks are grouped by user story (from spec.md) to enable
independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete
  task)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are relative to the repository root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bring Tailwind CSS + shadcn/ui into the project — required by the
constitution's Technology & Language Constraints and not yet present
(research.md Decision 1).

- [ ] T001 Add `tailwindcss` and `@tailwindcss/postcss` to `package.json`
      devDependencies and create `postcss.config.mjs` at the repo root wiring
      the Tailwind PostCSS plugin.
- [ ] T002 Create `app/globals.css` with the Tailwind CSS import, and import it
      from `app/layout.tsx`. (Depends on T001.)
- [ ] T003 Initialize shadcn/ui: run its CLI to create `components.json` and
      `lib/utils.ts` (the `cn()` class-merging helper), pointed at
      `app/globals.css`. (Depends on T001, T002.)

**Checkpoint**: `pnpm dev` still renders the existing `app/page.tsx` without
errors, now with Tailwind's base styles loaded and the shadcn/ui toolchain ready
to add components.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Domain-level building blocks shared by User Story 1 and User
Story 2.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T004 Create the `domain/`, `application/`, and `infrastructure/` directory
      scaffolding at the repo root, per `plan.md`'s Project Structure.
- [ ] T005 [P] Create `domain/navigation/menu-entry.ts`: the `MenuEntry` type
      (`key`, `label`, `route`) and the static `menuEntries` array, containing
      exactly one entry — `{ key: "home", label: "Home", route: "/" }`
      (contracts/menu-entry-contract.md; spec FR-009, FR-010). (Depends on
      T004.)
- [ ] T006 [P] Create `domain/navigation/find-active-entry.ts`: a pure
      `findActiveEntry(pathname, entries)` function returning the entry whose
      `route` exactly matches `pathname`, or `undefined` if none matches
      (contracts/menu-entry-contract.md; spec FR-011, Edge Cases). (Depends on
      T004.)

**Checkpoint**: Domain layer compiles with no framework imports; ready for the
UI layer to consume.

---

## Phase 3: User Story 1 - Land on the dashboard shell with the Home view (Priority: P1) 🎯 MVP

**Goal**: A full-width, ~96px header and a fixed left sidebar wrap the Home
view, which shows placeholder "Hello World" content.

**Independent Test**: `pnpm dev`, open the app root URL — the header, sidebar
(showing "Home"), and Home placeholder content all render together, full width,
no other tool implemented yet.

### Implementation for User Story 1

- [ ] T007 [P] [US1] Create `infrastructure/ui/header.tsx`: a full-width header,
      ~96px tall (Tailwind classes), with a left-aligned title area (for now:
      just the app name, "ai-filesexplorer-utils") and an empty right-side
      actions container reserved for future icons (spec FR-002, FR-003, FR-005).
- [ ] T008 [P] [US1] Create `infrastructure/ui/sidebar.tsx`: a fixed-width,
      always-visible left sidebar rendering `domain/navigation/menu-entry.ts`'s
      `menuEntries` as a list of nav links, in an independently scrollable
      container (spec FR-008, FR-009, FR-010, Edge Cases — sidebar overflow). No
      active-state styling yet (that's User Story 2).
- [ ] T009 [US1] Create `infrastructure/ui/dashboard-shell.tsx` composing
      `Header` + `Sidebar` + a `children` content slot, laid out to fill the
      full viewport width and height with no centered max-width anywhere (spec
      FR-001, FR-014, FR-015). (Depends on T007, T008.)
- [ ] T010 [US1] Update `app/layout.tsx` to render
      `<DashboardShell>{children}</DashboardShell>`, keeping the file thin per
      Constitution Principle II. (Depends on T009.)
- [ ] T011 [P] [US1] Update `app/page.tsx` to render the Home view's placeholder
      content, "Hello World" (spec FR-012, FR-013).

**Checkpoint**: User Story 1 is fully functional and independently testable —
shell renders, full width, Home placeholder visible, sidebar shows the single
"Home" entry.

---

## Phase 4: User Story 2 - See current location reflected in header and sidebar (Priority: P2)

**Goal**: The sidebar highlights the tool the user is currently on, and the
header title reads "AppName — Section".

**Independent Test**: With only the Home route available, load the app and
confirm the "Home" sidebar entry is marked active and the header title reads
"ai-filesexplorer-utils — Home".

### Implementation for User Story 2

- [ ] T012 [US2] Update `infrastructure/ui/dashboard-shell.tsx` to compute the
      active `MenuEntry` from the current pathname (Next.js `usePathname()` +
      `domain/navigation/find-active-entry.ts`) and pass it down to `Header` and
      `Sidebar` as a prop (spec FR-011). This makes `DashboardShell` a client
      boundary (`'use client'`). (Depends on T009, T006.)
- [ ] T013 [P] [US2] Update `infrastructure/ui/sidebar.tsx` to accept the
      active-entry prop and visually mark that entry as selected; mark none when
      it's `undefined` (spec FR-011, Edge Cases — unmatched route). (Depends on
      T012.)
- [ ] T014 [P] [US2] Update `infrastructure/ui/header.tsx` to accept the
      active-entry prop and render the title as
      `"ai-filesexplorer-utils — {Section}"` (em-dash separated) when an entry
      is active, or just `"ai-filesexplorer-utils"` when it's `undefined` (spec
      FR-004, Edge Cases — unmatched route). (Depends on T012.)

**Checkpoint**: User Stories 1 AND 2 both work independently — navigating to the
(only) "Home" route shows it highlighted in the sidebar and reflected in the
header title.

---

## Phase 5: User Story 3 - Inspect app info via the help icon (Priority: P3)

**Goal**: A help icon in the header's right side opens a dismissible popover
showing the app name, version, and current commit hash.

**Independent Test**: With the shell loaded, click the help icon — the popover
shows the correct app name, version (matching `package.json`), and 7-character
commit hash (matching `git rev-parse --short HEAD`), and closes on outside click
or Escape.

### Implementation for User Story 3

- [ ] T015 [US3] Update `package.json`: add `"version": "0.1.0"` and add
      `lucide-react` to dependencies (spec Clarifications — version source;
      research.md Decision 3).
- [ ] T016 [US3] Add shadcn/ui's `Popover` and `Button` components via its CLI
      into `infrastructure/ui/components/` (research.md Decision 2). (Depends on
      T003.)
- [ ] T017 [P] [US3] Create `application/build-info/build-info-port.ts`: the
      `BuildInfo` type (`appName`, `version`, `commitHash`) and the
      `BuildInfoPort` interface (contracts/build-info-port-contract.md).
      (Depends on T004.)
- [ ] T018 [US3] Create `application/build-info/get-build-info.ts`: a one-line
      `getBuildInfo(port: BuildInfoPort)` use case that calls
      `port.getBuildInfo()` (contracts/build-info-port-contract.md). (Depends on
      T017.)
- [ ] T019 [P] [US3] Update `next.config.ts` to compute the short commit hash
      (`git rev-parse --short HEAD`, wrapped in try/catch falling back to
      `"unknown"`) and expose it via the `env` config key as
      `NEXT_PUBLIC_COMMIT_HASH` (research.md Decision 4).
- [ ] T020 [P] [US3] Adjust `.dockerignore` so the Docker `builder` stage's
      build context includes `.git` (needed for T019's `git rev-parse` to
      succeed there), while the `runner` stage still never copies `.git` into
      the shipped image (research.md Decision 4).
- [ ] T021 [US3] Create `infrastructure/build-info/build-info-adapter.ts`
      implementing `BuildInfoPort`: `appName` is the literal constant
      `"ai-filesexplorer-utils"`, `version` comes from a static import of
      `package.json`'s `version` field, `commitHash` comes from
      `process.env.NEXT_PUBLIC_COMMIT_HASH` (falling back to `"unknown"` if
      unset or empty) (spec FR-007; data-model.md BuildInfo). (Depends on T015,
      T017, T019.)
- [ ] T022 [US3] Create `infrastructure/ui/help-popover.tsx` (`'use client'`): a
      help-icon button (`lucide-react`'s help icon) that opens a shadcn/ui
      `Popover` showing `getBuildInfo(buildInfoAdapter)`'s `appName`, `version`,
      and `commitHash`, dismissible by outside click or Escape (spec FR-006,
      FR-007). (Depends on T016, T018, T021.)
- [ ] T023 [US3] Wire `infrastructure/ui/header.tsx`'s right-side actions
      container to render `<HelpPopover />` as its first (and currently only)
      action (spec FR-005, FR-006). (Depends on T014, T022.)

**Checkpoint**: All three user stories are independently functional — the help
popover shows correct info without affecting the shell or navigation behavior
from User Stories 1–2.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Repo-wide conventions and final validation.

- [ ] T024 [P] Run `pnpm lint:fix` and `pnpm format` across all new/changed
      files (repo's Husky/lint-staged conventions).
- [ ] T025 Run the full `quickstart.md` validation: local `pnpm dev`, Docker dev
      (`./scripts/dev.sh`), and Docker prod (`./scripts/prod.sh`) — the three
      environments differ in `.git` availability, so the help popover's commit
      hash must be checked in all three (research.md Decision 4).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user
  stories.
- **User Story 1 (Phase 3)**: Depends on Foundational completion. No dependency
  on US2/US3.
- **User Story 2 (Phase 4)**: Depends on Foundational completion, and modifies
  files US1 created (`dashboard-shell.tsx`, `sidebar.tsx`, `header.tsx`) —
  implement after US1.
- **User Story 3 (Phase 5)**: Depends on Foundational and Setup (shadcn CLI).
  Only its final task (T023) touches a US1/US2 file (`header.tsx`'s actions
  slot) — everything else in US3 is new files, so it could start in parallel
  with US2 if staffed, merging at T023.
- **Polish (Phase 6)**: Depends on all three user stories being complete.

### Within Each User Story

- Foundational domain files before UI components that consume them.
- Presentational components (`header.tsx`, `sidebar.tsx`) before the composition
  (`dashboard-shell.tsx`) that wires them together.
- `dashboard-shell.tsx`/`layout.tsx` wiring before the story is
  checkpoint-testable.

### Parallel Opportunities

- T005 and T006 (Foundational) — different files, both depend only on T004.
- T007, T008, and T011 (US1) — different files, no cross-dependency.
- T013 and T014 (US2) — different files, both depend only on T012.
- T017, T019, and T020 (US3) — different files, independent of each other.

---

## Parallel Example: User Story 1

```bash
# After Phase 2 (Foundational) is complete, launch these together:
Task: "Create infrastructure/ui/header.tsx per T007"
Task: "Create infrastructure/ui/sidebar.tsx per T008"
Task: "Update app/page.tsx per T011"
# Then, once T007+T008 finish:
Task: "Create infrastructure/ui/dashboard-shell.tsx per T009"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (Tailwind + shadcn/ui toolchain).
2. Complete Phase 2: Foundational (domain/navigation).
3. Complete Phase 3: User Story 1.
4. **STOP and VALIDATE**: run `quickstart.md`'s local-dev steps 1–2, 5 (shell
   layout, Home content) manually.
5. Demo if ready — this is a visible, self-contained shell + Home placeholder.

### Incremental Delivery

1. Setup + Foundational → toolchain and domain layer ready.
2. Add User Story 1 → validate independently → demo (MVP).
3. Add User Story 2 → validate independently → demo (navigation feedback works).
4. Add User Story 3 → validate independently across all three run environments →
   demo (help popover works everywhere, including the Docker prod commit-hash
   path).
5. Phase 6 Polish → full `quickstart.md` run, lint/format pass.

---

## Notes

- [P] tasks touch different files with no unmet dependency.
- [Story] label maps each task to its user story for traceability.
- No automated tests exist or are planned (Constitution Principle IV) —
  `quickstart.md` (T025) is the verification step.
- Commit after each task or logical group, using Conventional Commits
  (Constitution Principle VI).
- Stop at any checkpoint to validate a story independently before moving on.
