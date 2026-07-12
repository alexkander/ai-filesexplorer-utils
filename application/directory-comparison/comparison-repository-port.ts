import type { ScanNodeStatus } from '@/domain/scanning/scan-node-status';

export interface DirectoryComparisonNode extends ScanNodeStatus {
  directoryChecksum: string | null;
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
  getDirectChildren(path: string): {
    directories: DirectoryComparisonNode[];
    files: FileChecksumEntry[];
  };

  // Pass 2 only.
  recordChecksums(
    path: string,
    checksums: { partialChecksum?: string; fullChecksum?: string },
  ): void;
  recordDirectoryChecksum(path: string, checksum: string | null): void; // null clears a stale value (e.g. a child changed)

  // Pass 2 only. Called with a FILE's own path: sets that file's
  // hasReadError. Called with a DIRECTORY's own path (propagating up the
  // ancestor chain, FR-011a): sets hasUnreadableEntries on that directory —
  // WITHOUT touching ownOutcome, which stays Pass-1-owned (research.md
  // Decision 3; found missing during /speckit-analyze review). A path is
  // never both a file and a directory, so one call always affects exactly
  // one row in exactly one of the two tables.
  recordContentReadFailure(path: string): void;

  // Pass 2 only, `mode: 'full'` (research.md Decision 11): clears every
  // cached checksum in both subtrees before Pass 2 re-derives them.
  clearChecksumsInSubtree(path: string): void;
}
