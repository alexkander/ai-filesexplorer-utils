import { ComparisonQueue } from '@/application/directory-comparison/start-comparison';
import { comparisonRepositoryAdapter } from './comparison-repository-adapter';
import { structuralScanWorker } from './structural-scan-worker';
import { comparisonPassWorker } from './comparison-pass-worker';

/**
 * Module-level singleton (spec FR-010): serializes every "Compare" request
 * in this tool into one full Pass 1 + Pass 2 pipeline at a time.
 */
export const comparisonQueue = new ComparisonQueue(
  comparisonRepositoryAdapter,
  structuralScanWorker,
  comparisonPassWorker,
);
