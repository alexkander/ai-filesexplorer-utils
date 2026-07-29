import {
  isDirectorySortBy,
  type DirectorySortBy,
} from '@/domain/duplicate-finder/directory-row';
import {
  isSortBy,
  isSortDir,
  type SortBy,
  type SortDir,
} from '@/domain/duplicate-finder/duplicate-group';

const PATH_KEY = 'duplicate-finder:last-path';
const INCLUDE_FOLDERS_KEY = 'duplicate-finder:include-folders';
const SORT_KEY = 'duplicate-finder:sort-by';
const SORT_DIR_KEY = 'duplicate-finder:sort-dir';
const TAB_KEY = 'duplicate-finder:tab';
const DIRECTORY_SORT_KEY = 'duplicate-finder:directory-sort-by';
const DIRECTORY_SORT_DIR_KEY = 'duplicate-finder:directory-sort-dir';
const HIDE_EMPTY_KEY = 'duplicate-finder:hide-empty-directories';
const EXCLUDE_EMPTY_FILES_KEY = 'duplicate-finder:exclude-empty-files';
const EXCLUDE_EMPTY_DIRS_KEY = 'duplicate-finder:exclude-empty-directories';

export type DuplicateFinderTab = 'duplicates' | 'directories';

const DEFAULT_SORT: SortBy = 'size';
const DEFAULT_SORT_DIR: SortDir = 'desc';
// The by-directory tab exists to answer "where do the duplicates pile up",
// so it opens on the fullest directory rather than alphabetically.
const DEFAULT_DIRECTORY_SORT: DirectorySortBy = 'count';

/**
 * Remembers the scan form's inputs and the listing's sort, client-side only
 * (spec FR-003, FR-020) — same rationale as the other tools' storage
 * modules: the current selection is deliberately not reflected in the app's
 * URL. Every getter falls back to a default during server rendering.
 */
export function loadLastPath(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(PATH_KEY) ?? '';
}

export function saveLastPath(path: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PATH_KEY, path);
}

export function loadIncludeFolders(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(INCLUDE_FOLDERS_KEY) === 'true';
}

export function saveIncludeFolders(includeFolders: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(INCLUDE_FOLDERS_KEY, String(includeFolders));
}

export function loadSortBy(): SortBy {
  if (typeof window === 'undefined') return DEFAULT_SORT;
  const raw = window.localStorage.getItem(SORT_KEY);
  return raw && isSortBy(raw) ? raw : DEFAULT_SORT;
}

export function saveSortBy(sortBy: SortBy): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SORT_KEY, sortBy);
}

/** Defaults to the by-directory view (user request): "where do the duplicates
 * pile up" is the question worth opening on; the checksum listing is where you
 * go once you know which folder to attack. An explicit choice still wins — a
 * stored `duplicates` is honoured. */
export function loadTab(): DuplicateFinderTab {
  if (typeof window === 'undefined') return 'directories';
  return window.localStorage.getItem(TAB_KEY) === 'duplicates'
    ? 'duplicates'
    : 'directories';
}

export function saveTab(tab: DuplicateFinderTab): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(TAB_KEY, tab);
}

export function loadDirectorySortBy(): DirectorySortBy {
  if (typeof window === 'undefined') return DEFAULT_DIRECTORY_SORT;
  const raw = window.localStorage.getItem(DIRECTORY_SORT_KEY);
  return raw && isDirectorySortBy(raw) ? raw : DEFAULT_DIRECTORY_SORT;
}

export function saveDirectorySortBy(sortBy: DirectorySortBy): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DIRECTORY_SORT_KEY, sortBy);
}

export function loadDirectorySortDir(): SortDir {
  if (typeof window === 'undefined') return DEFAULT_SORT_DIR;
  const raw = window.localStorage.getItem(DIRECTORY_SORT_DIR_KEY);
  return raw && isSortDir(raw) ? raw : DEFAULT_SORT_DIR;
}

export function saveDirectorySortDir(sortDir: SortDir): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DIRECTORY_SORT_DIR_KEY, sortDir);
}

export function loadHideEmptyDirectories(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(HIDE_EMPTY_KEY) === 'true';
}

export function saveHideEmptyDirectories(hideEmpty: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(HIDE_EMPTY_KEY, String(hideEmpty));
}

export function loadExcludeEmptyFiles(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(EXCLUDE_EMPTY_FILES_KEY) === 'true';
}

export function saveExcludeEmptyFiles(value: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(EXCLUDE_EMPTY_FILES_KEY, String(value));
}

export function loadExcludeEmptyDirectories(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(EXCLUDE_EMPTY_DIRS_KEY) === 'true';
}

export function saveExcludeEmptyDirectories(value: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(EXCLUDE_EMPTY_DIRS_KEY, String(value));
}

export function loadSortDir(): SortDir {
  if (typeof window === 'undefined') return DEFAULT_SORT_DIR;
  const raw = window.localStorage.getItem(SORT_DIR_KEY);
  return raw && isSortDir(raw) ? raw : DEFAULT_SORT_DIR;
}

export function saveSortDir(sortDir: SortDir): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SORT_DIR_KEY, sortDir);
}
