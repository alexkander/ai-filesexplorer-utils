import type { ScanNodeStatus } from '@/domain/scanning/scan-node-status';

export interface DirectoryScanNode extends ScanNodeStatus {
  directFileCount: number;
  directFileSize: number;
  errorMessage: string | null;
  ownFinishedAt: string | null;
}
