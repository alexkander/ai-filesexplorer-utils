# Contract: CopyPort

Added post-implementation (spec FR-018, user request). The port `copy-entry.ts`
depends on for the one filesystem-writing action this otherwise read-only tool
offers: copying an "Only on this side" entry to the other side. Defined in
`application/directory-comparison/copy-port.ts`.

## Shape

```ts
type CopyOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: 'source_not_found' | 'destination_exists' | 'unreadable';
    };

interface CopyPort {
  copy(sourcePath: string, destinationPath: string): Promise<CopyOutcome>;
}
```

## Use cases that depend on this port

- `application/directory-comparison/copy-entry.ts`: a thin wrapper calling
  `copy()` directly — no domain logic involved (unlike the checksum/scan ports,
  there's no comparison decision to make here).

## Implementation

- **`infrastructure/directory-comparison/copy-adapter.ts`** (the only
  implementation):
  `fs.promises.cp(source, destination, { recursive: true, errorOnExist: true, force: false })`
  (Node built-in, no new dependency) — recursive for directories, refuses to
  overwrite. Checks the destination doesn't already exist up front
  (`destination_exists`, fast/clear reason) in addition to `cp`'s own overwrite
  guard (protects against a same-name entry appearing between the check and the
  actual copy).

## Rules a consumer can rely on

- Never overwrites, moves, merges, or deletes anything — `destination_exists` is
  returned instead of proceeding, on both the pre-check and via `cp`'s own
  flags.
- Symlinks in the source are copied as symlinks (not dereferenced/followed),
  matching a plain filesystem-level copy — this is independent of the
  scanning/comparison pipeline's own "symlinks are ignored" rule (FR-011), which
  only governs what gets checksummed/compared, not what a raw copy action does.
- `POST /api/directory-comparison/copy` (see
  `directory-comparison-api-contract.md`) is the only caller — the UI (`copy`
  button, shown only for "Only on this side" entries) requires explicit user
  confirmation before ever making this request (Constitution Principle V's
  spirit, even though a pure "create new, never overwrite" action isn't strictly
  "destructive" as that principle defines the term).
