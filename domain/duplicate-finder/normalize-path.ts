/**
 * Canonical form of a path typed by a user: no surrounding whitespace, no
 * repeated slashes, no trailing slash (except for "/" itself).
 *
 * This exists because everything downstream compares paths as strings —
 * `parent_path = ?` lookups, the `path >= prefix AND path < prefix-bumped`
 * subtree ranges, the ignore list's exact-or-subtree rule. A root recorded as
 * "/data/photos/" while its children's `parent_path` is "/data/photos" (which
 * is what `getParentPath` produces) matches nothing at all, and the by-
 * directory view comes back empty even though the scan found plenty — the
 * exact bug a trailing slash in the scan form caused.
 */
export function normalizeScanPath(path: string): string {
  const collapsed = path.trim().replace(/\/{2,}/g, '/');
  if (collapsed === '/') return collapsed;
  return collapsed.replace(/\/+$/, '');
}
