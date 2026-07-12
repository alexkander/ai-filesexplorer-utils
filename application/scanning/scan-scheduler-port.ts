import type { ScanMode } from '@/domain/scanning/scan-stack';

/**
 * Lets application-layer use cases trigger/stop the background scan worker
 * without depending on infrastructure directly (Constitution Principle II).
 */
export interface ScanSchedulerPort {
  /** Push `path` onto the pending stack; its row must already exist
   * (ScanRepositoryPort.upsertPending) before calling this. `doneSet` is
   * only meaningful for `mode: 'incremental'` (research.md Decision 10). */
  enqueue(path: string, mode: ScanMode, doneSet?: ReadonlySet<string>): void;
  /**
   * Stops every in-flight/queued path that is `rootPath` itself or a
   * descendant of it — scoped to the subtree the caller cares about, not
   * merely whichever single node happens to be executing at this instant
   * (a scan tree can have thousands of independent siblings still queued).
   * The caller is still responsible for marking affected rows `stopped` in
   * the repository (via `getSubtree(rootPath)` filtered to `'pending'`) —
   * this only stops the worker from doing further work on them.
   */
  requestStop(rootPath: string): void;
  getActivePath(): string | null;
}
