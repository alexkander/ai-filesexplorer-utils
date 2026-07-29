'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ScanLine } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import type { SortBy } from '@/domain/duplicate-finder/duplicate-group';
import {
  loadIncludeFolders,
  loadLastPath,
  loadSortBy,
  saveIncludeFolders,
  saveLastPath,
  saveSortBy,
} from '../scan-preferences-storage';
import { DuplicateGroupList } from './duplicate-group-list';
import { ScanStatusPanel } from './scan-status-panel';
import { useScanStatus } from './use-scan-status';

export function DuplicateFinderView() {
  const [rootPath, setRootPath] = useState('');
  const [includeFolders, setIncludeFolders] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('size');
  const { status, starting, error, tick, scan, stop, refetch } =
    useScanStatus();

  // Read on mount rather than during render: localStorage does not exist on
  // the server, and seeding useState from it would desync hydration. Same
  // pattern (and same exemption) as the other tools' explorers.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRootPath(loadLastPath());
    setIncludeFolders(loadIncludeFolders());
    setSortBy(loadSortBy());
  }, []);

  const handleScan = () => {
    saveLastPath(rootPath);
    saveIncludeFolders(includeFolders);
    void scan(rootPath.trim(), includeFolders);
  };

  const handleSortByChange = (next: SortBy) => {
    setSortBy(next);
    saveSortBy(next);
  };

  const isRunning = status?.state === 'running';
  const hasResults = (status?.groupCount ?? 0) > 0;
  const hasRunAScan = status !== null && status.state !== 'idle';

  return (
    <div className="flex w-full flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold">Find Duplicates</h1>
        <Button variant="outline" size="sm" asChild className="ml-auto">
          <Link href="/duplicate-finder/ignored">Ignored paths</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={rootPath}
          onChange={(event) => setRootPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && rootPath.trim() && !isRunning) {
              handleScan();
            }
          }}
          placeholder="/path/to/directory"
          spellCheck={false}
          className="h-8 min-w-0 flex-1 rounded-lg border px-2.5 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeFolders}
            onChange={(event) => {
              setIncludeFolders(event.target.checked);
              saveIncludeFolders(event.target.checked);
            }}
          />
          Also detect duplicate folders
        </label>
        <Button
          variant="outline"
          size="sm"
          disabled={starting || isRunning || rootPath.trim().length === 0}
          onClick={handleScan}
        >
          <ScanLine className="size-4" aria-hidden="true" />
          Scan
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Groups every file inside the scanned directory by content checksum and
        lists the ones appearing more than once. Files whose size is unique are
        never read at all. Ticking the checkbox also reports whole folders whose
        content and structure are identical, and collapses the duplicate files
        inside them.
      </p>

      <ScanStatusPanel
        status={status}
        error={error}
        onStop={() => void stop()}
      />

      {hasResults ? (
        <DuplicateGroupList
          sortBy={sortBy}
          onSortByChange={handleSortByChange}
          refreshKey={tick}
          onResultsChanged={() => void refetch()}
        />
      ) : (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {!hasRunAScan
            ? 'No scan has been run yet. Enter a directory and press Scan.'
            : isRunning
              ? 'Scanning…'
              : 'No duplicates found in that directory.'}
        </p>
      )}
    </div>
  );
}
