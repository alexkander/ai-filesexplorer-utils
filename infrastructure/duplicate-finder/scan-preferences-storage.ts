import {
  isSortBy,
  type SortBy,
} from '@/domain/duplicate-finder/duplicate-group';

const PATH_KEY = 'duplicate-finder:last-path';
const INCLUDE_FOLDERS_KEY = 'duplicate-finder:include-folders';
const SORT_KEY = 'duplicate-finder:sort-by';

const DEFAULT_SORT: SortBy = 'size';

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
