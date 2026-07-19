import type {
  ComparisonRepositoryPort,
  DirectoryComparisonNode,
} from './comparison-repository-port';
import {
  pairEntriesByName,
  type PairableEntry,
} from '@/domain/directory-comparison/entry-comparison-result';
import { getName, joinChildPath } from '@/domain/scanning/path-info';

/**
 * Counts how many file pairs (same name, present as a file on both sides)
 * exist anywhere in leftNode/rightNode's already Pass-1-listed subtrees —
 * exactly the set `compare-subtree.ts`'s per-pair loop will call
 * `compareFilePair` for, so this doubles as the "total" a progress counter
 * compares against (spec: user request — "123 of 4,322" next to the
 * active-path display). Mirrors that loop's own skip conditions (ignored
 * pairs, mismatched kinds) so the total only ever counts pairs that will
 * actually be resolved — otherwise a progress counter built from it could
 * get permanently stuck short of 100%. Pure read against whatever Pass 1
 * has already persisted; no I/O of its own, no hashing.
 */
export function countFilePairs(
  leftNode: DirectoryComparisonNode,
  rightNode: DirectoryComparisonNode,
  comparisonRepository: ComparisonRepositoryPort,
): number {
  const leftChildren = comparisonRepository.getDirectChildren(leftNode.path);
  const rightChildren = comparisonRepository.getDirectChildren(rightNode.path);

  const leftDirsByName = new Map(
    leftChildren.directories.map((d) => [getName(d.path), d]),
  );
  const rightDirsByName = new Map(
    rightChildren.directories.map((d) => [getName(d.path), d]),
  );

  const leftEntries: PairableEntry[] = [
    ...leftChildren.directories.map((d) => ({
      name: getName(d.path),
      kind: 'directory' as const,
    })),
    ...leftChildren.files.map((f) => ({
      name: getName(f.path),
      kind: 'file' as const,
    })),
  ];
  const rightEntries: PairableEntry[] = [
    ...rightChildren.directories.map((d) => ({
      name: getName(d.path),
      kind: 'directory' as const,
    })),
    ...rightChildren.files.map((f) => ({
      name: getName(f.path),
      kind: 'file' as const,
    })),
  ];
  const pairs = pairEntriesByName(leftEntries, rightEntries);

  let count = 0;
  for (const pair of pairs) {
    if (!pair.left || !pair.right || pair.left.kind !== pair.right.kind) {
      continue;
    }

    const leftChildIgnored = comparisonRepository.isIgnored(
      joinChildPath(leftNode.path, pair.name),
    );
    const rightChildIgnored = comparisonRepository.isIgnored(
      joinChildPath(rightNode.path, pair.name),
    );
    if (leftChildIgnored || rightChildIgnored) continue;

    if (pair.left.kind === 'file') {
      count += 1;
      continue;
    }

    const childLeft = leftDirsByName.get(pair.name);
    const childRight = rightDirsByName.get(pair.name);
    if (childLeft && childRight) {
      count += countFilePairs(childLeft, childRight, comparisonRepository);
    }
  }
  return count;
}
