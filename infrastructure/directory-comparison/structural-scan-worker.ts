import { ScanEngine } from '@/infrastructure/scanning/scan-engine';
import { listEntries } from '@/application/directory-comparison/list-entries';
import { filesystemAdapter } from '@/infrastructure/scanning/filesystem-adapter';
import { comparisonRepositoryAdapter } from './comparison-repository-adapter';

/**
 * Module-level singleton: Pass 1 (structural listing) for this tool,
 * instantiating the shared ScanEngine with this feature's own adapters and
 * list-entries.ts as its per-node step (research.md Decision 2). Both roots
 * of a "Compare" are enqueued with `mode: 'full'` — Pass 1 has no
 * incremental mode of its own (research.md Decision 11); see
 * start-comparison.ts.
 */
export const structuralScanWorker = new ScanEngine(
  comparisonRepositoryAdapter,
  (path, mode, doneSet) =>
    listEntries(
      path,
      filesystemAdapter,
      comparisonRepositoryAdapter,
      mode,
      doneSet,
    ),
);
