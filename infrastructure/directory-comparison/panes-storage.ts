const STORAGE_KEY = 'directory-comparison:panes';

export interface PanesState {
  leftPath: string;
  rightPath: string;
  moveSync: boolean;
}

const DEFAULT_STATE: PanesState = {
  leftPath: '/',
  rightPath: '/',
  moveSync: false,
};

/**
 * Remembers both panes' paths and the Move sync setting client-side only
 * (research.md Decision 9) — never reflected in the URL, same precedent as
 * Count and Size's last-path-storage.ts.
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
    };
  } catch {
    return DEFAULT_STATE;
  }
}

export function savePanes(state: PanesState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
