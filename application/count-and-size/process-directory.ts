import type { FileSystemPort } from '@/application/scanning/filesystem-port';
import type { ScanRepositoryPort } from './scan-repository-port';
import { traverseDirectory } from '@/application/scanning/traverse-directory';
import { getDepth } from '@/domain/scanning/path-info';
import type { ScanMode } from '@/domain/scanning/scan-stack';

export interface ProcessDirectoryResult {
  childPaths: string[];
}

/**
 * Confirms every already-known descendant of `skippedRoot` (a subdirectory
 * `traverseDirectory` excluded from this visit's `childDirPaths` because
 * `doneSet` already considered its whole subtree finished) still exists —
 * one cheap `pathExists` stat per previously-known row, no directory reads.
 * `skippedRoot` itself is skipped in the loop: the live listing that
 * discovered it (in the caller) already proves it's still there.
 *
 * This is deliberately NOT a full re-walk (that would defeat the entire
 * point of `doneSet` skipping it) — it only catches "something inside this
 * already-known subtree was deleted", not newly added content, which stays
 * deferred to whenever this subtree is next actually rescanned, same as
 * today (user request: detect deletions without giving up the incremental
 * skip's performance benefit).
 */
async function pruneDeletedDescendants(
  skippedRoot: string,
  fileSystem: FileSystemPort,
  scanRepository: ScanRepositoryPort,
): Promise<void> {
  const subtree = scanRepository.getSubtree(skippedRoot);
  for (const node of subtree) {
    if (node.path === skippedRoot) continue;
    if (!(await fileSystem.pathExists(node.path))) {
      scanRepository.deleteDirectorySubtree(node.path);
    }
  }
}

/**
 * The scan engine's per-node step (spec FR-007, FR-015, FR-016): delegates
 * listing/filtering/child-selection to the shared `traverseDirectory`, sums
 * direct file count/size over the returned entries, records this node's own
 * outcome, and upserts a pending row for each subdirectory `traverseDirectory`
 * decided still needs visiting.
 *
 * Also prunes stale state two ways (user request — nothing here deleted
 * rows before, so a removed subdirectory lingered in the database forever,
 * in every mode): any previously-tracked direct child that no longer
 * appears as a directory in this fresh listing (deleted, renamed, or
 * replaced by a file) is removed outright; and, in incremental mode, any
 * child directory skipped here specifically because it was already fully
 * done gets its own already-known descendants existence-checked (see
 * `pruneDeletedDescendants`) instead of going untouched indefinitely.
 */
export async function processDirectory(
  path: string,
  fileSystem: FileSystemPort,
  scanRepository: ScanRepositoryPort,
  mode: ScanMode,
  doneSet?: ReadonlySet<string>,
): Promise<ProcessDirectoryResult> {
  const outcome = await traverseDirectory(path, fileSystem, mode, doneSet);

  if (!outcome.ok) {
    scanRepository.recordOwnResult(path, {
      outcome: 'error',
      errorMessage: 'Directory could not be read',
    });
    return { childPaths: [] };
  }

  let directFileCount = 0;
  let directFileSize = 0;
  const currentDirPaths = new Set<string>();
  for (const entry of outcome.result.entries) {
    if (entry.kind === 'file') {
      directFileCount += 1;
      directFileSize += entry.size;
    } else if (entry.kind === 'directory') {
      currentDirPaths.add(entry.path);
    }
  }

  for (const child of scanRepository.getDirectChildren(path)) {
    if (!currentDirPaths.has(child.path)) {
      scanRepository.deleteDirectorySubtree(child.path);
    }
  }

  const childDirSet = new Set(outcome.result.childDirPaths);
  for (const childPath of outcome.result.childDirPaths) {
    scanRepository.upsertPending(childPath, path, getDepth(childPath));
  }

  if (mode === 'incremental') {
    for (const dirPath of currentDirPaths) {
      if (!childDirSet.has(dirPath)) {
        await pruneDeletedDescendants(dirPath, fileSystem, scanRepository);
      }
    }
  }

  scanRepository.recordOwnResult(path, {
    outcome: 'done',
    directFileCount,
    directFileSize,
    hasUnreadableEntries: outcome.result.hasUnreadableEntries,
  });

  return { childPaths: outcome.result.childDirPaths };
}
