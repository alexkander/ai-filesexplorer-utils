# Contract: Directory Comparison HTTP API

The Route Handlers `infrastructure/directory-comparison/ui/` client components
call (research.md Decision 8). All paths are absolute filesystem paths passed as
query/body params (URL-encoded where needed). All responses are JSON.

## `GET /api/directory-comparison/list?path=...&offset=0&limit=200`

Plain browsing listing for one pane (FR-001, FR-001a) — no comparison data,
since a pane can be browsed independently of any comparison ever having run
(Story 1).

**Response `200`**:

```json
{
  "entries": [
    { "name": "photos", "type": "directory" },
    { "name": "notes.txt", "type": "file", "size": 4096 }
  ],
  "hasMore": false
}
```

**Response `404`**: `path` does not exist or is not a directory.

**Response `403`**: `path` exists but could not be read.

## `GET /api/directory-comparison/status?left=...&right=...`

The per-entry comparison view for the currently-selected pair (FR-007), plus
overall pass progress — used for the initial view and for polling while
`Scanning`.

**Response `200`**:

```json
{
  "passActive": "structural",
  "entries": [
    { "name": "photos", "kind": "directory", "status": "scanning" },
    { "name": "notes.txt", "kind": "file", "status": "matching" },
    { "name": "draft.txt", "kind": "file", "status": "only_left" },
    { "name": "video.mp4", "kind": "file", "status": "differs" },
    { "name": "backup", "kind": "directory", "status": "error" }
  ]
}
```

`passActive` is `"structural" | "comparison" | null` (`null` once both passes
have settled for this pair, or before "Compare" was ever pressed). Each entry's
`status` is one of
`"not_compared" | "matching" | "differs" | "only_left" | "only_right" | "scanning" | "error"`
(`data-model.md` `EntryComparisonResult`). Before "Compare" has ever been
pressed for this pair, every entry shows `"not_compared"` and `passActive` is
`null`.

## `POST /api/directory-comparison/compare`

Body:
`{ "leftPath": "/a", "rightPath": "/b", "mode"?: "incremental" | "full" }`.
Starts Pass 1 (structural listing) for both roots, chaining into Pass 2
(cascading comparison) once Pass 1 settles (research.md Decision 3). `mode`
defaults to `"incremental"` (FR-008): unchanged files/subtrees since the last
comparison involving that path are skipped in both passes. `mode: "full"`
(FR-009, the "Force full re-compare" action) always covers both sides together —
there is no per-side variant — and clears cached checksums for both subtrees
before recomputing.

**Response `202`**: `{ "accepted": true }` — returns immediately; both passes
run in the background (FR-012). Accepted whether or not another comparison is
active elsewhere in this tool — the request is enqueued (FR-010), never rejected
or run concurrently.

## `POST /api/directory-comparison/stop`

Body: `{ "leftPath": "/a", "rightPath": "/b" }` — cancels whichever pass
(structural or comparison) is currently active for this pair's roots (FR-013);
already-computed results are kept.

**Response `200`**: `{ "stopped": true }` if anything was in progress and is now
stopped; `{ "stopped": false }` otherwise.

## Rules a consumer can rely on

- `POST /compare` and `POST /stop` never block on either pass completing — both
  return as soon as the request has been recorded (FR-012).
- Polling `GET /status` is safe at any time, including before "Compare" has ever
  been pressed for a pair — it never errors, it just returns every entry as
  `"not_compared"`.
- `GET /list` is independent of `GET /status`/`POST /compare` — a pane can be
  browsed freely (Story 1) without triggering or being affected by any
  comparison.
