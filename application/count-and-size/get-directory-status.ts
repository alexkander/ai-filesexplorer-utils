import type { ScanRepositoryPort } from './scan-repository-port';
import {
  deriveDirectoryView,
  type DirectoryView,
} from '@/domain/count-and-size/derive-directory-view';

/**
 * The DirectoryView for one path (spec FR-005, FR-008, FR-009, FR-011;
 * contracts/count-and-size-api-contract.md GET /status).
 */
export function getDirectoryStatus(
  targetPath: string,
  scanRepository: ScanRepositoryPort,
): DirectoryView {
  const [node, ...descendants] = scanRepository.getSubtree(targetPath);
  return deriveDirectoryView(node ?? null, descendants);
}
