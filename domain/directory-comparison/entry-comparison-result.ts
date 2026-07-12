export type EntryComparisonStatus =
  | 'not_compared'
  | 'matching'
  | 'differs'
  | 'only_left'
  | 'only_right'
  | 'scanning'
  | 'error';

export interface EntryComparisonResult {
  name: string;
  kind: 'file' | 'directory';
  status: EntryComparisonStatus;
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
