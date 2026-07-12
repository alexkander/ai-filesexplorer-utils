import type { FileSystemPort } from '@/application/scanning/filesystem-port';
import type { EntryKind } from '@/domain/scanning/should-ignore-entry';
import type { SizeInfo, SizeInfoPort } from './size-info-port';

export interface ListedEntry {
  name: string;
  type: EntryKind;
  /** Files only — the entry's own size in bytes. */
  size?: number;
  /** Directories only, and only when Count and Size has scanned this exact
   * path — read-only overlay from that tool's own database (spec FR-019,
   * user request). `undefined` (not just an absent count) when no data
   * exists, same convention Count and Size's own listing uses for
   * `scanStatus`. */
  sizeInfo?: SizeInfo;
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
 * (Story 1). `sizeInfoPort` is optional (added post-implementation) — when
 * given, each returned directory entry is looked up in Count and Size's own
 * database for a read-only file count/size overlay; omitting it (or a `null`
 * lookup result) just means no overlay, never an error.
 */
export async function listDirectory(
  targetPath: string,
  offset: number,
  limit: number,
  fileSystem: FileSystemPort,
  sizeInfoPort?: SizeInfoPort,
): Promise<ListDirectoryOutcome> {
  const outcome = await fileSystem.listChildren(targetPath);
  if (!outcome.ok) return { ok: false, reason: outcome.reason };

  const sorted = [...outcome.result.entries].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const page = sorted.slice(offset, offset + limit);
  const hasMore = offset + limit < sorted.length;

  const entries: ListedEntry[] = page.map((entry) => {
    if (entry.kind === 'file') {
      return { name: entry.name, type: 'file', size: entry.size };
    }
    const sizeInfo = sizeInfoPort?.getSizeInfo(entry.path) ?? null;
    return {
      name: entry.name,
      type: entry.kind,
      sizeInfo: sizeInfo ?? undefined,
    };
  });

  return { ok: true, result: { entries, hasMore } };
}
