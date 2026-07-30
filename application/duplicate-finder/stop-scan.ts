import type { ScanWorkerPort } from './scan-worker-port';

/**
 * Stops the running scan (spec FR-007). Stopping when nothing runs is a
 * no-op, not an error — the button may well be clicked just as a scan
 * finishes on its own.
 *
 * The pipeline itself decides what "stopped" means: it aborts the in-flight
 * read, still groups whatever checksums exist, and records the state as
 * `stopped` so the listing can label its results partial.
 */
export function stopScan(worker: ScanWorkerPort): void {
  worker.requestStop();
}
