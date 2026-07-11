# Quickstart: Dashboard Main View (Header, Sidebar & Home)

Manual end-to-end verification (Constitution Principle IV — no automated tests).
Run this after implementation, on branch `001-dashboard-shell`. It's split by
environment because commit-hash resolution differs across them (see
[research.md](./research.md), Decision 4) — all three are worth checking at
least once.

## Note on SC-005

SC-005 ("a new tool can be introduced to the sidebar without requiring changes
to the header or existing entries") isn't checked in the steps below — this
feature ships with a single sidebar entry ("Home"), so there's no second tool
yet to prove the claim with. It's backed by design
(`contracts/menu-entry-contract.md`), not by an executed check here; it will be
exercised for real the first time a future feature adds a second `MenuEntry`.

## Prerequisites

- `pnpm install` has been run.
- You're on the `001-dashboard-shell` branch, at a commit whose short hash you
  know (`git rev-parse --short HEAD`) so you can compare it against what the UI
  shows.

## 1. Local dev (`pnpm dev`)

1. `pnpm dev`, open <http://localhost:3000>.
2. **Shell layout**: a full-width header (~96px tall, check via devtools) is
   visible at the top; a left sidebar is visible below it. No horizontal
   scrollbar at a browser width of 1280px or more (SC-004).
3. **Header title**: reads `ai-filesexplorer-utils — Home` (FR-004).
4. **Sidebar**: shows exactly one entry, "Home", visually marked as active
   (FR-010, FR-011).
5. **Home content**: the main content area shows "Hello World" (FR-013) and
   stretches edge-to-edge with no centered gutters, even at very wide window
   sizes (FR-015).
6. **Help popover**: click the help icon on the header's right side. A popover
   opens showing:
   - App name: `ai-filesexplorer-utils`
   - Version: matches the `"version"` field in `package.json`
   - Commit hash: matches `git rev-parse --short HEAD` run in your terminal
     Click outside the popover, or press Escape — it closes (FR-007).
7. **Unmatched route fallback**: navigate to a path with no matching tool, e.g.
   <http://localhost:3000/does-not-exist>. The header falls back to showing just
   `ai-filesexplorer-utils` (no section name), and no sidebar entry is marked
   active (Edge Cases).

## 2. Docker dev (`./scripts/dev.sh`)

1. `./scripts/dev.sh`, open <http://localhost:3000>.
2. Repeat step 6 above (help popover). This validates that the commit hash
   resolves correctly when `.git` is available only via the bind-mounted volume,
   not a `COPY`.
3. `./scripts/dev-down.sh` when done.

## 3. Docker prod (`./scripts/prod.sh`)

1. `./scripts/prod.sh` (this runs
   `docker compose -f docker-compose.prod.yml up --build -d`, rebuilding the
   `builder`/`runner` stages).
2. Open <http://localhost:3000>.
3. Repeat step 6 above (help popover). This validates that the commit hash
   resolves correctly from the `builder` stage's build-time `git rev-parse` (per
   the `.dockerignore` adjustment in research.md Decision 4), even though the
   final `runner` image ships no `.git` or source.
4. Confirm the app still looks and behaves identically to the dev checks above
   (shell layout, sidebar, unmatched-route fallback).
5. `./scripts/prod-down.sh` when done.

## Done when

- All checks in all three environments pass as described.
- No console errors in the browser devtools on initial load, popover open/close,
  or navigating to an unmatched route.
