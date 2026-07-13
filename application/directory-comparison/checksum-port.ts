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
}
