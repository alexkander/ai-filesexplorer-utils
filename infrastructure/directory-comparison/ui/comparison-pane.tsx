'use client';

import { useEffect, useState } from 'react';
import { File, Folder } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import { cn } from '@/lib/utils';
import type {
  ListedEntry,
  ListDirectoryResult,
} from '@/application/directory-comparison/list-directory';
import type { EntryComparisonStatus } from '@/domain/directory-comparison/entry-comparison-result';
import {
  COMPARISON_STATUS_COLORS,
  COMPARISON_STATUS_LABELS,
} from './comparison-status-colors';

const PAGE_SIZE = 200;

type FetchResult =
  | { status: 'ok'; page: ListDirectoryResult }
  | { status: 'not_found' }
  | { status: 'error' };

async function fetchPage(
  path: string,
  offset: number,
  limit: number,
): Promise<FetchResult> {
  const res = await fetch(
    `/api/directory-comparison/list?path=${encodeURIComponent(path)}&offset=${offset}&limit=${limit}`,
  );
  if (res.status === 404) return { status: 'not_found' };
  if (!res.ok) return { status: 'error' };
  return { status: 'ok', page: (await res.json()) as ListDirectoryResult };
}

export function ComparisonPane({
  path,
  onNavigate,
  statusByName,
}: {
  path: string;
  /** Called with the *name* of the subdirectory entered (not the full
   * path) — the parent owns computing the resulting absolute path for both
   * this pane and, if Move sync is on, the other pane's equivalent move. */
  onNavigate: (name: string) => void;
  /** From the shared `useComparisonStatus` poll (one per pair, not per
   * pane) — `undefined` before any Compare has ever been pressed. */
  statusByName?: Map<string, EntryComparisonStatus>;
}) {
  const [entries, setEntries] = useState<ListedEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let ignore = false;
    fetchPage(path, 0, PAGE_SIZE).then((result) => {
      if (ignore) return;
      setNotFound(false);
      setError(false);
      if (result.status === 'not_found') {
        setNotFound(true);
        setEntries([]);
        setHasMore(false);
        return;
      }
      if (result.status === 'error') {
        setError(true);
        setEntries([]);
        setHasMore(false);
        return;
      }
      setEntries(result.page.entries);
      setHasMore(result.page.hasMore);
    });
    return () => {
      ignore = true;
    };
  }, [path]);

  const loadMore = async () => {
    setLoading(true);
    try {
      const result = await fetchPage(path, entries.length, PAGE_SIZE);
      if (result.status !== 'ok') {
        setError(true);
        return;
      }
      setEntries((prev) => [...prev, ...result.page.entries]);
      setHasMore(result.page.hasMore);
    } finally {
      setLoading(false);
    }
  };

  if (notFound) {
    return (
      <p className="p-4 text-sm text-muted-foreground italic">
        Not found — this path doesn&apos;t exist on this side.
      </p>
    );
  }

  if (error) {
    return (
      <p className="p-4 text-sm text-destructive">
        This directory could not be read.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      <ul className="flex flex-col divide-y">
        {entries.map((entry) => {
          const status = statusByName?.get(entry.name);
          return (
            <li
              key={entry.name}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent/50"
            >
              {entry.type === 'directory' ? (
                <>
                  <Folder
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={() => onNavigate(entry.name)}
                    className="min-w-0 flex-1 truncate text-left hover:underline"
                  >
                    {entry.name}/
                  </button>
                </>
              ) : (
                <>
                  <File
                    className="size-4 shrink-0 text-muted-foreground"
                    fill="currentColor"
                    aria-hidden="true"
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      entry.type !== 'file' && 'text-muted-foreground italic',
                    )}
                  >
                    {entry.name}
                  </span>
                </>
              )}
              {status && (
                <span
                  className={cn(
                    'inline-block size-2.5 shrink-0 rounded-full',
                    COMPARISON_STATUS_COLORS[status],
                  )}
                  title={COMPARISON_STATUS_LABELS[status]}
                />
              )}
            </li>
          );
        })}
      </ul>
      {entries.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">Empty directory.</p>
      )}
      {hasMore && (
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={() => void loadMore()}
          className="self-start"
        >
          {loading ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}
