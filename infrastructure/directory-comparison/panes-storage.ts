import type {
  SortBy,
  SortDir,
} from '@/application/directory-comparison/list-directory';

const STORAGE_KEY = 'directory-comparison:panes';
const VALID_SORT_BY: SortBy[] = ['name', 'type', 'size', 'count'];

export interface PanesState {
  leftPath: string;
  rightPath: string;
  moveSync: boolean;
  /** Shared by both panes (not per-side) — a comparison screen's two panes
   * are conceptually one listing split in half, so one sort control applies
   * to both rather than needing to be set twice. */
  sortBy: SortBy;
  sortDir: SortDir;
  /** Shared by both panes — hides entries whose comparison status is
   * matching/matching_empty (user request). */
  hideMatching: boolean;
}

const DEFAULT_STATE: PanesState = {
  leftPath: '/',
  rightPath: '/',
  moveSync: false,
  sortBy: 'name',
  sortDir: 'asc',
  hideMatching: false,
};

/**
 * Remembers both panes' paths, the Move sync setting, and the shared sort
 * preference client-side only (research.md Decision 9) — never reflected in
 * the URL, same precedent as Count and Size's last-path-storage.ts.
 */
export function loadPanes(): PanesState {
  if (typeof window === 'undefined') return DEFAULT_STATE;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_STATE;
  try {
    const parsed = JSON.parse(raw) as Partial<PanesState>;
    return {
      leftPath: typeof parsed.leftPath === 'string' ? parsed.leftPath : '/',
      rightPath: typeof parsed.rightPath === 'string' ? parsed.rightPath : '/',
      moveSync: parsed.moveSync === true,
      sortBy:
        parsed.sortBy && VALID_SORT_BY.includes(parsed.sortBy)
          ? parsed.sortBy
          : 'name',
      sortDir: parsed.sortDir === 'desc' ? 'desc' : 'asc',
      hideMatching: parsed.hideMatching === true,
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function savePanes(state: PanesState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
