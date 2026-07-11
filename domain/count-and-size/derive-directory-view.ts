import type { DirectoryScanNode } from './directory-scan-node';

export type DirectoryState =
  'not_scanned' | 'scanning' | 'completed' | 'error' | 'stopped';

export interface DirectoryView {
  state: DirectoryState;
  incomplete: boolean;
  aggregatedCount: number;
  aggregatedSize: number;
  lastScannedAt: string | null;
  hasUnreadableEntries: boolean;
}

const NOT_SCANNED_VIEW: DirectoryView = {
  state: 'not_scanned',
  incomplete: false,
  aggregatedCount: 0,
  aggregatedSize: 0,
  lastScannedAt: null,
  hasUnreadableEntries: false,
};

/**
 * Derives the user-facing DirectoryView for one directory from its own
 * persisted node plus every descendant node currently in the table
 * (data-model.md DirectoryView). Pure — no I/O, no persisted aggregates.
 */
export function deriveDirectoryView(
  node: DirectoryScanNode | null,
  descendantNodes: DirectoryScanNode[],
): DirectoryView {
  if (!node) return NOT_SCANNED_VIEW;

  const subtree = [node, ...descendantNodes];

  const state: DirectoryState = subtree.some((n) => n.ownOutcome === 'pending')
    ? 'scanning'
    : node.ownOutcome === 'error'
      ? 'error'
      : node.ownOutcome === 'stopped'
        ? 'stopped'
        : 'completed';

  const incomplete =
    state === 'completed' &&
    !subtree.every((n) => n.ownOutcome === 'done' && !n.hasUnreadableEntries);

  const aggregatedCount = subtree.reduce(
    (sum, n) => sum + n.directFileCount,
    0,
  );
  const aggregatedSize = subtree.reduce((sum, n) => sum + n.directFileSize, 0);

  const finishedTimestamps = subtree
    .map((n) => n.ownFinishedAt)
    .filter((t): t is string => t !== null);
  const lastScannedAt =
    finishedTimestamps.length === 0
      ? null
      : finishedTimestamps.reduce((max, t) => (t > max ? t : max));

  return {
    state,
    incomplete,
    aggregatedCount,
    aggregatedSize,
    lastScannedAt,
    hasUnreadableEntries: node.hasUnreadableEntries,
  };
}
