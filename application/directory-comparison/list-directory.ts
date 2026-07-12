import type { FileSystemPort } from '@/application/scanning/filesystem-port';
import type { EntryKind } from '@/domain/scanning/should-ignore-entry';

export interface ListedEntry {
  name: string;
  type: EntryKind;
  /** Files only — the entry's own size in bytes. */
  size?: number;
}

export interface ListDirectoryResult {
  entries: ListedEntry[];
  hasMore: boolean;
}

export type ListDirectoryOutcome =
  | { ok: true; result: ListDirectoryResult }
  | { ok: false; reason: 'not_found' | 'unreadable' };

/**
 * Paginated listing for one pane (spec FR-001, FR-001a;
 * contracts/directory-comparison-api-contract.md GET /list). No comparison
 * data — a pane can be browsed independently of any Compare ever having run
 * (Story 1).
 */
export async function listDirectory(
  targetPath: string,
  offset: number,
  limit: number,
  fileSystem: FileSystemPort,
): Promise<ListDirectoryOutcome> {
  const outcome = await fileSystem.listChildren(targetPath);
  if (!outcome.ok) return { ok: false, reason: outcome.reason };

  const sorted = [...outcome.result.entries].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const page = sorted.slice(offset, offset + limit);
  const hasMore = offset + limit < sorted.length;

  const entries: ListedEntry[] = page.map((entry) =>
    entry.kind === 'file'
      ? { name: entry.name, type: 'file', size: entry.size }
      : { name: entry.name, type: entry.kind },
  );

  return { ok: true, result: { entries, hasMore } };
}
