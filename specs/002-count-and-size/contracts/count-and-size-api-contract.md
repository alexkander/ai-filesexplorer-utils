# Contract: Count and Size HTTP API

The Route Handlers `infrastructure/count-and-size/ui/` client components call
(research.md Decision 4). All paths are absolute filesystem paths passed as the
`path` query/body param (URL-encoded where needed). All responses are JSON.

## `GET /api/count-and-size/list?path=...&offset=0&limit=200&sortBy=name&sortDir=asc`

Browsing listing for one directory (FR-001, FR-002, FR-003, FR-004, FR-001a,
FR-004a, FR-004b).

`sortBy` is one of `name | type | size | status | date` (default `name`);
`sortDir` is `asc | desc` (default `asc`). Sorting is applied to the entire
directory's contents before pagination — `offset`/`limit` slice the already-
sorted list, so the same entry always lands on the same page for a given sort.
Unknown/missing `sortBy`/`sortDir` values fall back to the defaults rather than
erroring.

**Response `200`**:

```json
{
  "entries": [
    {
      "name": "etc",
      "type": "directory",
      "scanStatus": {
        "state": "completed",
        "incomplete": false,
        "aggregatedCount": 1204,
        "aggregatedSize": 583200,
        "lastScannedAt": "2026-07-11T20:00:00.000Z",
        "hasUnreadableEntries": false
      }
    },
    { "name": "cache", "type": "directory" },
    { "name": "vmlinuz", "type": "file", "size": 12345678 }
  ],
  "hasMore": false
}
```

`scanStatus` (directories) and `size` (files) are present only when applicable;
per FR-004, the client renders nothing beyond the entry's name when neither is
present (e.g. `"cache"` above, never scanned). (Revised during a
`/speckit-implement` follow-up round — research.md Decision 5a — from an earlier
`hasScanData: boolean` design that only signalled availability without the
actual numbers.)

**Response `404`**: `path` does not exist or is not a directory.

**Response `403`**: `path` exists but could not be read (permission denied) —
distinct from a subdirectory _inside_ a readable listing being unreadable, which
is instead surfaced there via omission (this endpoint reflects only what's
actually readable at `path` itself).

## `GET /api/count-and-size/status?path=...`

The `DirectoryView` for one directory (FR-005, FR-008, FR-009, FR-011) — used
for the initial page load and for polling (FR-017a).

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

`state` is one of
`"not_scanned" | "scanning" | "completed" | "error" | "stopped"`. When
`state === "not_scanned"`, all other fields are omitted except `state` itself —
the client shows "not scanned yet" (FR-005).

## `POST /api/count-and-size/scan`

Body: `{ "path": "/home/user", "mode"?: "incremental" | "full" }`. Starts (or
re-starts) a scan rooted at `path` (FR-006, FR-007, FR-012, FR-013). `mode`
defaults to `"incremental"` when omitted (FR-021): only paths in `path`'s
subtree that are missing, errored, stopped, or completed-but-incomplete are
(re)scanned — subdirectories already fully `completed` and not incomplete are
left untouched. `mode: "full"` (FR-021a) ignores all existing state and rescans
the entire subtree from scratch, exactly as this endpoint always behaved before
this revision. The page-level "Scan" button and the per-row scan trigger
(Decision 5c) both omit `mode` (incremental); the page-level "Force full rescan"
button (research.md Decision 11) is the only caller that sends `mode: "full"`.

**Response `202`**: `{ "accepted": true }` — always returns immediately; the
scan itself runs in the background (FR-017). Accepted whether or not another
scan is currently active elsewhere — the request is enqueued (FR-013), never
rejected. With `mode: "incremental"`, if `path`'s entire subtree is already
`completed` and not incomplete, the request is still accepted but nothing is
actually (re)enqueued — there is nothing outstanding to process.

## `POST /api/count-and-size/stop`

Body: `{ "path": "/home/user" }` — stops the scan rooted at `path`: every node
in that subtree not yet in a terminal state (including whichever one happens to
be actively executing, if it falls under `path`) transitions to Stopped
(FR-018). Scoped to the subtree, not to "whichever single node the worker's
timing happened to land on" — a scan tree can have thousands of independent
siblings still queued elsewhere in the global stack, and pressing Stop on a
directory means stopping everything under it, not an arbitrary unrelated node.
(Revised from an earlier no-path design during `/speckit-implement`: manual
testing showed a path-less "stop whatever's active" only ever cancelled one
arbitrary in-flight leaf, leaving thousands of queued siblings under the same
directory to keep running to completion.)

**Response `200`**: `{ "stopped": true }` if anything in that subtree was
pending and is now stopped; `{ "stopped": false }` otherwise.

## Rules a consumer can rely on

- Every endpoint accepts only paths under `/` (all filesystem paths are valid by
  construction on a Linux host — there is no separate allow-list; the
  constitution's single-user/no-auth deployment model means anything the running
  process's OS user can read is in scope).
- `POST /scan` and `POST /stop` never block on the scan itself completing — both
  return as soon as the request has been recorded (FR-017).
- Polling `GET /status` is safe to call at any time, including for a path with
  `state: "not_scanned"` — it never errors just because nothing has been scanned
  yet.
