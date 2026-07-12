import type { ScanRepositoryPort } from './scan-repository-port';
import type { ScanSchedulerPort } from '@/application/scanning/scan-scheduler-port';

/**
 * Stops the scan rooted at `path` — every node in its subtree that hasn't
 * yet reached a terminal outcome (including the one currently executing, if
 * any) transitions to Stopped (spec FR-018). No-op if nothing in that
 * subtree is currently pending.
 */
export function stopScan(
  path: string,
  scanRepository: ScanRepositoryPort,
  scheduler: ScanSchedulerPort,
): { stopped: boolean } {
  scheduler.requestStop(path);

  const pendingPaths = scanRepository
    .getSubtree(path)
    .filter((node) => node.ownOutcome === 'pending')
    .map((node) => node.path);

  if (pendingPaths.length === 0) return { stopped: false };

  scanRepository.markStopped(pendingPaths);
  return { stopped: true };
}
