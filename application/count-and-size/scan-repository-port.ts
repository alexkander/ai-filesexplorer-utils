import type { DirectoryScanNode } from '@/domain/count-and-size/directory-scan-node';

export type OwnResult =
  | {
      outcome: 'done';
      directFileCount: number;
      directFileSize: number;
      hasUnreadableEntries: boolean;
    }
  | { outcome: 'error'; errorMessage: string };

export interface ScanRepositoryPort {
  /** Insert or fully overwrite the row for `path` as pending (spec FR-021). */
  upsertPending(path: string, parentPath: string | null, depth: number): void;

  /** Record the conclusion of this node's own direct-file scan step. */
  recordOwnResult(path: string, result: OwnResult): void;

  /** Mark a specific set of paths as stopped (FR-018, FR-019). */
  markStopped(paths: string[]): void;

  /** Startup reconciliation: paths still 'pending' from a prior process. */
  findAllPendingPaths(): string[];

  /** `path`'s own row (if any) plus every descendant row, self first. */
  getSubtree(path: string): DirectoryScanNode[];

  /** `path`'s direct child directory rows (not recursive) — used to detect
   * a previously-tracked subdirectory that no longer appears in a fresh
   * listing (deleted, renamed, or replaced by a file), so its row doesn't
   * linger forever. */
  getDirectChildren(path: string): DirectoryScanNode[];

  /** Removes `path`'s own row AND every descendant row beneath it — for a
   * subdirectory that vanished (or changed kind) since the last scan, so
   * it stops being reported as if it still existed. */
  deleteDirectorySubtree(path: string): void;
}
