/**
 * Which duplicated-folder groups have a member that is a strict ancestor of
 * `path`. Walks the path's own ancestors — O(depth) — rather than scanning
 * every folder-group member, so this stays cheap with tens of thousands of
 * occurrences.
 */
export function coveringFolderGroups(
  path: string,
  folderGroupByMemberPath: ReadonlyMap<string, string>,
): Set<string> {
  const covering = new Set<string>();
  if (folderGroupByMemberPath.size === 0) return covering;

  let separatorIndex = path.lastIndexOf('/');
  while (separatorIndex > 0) {
    const group = folderGroupByMemberPath.get(path.slice(0, separatorIndex));
    if (group) covering.add(group);
    separatorIndex = path.lastIndexOf('/', separatorIndex - 1);
  }

  const rootGroup = folderGroupByMemberPath.get('/');
  if (rootGroup) covering.add(rootGroup);
  return covering;
}

/**
 * The collapsing rule (spec FR-015, research.md Decision 7): a group is
 * omitted only when ONE duplicated-folder group explains EVERY one of its
 * occurrences.
 *
 * The looser reading — "drop any occurrence that sits inside a duplicated
 * folder" — loses data: if `photos/2024` and `backup/2024` are duplicates and
 * a third copy of one of their files also sits in `downloads/`, dropping the
 * two inside occurrences leaves a one-occurrence group that then disappears,
 * hiding a real duplicate the user could act on. Requiring a single group to
 * explain all occurrences keeps that group intact and in full, while still
 * collapsing the pure case. Nested duplicated folders fall out of the same
 * rule for free.
 */
export function isFullyExplainedByOneFolderGroup(
  paths: readonly string[],
  folderGroupByMemberPath: ReadonlyMap<string, string>,
): boolean {
  if (paths.length === 0 || folderGroupByMemberPath.size === 0) return false;

  let intersection: Set<string> | null = null;
  for (const path of paths) {
    const covering = coveringFolderGroups(path, folderGroupByMemberPath);
    if (covering.size === 0) return false;
    if (intersection === null) {
      intersection = covering;
      continue;
    }
    intersection = new Set(
      [...intersection].filter((group) => covering.has(group)),
    );
    if (intersection.size === 0) return false;
  }

  return intersection !== null && intersection.size > 0;
}
