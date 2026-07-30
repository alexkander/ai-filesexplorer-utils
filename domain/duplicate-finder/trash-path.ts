/**
 * Where a deleted duplicate is moved to (spec FR-042): the trash root with
 * the file's own absolute path grafted underneath, so `/a/b/c/d.txt` lands at
 * `<trashRoot>/a/b/c/d.txt`.
 *
 * Keeping the full original structure is what makes the move reversible by
 * hand: the path under the trash root tells you exactly where the file came
 * from, with no index to consult and nothing to parse.
 */
export function trashDestination(trashRoot: string, path: string): string {
  const root = trashRoot.replace(/\/+$/, '');
  const absolute = path.startsWith('/') ? path : `/${path}`;
  return `${root}${absolute}`;
}

/** True when `path` already lives under the trash root — moving it again
 * would nest one trash structure inside another. */
export function isInsideTrash(trashRoot: string, path: string): boolean {
  const root = trashRoot.replace(/\/+$/, '');
  return path === root || path.startsWith(`${root}/`);
}
