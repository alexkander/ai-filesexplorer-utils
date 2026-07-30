export type DeletionTargetKind =
  'regular_file' | 'symlink' | 'directory' | 'missing' | 'unreadable';

/**
 * The only port in this feature allowed to change the filesystem, and the
 * narrowest one that can do the job: describe a path, or move one file into
 * the trash area.
 *
 * `describeTarget` MUST NOT follow symlinks (`lstat`, not `stat`): a symlink
 * pointing at a duplicate is not the duplicate, and moving through one would
 * take the target instead of the link — possibly something outside the
 * scanned tree entirely.
 */
export interface FileDeletionPort {
  describeTarget(path: string): Promise<DeletionTargetKind>;
  /**
   * Moves one file to `destination`, creating the parent directories it
   * needs. Never overwrites: if something is already there, a suffix is
   * added and the path actually used is returned.
   *
   * Nothing is ever unlinked outright — a "deleted" duplicate stays on disk
   * under the trash root, which is what makes the operation recoverable.
   */
  moveToTrash(path: string, destination: string): Promise<string>;
}
