export interface ChecksumPort {
  /** SHA-256 hex digest of the file's first 64 KiB (or the whole file, if
   * smaller). Never reads more than that regardless of file size. Rejects
   * (with an abort-flavored error) if `signal` fires mid-read — added
   * post-implementation so Stop (FR-013) can interrupt a slow file's
   * checksum instead of only taking effect between separate files. */
  computePartialChecksum(path: string, signal?: AbortSignal): Promise<string>;

  /** SHA-256 hex digest of the file's entire content, streamed. Same
   * `signal` behavior as `computePartialChecksum`. */
  computeFullChecksum(path: string, signal?: AbortSignal): Promise<string>;

  /** Fallback for OOXML files (spec: user request, `isOfficeContainerFormat`
   * gates when this gets called): SHA-256 over the file's ZIP entries
   * (name + compressed data, sorted), excluding container-level metadata
   * like each entry's own timestamp — Google Drive re-serves these files
   * with a non-deterministically repackaged ZIP container on every
   * download, so a raw-byte mismatch alone isn't proof of a real content
   * difference for this file type. `null` (never a rejected promise) if the
   * file isn't a well-formed ZIP, i.e. "can't tell", not a match. */
  computeOfficeContainerChecksum(
    path: string,
    signal?: AbortSignal,
  ): Promise<string | null>;
}
