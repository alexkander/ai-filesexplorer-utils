import type { ComparisonRepositoryPort } from './comparison-repository-port';
import type { ScanSchedulerPort } from '@/application/scanning/scan-scheduler-port';

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
  const pass2WasActive =
    comparisonPassWorker.getActivePair()?.leftRoot === leftPath &&
    comparisonPassWorker.getActivePair()?.rightRoot === rightPath;

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
