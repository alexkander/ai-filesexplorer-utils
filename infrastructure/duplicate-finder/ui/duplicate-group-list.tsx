'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, EyeOff, Folder, File } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import { CopyablePath } from '@/infrastructure/ui/components/copyable-path';
import type {
  DuplicateGroup,
  SortBy,
  SortDir,
} from '@/domain/duplicate-finder/duplicate-group';
import { cn } from '@/lib/utils';
import { getParentPath } from '@/domain/scanning/path-info';
import { CopyButton } from './copy-button';
import { exactBytesLabel, humanizeSize } from './format-size';

interface GroupsPage {
  groups: DuplicateGroup[];
  total: number;
  page: number;
  pageSize: number;
  partial: boolean;
}

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'size', label: 'Size' },
  { value: 'occurrences', label: 'Occurrences' },
];

function groupKey(group: Pick<DuplicateGroup, 'checksum' | 'kind'>): string {
  return `${group.kind}:${group.checksum}`;
}

export function DuplicateGroupList({
  sortBy,
  sortDir,
  onSortChange,
  refreshKey,
  onResultsChanged,
}: {
  sortBy: SortBy;
  sortDir: SortDir;
  onSortChange: (sortBy: SortBy, sortDir: SortDir) => void;
  /** Bumped by the status hook on every poll, so the listing refreshes in
   * lockstep with the panel instead of going stale mid-scan. */
  refreshKey: number;
  onResultsChanged: () => void;
}) {
  const [page, setPage] = useState(0);
  const [data, setData] = useState<GroupsPage | null>(null);
  const [expanded, setExpanded] = useState<Record<string, string[]>>({});
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const fetchPage = useCallback(async (): Promise<GroupsPage | null> => {
    const res = await fetch(
      `/api/duplicate-finder/groups?sortBy=${sortBy}&sortDir=${sortDir}&page=${page}`,
    );
    if (!res.ok) return null;
    return (await res.json()) as GroupsPage;
  }, [sortBy, sortDir, page]);

  const load = useCallback(async () => {
    const next = await fetchPage();
    if (next) setData(next);
  }, [fetchPage]);

  useEffect(() => {
    let ignore = false;
    fetchPage().then((next) => {
      if (!ignore && next) setData(next);
    });
    return () => {
      ignore = true;
    };
  }, [fetchPage, refreshKey]);

  // Changing the sort re-orders the whole result set, so staying on page 7
  // would land the user somewhere arbitrary (spec User Story 1, scenario 6).
  // Clicking the field that is already active flips its direction — the same
  // interaction the comparison tool's ignored-paths view already uses.
  const changeSort = (field: SortBy) => {
    setPage(0);
    setExpanded({});
    if (field === sortBy) {
      onSortChange(field, sortDir === 'desc' ? 'asc' : 'desc');
    } else {
      onSortChange(field, 'desc');
    }
  };

  const toggle = async (group: DuplicateGroup) => {
    const key = groupKey(group);
    if (expanded[key]) {
      setExpanded((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    const res = await fetch(
      `/api/duplicate-finder/occurrences?checksum=${encodeURIComponent(group.checksum)}&kind=${group.kind}`,
    );
    if (!res.ok) {
      // The group vanished between the page load and the click — refresh
      // rather than showing an empty expansion.
      await load();
      return;
    }
    const body = (await res.json()) as { paths: string[] };
    setExpanded((current) => ({ ...current, [key]: body.paths }));
  };

  const ignore = async (group: DuplicateGroup, path: string) => {
    setBusyPath(path);
    try {
      const res = await fetch('/api/duplicate-finder/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, ignored: true }),
      });
      if (!res.ok) {
        window.alert(`Failed to ignore "${path}"`);
        return;
      }
      // The server already pruned the results; drop the path locally so the
      // listing reacts immediately (spec FR-026), then reload the page from
      // the server so counts and pagination stay truthful.
      const key = groupKey(group);
      setExpanded((current) => {
        const paths = current[key];
        if (!paths) return current;
        const remaining = paths.filter((candidate) => candidate !== path);
        if (remaining.length < 2) {
          const next = { ...current };
          delete next[key];
          return next;
        }
        return { ...current, [key]: remaining };
      });
      await load();
      onResultsChanged();
    } finally {
      setBusyPath(null);
    }
  };

  if (!data) return null;

  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {data.total} duplicate group{data.total === 1 ? '' : 's'}
          {data.partial && ' (partial — the scan was stopped)'}
        </span>
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

      <ul className="flex flex-col divide-y rounded-md border">
        {data.groups.map((group) => {
          const key = groupKey(group);
          const paths = expanded[key];
          return (
            <li key={key} className="flex flex-col">
              <button
                type="button"
                onClick={() => void toggle(group)}
                className="flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                {paths ? (
                  <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronRight
                    className="size-4 shrink-0"
                    aria-hidden="true"
                  />
                )}
                {group.kind === 'directory' ? (
                  <Folder className="size-4 shrink-0" aria-hidden="true" />
                ) : (
                  <File className="size-4 shrink-0" aria-hidden="true" />
                )}
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                  {group.checksum}
                </span>
                {/* The icon alone is easy to misread at a glance, and the two
                    kinds behave differently (a folder group collapses the
                    files inside it), so the type is spelled out too. */}
                <span className="w-16 shrink-0 text-xs text-muted-foreground">
                  {group.kind === 'directory' ? 'Folder' : 'File'}
                </span>
                {group.isEmpty && (
                  <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    empty
                  </span>
                )}
                <span
                  className="shrink-0 tabular-nums"
                  title={exactBytesLabel(group.size)}
                >
                  {humanizeSize(group.size)}
                </span>
                <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                  ×{group.occurrenceCount}
                </span>
              </button>

              {paths && (
                <ul className="flex flex-col gap-1 border-t bg-muted/30 px-3 py-2">
                  {paths.map((path) => (
                    <li key={path} className="flex items-center gap-2 text-sm">
                      <CopyablePath
                        path={path}
                        title={path}
                        className="min-w-0 flex-1 truncate text-xs"
                      />
                      <CopyButton
                        value={path}
                        label="Path"
                        title={`Copy full path: ${path}`}
                      />
                      <CopyButton
                        value={getParentPath(path) ?? '/'}
                        label="Dir"
                        title={`Copy containing folder: ${getParentPath(path) ?? '/'}`}
                      />
                      <Button
                        variant="ghost"
                        size="xs"
                        disabled={busyPath !== null}
                        onClick={() => void ignore(group, path)}
                        title="Ignore this path in future scans"
                      >
                        <EyeOff className="size-3" aria-hidden="true" />
                        Ignore
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

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
    </div>
  );
}
