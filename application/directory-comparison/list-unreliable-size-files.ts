import type { ComparisonRepositoryPort } from './comparison-repository-port';

export interface UnreliableSizeFileEntry {
  path: string;
  size: number;
  detectedAt: string;
}

/**
 * Every file Pass 1 has ever caught with a corrected size (spec: user
 * request) — a dedicated view for reviewing them, since detection happens
 * silently during scanning with no other surface for it. No business logic
 * of its own, mirrors listIgnoredPaths.
 */
export function listUnreliableSizeFiles(
  comparisonRepository: ComparisonRepositoryPort,
): UnreliableSizeFileEntry[] {
  return comparisonRepository.listUnreliableSizeFiles();
}
