/**
 * The background scan runner, as the use cases see it. Keeps `start-scan`
 * and `stop-scan` free of any knowledge of how the worker is implemented
 * (a module-level singleton holding an `AbortController` — research.md
 * Decision 2) and of the adapters it injects into the pipeline.
 */
export interface ScanWorkerPort {
  /** Begins a run and returns its `scan_seq`. The caller has already
   * established that no other scan is in flight (spec FR-008). */
  start(rootPath: string, includeFolders: boolean): number;
  /** Aborts the in-flight read and lets the pipeline finish as `stopped`.
   * A no-op when nothing is running. */
  requestStop(): void;
}
