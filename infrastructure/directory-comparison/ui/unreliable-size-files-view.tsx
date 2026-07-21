'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import { cn } from '@/lib/utils';
import { exactBytesLabel, humanizeSize } from './format-size';

interface UnreliableSizeFileEntry {
  path: string;
  size: number;
  detectedAt: string;
}

type SortBy = 'path' | 'size' | 'detectedAt';
type SortDir = 'asc' | 'desc';

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'path', label: 'Name' },
  { value: 'size', label: 'Size' },
  { value: 'detectedAt', label: 'Date detected' },
];

function sortEntries(
  entries: UnreliableSizeFileEntry[],
  sortBy: SortBy,
  sortDir: SortDir,
): UnreliableSizeFileEntry[] {
  const dir = sortDir === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => {
    if (sortBy === 'path') return a.path.localeCompare(b.path) * dir;
    if (sortBy === 'size') return (a.size - b.size) * dir;
    // detectedAt is an ISO 8601 string — plain string comparison already
    // sorts chronologically, no Date parsing needed.
    return a.detectedAt.localeCompare(b.detectedAt) * dir;
  });
}

/**
 * Lists every file logged in the unreliable-size registry (spec: user
 * request) — the same data source that puts the Google icon on a file in
 * the listing instead of the plain file icon, so this is "every
 * Google-touched file" as its own dedicated view. Entries land here two
 * ways: Pass 1 catching a corrected size (a known quirk of some network
 * mounts, e.g. rclone's Google Drive mount, for Office files edited in
 * Drive's browser "compatibility mode", where `fs.stat` reports 0 for a
 * file that isn't actually empty), or `compare-subtree.ts`'s container-
 * content fallback proving a raw-byte mismatch was Drive's repackaging and
 * not a real difference. Detection happens silently during
 * scanning/comparing; this is the one place to review which files hit it.
 * Purely a log — removing an entry here has no effect on Compare, unlike
 * un-ignoring a path.
 */
export function UnreliableSizeFilesView() {
  const [entries, setEntries] = useState<UnreliableSizeFileEntry[] | null>(
    null,
  );
  const [removing, setRemoving] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>('detectedAt');
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
    fetch('/api/directory-comparison/unreliable-size-files')
      .then((res) => (res.ok ? res.json() : { files: [] }))
      .then((body: { files: UnreliableSizeFileEntry[] }) => {
        if (!ignore) setEntries(body.files);
      });
    return () => {
      ignore = true;
    };
  }, []);

  const remove = async (path: string) => {
    setRemoving(path);
    try {
      const res = await fetch(
        '/api/directory-comparison/unreliable-size-files/remove',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path }),
        },
      );
      if (!res.ok) {
        window.alert(`Failed to remove "${path}"`);
        return;
      }
      setEntries((current) => current?.filter((e) => e.path !== path) ?? null);
    } finally {
      setRemoving(null);
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
        <h1 className="text-lg font-semibold">Google-touched files</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Every file shown with the Google icon instead of the plain file icon in
        the listing — files known to have been opened/edited in Google
        Drive&apos;s browser &quot;compatibility mode&quot; at some point (a
        known quirk of some network mounts, e.g. rclone&apos;s Google Drive
        mount: their filesystem-reported size can read 0 even though the real
        content isn&apos;t empty, and Drive may re-serve them with a
        non-deterministically repackaged container on every download, which can
        show up as a false difference in Compare). Compare already works around
        this where it can, so this list is just for review — removing an entry
        here has no effect on Compare.
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
          No Google-touched files detected yet.
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
              <span
                className="shrink-0 text-xs text-muted-foreground"
                title={exactBytesLabel(entry.size)}
              >
                {humanizeSize(entry.size)}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {new Date(entry.detectedAt).toLocaleString()}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={removing !== null}
                onClick={() => void remove(entry.path)}
              >
                {removing === entry.path ? (
                  <Loader2
                    className="size-4 animate-spin"
                    aria-label="Removing"
                  />
                ) : (
                  'Remove'
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
