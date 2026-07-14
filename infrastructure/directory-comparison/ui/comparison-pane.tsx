'use client';

import { useEffect, useState } from 'react';
import { Copy, File, Folder, Loader2 } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import { cn } from '@/lib/utils';
import type {
  ListedEntry,
  ListDirectoryResult,
  SortBy,
  SortDir,
} from '@/application/directory-comparison/list-directory';
import type { EntryComparisonStatus } from '@/domain/directory-comparison/entry-comparison-result';
import {
  COMPARISON_STATUS_COLORS,
  COMPARISON_STATUS_LABELS,
} from './comparison-status-colors';
import { humanizeSize, exactBytesLabel } from './format-size';

const PAGE_SIZE = 200;

type FetchResult =
  | { status: 'ok'; page: ListDirectoryResult }
  | { status: 'not_found' }
  | { status: 'error' };

async function fetchPage(
  path: string,
  offset: number,
  limit: number,
  sortBy: SortBy,
  sortDir: SortDir,
): Promise<FetchResult> {
  const res = await fetch(
    `/api/directory-comparison/list?path=${encodeURIComponent(path)}&offset=${offset}&limit=${limit}&sortBy=${sortBy}&sortDir=${sortDir}`,
  );
  if (res.status === 404) return { status: 'not_found' };
  if (!res.ok) return { status: 'error' };
  return { status: 'ok', page: (await res.json()) as ListDirectoryResult };
}

const ONLY_ON_THIS_SIDE: Record<'left' | 'right', EntryComparisonStatus> = {
  left: 'only_left',
  right: 'only_right',
};

const MATCHING_STATUSES: ReadonlySet<EntryComparisonStatus> = new Set([
  'matching',
  'matching_empty',
]);

export function ComparisonPane({
  path,
  side,
  onNavigate,
  statusByName,
  checksumByName,
  refreshToken,
  onCopyToOtherSide,
  sortBy,
  sortDir,
  hideMatching,
}: {
  path: string;
  /** Which pane this is — determines which "only on this side" status
   * (only_left vs only_right) means "I have this, the other side doesn't"
   * and should offer a copy button. */
  side: 'left' | 'right';
  /** Called with the *name* of the subdirectory entered (not the full
   * path) — the parent owns computing the resulting absolute path for both
   * this pane and, if Move sync is on, the other pane's equivalent move. */
  onNavigate: (name: string) => void;
  /** From the shared `useComparisonStatus` poll (one per pair, not per
   * pane) — `undefined` before any Compare has ever been pressed. */
  statusByName?: Map<string, EntryComparisonStatus>;
  /** This side's own persisted full checksum per entry name (file's full
   * checksum, or a directory's Merkle root when it matched) — `undefined`
   * before any Compare, `null` per-entry when nothing's persisted yet (see
   * `EntryComparisonResult.leftChecksum`/`rightChecksum` for exactly when
   * that happens). */
  checksumByName?: Map<string, string | null>;
  /** Bumped by the parent after a copy lands a new entry on this side, to
   * force a re-fetch of this pane's own listing (which otherwise only
   * re-fetches when `path` itself changes). */
  refreshToken?: number;
  /** Called with the entry name when the user confirms copying an
   * "only on this side" entry to the other pane's current directory. The
   * parent owns the confirmation prompt, the actual copy request, and
   * bumping the destination pane's `refreshToken` afterward. */
  onCopyToOtherSide?: (name: string) => Promise<void>;
  /** Shared by both panes — set by the parent's single sort control. */
  sortBy: SortBy;
  sortDir: SortDir;
  /** Shared by both panes — hides entries whose comparison status is
   * `matching`/`matching_empty` (spec/user request), so a mostly-identical
   * pair only shows what actually needs attention. Purely a display filter
   * over the already-loaded page — doesn't affect `hasMore`/pagination. */
  hideMatching?: boolean;
}) {
  const [entries, setEntries] = useState<ListedEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [copyingName, setCopyingName] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    fetchPage(path, 0, PAGE_SIZE, sortBy, sortDir).then((result) => {
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
  }, [path, refreshToken, sortBy, sortDir]);

  const handleCopy = async (name: string) => {
    if (!onCopyToOtherSide) return;
    setCopyingName(name);
    try {
      await onCopyToOtherSide(name);
    } finally {
      setCopyingName(null);
    }
  };

  const loadMore = async () => {
    setLoading(true);
    try {
      const result = await fetchPage(
        path,
        entries.length,
        PAGE_SIZE,
        sortBy,
        sortDir,
      );
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

  const visibleEntries = hideMatching
    ? entries.filter((entry) => {
        const status = statusByName?.get(entry.name);
        return !status || !MATCHING_STATUSES.has(status);
      })
    : entries;

  return (
    <div className="flex flex-col gap-2 p-2">
      <ul className="flex flex-col divide-y">
        {visibleEntries.map((entry) => {
          const status = statusByName?.get(entry.name);
          const checksum = checksumByName?.get(entry.name);
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
              {entry.type === 'directory' && entry.sizeInfo && (
                <span
                  className="shrink-0 text-xs text-muted-foreground"
                  title={exactBytesLabel(entry.sizeInfo.totalSize)}
                >
                  {entry.sizeInfo.fileCount.toLocaleString()} files,{' '}
                  {humanizeSize(entry.sizeInfo.totalSize)}
                  {entry.sizeInfo.incomplete && (
                    <span
                      className="text-amber-600 dark:text-amber-500"
                      title="Count and Size's own scan of this directory hasn't fully completed — this total may be partial"
                    >
                      {' '}
                      (partial)
                    </span>
                  )}
                </span>
              )}
              {checksum && (
                <span
                  className="shrink-0 font-mono text-xs text-muted-foreground"
                  title={`Full checksum: ${checksum}`}
                >
                  {checksum.slice(0, 8)}
                </span>
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
              {status === ONLY_ON_THIS_SIDE[side] && onCopyToOtherSide && (
                <button
                  type="button"
                  onClick={() => void handleCopy(entry.name)}
                  disabled={copyingName !== null}
                  className="shrink-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
                  title={`Copy "${entry.name}" to the other side`}
                >
                  {copyingName === entry.name ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-label="Copying"
                    />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {entries.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground">Empty directory.</p>
      )}
      {entries.length > 0 && visibleEntries.length === 0 && !loading && (
        <p className="text-sm text-muted-foreground italic">
          Everything here matches — hidden by &quot;Hide matching&quot;.
        </p>
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
