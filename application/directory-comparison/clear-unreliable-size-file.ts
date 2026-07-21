import type { ComparisonRepositoryPort } from './comparison-repository-port';

/**
 * Removes one path from the unreliable-size log (spec: user request) —
 * pure housekeeping, no effect on Compare. No business logic of its own,
 * mirrors setIgnored's thin wrapper pattern.
 */
export function clearUnreliableSizeFile(
  path: string,
  comparisonRepository: ComparisonRepositoryPort,
): void {
  comparisonRepository.clearUnreliableSizeFile(path);
}
