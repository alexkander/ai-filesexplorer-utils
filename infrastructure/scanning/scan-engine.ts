import {
  ScanStack,
  type ScanStackEntry,
  type ScanMode,
} from '@/domain/scanning/scan-stack';
import type { ScanSchedulerPort } from '@/application/scanning/scan-scheduler-port';

export interface ScanEngineRepository {
  /** Startup reconciliation: paths still 'pending' from a prior process. */
  findAllPendingPaths(): string[];
  /** Mark a specific set of paths as stopped (FR-018, FR-019). */
  markStopped(paths: string[]): void;
}

export type ProcessDirectory = (
  path: string,
  mode: ScanMode,
  doneSet?: ReadonlySet<string>,
) => Promise<{ childPaths: string[] }>;

function isInSubtree(path: string, root: string): boolean {
  return path === root || path.startsWith(root + '/');
}

/**
 * Feature-agnostic scan engine (spec FR-012, FR-013, FR-014, FR-017):
 * a non-blocking, LIFO-ordered, at-most-one-active-scan-system-wide worker.
 * On construction, reconciles any row left 'pending' by a previous process
 * as 'stopped' (FR-019; research.md Decision 2) — nothing is ever
 * auto-resumed. The per-node step is supplied by the feature via
 * `processDirectory`; this engine only owns traversal order and stop/resume
 * bookkeeping, not any feature-specific persistence.
 */
export class ScanEngine implements ScanSchedulerPort {
  private stack = new ScanStack();
  private activePath: string | null = null;
  private running = false;
  private stoppedRoots = new Set<string>();

  constructor(
    private scanRepository: ScanEngineRepository,
    private processDirectory: ProcessDirectory,
  ) {
    const stalePending = this.scanRepository.findAllPendingPaths();
    if (stalePending.length > 0) {
      this.scanRepository.markStopped(stalePending);
    }
  }

  enqueue(path: string, mode: ScanMode, doneSet?: ReadonlySet<string>): void {
    this.stack.push({ path, mode, doneSet });
    void this.runLoop();
  }

  requestStop(rootPath: string): void {
    this.stoppedRoots.add(rootPath);
    // Drop every queued path under rootPath — not just whichever node
    // happens to be executing this instant. A scan tree can have thousands
    // of independent siblings still sitting in the stack; the user pressing
    // Stop on a directory means "stop this whole subtree," not "stop
    // whatever the worker's timing happened to land on."
    for (const item of this.stack.clear()) {
      if (!isInSubtree(item.path, rootPath)) this.stack.push(item);
    }
  }

  getActivePath(): string | null {
    return this.activePath;
  }

  private async runLoop(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let entry: ScanStackEntry | undefined;
      while ((entry = this.stack.pop())) {
        const { path, mode, doneSet } = entry;
        this.activePath = path;
        const { childPaths } = await this.processDirectory(
          path,
          mode,
          doneSet,
        );
        const stoppedForThisPath = [...this.stoppedRoots].some((root) =>
          isInSubtree(path, root),
        );
        if (stoppedForThisPath) {
          // These rows were just created as 'pending' by processDirectory
          // (above) — a stop requested while this node was in flight, so
          // they'd otherwise be orphaned as 'pending' forever (never
          // pushed, never marked stopped).
          if (childPaths.length > 0)
            this.scanRepository.markStopped(childPaths);
        } else {
          for (const child of childPaths)
            this.stack.push({ path: child, mode, doneSet });
        }
      }
    } finally {
      this.activePath = null;
      this.stoppedRoots.clear();
      this.running = false;
    }
  }
}
