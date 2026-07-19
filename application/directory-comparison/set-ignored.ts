import type { ComparisonRepositoryPort } from './comparison-repository-port';

/**
 * Marks (or unmarks) an exact path as excluded from Compare (spec: user
 * request) — no business logic of its own, mirrors copyEntry/deleteEntry/
 * renameEntry's thin wrapper pattern. The confirmation-free double-click
 * toggle and "Move sync" mirroring live in the UI layer.
 */
export function setIgnored(
  path: string,
  ignored: boolean,
  comparisonRepository: ComparisonRepositoryPort,
): void {
  comparisonRepository.setIgnored(path, ignored);
}
