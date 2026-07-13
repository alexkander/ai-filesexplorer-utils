import type { ScanRepositoryPort } from './scan-repository-port';
import type { ScanSchedulerPort } from '@/application/scanning/scan-scheduler-port';
import { getParentPath, getDepth } from '@/domain/scanning/path-info';
import { deriveDoneSet } from '@/domain/scanning/derive-done-set';
import type { ScanMode } from '@/domain/scanning/scan-stack';

/**
 * Starts a scan rooted at `path` (spec FR-006). `mode: 'incremental'`
 * (default, spec FR-021) skips DESCENDANT subtree paths already Completed
 * and not incomplete, via a done-set derived fresh from persisted state on
 * every call (research.md Decision 10) — but always re-visits `path` itself
 * at least once, regardless of whether it was already done. Without that,
 * a "Scan" click on an already-fully-scanned directory did nothing at all —
 * not even a single fresh `readdir` of it — so it could never notice a
 * sibling added or removed since the last scan (found post-implementation,
 * user request: an incremental scan must still be able to detect deletions,
 * which requires actually re-listing at least the requested root). `mode:
 * 'full'` (spec FR-021a) always rescans the entire subtree from scratch,
 * overwriting prior results.
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
  scanRepository.upsertPending(path, getParentPath(path), getDepth(path));
  scheduler.enqueue(path, 'incremental', doneSet);
}
