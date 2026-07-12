import { ScanEngine } from '@/infrastructure/scanning/scan-engine';
import { processDirectory } from '@/application/count-and-size/process-directory';
import { filesystemAdapter } from './filesystem-adapter';
import { scanRepositoryAdapter } from './scan-repository-adapter';

/**
 * Module-level singleton (spec FR-012): at most one active scan
 * system-wide. Instantiates the shared ScanEngine with count-and-size's
 * own filesystem/repository adapters and its own per-node step.
 */
export const scanWorker = new ScanEngine(
  scanRepositoryAdapter,
  (path, mode, doneSet) =>
    processDirectory(path, filesystemAdapter, scanRepositoryAdapter, mode, doneSet),
);
