'use client';

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
} from 'react';
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

// Drag-and-drop rename (spec: user request): drag a file from one pane onto
// a file on the other pane to rename the drop target to the dragged file's
// name. One MIME type per SOURCE side (rather than a single type with the
// side inside a JSON payload) so `onDragOver` can tell a same-side drag
// from a cross-side one just from `dataTransfer.types` — browsers withhold
// `getData` until the actual `drop` for security, so encoding the side in
// the type itself is the only way to gate hover feedback (and the
// `preventDefault` that allows a drop at all) to valid cross-side drags.
function otherSide(side: 'left' | 'right'): 'left' | 'right' {
  return side === 'left' ? 'right' : 'left';
}
function dragMimeType(sourceSide: 'left' | 'right'): string {
  return `application/x-directory-comparison-entry-${sourceSide}`;
}

function childPath(currentPath: string, name: string): string {
  return currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
}

// Hover-thumbnail preview (spec: user request): matches by extension only,
// same trust-the-extension approach `get-thumbnail.ts` uses server-side —
// no content sniffing, and formats browsers can't render inline (heic/tiff)
// are deliberately left out even though some cameras/exports use them.
const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif',
  'ico',
]);

function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

const PREVIEW_HOVER_DELAY_MS = 300;
const PREVIEW_SIZE_PX = 256;
const PREVIEW_MARGIN_PX = 8;

interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
}

// Fixed positioning (viewport-relative) rather than absolute-relative-to-row
// is deliberate: both panes scroll inside an `overflow-y-auto` ancestor, so
// an absolutely positioned popup would get clipped whenever the hovered row
// is near the top/bottom edge of that scroll area. Flips above the row, and
// clamps horizontally, when there isn't room below/to the right.
function previewPopupStyle(anchor: AnchorRect): CSSProperties {
  const spaceBelow = window.innerHeight - anchor.bottom;
  const top =
    spaceBelow >= PREVIEW_SIZE_PX + PREVIEW_MARGIN_PX
      ? anchor.bottom + PREVIEW_MARGIN_PX
      : Math.max(
          PREVIEW_MARGIN_PX,
          anchor.top - PREVIEW_SIZE_PX - PREVIEW_MARGIN_PX,
        );
  const left = Math.min(
    anchor.left,
    window.innerWidth - PREVIEW_SIZE_PX - PREVIEW_MARGIN_PX,
  );
  return { top, left: Math.max(PREVIEW_MARGIN_PX, left) };
}

// Safety cap on how many pages a single "load more" (or the initial load)
// will auto-continue through while every fetched page is fully hidden by
// "Hide matching" — without this, a pair of near-identical multi-thousand-
// entry directories could turn one click into an unbounded fetch loop.
const MAX_AUTO_PAGES = 50;

function isEntryHidden(
  entry: ListedEntry,
  statusByName: Map<string, EntryComparisonStatus> | undefined,
): boolean {
  const status = statusByName?.get(entry.name);
  return !!status && MATCHING_STATUSES.has(status);
}

// Count of entries in this page that "Hide matching" would NOT hide — used
// to decide whether a fetch should keep auto-continuing to the next page.
// Stopping as soon as a page has *any* visible entry (the original check)
// undercounts badly: a page of 100 fetched entries with only 10 visible
// would surface just those 10 and stop, instead of continuing to fill out
// something closer to a full page's worth of entries actually worth
// looking at.
function countVisible(
  pageEntries: ListedEntry[],
  statusByName: Map<string, EntryComparisonStatus> | undefined,
): number {
  return pageEntries.filter((entry) => !isEntryHidden(entry, statusByName))
    .length;
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
  onRenameDrop,
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
  /** Called when a file dragged from the OTHER pane is dropped onto a file
   * in THIS pane (spec: user request) — `droppedOnName` is this pane's
   * entry the drop landed on, `draggedName` is the name to rename it to.
   * Cross-side-only and file-only: enforced by this component before
   * calling it (dragging within the same pane, dropping on a directory, or
   * dropping a directory, all no-op). The parent owns the confirmation
   * prompt, the actual rename request, and re-fetching this pane's own
   * listing afterward. */
  onRenameDrop?: (droppedOnName: string, draggedName: string) => Promise<void>;
  /** Shared by both panes — set by the parent's single sort control. */
  sortBy: SortBy;
  sortDir: SortDir;
  /** Shared by both panes — hides entries whose comparison status is
   * `matching`/`matching_empty` (spec/user request), so a mostly-identical
   * pair only shows what actually needs attention. Also drives pagination:
   * both the initial load and "Load more" keep auto-fetching subsequent
   * pages (up to `MAX_AUTO_PAGES`) until roughly a full page's worth of
   * *visible* entries has been collected, not just until the raw fetched
   * page happens to contain one — otherwise a page with only a handful of
   * visible entries among hundreds hidden would surface just those few and
   * stop. */
  hideMatching?: boolean;
}) {
  const [entries, setEntries] = useState<ListedEntry[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [copyingName, setCopyingName] = useState<string | null>(null);
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const [dragOverName, setDragOverName] = useState<string | null>(null);
  const [previewEntry, setPreviewEntry] = useState<{
    name: string;
    anchor: AnchorRect;
  } | null>(null);
  const previewTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    };
  }, []);

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
      // Visible-entry count accumulated *within this call* (not counting
      // whatever was already on screen before it) — the target is roughly
      // one page's worth of entries actually worth looking at, not one raw
      // page of the underlying listing.
      let visibleAccumulated = 0;
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
        visibleAccumulated += countVisible(
          result.page.entries,
          statusByNameRef.current,
        );
        setEntries(collected);
        setHasMore(result.page.hasMore);

        const keepGoing =
          hideMatchingRef.current === true &&
          visibleAccumulated < PAGE_SIZE &&
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

  const handleDragStart = (e: DragEvent<HTMLLIElement>, entry: ListedEntry) => {
    if (entry.type !== 'file') return;
    e.dataTransfer.setData(dragMimeType(side), entry.name);
    e.dataTransfer.effectAllowed = 'move';
  };

  const acceptsDrop = (e: DragEvent<HTMLLIElement>, entry: ListedEntry) =>
    entry.type === 'file' &&
    e.dataTransfer.types.includes(dragMimeType(otherSide(side)));

  const handleDragOver = (e: DragEvent<HTMLLIElement>, entry: ListedEntry) => {
    if (!acceptsDrop(e, entry)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (e: DragEvent<HTMLLIElement>, entry: ListedEntry) => {
    if (!acceptsDrop(e, entry)) return;
    setDragOverName(entry.name);
  };

  const handleDragLeave = (e: DragEvent<HTMLLIElement>, entry: ListedEntry) => {
    // The browser fires dragleave/dragenter on the <li> every time the
    // pointer crosses into or out of one of its children (the folder icon,
    // the name button, etc.), not just when it truly leaves the row — left
    // unguarded, that flickers the drop-target highlight on and off while
    // hovering. `relatedTarget` is the element the pointer is entering;
    // if it's still inside this <li>, this isn't a real exit.
    if (
      e.relatedTarget instanceof Node &&
      e.currentTarget.contains(e.relatedTarget)
    ) {
      return;
    }
    setDragOverName((current) => (current === entry.name ? null : current));
  };

  const handleDrop = (e: DragEvent<HTMLLIElement>, entry: ListedEntry) => {
    setDragOverName(null);
    if (!acceptsDrop(e, entry) || !onRenameDrop) return;
    e.preventDefault();
    const draggedName = e.dataTransfer.getData(dragMimeType(otherSide(side)));
    if (!draggedName || draggedName === entry.name) return;
    void onRenameDrop(entry.name, draggedName);
  };

  const handleNameMouseEnter = (
    e: MouseEvent<HTMLSpanElement>,
    entry: ListedEntry,
  ) => {
    if (entry.type !== 'file' || !isImageFile(entry.name)) return;
    const { top, bottom, left } = e.currentTarget.getBoundingClientRect();
    if (previewTimeoutRef.current) clearTimeout(previewTimeoutRef.current);
    previewTimeoutRef.current = setTimeout(() => {
      setPreviewEntry({ name: entry.name, anchor: { top, bottom, left } });
    }, PREVIEW_HOVER_DELAY_MS);
  };

  const handleNameMouseLeave = () => {
    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
      previewTimeoutRef.current = null;
    }
    setPreviewEntry(null);
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
  // page already loaded, leaving FEWER THAN a full page's worth of visible
  // entries on screen — anywhere from none at all up to a handful out of a
  // couple hundred loaded — with nothing to click "Load more" from. Must be
  // "fewer than a page", not "exactly zero": a page can easily have, say, 5
  // visible entries out of 200 fetched, which is correct as far as it goes
  // but still leaves a lot more possibly-visible content unfetched on
  // later pages. `needsMoreVisible` is a plain boolean (not a Map), so it's
  // safe as an effect dependency — it only actually changes, and
  // re-triggers this, on a real transition, even though it's recomputed
  // every render. The `isFetchingRef` guard inside `fetchFromOffset` (not
  // just checking `loading` here) is what actually prevents this from
  // racing the initial load above.
  const needsMoreVisible =
    hideMatching === true && visibleEntries.length < PAGE_SIZE;

  useEffect(() => {
    if (!needsMoreVisible || !hasMore) return;
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsMoreVisible, hasMore]);

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
              draggable={entry.type === 'file'}
              onDragStart={(e) => handleDragStart(e, entry)}
              onDragOver={(e) => handleDragOver(e, entry)}
              onDragEnter={(e) => handleDragEnter(e, entry)}
              onDragLeave={(e) => handleDragLeave(e, entry)}
              onDrop={(e) => handleDrop(e, entry)}
              className={cn(
                'flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent/50',
                entry.type === 'file' && 'cursor-grab active:cursor-grabbing',
                dragOverName === entry.name &&
                  'bg-accent ring-2 ring-inset ring-primary/50',
              )}
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
                      entry.type === 'file' &&
                        isImageFile(entry.name) &&
                        'cursor-zoom-in',
                    )}
                    onMouseEnter={(e) => handleNameMouseEnter(e, entry)}
                    onMouseLeave={handleNameMouseLeave}
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
      {previewEntry && (
        <div
          className="pointer-events-none fixed z-50 rounded-md border bg-popover p-1 shadow-lg"
          style={previewPopupStyle(previewEntry.anchor)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary
              absolute filesystem paths, not a next/image-compatible source */}
          <img
            src={`/api/directory-comparison/thumbnail?path=${encodeURIComponent(childPath(path, previewEntry.name))}`}
            alt=""
            className="block max-h-64 max-w-64 rounded object-contain"
            onError={() => setPreviewEntry(null)}
          />
        </div>
      )}
    </div>
  );
}
