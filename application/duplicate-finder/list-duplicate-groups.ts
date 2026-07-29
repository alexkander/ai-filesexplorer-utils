import {
  PAGE_SIZE,
  type DuplicateGroup,
  type SortBy,
} from '@/domain/duplicate-finder/duplicate-group';
import type { DuplicateRepositoryPort } from './duplicate-repository-port';

export interface ListDuplicateGroupsParams {
  repository: DuplicateRepositoryPort;
  sortBy: SortBy;
  /** Zero-based. */
  page: number;
}

export interface DuplicateGroupsPage {
  groups: DuplicateGroup[];
  total: number;
  page: number;
  pageSize: number;
  /** The scan behind these results was stopped, so they are incomplete
   * (spec FR-007). */
  partial: boolean;
}

/**
 * One page of the results listing (spec FR-018, FR-020, SC-004).
 *
 * Paging and sorting happen in SQL against an index that already carries the
 * sort key — the listing never loads every group to slice one page out of
 * it, which is what keeps page 1 and page 2000 equally fast at 100 000
 * groups.
 */
export function listDuplicateGroups(
  params: ListDuplicateGroupsParams,
): DuplicateGroupsPage {
  const { repository, sortBy } = params;
  const page = Math.max(0, Math.floor(params.page));

  const { groups, total } = repository.listGroups({
    sortBy,
    offset: page * PAGE_SIZE,
    limit: PAGE_SIZE,
  });

  return {
    groups,
    total,
    page,
    pageSize: PAGE_SIZE,
    partial: repository.getScanState().state === 'stopped',
  };
}
