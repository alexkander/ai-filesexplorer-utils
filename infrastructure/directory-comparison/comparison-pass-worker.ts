import { compareSubtree } from '@/application/directory-comparison/compare-subtree';
import { countFilePairs } from '@/application/directory-comparison/count-file-pairs';
import { comparisonRepositoryAdapter } from './comparison-repository-adapter';
import { checksumAdapter } from './checksum-adapter';
import { isWithinSubtree } from '@/domain/scanning/path-info';
import type { ScanMode } from '@/domain/scanning/scan-stack';

export interface ActivePair {
  leftRoot: string;
  rightRoot: string;
}

export interface ActivePath {
  left: string;
  right: string;
}

export interface ComparisonProgress {
  processed: number;
  total: number;
}

/**
 * Module-level singleton for Pass 2 (research.md Decision 5): a small,
 * purpose-built worker — not another ScanEngine — that runs
 * `compare-subtree.ts` bottom-up over one pair's already Pass-1-listed
 * subtrees, exposing `activePair`/`activePath` for `/status` polling and a
 * per-run `AbortController` for Stop (FR-013), which now reaches all the
 * way into `ChecksumPort` so it can interrupt a file mid-read (found
 * necessary post-implementation — see compare-subtree.ts). Queueing
 * multiple "Compare" requests so only one runs at a time (spec FR-010) is
 * `start-comparison.ts`'s responsibility — it awaits `run()` to completion
 * before starting the next one, so this worker only ever has a single run
 * in flight.
 */
class ComparisonPassWorker {
  private activePair: ActivePair | null = null;
  private activePath: ActivePath | null = null;
  private abortController: AbortController | null = null;
  private progress: ComparisonProgress | null = null;

  async run(
    leftRoot: string,
    rightRoot: string,
    mode: ScanMode,
  ): Promise<void> {
    this.activePair = { leftRoot, rightRoot };
    const abortController = new AbortController();
    this.abortController = abortController;
    try {
      const leftRootNode = comparisonRepositoryAdapter.getSubtree(leftRoot)[0];
      const rightRootNode =
        comparisonRepositoryAdapter.getSubtree(rightRoot)[0];
      if (!leftRootNode || !rightRootNode) return;

      // Computed once up front (spec: user request — "N of TOTAL" next to
      // the active-path display) against whatever Pass 1 already listed;
      // cheap relative to the actual hashing this pass is about to do.
      this.progress = {
        processed: 0,
        total: countFilePairs(
          leftRootNode,
          rightRootNode,
          comparisonRepositoryAdapter,
        ),
      };

      await compareSubtree(
        leftRootNode,
        rightRootNode,
        {
          comparisonRepository: comparisonRepositoryAdapter,
          checksumPort: checksumAdapter,
        },
        {
          mode,
          signal: abortController.signal,
          onProgress: (left, right) => {
            this.activePath = { left, right };
          },
          onFilePairResolved: (count) => {
            if (this.progress) {
              this.progress = {
                ...this.progress,
                processed: this.progress.processed + count,
              };
            }
          },
        },
      );
    } finally {
      this.activePair = null;
      this.activePath = null;
      this.abortController = null;
      this.progress = null;
    }
  }

  /**
   * Stops the active run if `leftRoot`/`rightRoot` relate to it on either
   * side — either exactly matches the active pair's own roots, or is an
   * ancestor of one (the user navigated a pane up from where "Compare" was
   * originally pressed, then hit Stop). Matches the same
   * either-side-qualifies logic `get-comparison-view.ts` already uses to
   * decide whether to show the Stop button at all — found missing
   * post-implementation: the previous exact-match-only check silently did
   * nothing when the button was visible but the panes had moved.
   */
  requestStop(leftRoot: string, rightRoot: string): void {
    if (!this.activePair) return;
    const relevant =
      isWithinSubtree(this.activePair.leftRoot, leftRoot) ||
      isWithinSubtree(this.activePair.rightRoot, rightRoot);
    if (relevant) this.abortController?.abort();
  }

  getActivePair(): ActivePair | null {
    return this.activePair;
  }

  getActivePath(): ActivePath | null {
    return this.activePath;
  }

  getProgress(): ComparisonProgress | null {
    return this.progress;
  }
}

export const comparisonPassWorker = new ComparisonPassWorker();
