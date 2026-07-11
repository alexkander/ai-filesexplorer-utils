const STORAGE_KEY = 'count-and-size:last-path';

/**
 * Remembers the last directory the user browsed to, client-side only — the
 * current directory is deliberately NOT reflected in the app's URL, per
 * product decision. Falls back to the root "/" the first time, or when
 * called during server rendering.
 */
export function loadLastPath(): string {
  if (typeof window === 'undefined') return '/';
  return window.localStorage.getItem(STORAGE_KEY) ?? '/';
}

export function saveLastPath(path: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, path);
}
