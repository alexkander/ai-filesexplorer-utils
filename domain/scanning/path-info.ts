function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

export function getDepth(path: string): number {
  if (path === '/') return 0;
  return segments(path).length;
}

export function getParentPath(path: string): string | null {
  if (path === '/') return null;
  const parts = segments(path);
  parts.pop();
  return parts.length === 0 ? '/' : '/' + parts.join('/');
}

/** The final path segment, e.g. "c" for both "/a/b/c" and "/c". */
export function getName(path: string): string {
  const parts = segments(path);
  return parts[parts.length - 1] ?? '';
}

export function joinChildPath(parentPath: string, name: string): string {
  return parentPath === '/' ? `/${name}` : `${parentPath}/${name}`;
}

/** True if `path` is `root` itself or anywhere within `root`'s subtree. */
export function isWithinSubtree(path: string, root: string): boolean {
  return path === root || path.startsWith(root === '/' ? '/' : root + '/');
}

/** Walks up `count` levels from `path` (clamped at "/") — used to keep
 * "Move sync" panes in step when one side jumps straight to an ancestor
 * (e.g. a breadcrumb click), which pops an arbitrary number of segments at
 * once rather than exactly one like navigateUp. */
export function popPathSegments(path: string, count: number): string {
  let current = path;
  for (let i = 0; i < count && current !== '/'; i++) {
    current = getParentPath(current) ?? '/';
  }
  return current;
}
