import type { ComparisonRepositoryPort } from './comparison-repository-port';
import type { FileSystemPort } from '@/application/scanning/filesystem-port';
import {
  pairEntriesByName,
  type EntryComparisonResult,
  type EntryComparisonStatus,
  type PairableEntry,
} from '@/domain/directory-comparison/entry-comparison-result';
import { getName, isWithinSubtree } from '@/domain/scanning/path-info';
import { isEmptyDirectorySubtree } from './is-empty-directory-subtree';

export type PassActive = 'structural' | 'comparison' | null;

export interface ComparisonView {
  passActive: PassActive;
  /** The literal path(s) a pass is working on right now, so the UI can show
   * live progress instead of only a coarse-grained per-entry status dot.
   * `null` whenever `passActive` is `null`. Not scoped to `leftPath`/
   * `rightPath` — reflects whatever this tool's shared workers are doing
   * globally, since only one comparison runs at a time (FR-010). */
  activePath:
    | { pass: 'structural'; path: string }
    | { pass: 'comparison'; left: string; right: string }
    | null;
  /** The comparison's own roots (whichever pair `ComparisonQueue` is
   * currently running Pass 1 or Pass 2 for), independent of `leftPath`/
   * `rightPath` — added post-implementation so the UI can show
   * `activePath` relative to a stable base even when the panes have
   * navigated away from the directories actually being compared
   * (research.md Decision 16). `null` exactly when `activePath` is `null`. */
  activePair: { leftRoot: string; rightRoot: string } | null;
  entries: EntryComparisonResult[];
}

/**
 * The per-entry comparison view for `(leftPath, rightPath)` (spec FR-007;
 * data-model.md EntryComparisonResult; contracts/directory-comparison-api-contract.md
 * GET /status) — derived fresh from whatever's currently persisted, so it
 * reflects live progress while a pass is active (research.md Decision 7).
 *
 * Pairing (FR-006) is done against the *live* filesystem listing, not the
 * comparison repository — a pair that has never been Compared yet has no
 * rows in the repository at all, but its entries must still show
 * `not_compared` rather than being silently omitted (spec FR-007,
 * quickstart.md step 10). The repository is only consulted afterward, per
 * paired entry, to look up whatever checksum/outcome data actually exists.
 */
export async function getComparisonView(
  leftPath: string,
  rightPath: string,
  fileSystem: FileSystemPort,
  comparisonRepository: ComparisonRepositoryPort,
  structuralActivePath: string | null,
  comparisonActivePath: { left: string; right: string } | null,
  activePair: { leftRoot: string; rightRoot: string } | null,
): Promise<ComparisonView> {
  const [leftListing, rightListing] = await Promise.all([
    fileSystem.listChildren(leftPath),
    fileSystem.listChildren(rightPath),
  ]);

  const leftEntries: PairableEntry[] = leftListing.ok
    ? leftListing.result.entries
        .filter((e) => e.kind === 'file' || e.kind === 'directory')
        .map((e) => ({ name: e.name, kind: e.kind as 'file' | 'directory' }))
    : [];
  const rightEntries: PairableEntry[] = rightListing.ok
    ? rightListing.result.entries
        .filter((e) => e.kind === 'file' || e.kind === 'directory')
        .map((e) => ({ name: e.name, kind: e.kind as 'file' | 'directory' }))
    : [];

  const pairs = pairEntriesByName(leftEntries, rightEntries);

  const leftChildren = comparisonRepository.getDirectChildren(leftPath);
  const rightChildren = comparisonRepository.getDirectChildren(rightPath);

  const leftDirsByName = new Map(
    leftChildren.directories.map((d) => [getName(d.path), d]),
  );
  const leftFilesByName = new Map(
    leftChildren.files.map((f) => [getName(f.path), f]),
  );
  const rightDirsByName = new Map(
    rightChildren.directories.map((d) => [getName(d.path), d]),
  );
  const rightFilesByName = new Map(
    rightChildren.files.map((f) => [getName(f.path), f]),
  );

  const structuralActive =
    structuralActivePath !== null &&
    (isWithinSubtree(structuralActivePath, leftPath) ||
      isWithinSubtree(structuralActivePath, rightPath));
  const comparisonActive =
    comparisonActivePath !== null &&
    (isWithinSubtree(comparisonActivePath.left, leftPath) ||
      isWithinSubtree(comparisonActivePath.right, rightPath));
  const passActive: PassActive = structuralActive
    ? 'structural'
    : comparisonActive
      ? 'comparison'
      : null;

  // Deliberately NOT scoped to leftPath/rightPath, unlike passActive above —
  // only one comparison runs at a time in this tool (FR-010), so this always
  // reflects what's actually happening, even for a pair the user isn't
  // currently viewing (found necessary during manual verification: without
  // this, there was no way to tell "it's working, just not on what I'm
  // looking at" from "it's stuck").
  const activePath: ComparisonView['activePath'] =
    structuralActivePath !== null
      ? { pass: 'structural', path: structuralActivePath }
      : comparisonActivePath !== null
        ? {
            pass: 'comparison',
            left: comparisonActivePath.left,
            right: comparisonActivePath.right,
          }
        : null;

  const entries: EntryComparisonResult[] = pairs.map((pair) => {
    const kind = (pair.left ?? pair.right)!.kind;

    if (!pair.left) {
      const rightNode = rightDirsByName.get(pair.name);
      if (
        kind === 'directory' &&
        rightNode &&
        isEmptyDirectorySubtree(rightNode, comparisonRepository)
      ) {
        return { name: pair.name, kind, status: 'matching_empty' };
      }
      return { name: pair.name, kind, status: 'only_right' };
    }
    if (!pair.right) {
      const leftNode = leftDirsByName.get(pair.name);
      if (
        kind === 'directory' &&
        leftNode &&
        isEmptyDirectorySubtree(leftNode, comparisonRepository)
      ) {
        return { name: pair.name, kind, status: 'matching_empty' };
      }
      return { name: pair.name, kind, status: 'only_left' };
    }
    if (pair.left.kind !== pair.right.kind) {
      return { name: pair.name, kind, status: 'differs' };
    }

    if (kind === 'directory') {
      const leftNode = leftDirsByName.get(pair.name);
      const rightNode = rightDirsByName.get(pair.name);
      if (!leftNode || !rightNode) {
        return { name: pair.name, kind, status: 'not_compared' };
      }
      const childLeftPath = leftNode.path;
      const childRightPath = rightNode.path;

      if (
        (structuralActivePath !== null &&
          isWithinSubtree(structuralActivePath, childLeftPath)) ||
        (comparisonActivePath !== null &&
          (isWithinSubtree(comparisonActivePath.left, childLeftPath) ||
            isWithinSubtree(comparisonActivePath.right, childRightPath)))
      ) {
        return { name: pair.name, kind, status: 'scanning' };
      }
      if (
        leftNode.hasUnreadableEntries ||
        rightNode.hasUnreadableEntries ||
        leftNode.ownOutcome === 'error' ||
        rightNode.ownOutcome === 'error'
      ) {
        return { name: pair.name, kind, status: 'error' };
      }
      // 'stopped' (interrupted by Stop or an app restart, FR-014) is folded
      // into 'not_compared' rather than getting its own status — FR-007
      // only defines 6 statuses, none of which is "Stopped", so this is a
      // deliberate simplification: pressing "Compare" again reprocesses it
      // exactly as if it had never been compared (data-model.md).
      if (leftNode.ownOutcome !== 'done' || rightNode.ownOutcome !== 'done') {
        return { name: pair.name, kind, status: 'not_compared' };
      }
      // `directoryChecksum === null` alone does NOT mean "confirmed
      // differs" — it's also the value for a pair Pass 2 has never actually
      // reached (not yet gotten here in a still-running compare, or
      // interrupted by Stop before concluding anything). `resolvedByPass2`
      // is the actual signal for "Pass 2 concluded something here at least
      // once" (found missing post-implementation — this used to show a
      // false `differs` for entries that had never really been compared).
      if (!leftNode.resolvedByPass2 || !rightNode.resolvedByPass2) {
        return { name: pair.name, kind, status: 'not_compared' };
      }
      const status: EntryComparisonStatus =
        leftNode.directoryChecksum !== null &&
        leftNode.directoryChecksum === rightNode.directoryChecksum
          ? 'matching'
          : 'differs';
      return { name: pair.name, kind, status };
    }

    const leftFile = leftFilesByName.get(pair.name);
    const rightFile = rightFilesByName.get(pair.name);
    if (!leftFile || !rightFile) {
      return { name: pair.name, kind, status: 'not_compared' };
    }

    if (leftFile.hasReadError || rightFile.hasReadError) {
      return { name: pair.name, kind, status: 'error' };
    }
    if (leftFile.fullChecksum !== null && rightFile.fullChecksum !== null) {
      const status: EntryComparisonStatus =
        leftFile.fullChecksum === rightFile.fullChecksum
          ? 'matching'
          : 'differs';
      return { name: pair.name, kind, status };
    }
    // Not yet fully resolved — a cheaper cascade stage may already have
    // proven a difference even without a full checksum on either side.
    if (leftFile.size !== rightFile.size) {
      return { name: pair.name, kind, status: 'differs' };
    }
    if (
      leftFile.partialChecksum !== null &&
      rightFile.partialChecksum !== null &&
      leftFile.partialChecksum !== rightFile.partialChecksum
    ) {
      return { name: pair.name, kind, status: 'differs' };
    }
    // compare-subtree.ts reports this exact file pair as the active unit
    // once it actually needs to read content — so only the file genuinely
    // being hashed right now shows scanning, not every unresolved sibling
    // in the same directory.
    const thisFileActive =
      comparisonActivePath !== null &&
      comparisonActivePath.left === leftFile.path &&
      comparisonActivePath.right === rightFile.path;
    return {
      name: pair.name,
      kind,
      status: thisFileActive ? 'scanning' : 'not_compared',
    };
  });

  return {
    passActive,
    activePath,
    activePair: activePath !== null ? activePair : null,
    entries,
  };
}
