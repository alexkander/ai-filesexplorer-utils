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
