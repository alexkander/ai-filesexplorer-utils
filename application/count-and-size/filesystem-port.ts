import type { EntryKind } from '@/domain/count-and-size/should-ignore-entry';

export interface RawEntry {
  name: string;
  path: string;
  kind: EntryKind;
  size: number;
}

export interface ListChildrenResult {
  entries: RawEntry[];
}

export type ListChildrenOutcome =
  | { ok: true; result: ListChildrenResult }
  | { ok: false; reason: 'unreadable' };

export interface FileSystemPort {
  listChildren(path: string): Promise<ListChildrenOutcome>;
}
