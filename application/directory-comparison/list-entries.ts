import type { FileSystemPort } from '@/application/scanning/filesystem-port';
import type { ComparisonRepositoryPort } from './comparison-repository-port';
import { traverseDirectory } from '@/application/scanning/traverse-directory';
import { getDepth } from '@/domain/scanning/path-info';
import type { ScanMode } from '@/domain/scanning/scan-stack';

export interface ListEntriesResult {
  childPaths: string[];
}

/**
 * Pass 1's per-node step (research.md Decision 2): delegates
 * listing/filtering/child-selection to the shared `traverseDirectory`, then
 * persists each direct file's size/modification time (no hashing — Pass 2's
 * job) and a pending row for each subdirectory, and records this node's own
 * outcome. Always relists unconditionally — `structural-scan-worker.ts`
 * always calls this with `mode: 'full'` and no `doneSet`, so
 * `traverseDirectory` never skips a subdirectory here; the incremental/full
 * distinction is entirely Pass 2's concern (research.md Decision 11).
 *
 * Also prunes any previously-tracked child (file or subdirectory) that no
 * longer appears in the fresh listing, or whose kind changed — otherwise a
 * deleted/renamed entry would linger as a phantom row that Pass 2 keeps
 * pairing against, producing stale comparison results (FR-008 requires
 * relisting to reflect current disk state, not just accumulate onto it).
 */
export async function listEntries(
  path: string,
  fileSystem: FileSystemPort,
  comparisonRepository: ComparisonRepositoryPort,
  mode: ScanMode,
  doneSet?: ReadonlySet<string>,
): Promise<ListEntriesResult> {
  // Ignored (spec: user request): skip listing this directory's children
  // entirely — the whole point of marking something ignored is to spend no
  // scan time on it, not just to hide it cosmetically. Recorded as 'done'
  // with no unreadable entries so it doesn't linger as perpetually
  // "not_compared"/pending from Pass 1's own bookkeeping perspective,
  // though get-comparison-view.ts's `ignored` status override means this
  // outcome is never actually read for display purposes either way.
  if (comparisonRepository.isIgnored(path)) {
    comparisonRepository.recordDirectoryOwnResult(path, {
      outcome: 'done',
      hasUnreadableEntries: false,
    });
    return { childPaths: [] };
  }

  const outcome = await traverseDirectory(path, fileSystem, mode, doneSet);

  if (!outcome.ok) {
    comparisonRepository.recordDirectoryOwnResult(path, { outcome: 'error' });
    return { childPaths: [] };
  }

  const currentKindByPath = new Map(
    outcome.result.entries.map((e) => [e.path, e.kind]),
  );
  const previouslyKnown = comparisonRepository.getDirectChildren(path);
  for (const file of previouslyKnown.files) {
    if (currentKindByPath.get(file.path) !== 'file') {
      comparisonRepository.deleteFile(file.path);
    }
  }
  for (const dir of previouslyKnown.directories) {
    if (currentKindByPath.get(dir.path) !== 'directory') {
      comparisonRepository.deleteDirectorySubtree(dir.path);
    }
  }

  for (const entry of outcome.result.entries) {
    if (entry.kind === 'file') {
      comparisonRepository.upsertFileFacts(
        entry.path,
        entry.size,
        entry.modificationTime ?? new Date(0).toISOString(),
      );
    }
  }

  for (const childPath of outcome.result.childDirPaths) {
    comparisonRepository.upsertPendingDirectory(
      childPath,
      path,
      getDepth(childPath),
    );
  }

  comparisonRepository.recordDirectoryOwnResult(path, {
    outcome: 'done',
    hasUnreadableEntries: outcome.result.hasUnreadableEntries,
  });

  return { childPaths: outcome.result.childDirPaths };
}
