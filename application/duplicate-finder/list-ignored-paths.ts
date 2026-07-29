import type {
  DuplicateRepositoryPort,
  IgnoredPath,
} from './duplicate-repository-port';

/**
 * Everything the user has excluded from duplicate search, newest first
 * (spec FR-027). Independent from the directory comparison tool's own ignore
 * list — the two tables have no relationship whatsoever (FR-028).
 */
export function listIgnoredPaths(
  repository: DuplicateRepositoryPort,
): IgnoredPath[] {
  return repository.listIgnoredPaths();
}
