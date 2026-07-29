'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, CornerLeftUp, File, Files, Folder } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import type {
  DirectoryRow,
  DirectorySortBy,
} from '@/domain/duplicate-finder/directory-row';
import type { SortDir } from '@/domain/duplicate-finder/duplicate-group';
import { cn } from '@/lib/utils';
import { CopyButton } from './copy-button';
import {
  OccurrencesDialog,
  type OccurrencesTarget,
} from './occurrences-dialog';
import { exactBytesLabel, humanizeSize } from './format-size';

interface DirectoryView {
  rootPath: string | null;
  currentPath: string | null;
  parentPath: string | null;
  rows: DirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
  subtreeCount: number;
  subtreeSize: number;
  overallCount: number;
  overallSize: number;
}

const SORT_OPTIONS: { value: DirectorySortBy; label: string }[] = [
  { value: 'count', label: 'Duplicates' },
  { value: 'size', label: 'Size' },
  { value: 'name', label: 'Name' },
];

/** The path split into clickable segments, from the scanned root down. */
function breadcrumbSegments(
  rootPath: string,
  currentPath: string,
): { label: string; path: string }[] {
  const segments = [{ label: rootPath, path: rootPath }];
  if (currentPath === rootPath) return segments;

  const rest = currentPath
    .slice(rootPath === '/' ? 1 : rootPath.length + 1)
    .split('/');
  let path = rootPath === '/' ? '' : rootPath;
  for (const name of rest) {
    path = `${path}/${name}`;
    segments.push({ label: name, path });
  }
  return segments;
}

export function DirectoryDuplicatesView({
  sortBy,
  sortDir,
  hideEmpty,
  excludeEmptyFiles,
  excludeEmptyDirectories,
  onSortChange,
  onHideEmptyChange,
  onExcludeEmptyFilesChange,
  onExcludeEmptyDirectoriesChange,
  refreshKey,
}: {
  sortBy: DirectorySortBy;
  sortDir: SortDir;
  hideEmpty: boolean;
  excludeEmptyFiles: boolean;
  excludeEmptyDirectories: boolean;
  onSortChange: (sortBy: DirectorySortBy, sortDir: SortDir) => void;
  onHideEmptyChange: (hideEmpty: boolean) => void;
  onExcludeEmptyFilesChange: (value: boolean) => void;
  onExcludeEmptyDirectoriesChange: (value: boolean) => void;
  refreshKey: number;
}) {
  const [path, setPath] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<DirectoryView | null>(null);
  const [occurrencesTarget, setOccurrencesTarget] =
    useState<OccurrencesTarget | null>(null);

  const fetchView = useCallback(async (): Promise<DirectoryView | null> => {
    const query = new URLSearchParams({
      sortBy,
      sortDir,
      hideEmpty: String(hideEmpty),
      excludeEmptyFiles: String(excludeEmptyFiles),
      excludeEmptyDirectories: String(excludeEmptyDirectories),
      page: String(page),
    });
    if (path) query.set('path', path);
    const res = await fetch(`/api/duplicate-finder/directory?${query}`);
    if (!res.ok) return null;
    return (await res.json()) as DirectoryView;
  }, [
    sortBy,
    sortDir,
    hideEmpty,
    excludeEmptyFiles,
    excludeEmptyDirectories,
    page,
    path,
  ]);

  /** Refetch on demand — after a deletion, whose freed bytes and lowered
   * counts have to show up in every row above it. */
  const load = useCallback(async () => {
    const next = await fetchView();
    if (next) setView(next);
  }, [fetchView]);

  useEffect(() => {
    let ignore = false;
    fetchView().then((next) => {
      if (!ignore && next) setView(next);
    });
    return () => {
      ignore = true;
    };
  }, [fetchView, refreshKey]);

  const navigate = (nextPath: string) => {
    setPath(nextPath);
    setPage(0);
  };

  const changeSort = (field: DirectorySortBy) => {
    setPage(0);
    if (field === sortBy) {
      onSortChange(field, sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      // Name reads naturally A→Z; the two numeric columns are interesting
      // from the top down.
      onSortChange(field, field === 'name' ? 'asc' : 'desc');
    }
  };

  if (!view || !view.rootPath || !view.currentPath) return null;

  const pageCount = Math.max(1, Math.ceil(view.total / view.pageSize));
  const segments = breadcrumbSegments(view.rootPath, view.currentPath);
  const shareOfTotal =
    view.overallCount > 0
      ? Math.round((view.subtreeCount / view.overallCount) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1 text-sm">
        <Button
          variant="outline"
          size="xs"
          disabled={view.parentPath === null}
          onClick={() => view.parentPath && navigate(view.parentPath)}
          title="Go to the parent directory"
        >
          <CornerLeftUp className="size-3" aria-hidden="true" />
          Up
        </Button>
        {segments.map((segment, index) => (
          <span key={segment.path} className="flex items-center gap-1">
            {index > 0 && (
              <span className="text-muted-foreground" aria-hidden="true">
                /
              </span>
            )}
            <button
              type="button"
              onClick={() => navigate(segment.path)}
              className={cn(
                'max-w-xs truncate rounded px-1.5 py-0.5 font-mono text-xs hover:bg-accent',
                index === segments.length - 1 && 'font-medium text-foreground',
              )}
            >
              {segment.label}
            </button>
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <span>
          <span className="font-medium text-foreground">
            {view.subtreeCount}
          </span>{' '}
          duplicate{view.subtreeCount === 1 ? '' : 's'} here and below (
          {shareOfTotal}% of {view.overallCount}), taking{' '}
          <span
            className="font-medium text-foreground"
            title={exactBytesLabel(view.subtreeSize)}
          >
            {humanizeSize(view.subtreeSize)}
          </span>
        </span>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={(event) => {
              setPage(0);
              onHideEmptyChange(event.target.checked);
            }}
          />
          Hide directories without duplicates
        </label>

        {/* These two leave their content out of the counts and sizes as well
            as out of the rows: an empty file is a duplicate of every other
            empty file, which is true and almost never useful. */}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={excludeEmptyFiles}
            onChange={(event) => {
              setPage(0);
              onExcludeEmptyFilesChange(event.target.checked);
            }}
          />
          Ignore empty files
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={excludeEmptyDirectories}
            onChange={(event) => {
              setPage(0);
              onExcludeEmptyDirectoriesChange(event.target.checked);
            }}
          />
          Ignore empty directories
        </label>

        <span className="ml-auto">Sort by:</span>
        {SORT_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => changeSort(option.value)}
            title={
              sortBy === option.value
                ? `Click to reverse (currently ${sortDir === 'desc' ? 'highest first' : 'lowest first'})`
                : `Sort by ${option.label.toLowerCase()}`
            }
            className={cn(
              'rounded px-2 py-1 hover:bg-accent',
              sortBy === option.value &&
                'bg-accent font-medium text-foreground',
            )}
          >
            {option.label}
            {sortBy === option.value && (sortDir === 'desc' ? ' ↓' : ' ↑')}
          </button>
        ))}
      </div>

      {view.rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {hideEmpty
            ? 'No directory here holds duplicates. Untick the checkbox to see them all.'
            : 'This directory has no subdirectories and no duplicate files.'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {view.rows.map((row) => (
            <li
              key={row.path}
              onDoubleClick={() =>
                row.kind === 'directory' && navigate(row.path)
              }
              className={cn(
                'flex items-center gap-2 px-3 py-2 text-sm',
                row.kind === 'directory' &&
                  'cursor-pointer select-none hover:bg-accent',
              )}
            >
              {row.kind === 'directory' ? (
                <Folder className="size-4 shrink-0" aria-hidden="true" />
              ) : (
                <File className="size-4 shrink-0" aria-hidden="true" />
              )}
              {row.kind === 'directory' ? (
                // A real button, so one click is enough and the keyboard can
                // reach it. Double-clicking the row still works, but nothing
                // depends on discovering that.
                <button
                  type="button"
                  onClick={() => navigate(row.path)}
                  title={row.path}
                  className="min-w-0 flex-1 truncate text-left hover:underline"
                >
                  {row.name}
                </button>
              ) : (
                <span className="min-w-0 flex-1 truncate" title={row.path}>
                  {row.name}
                </span>
              )}

              {/* Only rows that are themselves duplicates have one; the
                  column is still rendered for the rest so everything to its
                  right stays aligned. */}
              <span
                className="w-32 shrink-0 truncate font-mono text-xs text-muted-foreground"
                title={row.checksum ?? undefined}
              >
                {row.checksum ?? ''}
              </span>

              {row.isDuplicate && row.checksum && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    setOccurrencesTarget({
                      checksum: row.checksum as string,
                      kind: row.kind,
                      name: row.name,
                      path: row.path,
                    })
                  }
                  title={`Show the ${row.occurrenceCount} places this content appears`}
                >
                  <Files className="size-3" aria-hidden="true" />×
                  {row.occurrenceCount}
                </Button>
              )}
              {row.isEmpty && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  empty
                </span>
              )}

              <span
                className={cn(
                  'w-24 shrink-0 text-right tabular-nums',
                  row.duplicateCount === 0 && 'text-muted-foreground',
                )}
                title="Duplicates in this subtree"
              >
                {row.duplicateCount}
              </span>
              <span
                className={cn(
                  'w-20 shrink-0 text-right tabular-nums',
                  row.duplicateSize === 0 && 'text-muted-foreground',
                )}
                title={exactBytesLabel(row.duplicateSize)}
              >
                {humanizeSize(row.duplicateSize)}
              </span>

              <CopyButton
                value={row.path}
                label="Path"
                title={`Copy full path: ${row.path}`}
              />
              {row.kind === 'directory' && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => navigate(row.path)}
                  title="Open this directory"
                  aria-label={`Open ${row.name}`}
                >
                  <ChevronRight className="size-3" aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {page + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <OccurrencesDialog
        target={occurrencesTarget}
        onClose={() => setOccurrencesTarget(null)}
        onDeleted={() => void load()}
      />
    </div>
  );
}
