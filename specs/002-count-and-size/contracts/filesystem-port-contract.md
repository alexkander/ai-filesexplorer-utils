# Contract: FileSystemPort

The port `application/count-and-size/` use cases depend on for any read of
the real filesystem. Defined in
`application/count-and-size/filesystem-port.ts`.

## Shape

```ts
interface RawEntry {
  name: string;
  path: string; // absolute
  kind: 'file' | 'directory' | 'symlink' | 'unreadable';
  size: number; // bytes; 0 for directories/symlinks/unreadable
}

interface ListChildrenResult {
  entries: RawEntry[]; // symlinks and unreadable entries ARE included here,
  // tagged by kind, so callers can decide what to do
  // with them (domain's shouldIgnoreEntry) and so the
  // listing use case can still show unreadable files to
  // the user even though the scan use case skips them
}

type ListChildrenOutcome =
  | { ok: true; result: ListChildrenResult }
  | { ok: false; reason: 'unreadable' }; // the directory itself couldn't be
// listed (e.g. permission denied)

interface FileSystemPort {
  listChildren(path: string): Promise<ListChildrenOutcome>;
}
```

## Use cases that depend on this port

- `application/count-and-size/list-directory.ts` — shows the browsing
  listing (FR-001/FR-001a). Uses raw `kind` directly: files are shown
  non-clickable, directories clickable, symlinks/unreadable entries shown but
  inert (spec doesn't require hiding them from browsing — only from scan
  totals).
- `application/count-and-size/process-directory.ts` — the scan worker's
  per-node step (FR-007). Applies `domain/count-and-size/shouldIgnoreEntry`
  to each `RawEntry`: symlinks are skipped and never contribute to
  `directFileCount`/`directFileSize`; unreadable entries are skipped and set
  `hasUnreadableEntries = true`; only `kind === 'file'` entries contribute to
  the direct count/size; `kind === 'directory'` entries become new
  `DirectoryScanNode` rows pushed onto the scan stack.

## Implementation

- **`infrastructure/count-and-size/filesystem-adapter.ts`** (the only
  implementation): uses `fs.promises.readdir(path, { withFileTypes: true })`
  plus `Dirent.isSymbolicLink()` to classify each entry without following
  symlinks, and `fs.promises.stat()` for file sizes, catching
  `EACCES`/`EPERM`/`ENOENT` per entry as `kind: 'unreadable'` and on the
  top-level `readdir` call itself as `{ ok: false, reason: 'unreadable' }`
  (research.md Decision 3).

## Rules a consumer can rely on

- `listChildren` never throws for a normal permission error — failures are
  always represented in the return value (`ok: false`, or a per-entry
  `'unreadable'` kind), never a rejected promise, except for truly
  unexpected errors (e.g. out of memory).
- `listChildren` never follows symlinks — a symlinked directory always comes
  back as `kind: 'symlink'`, never `'directory'`.
- Entries are returned in filesystem enumeration order (no sorting
  guarantee); sorting for display is the listing use case's responsibility.
