import type { EntryComparisonResult } from '@/domain/directory-comparison/entry-comparison-result';

const MATCHING_STATUSES = new Set(['matching', 'matching_empty']);

export interface ChecksumMatch {
  checksum: string;
  leftName: string;
  rightName: string;
}

/** Every file name currently present on the left, derived from `entries`
 * (which pairs by name across both sides — any entry not `only_right` has
 * a left-side file) rather than a fresh directory listing, so it stays
 * consistent with whatever set of names this feature reasoned about. Used
 * by `build-rename-plan.ts` to detect when a rename chain's final
 * destination collides with some file outside the plan. */
export function leftFileNamesFromEntries(
  entries: EntryComparisonResult[],
): Set<string> {
  return new Set(
    entries
      .filter((e) => e.kind === 'file' && e.status !== 'only_right')
      .map((e) => e.name),
  );
}

/**
 * Which file names actually need hashing (spec: user request — never
 * re-hashes a file the existing comparison has already confirmed
 * `matching`/`matching_empty`, keeping this bounded on a large,
 * mostly-identical pair of directories instead of re-reading everything
 * on every click). A name can appear in both lists (same-named pair whose
 * content differs — `differs`/`not_compared`/etc.) since each side's own
 * file still needs its own hash.
 */
export function getCandidateNames(entries: EntryComparisonResult[]): {
  leftNames: string[];
  rightNames: string[];
} {
  const leftNames: string[] = [];
  const rightNames: string[] = [];

  for (const entry of entries) {
    if (entry.kind !== 'file') continue;
    if (MATCHING_STATUSES.has(entry.status)) continue;
    if (entry.status !== 'only_right') leftNames.push(entry.name);
    if (entry.status !== 'only_left') rightNames.push(entry.name);
  }

  return { leftNames, rightNames };
}

/**
 * Folds one just-hashed name into the running per-side checksum maps and
 * (spec: user request — incremental discovery) updates `matchByChecksum`
 * the moment its checksum is known to appear on BOTH sides — called once
 * per file, in whatever order each side happens to get hashed in, so a
 * match can surface as soon as its second half is found rather than only
 * once every file on both sides has been processed.
 *
 * When a checksum has more than one candidate name on a side (duplicate
 * content under different names), only the alphabetically-first name is
 * used (spec: user request) — re-derived from scratch on every call so a
 * match already recorded gets corrected in place if a later, earlier-
 * sorting name for the same checksum turns up on either side.
 */
export function recordHashedName(
  side: 'left' | 'right',
  name: string,
  checksum: string,
  ownByChecksum: Map<string, string[]>,
  otherByChecksum: Map<string, string[]>,
  matchByChecksum: Map<string, ChecksumMatch>,
): void {
  const ownNames = ownByChecksum.get(checksum);
  if (ownNames) ownNames.push(name);
  else ownByChecksum.set(checksum, [name]);

  const otherNames = otherByChecksum.get(checksum);
  if (!otherNames || otherNames.length === 0) return;

  const ownBest = [...ownByChecksum.get(checksum)!].sort((a, b) =>
    a.localeCompare(b),
  )[0];
  const otherBest = [...otherNames].sort((a, b) => a.localeCompare(b))[0];
  const leftName = side === 'left' ? ownBest : otherBest;
  const rightName = side === 'left' ? otherBest : ownBest;

  if (leftName === rightName) {
    matchByChecksum.delete(checksum);
    return;
  }
  matchByChecksum.set(checksum, { checksum, leftName, rightName });
}

export function sortMatches(matches: ChecksumMatch[]): ChecksumMatch[] {
  return [...matches].sort((a, b) => a.leftName.localeCompare(b.leftName));
}
