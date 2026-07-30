import type { GroupKind } from '@/domain/duplicate-finder/duplicate-group';
import type { DuplicateRepositoryPort } from './duplicate-repository-port';

export type GroupOccurrencesOutcome =
  { found: true; paths: string[] } | { found: false };

/**
 * Every path of one group, for an expanded row (spec FR-019). Fetched on
 * demand rather than inlined into the listing page: a group with thousands
 * of paths would otherwise bloat every page that happens to contain it.
 *
 * `found: false` means the group is no longer part of the current result
 * set — it was ignored away, or a new scan replaced the results, between the
 * page load and the click.
 */
export function listGroupOccurrences(
  repository: DuplicateRepositoryPort,
  checksum: string,
  kind: GroupKind,
): GroupOccurrencesOutcome {
  const paths = repository.listOccurrences(checksum, kind);
  if (paths.length === 0) return { found: false };
  return { found: true, paths };
}
