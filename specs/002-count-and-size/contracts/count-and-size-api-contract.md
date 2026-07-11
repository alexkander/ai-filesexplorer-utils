# Contract: Count and Size HTTP API

The Route Handlers `infrastructure/count-and-size/ui/` client components call
(research.md Decision 4). All paths are absolute filesystem paths passed as
the `path` query/body param (URL-encoded where needed). All responses are
JSON.

## `GET /api/count-and-size/list?path=...&offset=0&limit=200`

Browsing listing for one directory (FR-001, FR-002, FR-003, FR-004,
FR-001a).

**Response `200`**:

```json
{
  "entries": [
    { "name": "etc", "type": "directory", "hasScanData": true },
    { "name": "vmlinuz", "type": "file" }
  ],
  "hasMore": false
}
```

`hasScanData` is present only for `type: "directory"` entries; per FR-004,
the client renders nothing when it's absent/`false`.

**Response `404`**: `path` does not exist or is not a directory.

**Response `403`**: `path` exists but could not be read (permission denied)
— distinct from a subdirectory *inside* a readable listing being unreadable,
which is instead surfaced there via omission (this endpoint reflects only
what's actually readable at `path` itself).

## `GET /api/count-and-size/status?path=...`

The `DirectoryView` for one directory (FR-005, FR-008, FR-009, FR-011) —
used for the initial page load and for polling (FR-017a).

**Response `200`**:

```json
{
  "state": "scanning",
  "incomplete": false,
  "aggregatedCount": 1204,
  "aggregatedSize": 583200,
  "lastScannedAt": null,
  "hasUnreadableEntries": false
}
```

`state` is one of `"not_scanned" | "scanning" | "completed" | "error" |
"stopped"`. When `state === "not_scanned"`, all other fields are omitted
except `state` itself — the client shows "not scanned yet" (FR-005).

## `POST /api/count-and-size/scan`

Body: `{ "path": "/home/user" }`. Starts (or re-starts, per FR-021) a scan
rooted at `path` (FR-006, FR-007, FR-012, FR-013).

**Response `202`**: `{ "accepted": true }` — always returns immediately; the
scan itself runs in the background (FR-017). Accepted whether or not another
scan is currently active elsewhere — the request is enqueued (FR-013),
never rejected.

## `POST /api/count-and-size/stop`

Body: `{}` (stops whatever is currently active — the spec's Stop action
applies to "the active scan", not to an arbitrary path; FR-018).

**Response `200`**: `{ "stopped": true }` if a scan was active and is now
stopped; `{ "stopped": false }` if nothing was active.

## Rules a consumer can rely on

- Every endpoint accepts only paths under `/` (all filesystem paths are
  valid by construction on a Linux host — there is no separate allow-list;
  the constitution's single-user/no-auth deployment model means anything the
  running process's OS user can read is in scope).
- `POST /scan` and `POST /stop` never block on the scan itself completing —
  both return as soon as the request has been recorded (FR-017).
- Polling `GET /status` is safe to call at any time, including for a path
  with `state: "not_scanned"` — it never errors just because nothing has
  been scanned yet.
