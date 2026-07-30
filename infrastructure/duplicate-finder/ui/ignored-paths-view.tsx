'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';

interface IgnoredPathEntry {
  path: string;
  ignoredAt: string;
}

/**
 * Lists every path excluded from duplicate search and lets the user undo it
 * (spec FR-027). Deliberately separate from the comparison tool's
 * equivalent view — the two ignore lists have nothing to do with each other
 * (FR-028).
 */
export function IgnoredPathsView() {
  const [entries, setEntries] = useState<IgnoredPathEntry[] | null>(null);
  const [unignoring, setUnignoring] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    fetch('/api/duplicate-finder/ignored-paths')
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
      const res = await fetch('/api/duplicate-finder/ignore', {
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
          <Link href="/duplicate-finder">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to Find Duplicates
          </Link>
        </Button>
        <h1 className="text-lg font-semibold">Ignored paths</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Paths excluded from duplicate search. An ignored folder excludes
        everything beneath it. Un-ignoring one brings its content back on the
        next scan — the current results are not recomputed.
      </p>

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
          {entries.map((entry) => (
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
