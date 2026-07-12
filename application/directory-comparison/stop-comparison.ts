import type { ComparisonRepositoryPort } from './comparison-repository-port';
import type { ScanSchedulerPort } from '@/application/scanning/scan-scheduler-port';
import { isWithinSubtree } from '@/domain/scanning/path-info';

export interface ComparisonPassStopPort {
  requestStop(leftRoot: string, rightRoot: string): void;
  getActivePair(): { leftRoot: string; rightRoot: string } | null;
}

/**
 * Stops whichever pass (structural or comparison) is currently active for
 * this pair's roots (spec FR-013) — already-computed results are kept.
 * Mirrors Count and Size's stop-scan.ts.
 */
export function stopComparison(
  leftPath: string,
  rightPath: string,
  comparisonRepository: ComparisonRepositoryPort,
  structuralScheduler: ScanSchedulerPort,
  comparisonPassWorker: ComparisonPassStopPort,
): { stopped: boolean } {
  // Either side qualifying is enough — matches comparisonPassWorker's own
  // requestStop logic and get-comparison-view.ts's Stop-button visibility
  // check (both use the same "is the active root within what's being
  // stopped" test), not an exact-match requirement.
  const activePair = comparisonPassWorker.getActivePair();
  const pass2WasActive =
    activePair !== null &&
    (isWithinSubtree(activePair.leftRoot, leftPath) ||
      isWithinSubtree(activePair.rightRoot, rightPath));

  structuralScheduler.requestStop(leftPath);
  structuralScheduler.requestStop(rightPath);
  comparisonPassWorker.requestStop(leftPath, rightPath);

  const leftPending = comparisonRepository
    .getSubtree(leftPath)
    .filter((n) => n.ownOutcome === 'pending')
    .map((n) => n.path);
  const rightPending =
    rightPath === leftPath
      ? []
      : comparisonRepository
          .getSubtree(rightPath)
          .filter((n) => n.ownOutcome === 'pending')
          .map((n) => n.path);
  const pendingPaths = [...leftPending, ...rightPending];

  if (pendingPaths.length > 0) comparisonRepository.markStopped(pendingPaths);

  return { stopped: pendingPaths.length > 0 || pass2WasActive };
}
