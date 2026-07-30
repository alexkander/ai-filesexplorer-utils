# Contract: ChecksumPort (Duplicate Finder)

The port the hashing phases depend on for reading file content and producing a
checksum. Defined in `application/duplicate-finder/checksum-port.ts`.

Deliberately **not** the comparison tool's port of the same name: that one also
carries `computeOfficeContainerChecksum`, which this feature never calls.
Depending on it would force this slice to accept a method it does not need
(interface segregation, Principle III) and would create a cross-slice import
this codebase's convention forbids (research.md Decision 9).

## Shape

```ts
interface ChecksumPort {
  /** SHA-256 hex digest of the file's first 64 KiB — or of the whole file
   * when it is smaller, in which case the digest IS the full checksum
   * (research.md Decision 5). Never reads more than the threshold. */
  computePartialChecksum(path: string, signal?: AbortSignal): Promise<string>;

  /** SHA-256 hex digest of the file's entire content, streamed — never
   * buffered in memory regardless of file size. */
  computeFullChecksum(path: string, signal?: AbortSignal): Promise<string>;
}
```

## Rules a consumer can rely on

- **Bounded reads**: `computePartialChecksum` reads at most 64 KiB. The
  threshold is a constant of the adapter, exported so the hashing use case can
  decide which files skip the full pass.
- **Streamed**: neither method loads a whole file into memory.
- **Abortable mid-file**: when `signal` fires, the underlying read stream is
  destroyed and the promise rejects. This is what makes SC-005's 2-second Stop
  bound hold while a multi-gigabyte file is being read; a caller distinguishes
  an abort from a genuine failure by checking `signal.aborted` in its `catch`.
- **Rejects on unreadable files**: a permission change or a file disappearing
  between the walk and the hash surfaces as a rejected promise. Callers mark
  `has_read_error` on that row and continue (FR-010) — a single bad file never
  aborts the scan.
- **Pure**: never writes to, creates, or touches anything on the filesystem
  (FR-029). Reading does not update access times in any way the feature relies
  on.

## Use cases that depend on this port

- `application/duplicate-finder/hash-candidates.ts` — calls
  `computePartialChecksum` only for files that share a size with at least one
  other file, and `computeFullChecksum` only for files larger than the partial
  threshold whose partial checksum matched another candidate's. A file with a
  unique size is never passed to either method (FR-013, SC-002).

## Implementation

`infrastructure/duplicate-finder/checksum-adapter.ts` — a local copy of the
comparison tool's streaming implementation, minus the Office-container method:
`fs.createReadStream(path, { signal })` for the full digest, and the same call
bounded with `end: PARTIAL_CHECKSUM_BYTES - 1` for the partial one. Bounding the
stream's byte range (rather than destroying it after N bytes) means `'end'`
fires exactly once whether the file is larger or smaller than the threshold, so
`hash.digest()` is never called twice.

See research.md Decision 9 for why this is a copy and the condition under which
the two copies should be merged into a shared module.
