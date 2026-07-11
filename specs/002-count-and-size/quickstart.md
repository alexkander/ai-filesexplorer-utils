# Quickstart: Count and Size Tool

Manual end-to-end verification (Constitution Principle IV — no automated tests).
Run after implementation, on branch `002-count-and-size`.

## Prerequisites

- `pnpm install` has been run (pulls in `better-sqlite3` once added via
  `pnpm add`, per `research.md` Decision 8).
- A local directory tree you don't mind scanning repeatedly and that contains at
  least: a subdirectory with a permission-denied file or folder inside it (e.g.
  `chmod 000` a test file), and a symlink (`ln -s`) pointing at something else.
  A scratch fixture under `/tmp` works well so you don't need to touch real
  system directories for every check.
- If a dev server for this repo may already be running (e.g. the project owner's
  own session), start any additional verification server with
  `COUNT_AND_SIZE_DB_PATH` set to a scratch path (e.g.
  `COUNT_AND_SIZE_DB_PATH=/tmp/scratch.sqlite pnpm dev -p 3001`) instead of the
  default `data/count-and-size.sqlite` — both point at the same file by default
  (same `process.cwd()`), and a second server's checks (or a
  `rm -f data/count-and-size.sqlite*` cleanup step) would otherwise destroy real
  scanned data out from under the other session.

## 1. Local dev (`pnpm dev`)

1. `pnpm dev`, open <http://localhost:3000>. Click "Count and Size" in the
   sidebar (new entry alongside "Home" — confirms it plugs into the existing
   navigation extension point from 001-dashboard-shell).
2. **Root browsing** (FR-001, FR-002a, FR-005a, User Story 1): the view loads
   showing `/`'s contents. Every entry shows "not scanned yet" the first time
   (no prior runs). Click into a couple of nested directories, then use the
   in-app "Up" button — the browser's own URL bar stays at `/count-and-size`
   throughout (never shows the directory path); reloading the page returns you
   to the same directory you were last on.
3. **Files are inert** (FR-003): click a file entry — nothing happens.
4. **Availability indicator** (FR-004): in any listing, subdirectories with no
   scan data show no indicator at all; none should be blank-but-present (e.g. an
   empty badge) — literally nothing rendered.
5. **Start a scan** (FR-006, FR-007, User Story 2): navigate to your scratch
   fixture directory, press "Scan". Status moves to Scanning immediately
   (including for the fixture's own subdirectories — check by navigating into
   one right away: it should already show Scanning, not "not scanned yet", per
   the queued-procedures-show-as-Scanning clarification).
6. **Live progress** (FR-017a): stay on the directory being scanned without
   touching anything — within a couple of seconds the view should auto-refresh
   once the scan reaches Completed, with no manual reload.
7. **Aggregation correctness** (FR-008, SC-003): once Completed, compare the
   shown count/size against `find <fixture> -type f | wc -l` and
   `du -sb <fixture>` run in a terminal — they should match (the symlink and the
   permission-denied file are excluded from both the tool's totals and, for a
   fair comparison, from your manual `find`/`du` check too).
8. **Unreadable entries flagged** (FR-016, User Story 3): the subdirectory
   containing the `chmod 000` file shows an "unreadable entries" indicator once
   its own scan step completes.
9. **Incomplete flag** (FR-011, User Story 3): temporarily make a subdirectory
   itself unreadable (`chmod 000` the directory, not just a file inside it)
   before scanning its parent. After the scan reaches Completed, the parent
   should show Completed _and_ flagged incomplete (not silently just
   "Completed"). Restore permissions afterward.
10. **Large listing stays responsive** (FR-001a, SC-007): browse into a
    directory with a very large number of entries (e.g. a populated
    `node_modules`, or `/usr/lib`). The page should not freeze; scrolling loads
    more entries rather than rendering all at once.
11. **Stop** (FR-018): start a scan on a large-enough tree that it's still
    running a few seconds later, press "Stop". The active procedure and its
    already-spawned descendants move to Stopped; the aggregated totals shown
    still reflect whatever was completed before stopping (not zero).
12. **Only one active scan** (FR-012, FR-013): start a scan on one directory,
    then immediately start a scan on an unrelated directory. The second one
    shows Scanning (queued) but its actual file counts stay at 0 until the first
    scan (and this one, once its turn comes) finishes — confirms scans are
    serialized, not concurrent.
13. **Rescanning overwrites** (FR-021): once a directory is Completed, press
    "Scan" on it again. It goes back through Scanning to Completed; previous
    numbers aren't just kept as-is (create/delete a file in the fixture between
    runs to see the count actually change).

## 2. Docker dev (`./scripts/dev.sh`)

1. `./scripts/dev.sh`, open <http://localhost:3000>.
2. Repeat steps 5, 7 above at minimum. `data/count-and-size.sqlite` should
   appear on the host filesystem (bind-mounted, same as the rest of the repo) —
   confirms persistence works without any container-specific setup in dev.
3. `./scripts/dev-down.sh` when done.

## 3. Docker prod (`./scripts/prod.sh`) — persistence across container recreation

This environment is the one `research.md` Decision 7 specifically targets:
`docker-compose.prod.yml` previously had no volumes at all.

1. `./scripts/prod.sh`, open <http://localhost:3000>.
2. Scan a directory, wait for Completed, note the aggregated count/size and the
   last-scanned timestamp.
3. `./scripts/prod-down.sh`, then `./scripts/prod.sh` again (recreates the
   container, not just a process restart inside it).
4. Reopen the same directory — the same count/size/timestamp from step 2 should
   still be there (SC-006), proving the named volume actually persists
   `/app/data` across container recreation, not just process restarts.
5. **Interrupted-scan reconciliation** (FR-019): start a scan on a large tree,
   then `docker compose -f docker-compose.prod.yml kill` mid-scan (a hard kill,
   not a graceful stop) to simulate a crash. Bring it back up with
   `./scripts/prod.sh`. The directory that was scanning should now show Stopped,
   not stuck showing Scanning forever and not silently resumed.
6. `./scripts/prod-down.sh` when done.

## Done when

- All checks in all three environments pass as described.
- No console errors in the browser devtools during browsing, scanning, stopping,
  or polling.
- The persistence check in section 3 specifically confirms data survives a full
  container recreation, not only a page reload.
