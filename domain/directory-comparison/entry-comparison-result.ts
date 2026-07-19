export type EntryComparisonStatus =
  | 'not_compared'
  | 'matching'
  // A directory that exists on only one side, where that side's entire
  // subtree (recursively) contains no files — treated as equivalent to a
  // non-existent directory on the other side rather than as a mismatch, but
  // kept distinct from plain `matching` so the UI can still hint that
  // there's nothing actually being compared here.
  | 'matching_empty'
  | 'differs'
  | 'only_left'
  | 'only_right'
  | 'scanning'
  | 'error'
  // Explicitly excluded from Compare (spec: user request, double-click the
  // status dot) — takes precedence over whatever the normal pairing/
  // checksum logic would otherwise conclude. Neither passes nor fails its
  // parent's matching rollup; it's simply left out of consideration, same
  // treatment as an empty-on-one-side directory.
  | 'ignored';

export interface EntryComparisonResult {
  name: string;
  kind: 'file' | 'directory';
  status: EntryComparisonStatus;
  /** The full checksum actually persisted for this exact entry on each
   * side, independent of the other side's value — a file always has its
   * own real value once computed (even when it `differs`, so both sides'
   * hashes can be inspected side by side). A directory only ever has one
   * when `status` is `matching` (or `matching_empty`, though that case is
   * never a Merkle participant) — `compareSubtree` deliberately discards
   * both sides' directory checksum (persists `null`) the moment they
   * `differ`, since a mismatching Merkle root isn't independently
   * meaningful per side. `null` means "no value persisted", not
   * necessarily "differs". */
  leftChecksum: string | null;
  rightChecksum: string | null;
}

export interface PairableEntry {
  name: string;
  kind: 'file' | 'directory';
}

export interface PairedEntry {
  name: string;
  left: PairableEntry | null;
  right: PairableEntry | null;
}

/**
 * Pairs two sides' direct entries by name (spec FR-006) — pure, no I/O.
 * An entry present on only one side pairs with `null` on the other; callers
 * (get-comparison-view.ts) turn each pair into a final `EntryComparisonResult`
 * using persisted checksum/outcome facts this function has no access to.
 */
export function pairEntriesByName(
  leftEntries: PairableEntry[],
  rightEntries: PairableEntry[],
): PairedEntry[] {
  const byName = new Map<string, PairedEntry>();

  for (const entry of leftEntries) {
    byName.set(entry.name, { name: entry.name, left: entry, right: null });
  }
  for (const entry of rightEntries) {
    const existing = byName.get(entry.name);
    if (existing) {
      existing.right = entry;
    } else {
      byName.set(entry.name, { name: entry.name, left: null, right: entry });
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
