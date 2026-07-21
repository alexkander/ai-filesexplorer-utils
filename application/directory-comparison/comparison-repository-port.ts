import type { ScanNodeStatus } from '@/domain/scanning/scan-node-status';

export interface DirectoryComparisonNode extends ScanNodeStatus {
  directoryChecksum: string | null;
  /** `true` once Pass 2 has concluded *something* for this directory pair at
   * least once (matching or differs) — added post-implementation to fix a
   * bug: `directoryChecksum === null` alone doesn't distinguish "genuinely
   * resolved as differing" from "never actually reached by Pass 2" (e.g.
   * cancelled by Stop, or simply not yet processed in a still-running
   * compare), so read-time derivation was showing a false `differs` for
   * entries that had never actually been compared. Sticky across Pass 1
   * relistings (preserves the last real Pass 2 conclusion, per FR-016's
   * "show precomputed status" precedent) — only reset to `false` by
   * `clearChecksumsInSubtree` (`mode: 'full'`) or when a brand-new row is
   * first created. */
  resolvedByPass2: boolean;
}

export interface FileChecksumEntry {
  path: string;
  size: number;
  modificationTime: string; // ISO 8601
  partialChecksum: string | null;
  fullChecksum: string | null;
  checksummedAt: string | null; // ISO 8601
  /** Set by `recordContentReadFailure(path)` when this specific file's
   * content couldn't be read during checksumming (FR-011) — distinct from a
   * sibling file's own status, unlike the directory-level
   * `hasUnreadableEntries` flag. Reset to `false` whenever the file is
   * relisted with a changed size/mtime (a fresh attempt deserves a fresh
   * chance). */
  hasReadError: boolean;
}

export interface ComparisonRepositoryPort {
  // Pass 1 (structural listing) — same shape/semantics as Count and Size's
  // ScanRepositoryPort.upsertPending/markStopped/findAllPendingPaths.
  upsertPendingDirectory(
    path: string,
    parentPath: string | null,
    depth: number,
  ): void;
  recordDirectoryOwnResult(
    path: string,
    result:
      { outcome: 'done'; hasUnreadableEntries: boolean } | { outcome: 'error' },
  ): void;
  upsertFileFacts(path: string, size: number, modificationTime: string): void; // resets checksums to null if size/mtime changed (research.md Decision 11)
  // Pass 1 only. Removes a file's row entirely — called for a
  // previously-listed child that no longer appears in a fresh listing (the
  // file was deleted/renamed since the last "Compare"), so it stops being a
  // phantom pairing candidate for Pass 2 (FR-008: relisting must actually
  // reflect current disk state, not just add to it).
  deleteFile(path: string): void;
  // Pass 1 only. Removes a directory's own row AND every descendant
  // directory/file row beneath it — same rationale as deleteFile, but for a
  // whole subdirectory that vanished (or was replaced by a file of the same
  // name) since the last "Compare".
  deleteDirectorySubtree(path: string): void;
  markStopped(paths: string[]): void;
  findAllPendingPaths(): string[];

  // Shared by Pass 1 and Pass 2, and by read-time comparison-view derivation.
  getSubtree(path: string): DirectoryComparisonNode[]; // self + descendants, self first
  // Cheap single-row lookup — used where only this exact path's own node is
  // needed (e.g. a pane's own header status), unlike getSubtree's full
  // recursive walk. `null` iff Pass 1 has never listed this exact path.
  getNode(path: string): DirectoryComparisonNode | null;
  getDirectChildren(path: string): {
    directories: DirectoryComparisonNode[];
    files: FileChecksumEntry[];
  };

  // Pass 2 only.
  recordChecksums(
    path: string,
    checksums: { partialChecksum?: string; fullChecksum?: string },
  ): void;
  // null clears a stale value (e.g. a child changed) — either way, marks
  // resolvedByPass2 = true, since this call itself IS the conclusion
  // (matching if checksum is set, differs if null).
  recordDirectoryChecksum(path: string, checksum: string | null): void;

  // Pass 2 only. Called with a FILE's own path: sets that file's
  // hasReadError. Called with a DIRECTORY's own path (propagating up the
  // ancestor chain, FR-011a): sets hasUnreadableEntries on that directory —
  // WITHOUT touching ownOutcome, which stays Pass-1-owned (research.md
  // Decision 3; found missing during /speckit-analyze review). A path is
  // never both a file and a directory, so one call always affects exactly
  // one row in exactly one of the two tables.
  recordContentReadFailure(path: string): void;

  // Pass 2 only, `mode: 'full'` (research.md Decision 11): clears every
  // cached checksum in both subtrees before Pass 2 re-derives them, and
  // resets resolvedByPass2 to false for every directory in the subtree (a
  // full re-compare means every entry genuinely goes back to not_compared
  // until Pass 2 concludes something fresh).
  clearChecksumsInSubtree(path: string): void;
  // Ignore list (spec: user request) — a path the user has explicitly
  // marked to skip during Compare (double-clicking its status dot).
  // Checked by both passes (Pass 1 skips listing an ignored directory's
  // children at all; Pass 2 excludes an ignored entry from its parent's
  // matching/Merkle rollup entirely, same treatment as an empty-on-one-
  // side directory) and by read-time derivation (overrides the entry's
  // status to `ignored` regardless of what comparison data exists).
  isIgnored(path: string): boolean;
  setIgnored(path: string, ignored: boolean): void;
  // Every currently-ignored path (spec: user request — a dedicated view
  // listing them all), most-recently-ignored first.
  listIgnoredPaths(): { path: string; ignoredAt: string }[];

  // Unreliable-size log (spec: user request) — Pass 1 calls this whenever a
  // file's filesystem-reported size was corrected from a false 0 (see
  // RawEntry.sizeWasCorrected), purely so the user can review which files
  // hit the quirk. Re-detecting an already-logged path refreshes its size
  // (in case the file's real content changed) without disturbing when it was
  // first detected. Never read by any comparison logic.
  recordUnreliableSizeFile(path: string, size: number): void;
  // User-triggered removal from the log (mirrors setIgnored's un-ignore) —
  // purely housekeeping, has no effect on Compare.
  clearUnreliableSizeFile(path: string): void;
  // Every currently-logged path, most-recently-detected first.
  listUnreliableSizeFiles(): {
    path: string;
    size: number;
    detectedAt: string;
  }[];
  // Cheap single-row lookup (mirrors isIgnored) — used by the directory
  // listing (spec: user request) to flag an individual file's row with a
  // "touched by Google's office suite" indicator, without fetching the
  // whole log just to check one path.
  isUnreliableSizeFile(path: string): boolean;

  // Pass 2 only, `mode: 'incremental'` cache-hit shortcut: `isCacheStillValid`
  // already confirmed (recursively) that every directory in this subtree has
  // a non-null checksum and every file/subdirectory under it is still fresh
  // — so the shortcut skips re-deriving anything, but every directory in the
  // subtree still needs resolvedByPass2 = true, or it stays stuck showing
  // not_compared forever (it was cached before resolvedByPass2 existed, or
  // before its own last real Pass 2 conclusion). Only touches rows that
  // already have a directory_checksum, matching isCacheStillValid's guard.
  markSubtreeResolved(path: string): void;
}
