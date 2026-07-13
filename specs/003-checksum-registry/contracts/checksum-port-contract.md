# Contract: ChecksumPort

The port Pass 2 (`application/directory-comparison/compare-subtree.ts`) depends
on for reading file content and producing a checksum. Defined in
`application/directory-comparison/checksum-port.ts`. New for this feature — kept
separate from the shared `FileSystemPort` (`application/scanning/`), which only
lists/stats and is reused unchanged by both Count and Size and this tool's own
Pass 1 (research.md Decision 6).

## Shape

```ts
interface ChecksumPort {
  /** SHA-256 hex digest of the file's first 64 KiB (or the whole file, if
   * smaller). Never reads more than that regardless of file size. */
  computePartialChecksum(path: string): Promise<string>;

  /** SHA-256 hex digest of the file's entire content, streamed. */
  computeFullChecksum(path: string): Promise<string>;
}
```

Both methods reject (throw) if the file cannot be read (permission change or the
file disappearing between listing and hashing) — callers catch this to set
`hasUnreadableEntries`/`error` status (spec FR-011, FR-011a) rather than letting
it crash the comparison pass.

## Use cases that depend on this port

- `application/directory-comparison/compare-subtree.ts` (Pass 2) — calls
  `computePartialChecksum` only for a file pair whose sizes already matched, and
  `computeFullChecksum` only for a pair whose partial checksums already matched
  (research.md Decision 3's cascade). Never called at all for a file with no
  same-name, same-size counterpart on the other side.

## Implementation

- **`infrastructure/directory-comparison/checksum-adapter.ts`** (the only
  implementation): `fs.createReadStream(path)` piped through
  `crypto.createHash('sha256')`; `computePartialChecksum` destroys the stream
  after 64 KiB have been read/hashed instead of reading to the end.

## Rules a consumer can rely on

- Never reads more of a file than the method promises — `computePartialChecksum`
  never triggers a full read as a side effect.
- Two calls with the same `path` and unchanged file content always return the
  same digest (pure function of file bytes) — callers are free to cache the
  result keyed by `(path, size, modificationTime)` (`FileChecksumEntry`,
  `data-model.md`).
- Throws (does not silently return an empty/placeholder digest) on any read
  failure, so callers can't mistake an unreadable file for one that happens to
  hash to a particular value.
