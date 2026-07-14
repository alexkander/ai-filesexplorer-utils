import type {
  FileSystemPort,
  RawEntry,
} from '@/application/scanning/filesystem-port';
import type { EntryKind } from '@/domain/scanning/should-ignore-entry';
import type { SizeInfo, SizeInfoPort } from './size-info-port';

export type SortBy = 'name' | 'type' | 'size' | 'count';
export type SortDir = 'asc' | 'desc';

const TYPE_ORDER: Record<EntryKind, number> = {
  directory: 0,
  file: 1,
  symlink: 2,
  unreadable: 3,
};

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
 * Paginated, sortable listing for one pane (spec FR-001, FR-001a;
 * contracts/directory-comparison-api-contract.md GET /list). No comparison
 * data — a pane can be browsed independently of any Compare ever having run
 * (Story 1). `sizeInfoPort` is optional (added post-implementation) — when
 * given, each returned directory entry is looked up in Count and Size's own
 * database for a read-only file count/size overlay; omitting it (or a `null`
 * lookup result) just means no overlay, never an error.
 *
 * Sorting happens on the full listing before pagination, same rationale as
 * Count and Size's own listDirectory — a page-only sort would put the same
 * entry on different pages depending on the requested offset. `size`/`count`
 * therefore need every directory entry's sizeInfo looked up up front (one
 * query each), not just the returned page's.
 */
export async function listDirectory(
  targetPath: string,
  offset: number,
  limit: number,
  sortBy: SortBy,
  sortDir: SortDir,
  fileSystem: FileSystemPort,
  sizeInfoPort?: SizeInfoPort,
): Promise<ListDirectoryOutcome> {
  const outcome = await fileSystem.listChildren(targetPath);
  if (!outcome.ok) return { ok: false, reason: outcome.reason };

  const sizeInfoCache = new Map<string, SizeInfo | null>();
  const getSizeInfo = (entry: RawEntry): SizeInfo | null => {
    if (entry.kind !== 'directory') return null;
    const cached = sizeInfoCache.get(entry.path);
    if (cached !== undefined) return cached;
    const info = sizeInfoPort?.getSizeInfo(entry.path) ?? null;
    sizeInfoCache.set(entry.path, info);
    return info;
  };

  const needsSizeInfoForSort = sortBy === 'size' || sortBy === 'count';
  if (needsSizeInfoForSort) {
    for (const entry of outcome.result.entries) getSizeInfo(entry);
  }

  const sortValue = (entry: RawEntry): number => {
    switch (sortBy) {
      case 'type':
        return TYPE_ORDER[entry.kind];
      case 'size':
        return entry.kind === 'file'
          ? entry.size
          : (getSizeInfo(entry)?.totalSize ?? 0);
      case 'count':
        return entry.kind === 'file' ? 1 : (getSizeInfo(entry)?.fileCount ?? 0);
      default:
        return 0;
    }
  };

  const dir = sortDir === 'asc' ? 1 : -1;
  const sorted = [...outcome.result.entries].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name) * dir;
    const av = sortValue(a);
    const bv = sortValue(b);
    if (av === bv) return a.name.localeCompare(b.name);
    return av < bv ? -dir : dir;
  });

  const page = sorted.slice(offset, offset + limit);
  const hasMore = offset + limit < sorted.length;

  const entries: ListedEntry[] = page.map((entry) => {
    if (entry.kind === 'file') {
      return { name: entry.name, type: 'file', size: entry.size };
    }
    const sizeInfo = getSizeInfo(entry);
    return {
      name: entry.name,
      type: entry.kind,
      sizeInfo: sizeInfo ?? undefined,
    };
  });

  return { ok: true, result: { entries, hasMore } };
}
