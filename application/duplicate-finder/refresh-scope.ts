import type { FileSystemPort } from '@/application/scanning/filesystem-port';
import {
  getName,
  getParentPath,
  isWithinSubtree,
} from '@/domain/scanning/path-info';
import { normalizeScanPath } from '@/domain/duplicate-finder/normalize-path';
import { isIgnored } from '@/domain/duplicate-finder/ignored-path-match';
import { buildDuplicateResults } from './build-duplicate-results';
import { deriveFolderGroups } from './derive-folder-groups';
import { hashCandidates } from './hash-candidates';
import { listScanTree } from './list-scan-tree';
import type { ChecksumCachePort } from './checksum-cache-port';
import type { ChecksumPort } from './checksum-port';
import type {
  DuplicateRepositoryPort,
  FileFacts,
} from './duplicate-repository-port';

export type RefreshRefusal =
  'no_scan' | 'outside_scan' | 'scan_running' | 'ignored';

export type RefreshScopeOutcome =
  | { outcome: 'started'; scopePath: string }
  | { outcome: 'refused'; reason: RefreshRefusal };

export interface RefreshScopeParams {
  scopePath: string;
  repository: DuplicateRepositoryPort;
  fileSystem: FileSystemPort;
  checksums: ChecksumPort;
  cache: ChecksumCachePort;
  partialThreshold: number;
  signal: AbortSignal;
}

/**
 * Re-scans one section of an existing result set (spec FR-045): a directory's
 * subtree, or a single file, without touching the rest.
 *
 * Deliberately does NOT bump `scan_seq` — that is what scopes the current
 * results, and a refresh is supposed to preserve them. What it does:
 *
 * 1. Re-walks the scope, refreshing sizes and modification times. The upsert
 *    nulls a checksum whose facts changed, which is what marks the file as
 *    needing to be read again; unchanged files keep theirs.
 * 2. Forgets files that were recorded under the scope but are no longer on
 *    disk.
 * 3. Re-hashes — globally, but that only reads the files whose checksums were
 *    just nulled or that are new. Everything else is a cache hit.
 * 4. Re-derives folder checksums (when the scan asked for them) and re-groups.
 *
 * Steps 3 and 4 are global on purpose, and it is the whole reason this is not
 * "just re-scan that folder": whether a file is a duplicate depends on the
 * entire tree, not on its own directory. A file that changed here may now
 * match something on the other side of the scan, and the copy it used to match
 * may be left with no partner at all. Both facts only fall out of grouping the
 * whole set — which is pure SQL over checksums that already exist, so it costs
 * a fraction of the walk.
 */
export async function refreshScope(params: RefreshScopeParams): Promise<void> {
  const { repository, fileSystem, checksums, cache, partialThreshold, signal } =
    params;
  const scopePath = normalizeScanPath(params.scopePath);

  try {
    const state = repository.getScanState();
    const scanSeq = state.scanSeq;
    const scanRootPath = state.rootPath
      ? normalizeScanPath(state.rootPath)
      : null;
    if (!scanRootPath) return;

    const ignoredPaths = repository.loadIgnoredPathSet();
    const recordedBefore = repository.listFilePathsUnder(scopePath);

    // A file scope has no subtree to walk: re-stat it through its parent's
    // listing, which is the only read the shared port offers, and pick out the
    // one entry. A directory scope goes through the normal walk.
    const kindIsFile = recordedBefore.includes(scopePath);
    let visited: string[] = [];

    if (kindIsFile) {
      repository.updateProgress({ phase: 'listing', activePath: scopePath });
      const parentPath = getParentPath(scopePath) ?? scanRootPath;
      const outcome = await fileSystem.listChildren(parentPath);
      if (outcome.ok) {
        const name = getName(scopePath);
        const entry = outcome.result.entries.find(
          (candidate) => candidate.kind === 'file' && candidate.name === name,
        );
        if (entry && !isIgnored(entry.path, ignoredPaths)) {
          const facts: FileFacts = {
            path: entry.path,
            parentPath,
            size: entry.size,
            modificationTime: entry.modificationTime ?? '',
          };
          repository.upsertFileFacts([facts], scanSeq);
          visited = [entry.path];
        }
      }
    } else {
      repository.updateProgress({ phase: 'listing', processed: 0, total: 0 });
      const listing = await listScanTree({
        rootPath: scopePath,
        scanRootPath,
        scanSeq,
        fileSystem,
        repository,
        ignoredPaths,
        signal,
      });
      visited = listing.visitedFiles;
      if (listing.aborted) {
        repository.finishScan('stopped');
        return;
      }
    }

    // Anything recorded under the scope that the walk did not see is gone
    // from disk (or newly ignored), so it must stop being a duplicate.
    const seen = new Set(visited);
    const vanished = recordedBefore.filter((path) => !seen.has(path));
    if (vanished.length > 0) repository.deleteScannedPaths(vanished);

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

    let foldersDerived = false;
    if (!hashing.aborted && state.includeFolders) {
      repository.updateProgress({ phase: 'deriving_folders' });
      const folders = deriveFolderGroups({
        scanSeq,
        repository,
        ignoredPaths,
        signal,
      });
      foldersDerived = !folders.aborted;
    }

    repository.updateProgress({ phase: 'grouping', activePath: null });
    buildDuplicateResults({
      scanSeq,
      repository,
      ignoredPaths,
      includeFolders: state.includeFolders && foldersDerived,
    });

    repository.finishScan(hashing.aborted ? 'stopped' : 'finished');
  } catch (error) {
    repository.finishScan(
      'failed',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}

/** Validation for the request, mirroring `start-scan`'s discriminated shape. */
export function checkRefreshScope(
  repository: DuplicateRepositoryPort,
  rawPath: string,
): RefreshScopeOutcome {
  const scopePath = normalizeScanPath(rawPath);
  const state = repository.getScanState();

  if (state.state === 'running') {
    return { outcome: 'refused', reason: 'scan_running' };
  }
  if (!state.rootPath) return { outcome: 'refused', reason: 'no_scan' };
  if (!isWithinSubtree(scopePath, normalizeScanPath(state.rootPath))) {
    return { outcome: 'refused', reason: 'outside_scan' };
  }
  if (isIgnored(scopePath, repository.loadIgnoredPathSet())) {
    return { outcome: 'refused', reason: 'ignored' };
  }
  return { outcome: 'started', scopePath };
}
