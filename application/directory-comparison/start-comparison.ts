import type { ComparisonRepositoryPort } from './comparison-repository-port';
import type { ScanSchedulerPort } from '@/application/scanning/scan-scheduler-port';
import { getParentPath, getDepth } from '@/domain/scanning/path-info';
import type { ScanMode } from '@/domain/scanning/scan-stack';

export interface ComparisonPassWorkerPort {
  run(leftRoot: string, rightRoot: string, mode: ScanMode): Promise<void>;
}

interface QueuedCompare {
  leftPath: string;
  rightPath: string;
  mode: ScanMode;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SETTLE_POLL_INTERVAL_MS = 20;

async function waitUntilFullyListed(
  leftPath: string,
  rightPath: string,
  comparisonRepository: ComparisonRepositoryPort,
): Promise<void> {
  for (;;) {
    const leftPending = comparisonRepository
      .getSubtree(leftPath)
      .some((n) => n.ownOutcome === 'pending');
    const rightPending = comparisonRepository
      .getSubtree(rightPath)
      .some((n) => n.ownOutcome === 'pending');
    if (!leftPending && !rightPending) return;
    await delay(SETTLE_POLL_INTERVAL_MS);
  }
}

/**
 * Owns the module-level queue that guarantees only one full "Compare"
 * pipeline (both passes, for one pair) runs at a time within this tool
 * (spec FR-010) — later requests wait their turn rather than interleaving
 * on the shared structural scheduler or Pass 2's worker.
 */
export class ComparisonQueue {
  private queue: QueuedCompare[] = [];
  private running = false;
  private activePair: { leftRoot: string; rightRoot: string } | null = null;

  constructor(
    private comparisonRepository: ComparisonRepositoryPort,
    private structuralScheduler: ScanSchedulerPort,
    private comparisonPassWorker: ComparisonPassWorkerPort,
  ) {}

  start(leftPath: string, rightPath: string, mode: ScanMode): void {
    this.queue.push({ leftPath, rightPath, mode });
    void this.runLoop();
  }

  /** The pair currently being processed (Pass 1 OR Pass 2 — spans both,
   * unlike `structuralScheduler`'s or `comparisonPassWorker`'s own
   * per-pass state), so the UI can show progress relative to the
   * comparison's own roots regardless of which pass is active and
   * regardless of what the panes currently display (added
   * post-implementation — see research.md Decision 16). */
  getActivePair(): { leftRoot: string; rightRoot: string } | null {
    return this.activePair;
  }

  private async runLoop(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let request: QueuedCompare | undefined;
      while ((request = this.queue.shift())) {
        await this.runOne(request);
      }
    } finally {
      this.running = false;
    }
  }

  private async runOne({ leftPath, rightPath, mode }: QueuedCompare) {
    this.activePair = { leftRoot: leftPath, rightRoot: rightPath };
    try {
      if (mode === 'full') {
        this.comparisonRepository.clearChecksumsInSubtree(leftPath);
        if (rightPath !== leftPath) {
          this.comparisonRepository.clearChecksumsInSubtree(rightPath);
        }
      }

      // Pass 1 always relists unconditionally — no `doneSet`, always 'full'
      // (research.md Decision 11); the user's incremental/full choice only
      // applies to Pass 2 below.
      this.comparisonRepository.upsertPendingDirectory(
        leftPath,
        getParentPath(leftPath),
        getDepth(leftPath),
      );
      this.structuralScheduler.enqueue(leftPath, 'full');
      if (rightPath !== leftPath) {
        this.comparisonRepository.upsertPendingDirectory(
          rightPath,
          getParentPath(rightPath),
          getDepth(rightPath),
        );
        this.structuralScheduler.enqueue(rightPath, 'full');
      }

      await waitUntilFullyListed(
        leftPath,
        rightPath,
        this.comparisonRepository,
      );

      await this.comparisonPassWorker.run(leftPath, rightPath, mode);
    } finally {
      this.activePair = null;
    }
  }
}

/**
 * Enqueues a "Compare" for `(leftPath, rightPath)` (spec FR-003, FR-006,
 * FR-008, FR-009). `mode: 'full'` (the "Force full re-compare" action)
 * always covers both sides together and clears cached checksums before
 * Pass 2 runs.
 */
export function startComparison(
  leftPath: string,
  rightPath: string,
  queue: ComparisonQueue,
  mode: ScanMode = 'incremental',
): void {
  queue.start(leftPath, rightPath, mode);
}
