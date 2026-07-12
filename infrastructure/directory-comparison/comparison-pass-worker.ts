import { compareSubtree } from '@/application/directory-comparison/compare-subtree';
import { comparisonRepositoryAdapter } from './comparison-repository-adapter';
import { checksumAdapter } from './checksum-adapter';
import type { ScanMode } from '@/domain/scanning/scan-stack';

export interface ActivePair {
  leftRoot: string;
  rightRoot: string;
}

export interface ActivePath {
  left: string;
  right: string;
}

function pairKey(leftRoot: string, rightRoot: string): string {
  return `${leftRoot} ${rightRoot}`;
}

/**
 * Module-level singleton for Pass 2 (research.md Decision 5): a small,
 * purpose-built worker — not another ScanEngine — that runs
 * `compare-subtree.ts` bottom-up over one pair's already Pass-1-listed
 * subtrees, exposing `activePair`/`activePath` for `/status` polling and a
 * per-run cancellation flag for Stop (FR-013). Queueing multiple "Compare"
 * requests so only one runs at a time (spec FR-010) is `start-comparison.ts`'s
 * responsibility — it awaits `run()` to completion before starting the next
 * one, so this worker only ever has a single run in flight.
 */
class ComparisonPassWorker {
  private activePair: ActivePair | null = null;
  private activePath: ActivePath | null = null;
  private cancelledKey: string | null = null;

  async run(
    leftRoot: string,
    rightRoot: string,
    mode: ScanMode,
  ): Promise<void> {
    const key = pairKey(leftRoot, rightRoot);
    this.activePair = { leftRoot, rightRoot };
    this.cancelledKey = null;
    try {
      const leftRootNode = comparisonRepositoryAdapter.getSubtree(leftRoot)[0];
      const rightRootNode =
        comparisonRepositoryAdapter.getSubtree(rightRoot)[0];
      if (!leftRootNode || !rightRootNode) return;

      await compareSubtree(
        leftRootNode,
        rightRootNode,
        {
          comparisonRepository: comparisonRepositoryAdapter,
          checksumPort: checksumAdapter,
        },
        {
          mode,
          isCancelled: () => this.cancelledKey === key,
          onProgress: (left, right) => {
            this.activePath = { left, right };
          },
        },
      );
    } finally {
      this.activePair = null;
      this.activePath = null;
      this.cancelledKey = null;
    }
  }

  requestStop(leftRoot: string, rightRoot: string): void {
    if (
      this.activePair?.leftRoot === leftRoot &&
      this.activePair?.rightRoot === rightRoot
    ) {
      this.cancelledKey = pairKey(leftRoot, rightRoot);
    }
  }

  getActivePair(): ActivePair | null {
    return this.activePair;
  }

  getActivePath(): ActivePath | null {
    return this.activePath;
  }
}

export const comparisonPassWorker = new ComparisonPassWorker();
