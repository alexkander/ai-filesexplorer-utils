# Quickstart: Directory Comparison Tool

Manual end-to-end verification (Constitution Principle IV — no automated tests).
Run after implementation, on branch `003-checksum-registry`.

## Prerequisites

- `pnpm install` has been run (no new dependency for this feature —
  `better-sqlite3` is already present from Count and Size).
- A scratch fixture tree under `/tmp` with:
  - Two subdirectories that are exact copies of each other (same names, same
    file content).
  - A same-named pair of files with the same size but different content.
  - A file that exists on only one side.
  - A file/subdirectory made unreadable (`chmod 000`) on one side.
  - At least one large file (tens of MB) with **no** same-size counterpart
    anywhere in the fixture, to sanity-check the cascade never reads it.
- If a dev server for this repo may already be running, start any additional
  verification server with `DIRECTORY_COMPARISON_DB_PATH` (and
  `COUNT_AND_SIZE_DB_PATH`, if also touching that tool) set to scratch paths
  instead of the defaults — same reasoning as Count and Size's quickstart, to
  avoid two sessions clobbering the same SQLite file.

## 1. Local dev (`pnpm dev`)

1. `pnpm dev`, open <http://localhost:3000>. Click "Compare Directories" in the
   sidebar (new entry alongside "Home" and "Count and Size").
2. **Independent browsing** (FR-001, Story 1): both panes load showing `/`.
   Navigate each pane into different subdirectories independently — moving one
   pane must not affect the other. Click a file entry in either pane — nothing
   happens.
3. **Move sync on** (FR-002, FR-002a, FR-002b, Story 2): turn Move sync on.
   Navigate the left pane into a subdirectory that also exists (same name) under
   the right pane's current directory — the right pane follows into its own
   same-named child. Navigate into a subdirectory that has **no** same-named
   counterpart on the right — the right pane shows a clear "not found" state,
   and the left pane's navigation still succeeded normally.
4. **Move sync survives a mismatch** (FR-002c): from the "not found" state in
   step 3, manually navigate the right pane somewhere else — Move sync stays on;
   the next navigation on either side still mirrors to the other.
5. **Turning sync on doesn't jump** (FR-002b): with the two panes already
   showing unrelated paths, turn Move sync on — neither pane re-navigates until
   you actually move one of them next.
6. **Compare, matching case** (FR-003, FR-006, FR-007, Story 3): point each pane
   at one of your two identical fixture subdirectories, press "Compare". Every
   entry — files and the directory itself — ends up `Matching` (its own color),
   including nested files several levels deep.
7. **Compare, differing and only-one-side cases** (FR-006, FR-007): point the
   panes at a fixture pair containing the same-size-different-content file and
   the only-on-one-side file. After Compare completes, the same-size file shows
   `Differs`, the lone file shows `Only on this side` on whichever pane has it,
   and unrelated matching files still show `Matching` — confirms per-entry
   granularity, not an all-or-nothing verdict.
8. **Cascade avoids unnecessary full reads** (FR-003, FR-004, SC-004): with the
   large, no-same-size-counterpart file included in one pane's Compare, watch
   the comparison finish in roughly the time it takes to list and size the tree,
   not the time it would take to read that large file's full content (a rough
   proxy — if you have `strace`/`fatrace` handy, confirm no `read()` calls
   against that specific file path during the run).
9. **Unreadable entry → Error, no false verdict** (FR-011, FR-011a): with the
   `chmod 000` fixture entry included, Compare that pair. The unreadable entry
   (and its containing directory, up to the compared root on that side) shows
   `Error` — never a false `Matching` or `Differs`. Restore permissions
   afterward.
10. **Not compared, before any Compare** (FR-007): navigate to a pair that's
    never been compared — every entry shows the `Not compared` color, not
    `Scanning` or blank.
11. **Live Scanning status** (FR-007, FR-012): on a large-enough fixture, watch
    entries move through `Scanning` to a final status without reloading the
    page, and confirm you can navigate elsewhere in the app while it runs.
12. **Stop** (FR-013): start a Compare on a large-enough pair, press Stop
    partway through. Already-resolved entries keep their status; unresolved ones
    stay at whatever they were (`Not compared` or `Scanning`) rather than
    silently finishing.
13. **Only one active comparison in this tool** (FR-010): start a Compare, then
    immediately start a different Compare on an unrelated pair — the second is
    enqueued (its entries stay `Scanning`/`Not compared` until the first
    finishes), never run concurrently. Separately, confirm a Count and Size scan
    can run at the same time without either tool blocking the other (FR-010's
    per-tool scoping).
14. **Incremental Compare is a no-op when unchanged** (FR-008): re-press
    "Compare" on an already-fully-`Matching` pair with nothing changed on disk —
    it finishes immediately, no entries flicker through `Scanning`.
15. **Incremental Compare only redoes what changed** (FR-008): modify one file
    inside an already-compared, previously-`Matching` pair, then press "Compare"
    again. Only that file (and the directory checksums along the path from it up
    to the compared root) move through `Scanning` — unrelated siblings stay
    untouched.
16. **Force full re-compare covers both sides together** (FR-009): press "Force
    full re-compare" on an already-compared pair — every entry on both sides
    moves back through `Scanning`, confirming there's no per-side variant.

## 2. Docker dev (`./scripts/dev.sh`)

1. `./scripts/dev.sh`, open <http://localhost:3000>.
2. Repeat steps 6 and 15 above at minimum. `data/directory-comparison.sqlite`
   should appear on the host filesystem alongside `data/count-and-size.sqlite`.
3. `./scripts/dev-down.sh` when done.

## 3. Docker prod (`./scripts/prod.sh`) — persistence across container recreation

1. `./scripts/prod.sh`, open <http://localhost:3000>.
2. Compare a pair, wait for every entry to resolve, note the results.
3. `./scripts/prod-down.sh`, then `./scripts/prod.sh` again.
4. Reopen the same pair — the same results from step 2 should still be there
   (FR-015), proving the existing named volume (already added for Count and
   Size's database) covers this tool's database too, since both live under the
   same `data/` directory.
5. **Interrupted comparison reconciliation** (FR-014): start a Compare on a
   large-enough pair, `docker compose -f docker-compose.prod.yml kill` mid-run,
   bring it back up. The pair should show whichever entries didn't finish as
   reflecting a Stopped state (not stuck `Scanning` forever), and a subsequent
   "Compare" only redoes what's outstanding.
6. `./scripts/prod-down.sh` when done.

## Done when

- All checks in all three environments pass as described.
- No console errors in the browser devtools during browsing, syncing, comparing,
  stopping, or polling.
- Step 8's cascade check and step 9's error-propagation check both hold — these
  are the two riskiest, most feature-specific behaviors (research.md Decision 3,
  FR-011a).
