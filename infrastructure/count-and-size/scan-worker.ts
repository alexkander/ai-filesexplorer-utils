import { ScanStack } from '@/domain/count-and-size/scan-stack';
import { processDirectory } from '@/application/count-and-size/process-directory';
import type { ScanSchedulerPort } from '@/application/count-and-size/scan-scheduler-port';
import type { ScanRepositoryPort } from '@/application/count-and-size/scan-repository-port';
import type { FileSystemPort } from '@/application/count-and-size/filesystem-port';
import { filesystemAdapter } from './filesystem-adapter';
import { scanRepositoryAdapter } from './scan-repository-adapter';

function isInSubtree(path: string, root: string): boolean {
  return path === root || path.startsWith(root + '/');
}

/**
 * Module-level singleton (spec FR-012): at most one active scan
 * system-wide, LIFO-ordered (FR-013, FR-014), non-blocking (FR-017). On
 * construction, reconciles any row left 'pending' by a previous process as
 * 'stopped' (FR-019; research.md Decision 2) — nothing is ever auto-resumed.
 */
class ScanWorker implements ScanSchedulerPort {
  private stack = new ScanStack();
  private activePath: string | null = null;
  private running = false;
  private stoppedRoots = new Set<string>();

  constructor(
    private fileSystem: FileSystemPort,
    private scanRepository: ScanRepositoryPort,
  ) {
    const stalePending = this.scanRepository.findAllPendingPaths();
    if (stalePending.length > 0) {
      this.scanRepository.markStopped(stalePending);
    }
  }

  enqueue(path: string): void {
    this.stack.push(path);
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
      if (!isInSubtree(item, rootPath)) this.stack.push(item);
    }
  }

  getActivePath(): string | null {
    return this.activePath;
  }

  private async runLoop(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      let path: string | undefined;
      while ((path = this.stack.pop())) {
        this.activePath = path;
        const { childPaths } = await processDirectory(
          path,
          this.fileSystem,
          this.scanRepository,
        );
        const stoppedForThisPath = [...this.stoppedRoots].some((root) =>
          isInSubtree(path!, root),
        );
        if (stoppedForThisPath) {
          // These rows were just created as 'pending' by processDirectory
          // (above) — a stop requested while this node was in flight, so
          // they'd otherwise be orphaned as 'pending' forever (never
          // pushed, never marked stopped).
          if (childPaths.length > 0)
            this.scanRepository.markStopped(childPaths);
        } else {
          for (const child of childPaths) this.stack.push(child);
        }
      }
    } finally {
      this.activePath = null;
      this.stoppedRoots.clear();
      this.running = false;
    }
  }
}

export const scanWorker = new ScanWorker(
  filesystemAdapter,
  scanRepositoryAdapter,
);
