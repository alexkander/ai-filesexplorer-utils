import {
  sortDirectoryRows,
  type DirectorySortBy,
  type DirectoryRow,
} from '@/domain/duplicate-finder/directory-row';
import type { SortDir } from '@/domain/duplicate-finder/duplicate-group';
import { normalizeScanPath } from '@/domain/duplicate-finder/normalize-path';
import {
  getName,
  getParentPath,
  isWithinSubtree,
} from '@/domain/scanning/path-info';
import type {
  DuplicateFilters,
  DuplicateRepositoryPort,
} from './duplicate-repository-port';

/** Entries per page of the by-directory listing. Larger than the Duplicates
 * tab's 50: this one is a directory listing, where the user is scanning for a
 * name as much as reading rows. */
export const DIRECTORY_PAGE_SIZE = 200;

export interface ListDirectoryDuplicatesParams {
  repository: DuplicateRepositoryPort;
  /** Defaults to the scanned root; anything outside it is ignored, since no
   * results exist there. */
  path?: string | null;
  sortBy: DirectorySortBy;
  sortDir: SortDir;
  /** Drop directories holding no duplicates at all (spec FR-034). */
  hideEmptyDirectories: boolean;
  /** Leave zero-byte files and/or childless directories out of the rows AND
   * out of every count and size (spec FR-044). */
  filters: DuplicateFilters;
  page: number;
}

export interface DirectoryDuplicatesView {
  rootPath: string | null;
  currentPath: string | null;
  /** Null at the scanned root — this view never navigates above it. */
  parentPath: string | null;
  rows: DirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Duplicates at or beneath `currentPath`. */
  subtreeCount: number;
  subtreeSize: number;
  /** Duplicates in the whole result set, so a row can be read as a share. */
  overallCount: number;
  overallSize: number;
}

/**
 * One level of the by-directory view (spec User Story 4): the directories
 * directly under `path` with how many duplicates each one holds in its whole
 * subtree, plus the files directly under `path` that are themselves
 * duplicates.
 *
 * Reads the persisted result set rather than the filesystem, so it always
 * agrees with the Duplicates tab — including after a path has been ignored,
 * which prunes occurrences and therefore lowers these counts too.
 */
export function listDirectoryDuplicates(
  params: ListDirectoryDuplicatesParams,
): DirectoryDuplicatesView {
  const { repository, sortBy, sortDir, hideEmptyDirectories, filters } = params;
  const page = Math.max(0, Math.floor(params.page));

  // Normalised on read as well as on write: a scan recorded before paths were
  // canonicalised still has a trailing slash in `scan_state.root_path`, and
  // this view is perfectly able to serve it correctly without a re-scan —
  // every other row in the database is already canonical.
  const state = repository.getScanState();
  const rootPath = state.rootPath ? normalizeScanPath(state.rootPath) : null;
  const overall = repository.getDuplicateTotals(filters);

  const empty: DirectoryDuplicatesView = {
    rootPath,
    currentPath: null,
    parentPath: null,
    rows: [],
    total: 0,
    page: 0,
    pageSize: DIRECTORY_PAGE_SIZE,
    subtreeCount: 0,
    subtreeSize: 0,
    overallCount: overall.count,
    overallSize: overall.size,
  };

  if (!rootPath) return empty;

  // Anything outside the scanned subtree has no recorded results, so asking
  // for it would show a misleading empty directory rather than an error.
  const requestedPath = params.path ? normalizeScanPath(params.path) : null;
  const currentPath =
    requestedPath && isWithinSubtree(requestedPath, rootPath)
      ? requestedPath
      : rootPath;

  const aggregates = new Map(
    repository
      .aggregateDuplicatesByChild(currentPath, filters)
      .map((entry) => [entry.childPath, entry]),
  );
  const directDuplicates = new Map(
    repository
      .listDirectDuplicateChildren(currentPath, filters)
      .map((entry) => [entry.path, entry]),
  );

  const rows: DirectoryRow[] = [];

  for (const childPath of repository.listChildDirectories(
    currentPath,
    filters,
  )) {
    const aggregate = aggregates.get(childPath);
    const asDuplicate = directDuplicates.get(childPath);
    rows.push({
      path: childPath,
      name: getName(childPath),
      kind: 'directory',
      duplicateCount: aggregate?.count ?? 0,
      duplicateSize: aggregate?.size ?? 0,
      isDuplicate: asDuplicate !== undefined,
      checksum: asDuplicate?.checksum ?? null,
      occurrenceCount: asDuplicate?.occurrenceCount ?? null,
      isEmpty: asDuplicate?.isEmpty ?? false,
    });
  }

  // Whatever is left is a duplicate file sitting directly here: plain files
  // are deliberately not listed (spec FR-033), so the only file rows are the
  // ones the scan actually flagged.
  for (const [path, entry] of directDuplicates) {
    if (entry.kind === 'directory') continue;
    rows.push({
      path,
      name: getName(path),
      kind: 'file',
      duplicateCount: 1,
      duplicateSize: entry.size,
      isDuplicate: true,
      checksum: entry.checksum,
      occurrenceCount: entry.occurrenceCount,
      isEmpty: entry.isEmpty,
    });
  }

  let subtreeCount = 0;
  let subtreeSize = 0;
  for (const aggregate of aggregates.values()) {
    subtreeCount += aggregate.count;
    subtreeSize += aggregate.size;
  }

  const visible = hideEmptyDirectories
    ? rows.filter((row) => row.duplicateCount > 0)
    : rows;
  const sorted = sortDirectoryRows(visible, sortBy, sortDir);
  const offset = page * DIRECTORY_PAGE_SIZE;

  return {
    rootPath,
    currentPath,
    parentPath: currentPath === rootPath ? null : getParentPath(currentPath),
    rows: sorted.slice(offset, offset + DIRECTORY_PAGE_SIZE),
    total: sorted.length,
    page,
    pageSize: DIRECTORY_PAGE_SIZE,
    subtreeCount,
    subtreeSize,
    overallCount: overall.count,
    overallSize: overall.size,
  };
}
