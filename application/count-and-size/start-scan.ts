import type { ScanRepositoryPort } from './scan-repository-port';
import type { ScanSchedulerPort } from '@/application/scanning/scan-scheduler-port';
import { getParentPath, getDepth } from '@/domain/scanning/path-info';
import { deriveDoneSet } from '@/domain/scanning/derive-done-set';
import type { ScanMode } from '@/domain/scanning/scan-stack';

/**
 * Starts a scan rooted at `path` (spec FR-006). `mode: 'incremental'`
 * (default, spec FR-021) skips subtree paths already Completed and not
 * incomplete, via a done-set derived fresh from persisted state on every
 * call (research.md Decision 10). `mode: 'full'` (spec FR-021a) always
 * rescans the entire subtree from scratch, overwriting prior results.
 */
export function startScan(
  path: string,
  scanRepository: ScanRepositoryPort,
  scheduler: ScanSchedulerPort,
  mode: ScanMode = 'incremental',
): void {
  if (mode === 'full') {
    scanRepository.upsertPending(path, getParentPath(path), getDepth(path));
    scheduler.enqueue(path, 'full');
    return;
  }

  const doneSet = deriveDoneSet(scanRepository.getSubtree(path));
  if (doneSet.has(path)) return; // nothing outstanding in this subtree

  scanRepository.upsertPending(path, getParentPath(path), getDepth(path));
  scheduler.enqueue(path, 'incremental', doneSet);
}
