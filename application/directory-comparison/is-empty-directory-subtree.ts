import type {
  ComparisonRepositoryPort,
  DirectoryComparisonNode,
} from './comparison-repository-port';

/**
 * True iff `node`'s entire subtree (per the last Pass 1 listing) contains no
 * files at any depth, every directory in it finished listing successfully,
 * and none has unreadable entries — i.e. we're confident it's genuinely
 * empty, not merely "not yet fully explored" or "partially unreadable".
 * Shared by `compare-subtree.ts` (Pass 2: an empty directory on only one
 * side shouldn't break the parent's checksum match) and
 * `get-comparison-view.ts` (read-time: shows `matching_empty` instead of
 * `only_left`/`only_right` for such a directory).
 */
export function isEmptyDirectorySubtree(
  node: DirectoryComparisonNode,
  comparisonRepository: ComparisonRepositoryPort,
): boolean {
  if (node.ownOutcome !== 'done' || node.hasUnreadableEntries) return false;

  const { directories, files } = comparisonRepository.getDirectChildren(
    node.path,
  );
  if (files.length > 0) return false;
  return directories.every((dir) =>
    isEmptyDirectorySubtree(dir, comparisonRepository),
  );
}
