export interface CachedChecksums {
  partialChecksum: string | null;
  fullChecksum: string | null;
}

/**
 * An optional, read-only accelerator: "has another tool already hashed this
 * exact file, unchanged?" (contracts/checksum-cache-port-contract.md).
 *
 * A miss is NEVER an answer about duplication (spec FR-017): the backing
 * table is a partial cache — the comparison tool's cascade routinely stops
 * at the partial checksum, and a file it never had a counterpart for may
 * have no checksum at all — so nulls mean "hash it", never "unique".
 */
export interface ChecksumCachePort {
  /**
   * Checksums another tool computed for `path`, but only if the facts it
   * recorded still match what this scan just observed. Any mismatch, missing
   * row, read-error flag or unavailable source returns nulls. Never throws.
   */
  getCachedChecksums(
    path: string,
    size: number,
    modificationTime: string,
  ): CachedChecksums;
}

/** What the port degrades to when no source database is available. */
export const noChecksumCache: ChecksumCachePort = {
  getCachedChecksums: () => ({ partialChecksum: null, fullChecksum: null }),
};
