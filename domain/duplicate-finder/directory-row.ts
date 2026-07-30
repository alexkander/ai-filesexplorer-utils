export type DirectoryRowKind = 'directory' | 'file';

/** How the by-directory listing can be ordered (spec FR-035). */
export type DirectorySortBy = 'name' | 'count' | 'size';

/**
 * One entry of the by-directory view: a subdirectory, or a file that is
 * itself one of the duplicates found (plain files are not listed — spec
 * FR-033).
 */
export interface DirectoryRow {
  path: string;
  name: string;
  kind: DirectoryRowKind;
  /** Duplicate items at or beneath this row. For a directory this is the
   * whole subtree (spec FR-032); for a file it is 1. */
  duplicateCount: number;
  /** Bytes those duplicates occupy. */
  duplicateSize: number;
  /** This row is itself a member of a duplicate group — a duplicated file,
   * or a directory reported as a duplicate of another directory. */
  isDuplicate: boolean;
  /** Set only when `isDuplicate`, so the row can be cross-referenced with
   * the Duplicates tab. */
  checksum: string | null;
  occurrenceCount: number | null;
  isEmpty: boolean;
}

export function isDirectorySortBy(value: string): value is DirectorySortBy {
  return value === 'name' || value === 'count' || value === 'size';
}

/**
 * Orders one directory level. Directories and files are deliberately NOT
 * separated into two blocks: the point of this view is "where is the mass",
 * and pinning directories to the top would bury a single huge duplicated
 * file below folders holding far less.
 *
 * Name is always the final tiebreaker, so the order is total and paging
 * through it can never skip or repeat a row.
 */
export function sortDirectoryRows(
  rows: DirectoryRow[],
  sortBy: DirectorySortBy,
  sortDir: 'asc' | 'desc',
): DirectoryRow[] {
  const direction = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    if (sortBy === 'count' && a.duplicateCount !== b.duplicateCount) {
      return (a.duplicateCount - b.duplicateCount) * direction;
    }
    if (sortBy === 'size' && a.duplicateSize !== b.duplicateSize) {
      return (a.duplicateSize - b.duplicateSize) * direction;
    }
    if (sortBy === 'name') return a.name.localeCompare(b.name) * direction;
    return a.name.localeCompare(b.name);
  });
}
