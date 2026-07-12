export interface SizeInfo {
  fileCount: number;
  totalSize: number;
  /** `true` if any directory in the subtree Count and Size measured hasn't
   * finished successfully (still scanning, errored, stopped, or has
   * unreadable entries) — mirrors that tool's own "incomplete" flag, shown
   * so this read-only overlay doesn't present a partial count as final. */
  incomplete: boolean;
}

/**
 * Read-only lookup of a directory's aggregated file count/size, as already
 * measured by the separate Count and Size tool (spec FR-019, user request).
 * Entirely optional — `null` means Count and Size has never scanned this
 * exact path (or its database doesn't exist at all), not an error.
 */
export interface SizeInfoPort {
  getSizeInfo(path: string): SizeInfo | null;
}
