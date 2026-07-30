import type { FileSystemPort } from '@/application/scanning/filesystem-port';
import { buildDuplicateResults } from './build-duplicate-results';
import { deriveFolderGroups } from './derive-folder-groups';
import { hashCandidates } from './hash-candidates';
import { listScanTree } from './list-scan-tree';
import type { ChecksumCachePort } from './checksum-cache-port';
import type { ChecksumPort } from './checksum-port';
import type { DuplicateRepositoryPort } from './duplicate-repository-port';

export interface RunDuplicateScanParams {
  rootPath: string;
  includeFolders: boolean;
  scanSeq: number;
  repository: DuplicateRepositoryPort;
  fileSystem: FileSystemPort;
  checksums: ChecksumPort;
  cache: ChecksumCachePort;
  partialThreshold: number;
  signal: AbortSignal;
}

/**
 * The scan pipeline (plan.md § Summary). The order is fixed:
 *
 *   list → hash → [derive folders, only when requested] → build results
 *
 * Folder derivation sits between hashing and grouping because it needs the
 * full checksums phase 4 produced, and grouping needs the directory
 * checksums it produces. Grouping is always last, and always runs — even
 * after a Stop — so a cancelled scan still leaves usable partial results
 * (spec FR-007, research.md Decision 13).
 *
 * Owns the terminal state transition: `finished`, `stopped` or `failed`.
 */
export async function runDuplicateScan(
  params: RunDuplicateScanParams,
): Promise<void> {
  const {
    rootPath,
    includeFolders,
    scanSeq,
    repository,
    fileSystem,
    checksums,
    cache,
    partialThreshold,
    signal,
  } = params;

  try {
    const ignoredPaths = repository.loadIgnoredPathSet();

    repository.updateProgress({ phase: 'listing', processed: 0, total: 0 });
    const listing = await listScanTree({
      rootPath,
      scanSeq,
      fileSystem,
      repository,
      ignoredPaths,
      signal,
    });

    let aborted = listing.aborted;

    if (!aborted) {
      repository.updateProgress({ phase: 'hashing' });
      const hashing = await hashCandidates({
        scanSeq,
        repository,
        checksums,
        cache,
        partialThreshold,
        ignoredPaths,
        signal,
      });
      aborted = hashing.aborted;
    }

    let foldersDerived = false;
    if (!aborted && includeFolders) {
      repository.updateProgress({ phase: 'deriving_folders' });
      const folders = deriveFolderGroups({
        scanSeq,
        repository,
        ignoredPaths,
        signal,
      });
      aborted = folders.aborted;
      foldersDerived = !folders.aborted;
    }

    repository.updateProgress({ phase: 'grouping', activePath: null });
    buildDuplicateResults({
      scanSeq,
      repository,
      ignoredPaths,
      includeFolders: includeFolders && foldersDerived,
    });

    repository.finishScan(aborted ? 'stopped' : 'finished');
  } catch (error) {
    repository.finishScan(
      'failed',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
