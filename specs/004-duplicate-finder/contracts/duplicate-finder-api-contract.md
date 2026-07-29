# Contract: Duplicate Finder HTTP API

The Route Handlers that `infrastructure/duplicate-finder/ui/` client components
call. All paths are absolute filesystem paths passed as query/body params
(URL-encoded where needed). All responses are JSON. Every handler stays thin: it
parses input, calls one use case, and maps the outcome to a status code.

## `POST /api/duplicate-finder/scan`

Starts a scan (FR-004, FR-005, FR-008).

**Body**: `{ "rootPath": "/data/photos", "includeFolders": false }`

**Response `202`**: `{ "started": true, "scanSeq": 7 }` — the scan is running in
the background; the client switches to polling `/status`.

**Response `400`**:
`{ "error": "not_found" | "not_a_directory" | "unreadable" | "root_ignored" }` —
the four rejections FR-004 and the "root inside an ignored subtree" edge case
require. The client renders a distinct message per code.

**Response `409`**: `{ "error": "already_running", "activePath": "..." }` — a
scan is already in flight; the user must Stop it first (FR-008). The request
does **not** queue and does **not** disturb the running scan.

## `GET /api/duplicate-finder/status`

The single source of truth for the status panel (FR-006, FR-023). Polled while a
scan is active.

**Response `200`**:

```json
{
  "state": "running",
  "phase": "hashing",
  "rootPath": "/data/photos",
  "includeFolders": true,
  "activePath": "/data/photos/2024/IMG_0421.CR3",
  "processed": 1841,
  "total": 5230,
  "unreadableCount": 3,
  "startedAt": "2026-07-29T10:12:03.881Z",
  "finishedAt": null,
  "errorMessage": null,
  "groupCount": 12
}
```

`state` is one of `idle` (no scan has ever run — distinct from a scan that found
nothing, FR-022), `running`, `finished`, `stopped` (results are partial, FR-007)
or `failed`. `phase` is `listing` | `hashing` | `deriving_folders` | `grouping`,
and is `null` unless `state` is `running`. `total` is `0` while the phase's
denominator is still unknown.

A `state` of `running` returned right after a server restart is impossible: the
worker reconciles an interrupted row to `stopped` when its module is first
evaluated (research.md Decision 3).

## `POST /api/duplicate-finder/stop`

**Body**: none.

**Response `200`**: `{ "stopped": true }` — the in-flight read is aborted, the
cheap grouping pass still runs over whatever checksums exist, and the state
becomes `stopped` with the results labelled partial (research.md Decision 13).
Stopping when nothing is running is a no-op, not an error.

## `GET /api/duplicate-finder/groups?sortBy=size&sortDir=desc&page=0`

`sortDir` is `desc` (default) or `asc`; anything else falls back to `desc`. The
paginated listing (FR-018, FR-020, SC-004). `sortBy` is `size` (default) or
`occurrences`; `page` is zero-based; the page size is fixed at 50.

**Response `200`**:

```json
{
  "groups": [
    {
      "checksum": "9f86d081884c7d65...",
      "kind": "directory",
      "size": 4294967296,
      "occurrenceCount": 2,
      "isEmpty": false
    }
  ],
  "total": 1284,
  "partial": false
}
```

`partial` mirrors `state === 'stopped'`, so the listing can label the whole
result set without a second request. Occurrences are deliberately **not**
inlined — a group with thousands of paths would otherwise bloat every page that
contains it.

## `GET /api/duplicate-finder/directory?path=...&sortBy=count&sortDir=desc&hideEmpty=false&page=0`

One level of the by-directory view (FR-031 — FR-037). `path` defaults to the
scanned root, and anything outside that root silently falls back to it — no
results exist there, so an empty listing would be a lie. `sortBy` is `count`
(default), `size` or `name`; `hideEmpty=true` drops directories with no
duplicates; the page size is 200.

**Response `200`**:

```json
{
  "rootPath": "/data/photos",
  "currentPath": "/data/photos/2024",
  "parentPath": "/data/photos",
  "rows": [
    {
      "path": "/data/photos/2024/raw",
      "name": "raw",
      "kind": "directory",
      "duplicateCount": 412,
      "duplicateSize": 8123456789,
      "isDuplicate": false,
      "checksum": null,
      "occurrenceCount": null,
      "isEmpty": false
    }
  ],
  "total": 37,
  "page": 0,
  "pageSize": 200,
  "subtreeCount": 480,
  "subtreeSize": 9000000000,
  "overallCount": 1284,
  "overallSize": 21000000000
}
```

`duplicateCount`/`duplicateSize` cover the row's whole subtree; `subtree*`
covers `currentPath`; `overall*` covers the entire result set, so a row can be
read as a share of the total. `parentPath` is `null` at the scanned root, and
`currentPath` is `null` when no scan has ever run.

`isDuplicate` marks a row that is itself a member of a duplicate group — a
duplicated file, or a directory reported as a duplicate of another directory —
and only then are `checksum` and `occurrenceCount` populated.

## `GET /api/duplicate-finder/occurrences?checksum=...&kind=file`

Every path of one group, for the expanded row (FR-019).

**Response `200`**: `{ "paths": ["/data/photos/a.jpg", "/data/backup/a.jpg"] }`

**Response `404`**: the group is not part of the current result set (for
example, it was collapsed away or ignored between the page load and the click).

## `POST /api/duplicate-finder/ignore`

**Body**: `{ "path": "/data/backup", "ignored": true }`

**Response `200`**: `{ "removedGroups": 118, "removedOccurrences": 4021 }` — the
counts let the client refresh the current page and the total without refetching
blindly.

Marking excludes the path and, for a folder, everything beneath it from every
later scan (FR-025), and immediately prunes the current results (FR-026).
Unmarking (`"ignored": false`) only removes the ignore entry; the content
reappears on the next scan (FR-027).

## `POST /api/duplicate-finder/delete`

Moves one duplicate copy into the trash area (FR-038 — FR-043). **Two-step by
construction**: `dryRun` defaults to `true`, so a request that omits the flag
can only ever report what it would do — deleting for real requires an explicit
`"dryRun": false` (constitution Principle V).

**Body**: `{ "path": "/data/photos/copy.jpg", "dryRun": true }`

**Response `200`**:

```json
{
  "outcome": "planned",
  "plan": {
    "path": "/data/photos/copy.jpg",
    "destination": "/app/data/data/photos/copy.jpg",
    "freedBytes": 204800,
    "remainingCopies": 2,
    "groupDisappears": false
  }
}
```

`outcome` is `planned` for a dry run and `deleted` for the real thing; the plan
is identical in shape, and after a real move `destination` is the path actually
used (a suffix is appended rather than overwriting anything already there).

**Response `409`**: `{ "error": "<reason>" }` — one of `not_reported`,
`last_copy`, `is_symlink`, `is_directory`, `not_a_file`, `missing`,
`unreadable`, `outside_scan`, `inside_trash`, `scan_running`. Every one of these
is checked again on the real run, not just during the dry run: the confirmed
plan may be minutes old.

Note that `last_copy` is the backstop, not the usual path — once a content is
down to one copy its group has already left the result set, so the request fails
earlier with `not_reported`. Either way the last copy is never deletable.

## `GET /api/duplicate-finder/ignored-paths`

**Response `200`**:

```json
{
  "paths": [{ "path": "/data/backup", "ignoredAt": "2026-07-29T09:58:11.204Z" }]
}
```

Newest first. Backs the dedicated ignored-paths view, which un-ignores through
the `ignore` endpoint above — the same shape the comparison tool's ignored-paths
view already uses.

## Cross-cutting rules

- No endpoint ever mutates the scanned filesystem (FR-029) or the comparison
  tool's database (FR-030).
- A path argument is always absolute; handlers reject a missing or empty `path`
  with `400 { "error": "Missing path" }`, matching the existing tools' handlers.
- There is no authentication: single-user, self-hosted deployment model per the
  constitution.
