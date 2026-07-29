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

## `GET /api/duplicate-finder/groups?sortBy=size&page=0`

The paginated listing (FR-018, FR-020, SC-004). `sortBy` is `size` (default) or
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
