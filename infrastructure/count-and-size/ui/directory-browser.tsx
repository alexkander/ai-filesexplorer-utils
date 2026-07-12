'use client';

import { useEffect, useState } from 'react';
import { Ban, File, Folder, Link2, Loader2, ScanLine } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import { cn } from '@/lib/utils';
import { humanizeSize, exactBytesLabel } from './format-size';
import { formatDateTime } from './format-date';
import { STATE_LABELS } from './state-labels';
import {
  loadSortPreference,
  saveSortPreference,
} from '@/infrastructure/count-and-size/sort-preference-storage';
import type {
  DirectoryState,
  DirectoryView,
} from '@/domain/count-and-size/derive-directory-view';
import type {
  ListedEntry,
  SortBy,
  SortDir,
} from '@/application/count-and-size/list-directory';

const PAGE_SIZE = 200;
const SCAN_POLL_INTERVAL_MS = 2000;

interface Page {
  entries: ListedEntry[];
  hasMore: boolean;
}

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'type', label: 'Type' },
  { value: 'size', label: 'Size' },
  { value: 'count', label: 'Files' },
  { value: 'status', label: 'Status' },
  { value: 'date', label: 'Scanned' },
];

const TYPE_ICONS: Record<ListedEntry['type'], typeof Folder> = {
  directory: Folder,
  file: File,
  symlink: Link2,
  unreadable: Ban,
};

const STATUS_DOT_COLORS: Record<DirectoryState, string> = {
  not_scanned: 'bg-gray-400 dark:bg-gray-500',
  scanning: 'bg-blue-500',
  completed: 'bg-green-500',
  error: 'bg-red-500',
  stopped: 'bg-yellow-500',
};

function childPath(currentPath: string, name: string): string {
  return currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
}

async function fetchPage(
  path: string,
  offset: number,
  limit: number,
  sortBy: SortBy,
  sortDir: SortDir,
): Promise<Page | null> {
  const res = await fetch(
    `/api/count-and-size/list?path=${encodeURIComponent(path)}&offset=${offset}&limit=${limit}&sortBy=${sortBy}&sortDir=${sortDir}`,
  );
  if (!res.ok) return null;
  return (await res.json()) as Page;
}

export function DirectoryBrowser({
  currentPath,
  onNavigate,
  refreshToken,
}: {
  currentPath: string;
  onNavigate: (path: string) => void;
  /** Bumped by the parent whenever currentPath's own scan status changes
   * (poll tick, scan/stop) — triggers a re-fetch so subdirectory rows stay
   * live while/after a scan runs, not just on initial load. */
  refreshToken: number;
}) {
  const [entries, setEntries] = useState<ListedEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [sortHydrated, setSortHydrated] = useState(false);

  useEffect(() => {
    // Hydrating from an external system (localStorage) on mount — not
    // available during server rendering, so this can't be a lazy useState
    // initializer without a hydration mismatch.
    const preference = loadSortPreference();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSortBy(preference.sortBy);
    setSortDir(preference.sortDir);
    setSortHydrated(true);
  }, []);

  useEffect(() => {
    if (sortHydrated) saveSortPreference({ sortBy, sortDir });
  }, [sortBy, sortDir, sortHydrated]);

  useEffect(() => {
    let ignore = false;
    fetchPage(currentPath, 0, PAGE_SIZE, sortBy, sortDir).then((page) => {
      if (ignore) return;
      if (!page) {
        setError(true);
        return;
      }
      setError(false);
      setEntries(page.entries);
      setHasMore(page.hasMore);
    });
    return () => {
      ignore = true;
    };
  }, [currentPath, refreshToken, sortBy, sortDir]);

  // A row-triggered scan (handleScanEntry below) isn't covered by the
  // parent's refreshToken, which only tracks currentPath's own scan — so
  // poll independently while any currently-loaded entry is scanning,
  // re-fetching everything loaded so far (not just the first page).
  useEffect(() => {
    const anyScanning = entries.some(
      (e) => e.type === 'directory' && e.scanStatus?.state === 'scanning',
    );
    if (!anyScanning) return;
    let ignore = false;
    const id = setInterval(() => {
      fetchPage(
        currentPath,
        0,
        Math.max(entries.length, PAGE_SIZE),
        sortBy,
        sortDir,
      ).then((page) => {
        if (ignore || !page) return;
        setEntries(page.entries);
        setHasMore(page.hasMore);
      });
    }, SCAN_POLL_INTERVAL_MS);
    return () => {
      ignore = true;
      clearInterval(id);
    };
  }, [entries, currentPath, sortBy, sortDir]);

  const loadMore = async () => {
    setLoading(true);
    try {
      const page = await fetchPage(
        currentPath,
        entries.length,
        PAGE_SIZE,
        sortBy,
        sortDir,
      );
      if (!page) {
        setError(true);
        return;
      }
      setEntries((prev) => [...prev, ...page.entries]);
      setHasMore(page.hasMore);
    } finally {
      setLoading(false);
    }
  };

  const handleSortClick = (field: SortBy) => {
    if (field === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  };

  const handleScanEntry = async (entry: ListedEntry) => {
    const path = childPath(currentPath, entry.name);
    const optimisticStatus: DirectoryView = {
      state: 'scanning',
      incomplete: entry.scanStatus?.incomplete ?? false,
      aggregatedCount: entry.scanStatus?.aggregatedCount ?? 0,
      aggregatedSize: entry.scanStatus?.aggregatedSize ?? 0,
      lastScannedAt: entry.scanStatus?.lastScannedAt ?? null,
      hasUnreadableEntries: entry.scanStatus?.hasUnreadableEntries ?? false,
    };
    setEntries((prev) =>
      prev.map((e) =>
        e.name === entry.name ? { ...e, scanStatus: optimisticStatus } : e,
      ),
    );
    await fetch('/api/count-and-size/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    const page = await fetchPage(
      currentPath,
      0,
      Math.max(entries.length, PAGE_SIZE),
      sortBy,
      sortDir,
    );
    if (page) {
      setEntries(page.entries);
      setHasMore(page.hasMore);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <span>Sort by:</span>
        {SORT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleSortClick(option.value)}
            className={cn(
              'rounded px-2 py-1 hover:bg-accent',
              sortBy === option.value &&
                'bg-accent font-medium text-foreground',
            )}
          >
            {option.label}
            {sortBy === option.value && (sortDir === 'asc' ? ' ↑' : ' ↓')}
          </button>
        ))}
      </div>
      {error && (
        <p className="text-sm text-destructive">
          This directory could not be read.
        </p>
      )}
      <ul className="flex flex-col divide-y">
        {entries.map((entry) => {
          const Icon = TYPE_ICONS[entry.type];
          const isScanning = entry.scanStatus?.state === 'scanning';
          return (
            <li
              key={entry.name}
              className="flex items-center gap-3 rounded-sm px-2 py-1.5 text-sm hover:bg-accent/50"
            >
              <div className="flex min-w-0 shrink-0 items-center gap-1.5">
                <Icon
                  className="size-4 shrink-0 text-muted-foreground"
                  fill={entry.type === 'file' ? 'currentColor' : 'none'}
                  aria-hidden="true"
                />
                {entry.type === 'directory' ? (
                  <button
                    type="button"
                    onClick={() =>
                      onNavigate(childPath(currentPath, entry.name))
                    }
                    className="text-left hover:underline"
                  >
                    {entry.name}/
                  </button>
                ) : (
                  <span
                    className={cn(
                      entry.type !== 'file' && 'text-muted-foreground italic',
                    )}
                  >
                    {entry.name}
                    {entry.type === 'symlink' && ' (symlink)'}
                    {entry.type === 'unreadable' && ' (unreadable)'}
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
                {entry.type === 'file' && entry.size !== undefined && (
                  <span title={exactBytesLabel(entry.size)}>
                    {humanizeSize(entry.size)}
                  </span>
                )}
                {entry.type === 'directory' && (
                  <>
                    {entry.scanStatus && (
                      <>
                        <span
                          title={exactBytesLabel(
                            entry.scanStatus.aggregatedSize,
                          )}
                        >
                          {entry.scanStatus.aggregatedCount} files,{' '}
                          {humanizeSize(entry.scanStatus.aggregatedSize)}
                        </span>
                        {entry.scanStatus.lastScannedAt && (
                          <span>
                            {formatDateTime(entry.scanStatus.lastScannedAt)}
                          </span>
                        )}
                        {entry.scanStatus.incomplete && (
                          <span className="text-amber-600 dark:text-amber-500">
                            incomplete
                          </span>
                        )}
                        {entry.scanStatus.hasUnreadableEntries && (
                          <span className="text-amber-600 dark:text-amber-500">
                            has unreadable entries
                          </span>
                        )}
                      </>
                    )}
                    <span
                      className={cn(
                        'inline-block size-2.5 shrink-0 rounded-full',
                        STATUS_DOT_COLORS[
                          entry.scanStatus?.state ?? 'not_scanned'
                        ],
                      )}
                      title={
                        STATE_LABELS[entry.scanStatus?.state ?? 'not_scanned']
                      }
                    />
                  </>
                )}
              </div>
              <div className="flex size-6 shrink-0 items-center justify-center">
                {entry.type === 'directory' &&
                  (isScanning ? (
                    <Loader2
                      className="size-4 animate-spin text-muted-foreground"
                      aria-label="Scanning"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleScanEntry(entry)}
                      className="text-muted-foreground hover:text-foreground"
                      title="Scan this directory"
                    >
                      <ScanLine className="size-4" aria-hidden="true" />
                    </button>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>
      {entries.length === 0 && !loading && !error && (
        <p className="text-sm text-muted-foreground">Empty directory.</p>
      )}
      {hasMore && (
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void loadMore()}
          className="mt-2 self-start"
        >
          {loading ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
