import type { DirectoryScanNode } from './directory-scan-node';

/**
 * Given one `getSubtree(root)` result, returns the set of paths whose own
 * subtree is fully done: `ownOutcome === 'done'`, no unreadable entries, and
 * every child present in `nodes` is itself done (recursively). Used to skip
 * already-complete subdirectories during an incremental scan (spec FR-021;
 * research.md Decision 10). Pure — no I/O.
 */
export function deriveDoneSet(nodes: DirectoryScanNode[]): Set<string> {
  const childrenByParent = new Map<string, DirectoryScanNode[]>();
  for (const node of nodes) {
    if (node.parentPath === null) continue;
    const siblings = childrenByParent.get(node.parentPath) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentPath, siblings);
  }

  const doneSet = new Set<string>();
  // Deepest nodes first, so each node's children have already been decided.
  const byDepthDesc = [...nodes].sort((a, b) => b.depth - a.depth);

  for (const node of byDepthDesc) {
    const ownDone = node.ownOutcome === 'done' && !node.hasUnreadableEntries;
    const children = childrenByParent.get(node.path) ?? [];
    const childrenDone = children.every((child) => doneSet.has(child.path));
    if (ownDone && childrenDone) doneSet.add(node.path);
  }

  return doneSet;
}
