# Phase 0 Research: Count and Size Tool

All Technical Context items are resolved below; no `NEEDS CLARIFICATION` markers
remain.

## Decision 0: Spec correction — "incomplete" is a flag, not a 6th state

**Decision**: FR-009's five states (Not scanned / Scanning / Completed / Error /
Stopped) are exhaustive. "Incomplete" (FR-011) is a separate boolean qualifier
shown alongside the Completed state, not an additional state value. A
directory's `state` reaches Completed once its own direct files finish being
computed and every descendant procedure has reached _some_ terminal state
(Completed, Error, or Stopped) — regardless of whether every descendant
individually succeeded. Whether to also show the "incomplete" flag is a
separate, independently-computed fact.

**Rationale**: The spec as originally written (`spec.md` Acceptance Scenario
US3-AC3) said an incomplete directory is "marked incomplete (not Completed)",
which is unsatisfiable with only 5 states — none of the other 4 states correctly
describes "this node's own work is done and every descendant reached a terminal
outcome, but not all of them succeeded." The original Spanish feature
description supports this reading too: it introduces the 5 "estados" (states) as
one concept, then separately says a procedure with a failed descendant should
still "marcar el directorio como incompleto" (mark the directory as incomplete)
— treating "incomplete" as a marking layered on top of, not instead of, the
state. `spec.md` FR-011 and US3-AC3 were corrected during this planning pass to
remove the contradiction.

**Alternatives considered**: Adding a 6th state, e.g. "Completed (partial)"
(rejected — the user explicitly enumerated exactly 5 states in the original
request; introducing a 6th changes the state machine's shape without being
asked).

## Decision 1: SQLite via `better-sqlite3`, one row per directory, read-time aggregation

**Decision**: Persist one row per directory that has ever been scanned in a
single SQLite table (`directory_scan_nodes`), using the `better-sqlite3` driver
(synchronous, no separate DB server process, well-suited to a single-user
self-hosted app). Each row stores only that directory's _own_ facts (its direct
file count/size, its own outcome, whether it has unreadable entries). The
user-facing aggregated count/size, the derived 5-value display state, and the
"incomplete" flag are **not** stored — they are computed at read time via a SQL
recursive CTE that walks the row and all of its descendant rows already in the
table.

**Rationale**: The alternative — writing aggregated totals to every ancestor
each time a leaf directory finishes — means every leaf completion under a deep
tree (e.g. scanning from "/") triggers a write to every ancestor up to the root,
which is both more code (bubble-up propagation with race handling, since only
one worker is active so there's no real concurrency risk, but it's still more
moving parts) and unnecessary: SQLite's recursive CTEs make "sum this
directory + everything under it" a cheap, correct-by-construction query,
computed fresh every time it's needed (directory view, status poll). This
directly satisfies FR-008 (aggregation = sum of self + children) and
FR-010/FR-011 (state and incomplete-ness both depend on the full subtree)
without a second, denormalized source of truth that could drift.

**Alternatives considered**: A single JSON index file (rejected during
`/speckit-clarify` — doesn't scale, whole-file rewrites); per-directory JSON
sidecar files (rejected same session — filesystem overhead for large trees);
write-time bubble-up aggregation (rejected above).

## Decision 2: The scan queue (stack) is in-memory only, not persisted

**Decision**: The LIFO stack of pending directory paths (FR-014) lives only in a
module-level in-memory array inside the worker singleton
(`infrastructure/count-and-size/scan-worker.ts`). It is not written to SQLite.
On process startup, a one-time reconciliation step finds any row still marked as
the "own work not yet finished" outcome (left over from a process that died
mid-scan) and flips it to the Stopped outcome; the stack itself simply starts
empty.

**Rationale**: FR-019 already requires that anything in the Scanning state when
the app restarts or crashes must be surfaced as Stopped, not resumed — and per
FR-010, a directory shows Scanning both while actively running _and_ while
merely queued/waiting its turn. Since nothing in the Scanning state is ever
meant to survive a restart, there is nothing left for a persisted queue to
recover — persisting it would be built for a resume capability the spec
explicitly says not to build. This keeps the schema and the worker simpler
(FR-022 requires persisting results/state/timestamps/depth; it does not require
persisting the pending queue).

**Alternatives considered**: Persisting the stack to SQLite for durability
(rejected — would imply auto-resume after a restart, which FR-019 contradicts;
unnecessary complexity per Constitution Principle I).

## Decision 3: Symlink and unreadable-entry detection via `fs/promises` + `Dirent`

**Decision**: List a directory's direct children with
`fs.promises.readdir(path, { withFileTypes: true })`. Use
`Dirent.isSymbolicLink()` to identify and skip symlinks without following them
(FR-015) — `readdir`'s `Dirent` already reflects `lstat` semantics, so no extra
syscall is needed to detect a symlink. For each remaining entry, use
`fs.promises.stat()` to read file size; catch `EACCES`/`EPERM` (and `ENOENT`,
for entries removed between listing and stat, treated the same as unreadable) to
skip the entry and set the containing directory's `hasUnreadableEntries` flag
(FR-016), rather than failing the whole directory's scan.

**Rationale**: Matches Node's built-in filesystem primitives exactly to the
spec's ignore/skip rules, with no extra dependency.

**Alternatives considered**: A third-party directory-walking library (rejected —
Node's built-ins are sufficient and this keeps the
`infrastructure/count-and-size/filesystem-adapter.ts` the single, obvious place
implementing the `FileSystemPort`, per Constitution Principle I).

## Decision 4: Next.js Route Handlers (not Server Actions) for the tool's API surface

**Decision**: Expose four Route Handlers under `app/api/count-and-size/`:
`GET /list` (paginated directory listing), `GET /status` (current derived
state/aggregates for a path, used both for the initial view and for polling),
`POST /scan` (enqueue a path), `POST /stop` (stop the active scan). The
`app/count-and-size/[[...path]]/page.tsx` page and its client components call
these via `fetch`.

**Rationale**: The UI needs plain, poll-able `GET` requests for live status
refresh (FR-017a) and paginated listing (FR-001a) — a natural REST-ish JSON API
fits that better than Server Actions, which are oriented around form-style
mutations invoked from a Server/Client Component tree rather than being polled
on an interval from client code.

**Alternatives considered**: Server Actions for `scan`/`stop` plus a Route
Handler only for polling (rejected — splitting the same feature's API across two
different Next.js mechanisms adds inconsistency for no real benefit, since Route
Handlers work fine for mutations too).

## Decision 5: Fixed route; current path in client state, remembered via localStorage (revised)

**Decision (revised post-implementation)**: `app/count-and-size/page.tsx` is a
single fixed route — no catch-all segments, the URL never reflects the directory
being browsed. `infrastructure/count-and-size/ui/count-and-size-explorer.tsx`
owns `currentPath` as client component state, initialized to `/` for the
server-rendered/first-paint output and then hydrated from `window.localStorage`
(`infrastructure/count-and-size/last-path-storage.ts`) in an effect once
mounted; every change is written back to the same `localStorage` key, so
reopening the tool resumes at the last-visited directory (spec FR-005a).

**Original decision (superseded)**: `app/count-and-size/[[...path]]/page.tsx`,
mapping URL segments directly to the filesystem path, for bookmarkability and
back/forward-button support.

**Rationale for the reversal**: Explicit product decision — the current
directory must not appear in the app's URL, but the last directory visited must
still be remembered across visits. `localStorage` is the natural mechanism for a
value that's a UI convenience (not scan data) in a single-user, client-rendered
tool; no server-side persistence or new SQLite column was warranted for it
(Constitution Principle I). Losing bookmarkability was an accepted, explicit
tradeoff of this decision, not an oversight.

**Alternatives considered**: Keeping the catch-all route but hiding it behind a
redirect (rejected — the path would still be visible in the URL after
navigation, which is exactly what was rejected); storing the last path
server-side, e.g. a second SQLite table or column (rejected — no other
per-user/session state exists anywhere in this single-user app, and
`localStorage` already solves it with zero new persistence surface).

## Decision 5a: Full per-entry scan stats in the listing (revised)

**Decision (revised post-implementation)**: `GET /list` now returns, per
directory entry with scan data, its full `DirectoryView` (state, aggregated
count/size, last-scanned time, incomplete/unreadable flags) under a `scanStatus`
field, computed the same way `GET /status` computes it (one `getSubtree` +
`deriveDirectoryView` call per listed directory). Per file entry, it returns the
file's own size in bytes. `ListedEntry.hasScanData` (a boolean) is removed in
favor of `scanStatus` being present/absent.

**Rationale**: Explicit product decision — a listing row for a scanned directory
should show its numbers directly, not just a "has data" flag requiring an extra
click to see them; direct files should show their own size too, which was
already computed by `FileSystemPort.listChildren` (`RawEntry.size`) but
previously discarded by the listing use case.

**Cost accepted**: One recursive CTE query per listed directory with scan data
(bounded by page size, default 200 — Decision 6) rather than one cheap boolean
lookup. Not optimized further (e.g., a single batched query) since page sizes
are small and SQLite recursive CTEs are cheap; revisit only if real usage shows
this is slow (YAGNI).

## Decision 5b: Sortable listing — sort the whole directory, then paginate

**Decision**: `application/count-and-size/list-directory.ts` accepts `sortBy`
(`name | type | size | status | date`) and `sortDir` (`asc | desc`). It sorts
_all_ of the target directory's entries (already fetched in full via
`FileSystemPort.listChildren` for the existing name-sort) before slicing to the
requested `offset`/`limit` page — never sorts only the returned page.

**Rationale**: Pagination and sorting compose correctly only in that order.
Sorting each page independently would be visibly wrong (e.g., page 2's "smallest
first" entries could be larger than page 1's, since each page would be sorted in
isolation from a different, arbitrary starting subset).

**Cost accepted**: Sorting by `size`, `status`, or `date` requires every
directory entry's `DirectoryView` (not just the page's) computed up front — one
recursive CTE query per subdirectory in the _entire_ listing, not the bounded
page size from Decision 5a. For a directory with a very large number of
subdirectories, this is more expensive than the unsorted/name/type case.
Accepted as a reasonable YAGNI tradeoff for a personal tool — sorting by a
scan-derived field is an explicit, occasional user action, not the default path,
and SQLite recursive CTEs remain cheap individually even if there are many of
them. A `Map`-based per-request cache (`viewCache`) avoids querying the same
directory's subtree twice (once for sorting, once for the returned page's
`scanStatus`).

**Alternatives considered**: Sorting only within the current page (rejected —
incorrect, per Rationale above); denormalizing `aggregatedSize`/`state` columns
onto `DirectoryScanNode` to make sort-by-size a plain indexed SQL `ORDER BY`
(rejected — reintroduces the write-time-propagation design Decision 1
deliberately avoided, for a feature that's still cheap enough without it).

## Decision 5c: Sort preference and per-row scan actions (revised post-implementation)

**Decision**: The listing's sort field/direction is remembered client-side via
`localStorage` (`infrastructure/count-and-size/sort-preference-storage.ts`),
same rationale and hydration pattern as Decision 5's last-path storage. Each
subdirectory row also gets its own scan trigger (calling the same `POST /scan`
endpoint with that row's path, not the currently-viewed directory's),
independent of the page-level Scan button; while that specific path is scanning,
`directory-browser.tsx` polls to refresh all currently-loaded rows every 2s
(separately from the page-level status poll in `use-directory-status.ts`, which
only tracks the currently-viewed directory). Scan status is shown as a colored
dot (`STATUS_DOT_COLORS`) with the state name as a `title` tooltip, rather than
inline text, to keep rows compact after adding the per-row action.

**Rationale**: Explicit product decisions — sort preference should persist like
the browsing path does; users want to kick off a scan on a subdirectory without
navigating into it first.

**Alternatives considered**: Reusing the page-level `refreshToken` (from
`use-directory-status.ts`) for row-triggered scans too (rejected — that hook
only tracks the currently-viewed directory's own status; a row-triggered scan on
an unvisited subdirectory wouldn't be reflected in it without a separate polling
path).

## Decision 6: Pagination and polling parameters

**Decision**: `GET /list` accepts `offset`/`limit` query params (default `limit`
of 200 entries) and returns whether more entries remain (FR-001a). The client
fetches the next page as the user scrolls near the bottom of the listing.
`GET /status` is polled by the client every 2 seconds while the currently-viewed
directory's derived state is Scanning (FR-017a); polling stops automatically
once the state reaches a terminal value (Completed, Error, or Stopped).

**Rationale**: Simple, fixed values appropriate for a single-user personal tool
(Constitution Principle I — no configurable polling interval or page size until
a real need for one appears); a 2-second interval is frequent enough to feel
live without generating excessive request volume for a single-user backend
hitting a local SQLite file.

**Alternatives considered**: Server-Sent Events / WebSocket push for status
(rejected — real-time push adds a persistent-connection mechanism the spec's
clarification session explicitly chose not to require, favoring polling of just
the currently-viewed directory over a full real-time architecture).

## Decision 7: Persisting the SQLite file across container recreation

**Decision**: Store the SQLite database at `data/count-and-size.sqlite` (new,
`.gitignore`d `data/` directory at the repo root). In `docker-compose.prod.yml`,
add a named volume mounted at `/app/data` on the `web` service.
`docker-compose.yml` (dev) needs no equivalent change — it already bind-mounts
the entire repo (`.:/app`), so `data/` is persisted on the host automatically.

**Rationale**: `docker-compose.prod.yml` currently defines no volumes at all —
the `runner` stage's container filesystem is fully ephemeral. Without a named
volume, every `docker compose ... up --build` (e.g. after a code change) would
silently wipe all scan results, directly violating FR-022 and SC-006 ("results
remain available after an application restart"), which do not distinguish a
process restart from a container recreation.

**Alternatives considered**: Storing the database inside the existing
`.next`/`node_modules` anonymous volumes (rejected — those are dev-only volumes
for hot-reload and don't exist in the prod compose file; conflating build
artifacts with user data is also fragile).

## Decision 8: `better-sqlite3` on the Alpine (`runner`) image

**Decision**: Add `better-sqlite3` via `pnpm add`. It ships prebuilt native
binaries (via `prebuild-install`) for common platforms including
`linux-musl-x64` (Alpine), so no compiler toolchain should be needed in either
Docker stage. This will be verified during implementation (`/speckit-implement`)
by actually building the `docker-compose.prod.yml` image; if the prebuilt binary
is unavailable for the exact Node 22 / Alpine combination in use, the fallback
is adding `python3 make g++` to the `deps` stage in the `Dockerfile` so
`node-gyp` can compile it from source.

**Rationale**: Avoids preemptively adding a C/C++ build toolchain to the image
(Constitution Principle I — don't build for a problem that may not exist) while
flagging the concrete fallback so it isn't a surprise if the prebuilt binary
path fails.

**Alternatives considered**: Node's built-in experimental `node:sqlite` module
(rejected — still flagged experimental as of Node 22, and its exact
availability/stability across the project's pinned Node 22 base images isn't
guaranteed the way a mature, widely-used package like `better-sqlite3` is).

## Decision 9: Domain/application/infrastructure split for this feature

**Decision**:

- `domain/count-and-size/`: `DirectoryScanNode`/`OwnOutcome` types, the pure
  `deriveDirectoryView(node, descendantNodes)` function (state, incomplete flag,
  aggregated count/size, last-scanned timestamp — Decision 1), a pure LIFO
  `ScanStack` structure, and a pure `shouldIgnoreEntry(entry)` predicate given
  already-resolved metadata. No `fs`, no SQL, no Next.js imports.
- `application/count-and-size/`: `FileSystemPort` and `ScanRepositoryPort`
  interfaces, plus use cases (`listDirectory`, `getDirectoryStatus`,
  `startScan`, `stopScan`, `processDirectory`) that depend only on those ports
  and on `domain/count-and-size/`.
- `infrastructure/count-and-size/`: `filesystem-adapter.ts` (implements
  `FileSystemPort` via `fs/promises`), `sqlite-client.ts` +
  `scan-repository-adapter.ts` (implement `ScanRepositoryPort` via
  `better-sqlite3`), `scan-worker.ts` (the singleton background loop —
  process-level state and timing are inherently a runtime/infrastructure
  concern), and `ui/` React components (browser listing, status panel, Scan/Stop
  buttons).
- `app/count-and-size/[[...path]]/page.tsx` and `app/api/count-and-size/*` stay
  thin: they parse the path/query params, call one `application/` use case, and
  render/return the result.

**Rationale**: Required by Constitution Principle II for every system boundary
this feature crosses (filesystem reads, SQLite, the background worker's
process-level state) and Principle III (SOLID — `FileSystemPort` and
`ScanRepositoryPort` are two small, single-purpose interfaces rather than one
catch-all "count and size port"). Mirrors the split already established by
feature 001-dashboard-shell.

**Alternatives considered**: One combined `CountAndSizePort` covering both
filesystem and persistence (rejected — conflates two independently substitutable
concerns; interface segregation, Principle III).
