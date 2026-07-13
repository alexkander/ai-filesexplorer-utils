import type {
  FileSystemPort,
  RawEntry,
} from '@/application/scanning/filesystem-port';
import type { ScanRepositoryPort } from './scan-repository-port';
import type { ChecksumInfoPort } from './checksum-info-port';
import type { EntryKind } from '@/domain/scanning/should-ignore-entry';
import {
  deriveDirectoryView,
  type DirectoryView,
  type DirectoryState,
} from '@/domain/count-and-size/derive-directory-view';

export type SortBy = 'name' | 'type' | 'size' | 'count' | 'status' | 'date';
export type SortDir = 'asc' | 'desc';

export interface ListedEntry {
  name: string;
  type: EntryKind;
  /** Files only — the entry's own size in bytes. */
  size?: number;
  /** Directories only, and only when scan data exists (FR-004). */
  scanStatus?: DirectoryView;
  /** Files and directories, read-only overlay from the separate
   * directory-comparison tool's own database (user request, mirrors the
   * reverse overlay directory-comparison already has for this tool's own
   * size info) — the full checksum last persisted for this exact path.
   * `undefined` when directory-comparison has never touched this path (or,
   * for a directory, its last comparison `differ`red — only a `matching`
   * directory has a per-side checksum persisted at all). */
  checksum?: string;
}

export interface ListDirectoryResult {
  entries: ListedEntry[];
  hasMore: boolean;
}

export type ListDirectoryOutcome =
  { ok: true; result: ListDirectoryResult } | { ok: false };

const TYPE_ORDER: Record<EntryKind, number> = {
  directory: 0,
  file: 1,
  symlink: 2,
  unreadable: 3,
};

const STATE_ORDER: Record<DirectoryState, number> = {
  not_scanned: 0,
  scanning: 1,
  completed: 2,
  error: 3,
  stopped: 4,
};

function getView(
  entry: RawEntry,
  scanRepository: ScanRepositoryPort,
  cache: Map<string, DirectoryView>,
): DirectoryView | undefined {
  if (entry.kind !== 'directory') return undefined;
  const cached = cache.get(entry.path);
  if (cached) return cached;
  const [node, ...descendants] = scanRepository.getSubtree(entry.path);
  const view = deriveDirectoryView(node ?? null, descendants);
  cache.set(entry.path, view);
  return view;
}

/**
 * Paginated, sortable browsing listing for one directory (spec FR-001,
 * FR-001a, FR-002, FR-003, FR-004, FR-004a, FR-004b;
 * contracts/count-and-size-api-contract.md GET /list). Each subdirectory
 * entry carries its full scan status (count, size, state, last-scanned)
 * when available; each file entry carries its own size.
 *
 * Sorting happens on the full listing before pagination — a page-only sort
 * would be meaningless (the same entry could land on different pages
 * depending on the requested offset). Sorting by `size`/`count`/`status`/
 * `date` therefore needs every directory entry's DirectoryView computed up
 * front
 * (one recursive query each), not just the returned page's; `name`/`type`
 * need no scan data at all.
 */
export async function listDirectory(
  targetPath: string,
  offset: number,
  limit: number,
  sortBy: SortBy,
  sortDir: SortDir,
  fileSystem: FileSystemPort,
  scanRepository: ScanRepositoryPort,
  checksumInfoPort?: ChecksumInfoPort,
): Promise<ListDirectoryOutcome> {
  const outcome = await fileSystem.listChildren(targetPath);
  if (!outcome.ok) return { ok: false };

  const viewCache = new Map<string, DirectoryView>();
  const needsScanDataForSort =
    sortBy === 'size' ||
    sortBy === 'count' ||
    sortBy === 'status' ||
    sortBy === 'date';
  if (needsScanDataForSort) {
    for (const entry of outcome.result.entries) {
      getView(entry, scanRepository, viewCache);
    }
  }

  const sortValue = (entry: RawEntry): number => {
    switch (sortBy) {
      case 'type':
        return TYPE_ORDER[entry.kind];
      case 'size':
        return entry.kind === 'file'
          ? entry.size
          : (viewCache.get(entry.path)?.aggregatedSize ?? 0);
      case 'count':
        return entry.kind === 'file'
          ? 1
          : (viewCache.get(entry.path)?.aggregatedCount ?? 0);
      case 'status':
        return entry.kind === 'directory'
          ? STATE_ORDER[viewCache.get(entry.path)?.state ?? 'not_scanned']
          : -1;
      case 'date':
        return 0; // handled separately below (string comparison)
      default:
        return 0;
    }
  };

  const dateValue = (entry: RawEntry): string =>
    entry.kind === 'directory'
      ? (viewCache.get(entry.path)?.lastScannedAt ?? '')
      : '';

  const dir = sortDir === 'asc' ? 1 : -1;
  const sorted = [...outcome.result.entries].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name) * dir;
    if (sortBy === 'date') {
      const av = dateValue(a);
      const bv = dateValue(b);
      if (av === bv) return a.name.localeCompare(b.name);
      return av < bv ? -dir : dir;
    }
    const av = sortValue(a);
    const bv = sortValue(b);
    if (av === bv) return a.name.localeCompare(b.name);
    return av < bv ? -dir : dir;
  });

  const page = sorted.slice(offset, offset + limit);
  const hasMore = offset + limit < sorted.length;

  const entries: ListedEntry[] = page.map((entry) => {
    if (entry.kind === 'directory') {
      const view = getView(entry, scanRepository, viewCache)!;
      return {
        name: entry.name,
        type: 'directory',
        scanStatus: view.state === 'not_scanned' ? undefined : view,
        checksum: checksumInfoPort?.getChecksum(entry.path) ?? undefined,
      };
    }
    if (entry.kind === 'file') {
      return {
        name: entry.name,
        type: 'file',
        size: entry.size,
        checksum: checksumInfoPort?.getChecksum(entry.path) ?? undefined,
      };
    }
    return { name: entry.name, type: entry.kind };
  });

  return { ok: true, result: { entries, hasMore } };
}
