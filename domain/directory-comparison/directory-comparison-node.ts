import type { ScanNodeStatus } from '@/domain/scanning/scan-node-status';

export interface DirectoryComparisonNode extends ScanNodeStatus {
  directoryChecksum: string | null;
}
