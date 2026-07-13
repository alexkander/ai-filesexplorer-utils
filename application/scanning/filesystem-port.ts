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

export interface FileSystemPort {
  listChildren(path: string): Promise<ListChildrenOutcome>;

  /** Cheap existence check (a single stat, no directory read) — used where
   * a caller already knows a path and just needs to confirm it's still
   * there, without paying for a full `listChildren` walk of it. */
  pathExists(path: string): Promise<boolean>;
}
