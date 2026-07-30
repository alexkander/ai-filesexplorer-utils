/**
 * Content hashing for the scan's cascade (contracts/checksum-port-contract.md).
 *
 * Deliberately narrower than the directory comparison tool's port of the same
 * name: that one also carries `computeOfficeContainerChecksum`, which this
 * feature never calls. Depending on it would force this slice to accept a
 * method it does not need (interface segregation) and would introduce a
 * cross-tool import this codebase's convention avoids.
 */
export interface ChecksumPort {
  /**
   * SHA-256 hex digest of the file's first `PARTIAL_CHECKSUM_BYTES` — or of
   * the whole file when it is smaller, in which case the digest IS the full
   * checksum and the caller can skip the full pass entirely (research.md
   * Decision 5). Never reads more than the threshold.
   */
  computePartialChecksum(path: string, signal?: AbortSignal): Promise<string>;

  /** SHA-256 hex digest of the file's entire content, streamed. */
  computeFullChecksum(path: string, signal?: AbortSignal): Promise<string>;
}
