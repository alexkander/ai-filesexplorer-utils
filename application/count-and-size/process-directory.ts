import type { FileSystemPort } from '@/application/scanning/filesystem-port';
import type { ScanRepositoryPort } from './scan-repository-port';
import { traverseDirectory } from '@/application/scanning/traverse-directory';
import { getDepth } from '@/domain/scanning/path-info';
import type { ScanMode } from '@/domain/scanning/scan-stack';

export interface ProcessDirectoryResult {
  childPaths: string[];
}

/**
 * The scan engine's per-node step (spec FR-007, FR-015, FR-016): delegates
 * listing/filtering/child-selection to the shared `traverseDirectory`, sums
 * direct file count/size over the returned entries, records this node's own
 * outcome, and upserts a pending row for each subdirectory `traverseDirectory`
 * decided still needs visiting.
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
  for (const entry of outcome.result.entries) {
    if (entry.kind === 'file') {
      directFileCount += 1;
      directFileSize += entry.size;
    }
  }

  for (const childPath of outcome.result.childDirPaths) {
    scanRepository.upsertPending(childPath, path, getDepth(childPath));
  }

  scanRepository.recordOwnResult(path, {
    outcome: 'done',
    directFileCount,
    directFileSize,
    hasUnreadableEntries: outcome.result.hasUnreadableEntries,
  });

  return { childPaths: outcome.result.childDirPaths };
}
