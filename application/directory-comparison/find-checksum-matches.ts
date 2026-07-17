import type { EntryComparisonResult } from '@/domain/directory-comparison/entry-comparison-result';
import { joinChildPath } from '@/domain/scanning/path-info';
import type { ChecksumPort } from './checksum-port';

const MATCHING_STATUSES = new Set(['matching', 'matching_empty']);

export interface ChecksumMatch {
  checksum: string;
  leftName: string;
  rightName: string;
}

/** Every file name currently present on the left, derived from `entries`
 * (which pairs by name across both sides — any entry not `only_right` has
 * a left-side file) rather than a fresh directory listing, so it stays
 * consistent with whatever set of names `findChecksumMatches` itself
 * reasoned about. Used by `build-rename-plan.ts` to detect when a rename
 * chain's final destination collides with some file outside the plan. */
export function leftFileNamesFromEntries(
  entries: EntryComparisonResult[],
): Set<string> {
  return new Set(
    entries
      .filter((e) => e.kind === 'file' && e.status !== 'only_right')
      .map((e) => e.name),
  );
}

async function hashByName(
  parentPath: string,
  names: string[],
  checksumPort: ChecksumPort,
): Promise<Map<string, string[]>> {
  const byChecksum = new Map<string, string[]>();
  for (const name of names) {
    let checksum: string;
    try {
      checksum = await checksumPort.computeFullChecksum(
        joinChildPath(parentPath, name),
      );
    } catch {
      // Unreadable file — excluded from matching rather than surfaced as
      // an error; this is a best-effort discovery tool, not a scan.
      continue;
    }
    const existing = byChecksum.get(checksum);
    if (existing) existing.push(name);
    else byChecksum.set(checksum, [name]);
  }
  return byChecksum;
}

/**
 * Cross-matches by CONTENT, ignoring filename (spec: user request): among
 * files that don't already fully match by name+content between leftPath
 * and rightPath, hashes each one live and looks for the same checksum
 * appearing on both sides under different names — evidence of a rename.
 *
 * Deliberately scoped to `entries` (this pane pair's `ComparisonView`,
 * same data `ComparisonPane` already renders) rather than a fresh
 * directory listing — never re-hashes a file the existing comparison has
 * already confirmed `matching`/`matching_empty`, which keeps this bounded
 * on a large, mostly-identical pair of directories instead of re-reading
 * everything on every click.
 *
 * When a checksum has more than one candidate name on a side (duplicate
 * content under different names), only the alphabetically-first name is
 * used (spec: user request) — the rest are left untouched.
 *
 * Sequencing these into actually-safe, individually-executable rename
 * steps (handling the case where matches chain into each other, or form a
 * rename cycle/swap) is `build-rename-plan.ts`'s job, not this one — this
 * only discovers WHICH names correspond by content.
 */
export async function findChecksumMatches(
  leftPath: string,
  rightPath: string,
  entries: EntryComparisonResult[],
  checksumPort: ChecksumPort,
): Promise<ChecksumMatch[]> {
  const leftNames: string[] = [];
  const rightNames: string[] = [];

  for (const entry of entries) {
    if (entry.kind !== 'file') continue;
    if (MATCHING_STATUSES.has(entry.status)) continue;
    if (entry.status !== 'only_right') leftNames.push(entry.name);
    if (entry.status !== 'only_left') rightNames.push(entry.name);
  }

  const [leftByChecksum, rightByChecksum] = await Promise.all([
    hashByName(leftPath, leftNames, checksumPort),
    hashByName(rightPath, rightNames, checksumPort),
  ]);

  const matches: ChecksumMatch[] = [];
  for (const [checksum, candidateLeftNames] of leftByChecksum) {
    const candidateRightNames = rightByChecksum.get(checksum);
    if (!candidateRightNames) continue;

    const leftName = [...candidateLeftNames].sort((a, b) =>
      a.localeCompare(b),
    )[0];
    const rightName = [...candidateRightNames].sort((a, b) =>
      a.localeCompare(b),
    )[0];
    if (leftName === rightName) continue;

    matches.push({ checksum, leftName, rightName });
  }

  return matches.sort((a, b) => a.leftName.localeCompare(b.leftName));
}
