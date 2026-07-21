'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import { cn } from '@/lib/utils';

interface IgnoredPathEntry {
  path: string;
  ignoredAt: string;
}

type SortBy = 'path' | 'ignoredAt';
type SortDir = 'asc' | 'desc';

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'path', label: 'Name' },
  { value: 'ignoredAt', label: 'Date added' },
];

function sortEntries(
  entries: IgnoredPathEntry[],
  sortBy: SortBy,
  sortDir: SortDir,
): IgnoredPathEntry[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (sortBy === 'path') return a.path.localeCompare(b.path) * dir;
    // ignoredAt is an ISO 8601 string — plain string comparison already
    // sorts chronologically, no Date parsing needed.
    return a.ignoredAt.localeCompare(b.ignoredAt) * dir;
  });
}

/**
 * Lists every path currently marked ignored (spec: user request) — the
 * double-click-a-status-dot toggle only ever exposes one pane pair's worth
 * at a time, so this is the one place to see (and undo) all of them across
 * the whole tool at once, regardless of which directories are currently
 * open in Compare.
 */
export function IgnoredPathsView() {
  const [entries, setEntries] = useState<IgnoredPathEntry[] | null>(null);
  const [unignoring, setUnignoring] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('ignoredAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSortClick = (field: SortBy) => {
    if (field === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  };

  useEffect(() => {
    let ignore = false;
    fetch('/api/directory-comparison/ignored-paths')
      .then((res) => (res.ok ? res.json() : { paths: [] }))
      .then((body: { paths: IgnoredPathEntry[] }) => {
        if (!ignore) setEntries(body.paths);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const unignore = async (path: string) => {
    setUnignoring(path);
    try {
      const res = await fetch('/api/directory-comparison/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, ignored: false }),
      });
      if (!res.ok) {
        window.alert(`Failed to un-ignore "${path}"`);
        return;
      }
      setEntries((current) => current?.filter((e) => e.path !== path) ?? null);
    } finally {
      setUnignoring(null);
    }
  };

  return (
    <div className="flex w-full flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          <Link href="/directory-comparison">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to Compare
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">Ignored paths</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Files and directories excluded from Compare (double-click a status dot
        in the comparison view to ignore/un-ignore one) — Pass 1 never lists an
        ignored directory&apos;s children, and Pass 2 excludes an ignored entry
        from its parent&apos;s matching status entirely.
      </p>

      {entries !== null && entries.length > 0 && (
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
      )}

      {entries === null ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading…
        </div>
      ) : entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nothing is currently ignored.
        </p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {sortEntries(entries, sortBy, sortDir).map((entry) => (
            <li
              key={entry.path}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <span
                className="min-w-0 flex-1 truncate font-mono"
                title={entry.path}
              >
                {entry.path}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {new Date(entry.ignoredAt).toLocaleString()}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={unignoring !== null}
                onClick={() => void unignore(entry.path)}
              >
                {unignoring === entry.path ? (
                  <Loader2
                    className="size-4 animate-spin"
                    aria-label="Un-ignoring"
                  />
                ) : (
                  'Un-ignore'
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
