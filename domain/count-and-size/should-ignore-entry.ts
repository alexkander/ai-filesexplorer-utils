export type EntryKind = 'file' | 'directory' | 'symlink' | 'unreadable';

export interface IgnorableEntry {
  kind: EntryKind;
}

export type IgnoreDecision =
  { ignore: false } | { ignore: true; reason: 'symlink' | 'unreadable' };

/**
 * Scanning decision for one directory entry (spec FR-015, FR-016). Symlinks
 * are never followed/counted; unreadable entries are skipped but flag their
 * containing directory. Plain files and directories are never ignored here
 * — directories become child scan procedures, files contribute to totals.
 */
export function shouldIgnoreEntry(entry: IgnorableEntry): IgnoreDecision {
  if (entry.kind === 'symlink') return { ignore: true, reason: 'symlink' };
  if (entry.kind === 'unreadable')
    return { ignore: true, reason: 'unreadable' };
  return { ignore: false };
}
