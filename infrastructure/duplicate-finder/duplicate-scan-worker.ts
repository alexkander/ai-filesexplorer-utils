import { refreshScope } from '@/application/duplicate-finder/refresh-scope';
import { runDuplicateScan } from '@/application/duplicate-finder/run-duplicate-scan';
import type { ScanWorkerPort } from '@/application/duplicate-finder/scan-worker-port';
import { filesystemAdapter } from '@/infrastructure/scanning/filesystem-adapter';
import { checksumAdapter, PARTIAL_CHECKSUM_BYTES } from './checksum-adapter';
import { comparisonChecksumReadonlyAdapter } from './comparison-checksum-readonly-adapter';
import { duplicateRepositoryAdapter } from './duplicate-repository-adapter';

/**
 * Module-level singleton owning the one scan this tool can have in flight
 * (spec FR-008) — the same shape as the comparison tool's own workers, and
 * deliberately not another `ScanEngine`: that engine models a resumable
 * forest of per-directory scans, while this is a single linear pipeline over
 * one root whose later phases have no per-directory unit of work at all
 * (research.md Decision 2).
 *
 * "Is a scan running?" is answered by the persisted `scan_state`, not by an
 * in-memory flag, so the answer survives a restart. The only in-memory state
 * is the `AbortController`, which by definition cannot outlive its process —
 * hence the reconciliation below.
 */
class DuplicateScanWorker implements ScanWorkerPort {
  private abortController: AbortController | null = null;

  constructor() {
    // A row left `running` belongs to a process that no longer exists.
    // Nothing is ever auto-resumed — it is marked `stopped` so the user sees
    // what happened instead of a scan that appears to be progressing with
    // nothing behind it (research.md Decision 3).
    duplicateRepositoryAdapter.reconcileInterruptedScan();
    // Heals results written before the pipeline knew about the ignore list:
    // filtering at read time left them stored, and therefore still counted in
    // every ancestor's totals and still listed by the Duplicates tab.
    duplicateRepositoryAdapter.pruneIgnoredFromResults();
  }

  start(rootPath: string, includeFolders: boolean): number {
    const scanSeq = duplicateRepositoryAdapter.beginScan(
      rootPath,
      includeFolders,
    );

    const controller = new AbortController();
    this.abortController = controller;

    // Deliberately not awaited: the Route Handler answers 202 immediately
    // and the client switches to polling /status (spec FR-005).
    void runDuplicateScan({
      rootPath,
      includeFolders,
      scanSeq,
      repository: duplicateRepositoryAdapter,
      fileSystem: filesystemAdapter,
      checksums: checksumAdapter,
      cache: comparisonChecksumReadonlyAdapter,
      partialThreshold: PARTIAL_CHECKSUM_BYTES,
      signal: controller.signal,
    }).finally(() => {
      // Only the run that is still current clears the controller — a
      // superseded one finishing later must not disarm a newer run's Stop.
      if (this.abortController === controller) this.abortController = null;
    });

    return scanSeq;
  }

  /**
   * Re-scans one section of the current result set. Occupies the same
   * single-run slot as a full scan (spec FR-008), so the UI shows the same
   * progress panel and Stop button, but keeps `scan_seq` — and therefore the
   * rest of the results — untouched.
   */
  startRefresh(scopePath: string): number {
    const scanSeq = duplicateRepositoryAdapter.beginRefresh(scopePath);

    const controller = new AbortController();
    this.abortController = controller;

    void refreshScope({
      scopePath,
      repository: duplicateRepositoryAdapter,
      fileSystem: filesystemAdapter,
      checksums: checksumAdapter,
      cache: comparisonChecksumReadonlyAdapter,
      partialThreshold: PARTIAL_CHECKSUM_BYTES,
      signal: controller.signal,
    }).finally(() => {
      if (this.abortController === controller) this.abortController = null;
    });

    return scanSeq;
  }

  requestStop(): void {
    // Reaches all the way into the read stream, so Stop interrupts a
    // multi-gigabyte file mid-hash rather than waiting for it to finish
    // (spec SC-005).
    this.abortController?.abort();
  }
}

export const duplicateScanWorker = new DuplicateScanWorker();
