import type {
  SortBy,
  SortDir,
} from '@/application/count-and-size/list-directory';

const STORAGE_KEY = 'count-and-size:sort-preference';
const VALID_SORT_BY: SortBy[] = [
  'name',
  'type',
  'size',
  'count',
  'status',
  'date',
];

export interface SortPreference {
  sortBy: SortBy;
  sortDir: SortDir;
}

const DEFAULT_PREFERENCE: SortPreference = { sortBy: 'name', sortDir: 'asc' };

/** Remembers the listing's sort field/direction client-side, same rationale as last-path-storage.ts. */
export function loadSortPreference(): SortPreference {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCE;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_PREFERENCE;
  try {
    const parsed = JSON.parse(raw) as Partial<SortPreference>;
    if (
      parsed.sortBy &&
      VALID_SORT_BY.includes(parsed.sortBy) &&
      (parsed.sortDir === 'asc' || parsed.sortDir === 'desc')
    ) {
      return { sortBy: parsed.sortBy, sortDir: parsed.sortDir };
    }
  } catch {
    // Malformed/foreign value under our key — fall back to the default.
  }
  return DEFAULT_PREFERENCE;
}

export function saveSortPreference(preference: SortPreference): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
}
