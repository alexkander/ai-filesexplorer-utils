import type { EntryKind } from '@/domain/scanning/should-ignore-entry';

export interface RawEntry {
  name: string;
  path: string;
  kind: EntryKind;
  size: number;
  /** Files only — ISO 8601. Undefined for directories/symlinks/unreadable
   * entries, which have no meaningful content modification time here. */
  modificationTime?: string;
}

export interface ListChildrenResult {
  entries: RawEntry[];
}

export type ListChildrenOutcome =
  | { ok: true; result: ListChildrenResult }
  | { ok: false; reason: 'not_found' | 'unreadable' };

export interface NameEntry {
  name: string;
  kind: EntryKind;
}

export interface ListChildrenNamesResult {
  entries: NameEntry[];
}

export type ListChildrenNamesOutcome =
  | { ok: true; result: ListChildrenNamesResult }
  | { ok: false; reason: 'not_found' | 'unreadable' };

export interface FileSystemPort {
  listChildren(path: string): Promise<ListChildrenOutcome>;

  /** Name + kind only, no per-entry `stat()` call — for callers that only
   * pair entries by name (e.g. directory-comparison's live status view),
   * not size/mtime. `listChildren` stats every file individually to get
   * size, which on a directory with thousands of files (especially over a
   * network filesystem) turns one call into tens of seconds; this skips
   * that entirely by reading only the directory entries' own type bits.
   * Never reports `'unreadable'` (that requires the stat this deliberately
   * avoids) — an unreadable file just comes back as `'file'`. */
  listChildrenNames(path: string): Promise<ListChildrenNamesOutcome>;

  /** Cheap existence check (a single stat, no directory read) — used where
   * a caller already knows a path and just needs to confirm it's still
   * there, without paying for a full `listChildren` walk of it. */
  pathExists(path: string): Promise<boolean>;
}
