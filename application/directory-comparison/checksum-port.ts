export interface ChecksumPort {
  /** SHA-256 hex digest of the file's first 64 KiB (or the whole file, if
   * smaller). Never reads more than that regardless of file size. */
  computePartialChecksum(path: string): Promise<string>;

  /** SHA-256 hex digest of the file's entire content, streamed. */
  computeFullChecksum(path: string): Promise<string>;
}
