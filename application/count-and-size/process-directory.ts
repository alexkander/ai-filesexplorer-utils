import type { FileSystemPort } from './filesystem-port';
import type { ScanRepositoryPort } from './scan-repository-port';
import { shouldIgnoreEntry } from '@/domain/count-and-size/should-ignore-entry';
import { getDepth } from '@/domain/count-and-size/path-info';

export interface ProcessDirectoryResult {
  childPaths: string[];
}

/**
 * The scan worker's per-node step (spec FR-007, FR-015, FR-016): scans
 * `path`'s direct children, ignoring symlinks/unreadable entries, sums
 * direct file count/size, records this node's own outcome, and enqueues a
 * pending row for each subdirectory.
 */
export async function processDirectory(
  path: string,
  fileSystem: FileSystemPort,
  scanRepository: ScanRepositoryPort,
): Promise<ProcessDirectoryResult> {
  const outcome = await fileSystem.listChildren(path);

  if (!outcome.ok) {
    scanRepository.recordOwnResult(path, {
      outcome: 'error',
      errorMessage: 'Directory could not be read',
    });
    return { childPaths: [] };
  }

  let directFileCount = 0;
  let directFileSize = 0;
  let hasUnreadableEntries = false;
  const childPaths: string[] = [];

  for (const entry of outcome.result.entries) {
    const decision = shouldIgnoreEntry(entry);
    if (decision.ignore) {
      if (decision.reason === 'unreadable') hasUnreadableEntries = true;
      continue;
    }

    if (entry.kind === 'file') {
      directFileCount += 1;
      directFileSize += entry.size;
    } else if (entry.kind === 'directory') {
      scanRepository.upsertPending(entry.path, path, getDepth(entry.path));
      childPaths.push(entry.path);
    }
  }

  scanRepository.recordOwnResult(path, {
    outcome: 'done',
    directFileCount,
    directFileSize,
    hasUnreadableEntries,
  });

  return { childPaths };
}
