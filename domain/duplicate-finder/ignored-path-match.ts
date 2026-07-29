/**
 * Exact-or-subtree ignore matching (spec FR-025, research.md Decision 10):
 * an ignored directory excludes everything beneath it, an ignored file
 * excludes only itself — which falls out of the same rule, since a file has
 * no descendants. That is why `ignored_paths` stores no kind column.
 *
 * Walks `targetPath`'s own ancestors against the set rather than iterating
 * the set against the path: cost is the path's depth (a handful of lookups)
 * regardless of how many paths the user has ignored, which matters because
 * this runs once per entry of a scan that may visit millions of them.
 */
export function isIgnored(
  targetPath: string,
  ignoredPaths: ReadonlySet<string>,
): boolean {
  if (ignoredPaths.size === 0) return false;
  if (ignoredPaths.has(targetPath)) return true;

  let separatorIndex = targetPath.lastIndexOf('/');
  while (separatorIndex > 0) {
    if (ignoredPaths.has(targetPath.slice(0, separatorIndex))) return true;
    separatorIndex = targetPath.lastIndexOf('/', separatorIndex - 1);
  }

  // The loop above stops before the filesystem root, whose ancestor slice
  // would be the empty string rather than "/".
  return ignoredPaths.has('/');
}
