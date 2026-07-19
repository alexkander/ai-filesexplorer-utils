import type { ComparisonRepositoryPort } from './comparison-repository-port';

export interface IgnoredPathEntry {
  path: string;
  ignoredAt: string;
}

/**
 * Every currently-ignored path (spec: user request — a dedicated view for
 * managing them, since double-clicking a status dot only exposes them one
 * pane pair at a time). No business logic of its own, mirrors the other
 * thin application-layer wrappers in this feature.
 */
export function listIgnoredPaths(
  comparisonRepository: ComparisonRepositoryPort,
): IgnoredPathEntry[] {
  return comparisonRepository.listIgnoredPaths();
}
