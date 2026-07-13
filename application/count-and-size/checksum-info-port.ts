/**
 * Read-only lookup of a file/directory's own full checksum, as already
 * computed by the separate directory-comparison tool. Entirely optional —
 * `null` means that exact path has never been part of a Compare (or its
 * checksum wasn't persisted — e.g. a directory pair that `differs` has no
 * per-side value to show, only `matching` ones do), not an error.
 */
export interface ChecksumInfoPort {
  getChecksum(path: string): string | null;
}
