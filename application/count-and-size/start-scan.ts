import type { ScanRepositoryPort } from './scan-repository-port';
import type { ScanSchedulerPort } from './scan-scheduler-port';
import { getParentPath, getDepth } from '@/domain/count-and-size/path-info';

/** Starts (or restarts — spec FR-021) a scan rooted at `path` (spec FR-006). */
export function startScan(
  path: string,
  scanRepository: ScanRepositoryPort,
  scheduler: ScanSchedulerPort,
): void {
  scanRepository.upsertPending(path, getParentPath(path), getDepth(path));
  scheduler.enqueue(path);
}
