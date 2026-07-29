import type { FileSystemPort } from '@/application/scanning/filesystem-port';
import { traverseDirectory } from '@/application/scanning/traverse-directory';
import { getDepth, getParentPath } from '@/domain/scanning/path-info';
import { isIgnored } from '@/domain/duplicate-finder/ignored-path-match';
import type {
  DuplicateRepositoryPort,
  FileFacts,
} from './duplicate-repository-port';

export interface ListScanTreeParams {
  rootPath: string;
  scanSeq: number;
  fileSystem: FileSystemPort;
  repository: DuplicateRepositoryPort;
  ignoredPaths: ReadonlySet<string>;
  signal: AbortSignal;
}

export interface ListScanTreeResult {
  fileCount: number;
  unreadableCount: number;
  aborted: boolean;
}

/**
 * Phase 1 of the scan (spec FR-011): walks the subtree and records every
 * file's size and modification time — no hashing at all. Reuses the shared
 * `traverseDirectory`, which already drops symlinks (never followed) and
 * unreadable entries, so this only adds what is specific to this feature:
 * the ignore list and the per-scan bookkeeping.
 *
 * Iterative rather than recursive: a deep tree would otherwise be one stack
 * overflow away from killing the server process.
 */
export async function listScanTree(
  params: ListScanTreeParams,
): Promise<ListScanTreeResult> {
  const { rootPath, scanSeq, fileSystem, repository, ignoredPaths, signal } =
    params;

  let fileCount = 0;
  let unreadableCount = 0;
  const stack: string[] = [rootPath];

  while (stack.length > 0) {
    if (signal.aborted) {
      return { fileCount, unreadableCount, aborted: true };
    }

    const currentPath = stack.pop()!;
    repository.updateProgress({ activePath: currentPath });

    const outcome = await traverseDirectory(currentPath, fileSystem, 'full');
    if (!outcome.ok) {
      // The directory itself could not be listed. Its own row still gets
      // written, flagged — a directory whose content is unknown can never be
      // a duplicate candidate (research.md Decision 4).
      unreadableCount += 1;
      repository.upsertDirectory(
        {
          path: currentPath,
          parentPath:
            currentPath === rootPath ? null : getParentPath(currentPath),
          depth: getDepth(currentPath),
          hasIncompleteContent: true,
        },
        scanSeq,
      );
      repository.updateProgress({ unreadableCount });
      continue;
    }

    const { entries, hasUnreadableEntries } = outcome.result;
    if (hasUnreadableEntries) unreadableCount += 1;

    const files: FileFacts[] = [];
    let ignoredHere = 0;

    for (const entry of entries) {
      if (isIgnored(entry.path, ignoredPaths)) {
        ignoredHere += 1;
        continue;
      }
      if (entry.kind === 'file') {
        files.push({
          path: entry.path,
          parentPath: currentPath,
          size: entry.size,
          // `modificationTime` is only undefined for kinds this branch has
          // already excluded, but the fallback keeps the column NOT NULL
          // honest rather than trusting that invariant silently.
          modificationTime: entry.modificationTime ?? '',
        });
      } else if (entry.kind === 'directory') {
        stack.push(entry.path);
      }
    }

    if (files.length > 0) {
      repository.upsertFileFacts(files, scanSeq);
      fileCount += files.length;
    }

    repository.upsertDirectory(
      {
        path: currentPath,
        parentPath:
          currentPath === rootPath ? null : getParentPath(currentPath),
        depth: getDepth(currentPath),
        // An ignored child is not "unreadable", but it does mean this
        // directory's recorded content is not its real content — deriving a
        // Merkle checksum from it would claim an equality that does not hold
        // (a twin directory without that ignored child would hash the same).
        hasIncompleteContent: hasUnreadableEntries || ignoredHere > 0,
      },
      scanSeq,
    );

    repository.updateProgress({
      processed: fileCount,
      total: fileCount,
      unreadableCount,
    });
  }

  return { fileCount, unreadableCount, aborted: false };
}
