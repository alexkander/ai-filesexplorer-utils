'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, File, Folder, Loader2, Trash2 } from 'lucide-react';
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

// Safety cap on how many pages a single "load more" (or the initial load)
// will auto-continue through while every fetched page is fully hidden by
// "Hide matching" — without this, a pair of near-identical multi-thousand-
// entry directories could turn one click into an unbounded fetch loop.
const MAX_AUTO_PAGES = 50;

function pageIsFullyHidden(
  pageEntries: ListedEntry[],
  hideMatching: boolean | undefined,
  statusByName: Map<string, EntryComparisonStatus> | undefined,
): boolean {
  if (!hideMatching || pageEntries.length === 0) return false;
  return pageEntries.every((entry) => {
    const status = statusByName?.get(entry.name);
    return !!status && MATCHING_STATUSES.has(status);
  });
}

export function ComparisonPane({
  path,
  side,
  onNavigate,
  statusByName,
  checksumByName,
  refreshToken,
  onCopyToOtherSide,
  onDeleteFromThisSide,
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
  /** Called with the entry name when the user confirms permanently deleting
   * an "only on this side" entry (spec: user request, mirrors
   * onCopyToOtherSide) — same condition as the Copy button, offered as an
   * alternative to it: resolve a one-sided diff either by copying the
   * missing side in, or by deleting the extra one. The parent owns the
   * confirmation prompt, the actual delete request, and re-fetching this
   * pane's own listing afterward. */
  onDeleteFromThisSide?: (name: string) => Promise<void>;
  /** Shared by both panes — set by the parent's single sort control. */
  sortBy: SortBy;
  sortDir: SortDir;
  /** Shared by both panes — hides entries whose comparison status is
   * `matching`/`matching_empty` (spec/user request), so a mostly-identical
   * pair only shows what actually needs attention. Also drives pagination:
   * both the initial load and "Load more" keep auto-fetching subsequent
   * pages (up to `MAX_AUTO_PAGES`) while every entry on the page fetched so
   * far is hidden, so a click actually surfaces something instead of
   * silently appending another fully-hidden page. */
  hideMatching?: boolean;
}) {
  const [entries, setEntries] = useState<ListedEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [copyingName, setCopyingName] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);

  // hideMatching/statusByName deliberately are NOT effect dependencies below
  // — statusByName is a brand-new Map identity on every parent render (every
  // status poll tick), so depending on it would re-run the initial fetch
  // from scratch constantly. Refs let the fetch loop read the latest value
  // each iteration without that.
  const hideMatchingRef = useRef(hideMatching);
  const statusByNameRef = useRef(statusByName);
  useEffect(() => {
    hideMatchingRef.current = hideMatching;
    statusByNameRef.current = statusByName;
  }, [hideMatching, statusByName]);

  // Generation counter + busy flag guarding every path that can fetch a
  // page (initial load, "Load more", and the auto-continue effect below).
  // Plain `loading` state isn't enough: it only takes effect on the next
  // render, leaving a window where two continuation triggers ("Load more"
  // and the hideMatching auto-continue effect) could both see "not
  // loading" and start overlapping fetches that each append the same page,
  // duplicating rows — refs close that window since they mutate
  // immediately. But a hard "busy means refuse" mutex has its own failure
  // mode: if `path`/sortBy/sortDir/refreshToken change (a real reset, e.g.
  // hydrating leftPath from localStorage right after mount) *while* a
  // stale fetch for the OLD path is still in flight, a plain busy flag
  // would make the new, correct fetch silently no-op, leaving the pane
  // stuck showing the old path's listing forever. A reset always bumps the
  // generation and proceeds regardless of busy state; every fetch checks
  // its own generation after each await and abandons itself (without
  // touching state) the moment a newer one has superseded it.
  const fetchGenerationRef = useRef(0);
  const isFetchingRef = useRef(false);

  const fetchFromOffset = async (startOffset: number, reset: boolean) => {
    if (reset) {
      fetchGenerationRef.current += 1;
    } else if (isFetchingRef.current) {
      return;
    }
    const myGeneration = fetchGenerationRef.current;
    isFetchingRef.current = true;
    setLoading(true);
    try {
      let offset = startOffset;
      let collected: ListedEntry[] = reset ? [] : entries;
      let pagesFetched = 0;
      for (;;) {
        const result = await fetchPage(
          path,
          offset,
          PAGE_SIZE,
          sortBy,
          sortDir,
        );
        if (fetchGenerationRef.current !== myGeneration) return;
        if (result.status === 'not_found') {
          setNotFound(true);
          setError(false);
          setEntries([]);
          setHasMore(false);
          return;
        }
        if (result.status === 'error') {
          setNotFound(false);
          setError(true);
          if (reset) setEntries([]);
          setHasMore(false);
          return;
        }
        setNotFound(false);
        setError(false);
        collected = [...collected, ...result.page.entries];
        pagesFetched += 1;
        setEntries(collected);
        setHasMore(result.page.hasMore);

        const keepGoing =
          pageIsFullyHidden(
            result.page.entries,
            hideMatchingRef.current,
            statusByNameRef.current,
          ) &&
          result.page.hasMore &&
          pagesFetched < MAX_AUTO_PAGES;
        if (!keepGoing) return;
        offset += PAGE_SIZE;
      }
    } finally {
      // Only the fetch that's still current clears the busy flag/spinner —
      // a superseded one finishing later must not clobber a newer fetch's
      // in-progress state.
      if (fetchGenerationRef.current === myGeneration) {
        isFetchingRef.current = false;
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    void fetchFromOffset(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleDelete = async (name: string) => {
    if (!onDeleteFromThisSide) return;
    setDeletingName(name);
    try {
      await onDeleteFromThisSide(name);
    } finally {
      setDeletingName(null);
    }
  };

  const loadMore = () => fetchFromOffset(entries.length, false);

  const visibleEntries = hideMatching
    ? entries.filter((entry) => {
        const status = statusByName?.get(entry.name);
        return !status || !MATCHING_STATUSES.has(status);
      })
    : entries;

  // Covers the case fetchFromOffset's own auto-continue doesn't: "Hide
  // matching" gets toggled ON (or statusByName finishes arriving) *after* a
  // page already loaded, leaving every already-loaded entry hidden with
  // nothing on screen to click "Load more" from. `allCurrentlyHidden` is a
  // plain boolean (not a Map), so it's safe as an effect dependency — it
  // only actually changes, and re-triggers this, on a true transition, even
  // though it's recomputed every render. The `isFetchingRef` guard inside
  // `fetchFromOffset` (not just checking `loading` here) is what actually
  // prevents this from racing the initial load above.
  const allCurrentlyHidden =
    hideMatching === true && entries.length > 0 && visibleEntries.length === 0;

  useEffect(() => {
    if (!allCurrentlyHidden || !hasMore) return;
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCurrentlyHidden, hasMore]);

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
              {status === ONLY_ON_THIS_SIDE[side] && onDeleteFromThisSide && (
                <button
                  type="button"
                  onClick={() => void handleDelete(entry.name)}
                  disabled={deletingName !== null}
                  className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-50"
                  title={`Move "${entry.name}" to trash`}
                >
                  {deletingName === entry.name ? (
                    <Loader2
                      className="size-4 animate-spin"
                      aria-label="Deleting"
                    />
                  ) : (
                    <Trash2 className="size-4" aria-hidden="true" />
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
