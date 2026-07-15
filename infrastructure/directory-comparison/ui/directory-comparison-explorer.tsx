'use client';

import { useEffect, useState } from 'react';
import { FolderUp } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import { CopyablePath } from '@/infrastructure/ui/components/copyable-path';
import { ComparisonPane } from './comparison-pane';
import { ComparisonStatusPanel } from './comparison-status-panel';
import {
  useComparisonStatus,
  type ComparisonView,
} from './use-comparison-status';
import { getParentPath, isWithinSubtree } from '@/domain/scanning/path-info';
import type { EntryComparisonStatus } from '@/domain/directory-comparison/entry-comparison-result';
import type { SizeInfo } from '@/application/directory-comparison/size-info-port';
import type {
  SortBy,
  SortDir,
} from '@/application/directory-comparison/list-directory';
import {
  loadPanes,
  savePanes,
  type PanesState,
} from '@/infrastructure/directory-comparison/panes-storage';
import {
  COMPARISON_STATUS_COLORS,
  COMPARISON_STATUS_LABELS,
} from './comparison-status-colors';
import { humanizeSize, exactBytesLabel } from './format-size';
import { cn } from '@/lib/utils';

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'type', label: 'Type' },
  { value: 'size', label: 'Size' },
  { value: 'count', label: 'Files' },
];

function childPath(currentPath: string, name: string): string {
  return currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
}

function toRelative(path: string, root: string): string {
  if (path === root) return '.';
  return root === '/' ? path.slice(1) : path.slice(root.length + 1);
}

/** The active path for `side`, relative to the comparison's OWN root for
 * that side (`activePair`) — deliberately NOT relative to (or gated by)
 * whatever the pane currently displays, so it keeps showing even if the
 * user has navigated a pane away from the directories actually being
 * compared (found necessary post-implementation: the original version only
 * showed this when the pane's own path happened to contain the active
 * work, so navigating elsewhere made it disappear entirely). For the
 * structural pass, the single active path could belong to either root —
 * checked against this specific side's root to decide whether it applies
 * here. */
function activePathForSide(
  activePath: ComparisonView['activePath'],
  activePair: ComparisonView['activePair'],
  side: 'left' | 'right',
): string | null {
  if (!activePath || !activePair) return null;
  const root = side === 'left' ? activePair.leftRoot : activePair.rightRoot;
  const candidate =
    activePath.pass === 'structural' ? activePath.path : activePath[side];
  if (!isWithinSubtree(candidate, root)) return null;
  return toRelative(candidate, root);
}

/** Shown at the right of a pane's header, next to its path — the same
 * file-count/size/status info `ComparisonPane` shows for each child entry,
 * but for the path itself (spec: user request). `undefined` while the
 * status poll hasn't returned yet; `null` fields mean "no data" (Count and
 * Size never scanned this path, or no Compare has reached it), same as any
 * other entry. */
function PaneOwnInfo({
  sizeInfo,
  checksum,
  status,
}: {
  sizeInfo: SizeInfo | null | undefined;
  checksum: string | null | undefined;
  status: EntryComparisonStatus | null | undefined;
}) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
      {sizeInfo && (
        <span title={exactBytesLabel(sizeInfo.totalSize)}>
          {sizeInfo.fileCount.toLocaleString()} files,{' '}
          {humanizeSize(sizeInfo.totalSize)}
          {sizeInfo.incomplete && (
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
        <span className="font-mono" title={`Full checksum: ${checksum}`}>
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
    </span>
  );
}

/**
 * Owns leftPath/rightPath/moveSync client state, hydrated from
 * panes-storage.ts post-mount (starts at "/" for SSR, same
 * hydration-mismatch-safe pattern as Count and Size's
 * count-and-size-explorer.tsx), persisted on every change (spec FR-001,
 * FR-002).
 */
export function DirectoryComparisonExplorer() {
  const [leftPath, setLeftPath] = useState('/');
  const [rightPath, setRightPath] = useState('/');
  const [moveSync, setMoveSync] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [hideMatching, setHideMatching] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const state = loadPanes();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLeftPath(state.leftPath);
    setRightPath(state.rightPath);
    setMoveSync(state.moveSync);
    setSortBy(state.sortBy);
    setSortDir(state.sortDir);
    setHideMatching(state.hideMatching);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const state: PanesState = {
      leftPath,
      rightPath,
      moveSync,
      sortBy,
      sortDir,
      hideMatching,
    };
    savePanes(state);
  }, [leftPath, rightPath, moveSync, sortBy, sortDir, hideMatching, hydrated]);

  const handleSortClick = (field: SortBy) => {
    if (field === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDir('asc');
    }
  };

  const { view, starting, compare, stop, refetch } = useComparisonStatus(
    leftPath,
    rightPath,
  );

  const [leftRefreshToken, setLeftRefreshToken] = useState(0);
  const [rightRefreshToken, setRightRefreshToken] = useState(0);

  const leftActivePath = activePathForSide(
    view?.activePath ?? null,
    view?.activePair ?? null,
    'left',
  );
  const rightActivePath = activePathForSide(
    view?.activePath ?? null,
    view?.activePair ?? null,
    'right',
  );

  const leftStatusByName = new Map<string, EntryComparisonStatus>();
  const rightStatusByName = new Map<string, EntryComparisonStatus>();
  const leftChecksumByName = new Map<string, string | null>();
  const rightChecksumByName = new Map<string, string | null>();
  for (const entry of view?.entries ?? []) {
    if (entry.status !== 'only_right') {
      leftStatusByName.set(entry.name, entry.status);
      leftChecksumByName.set(entry.name, entry.leftChecksum);
    }
    if (entry.status !== 'only_left') {
      rightStatusByName.set(entry.name, entry.status);
      rightChecksumByName.set(entry.name, entry.rightChecksum);
    }
  }

  const navigateInto = (pane: 'left' | 'right', name: string) => {
    if (pane === 'left') {
      setLeftPath(childPath(leftPath, name));
      if (moveSync) setRightPath(childPath(rightPath, name));
    } else {
      setRightPath(childPath(rightPath, name));
      if (moveSync) setLeftPath(childPath(leftPath, name));
    }
  };

  const copyToOtherSide = async (fromSide: 'left' | 'right', name: string) => {
    const sourceParent = fromSide === 'left' ? leftPath : rightPath;
    const destinationParent = fromSide === 'left' ? rightPath : leftPath;
    const sourcePath = childPath(sourceParent, name);
    const destinationPath = childPath(destinationParent, name);

    if (
      !window.confirm(
        `Copy "${sourcePath}" to "${destinationPath}"?\n\nThis creates a new copy — nothing on either side is deleted, moved, or overwritten.`,
      )
    ) {
      return;
    }

    const res = await fetch('/api/directory-comparison/copy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourcePath, destinationPath }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      window.alert(`Copy failed: ${body?.error ?? res.statusText}`);
      return;
    }

    if (fromSide === 'left') setRightRefreshToken((t) => t + 1);
    else setLeftRefreshToken((t) => t + 1);
    // Without this, the entry keeps showing its stale only_left/only_right
    // status (and the Copy button) until the next poll tick — which may
    // never come if no pass is currently active (isActive gates polling).
    await refetch();
  };

  // Same "only on this side" condition as copyToOtherSide, offered as the
  // alternative resolution: instead of copying the missing side in, delete
  // the extra one. Moves it to this tool's own trash folder rather than
  // removing it outright (spec: user request; the original spec deferred
  // any delete action entirely) — see delete-adapter.ts.
  const deleteFromThisSide = async (side: 'left' | 'right', name: string) => {
    const parent = side === 'left' ? leftPath : rightPath;
    const targetPath = childPath(parent, name);

    if (
      !window.confirm(
        `Move "${targetPath}" to trash?\n\nIt will be moved into this tool's .ai-filesexplorer-utils-trash/ folder, not deleted outright — recoverable by hand if needed.`,
      )
    ) {
      return;
    }

    const res = await fetch('/api/directory-comparison/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        error?: string;
      } | null;
      window.alert(`Delete failed: ${body?.error ?? res.statusText}`);
      return;
    }

    if (side === 'left') setLeftRefreshToken((t) => t + 1);
    else setRightRefreshToken((t) => t + 1);
    await refetch();
  };

  const navigateUp = (pane: 'left' | 'right') => {
    if (pane === 'left') {
      const parent = getParentPath(leftPath);
      if (parent !== null) setLeftPath(parent);
      if (moveSync) {
        const otherParent = getParentPath(rightPath);
        if (otherParent !== null) setRightPath(otherParent);
      }
    } else {
      const parent = getParentPath(rightPath);
      if (parent !== null) setRightPath(parent);
      if (moveSync) {
        const otherParent = getParentPath(leftPath);
        if (otherParent !== null) setLeftPath(otherParent);
      }
    }
  };

  return (
    // h-full (not flex-1 — the dashboard shell's <main> isn't a flex
    // container, so flex-1 alone does nothing here) makes this fill the
    // shell's real height regardless of content length, so the two-pane
    // grid below always stretches to the bottom — otherwise, with few
    // entries, the grid (and its divide-x border) only grows as tall as its
    // own content and stops partway down the page.
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-background p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={moveSync}
              onChange={(e) => setMoveSync(e.target.checked)}
            />
            Move sync
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hideMatching}
              onChange={(e) => setHideMatching(e.target.checked)}
            />
            Hide matching
          </label>
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
        </div>
        <ComparisonStatusPanel
          view={view}
          starting={starting}
          onCompare={() => void compare()}
          onForceFullRecompare={() => void compare('full')}
          onStop={() => void stop()}
        />
      </div>
      <div className="grid flex-1 grid-cols-2 divide-x overflow-hidden">
        <div className="flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 border-b p-2">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={leftPath === '/'}
              onClick={() => navigateUp('left')}
              aria-label="Up (left)"
              title="Up"
            >
              <FolderUp className="size-4" aria-hidden="true" />
            </Button>
            <CopyablePath
              path={leftPath}
              className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
            />
            <PaneOwnInfo
              sizeInfo={view?.leftSizeInfo}
              checksum={view?.ownChecksum}
              status={view?.ownStatus}
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            <ComparisonPane
              path={leftPath}
              side="left"
              onNavigate={(name) => navigateInto('left', name)}
              statusByName={leftStatusByName}
              checksumByName={leftChecksumByName}
              refreshToken={leftRefreshToken}
              onCopyToOtherSide={(name) => copyToOtherSide('left', name)}
              onDeleteFromThisSide={(name) => deleteFromThisSide('left', name)}
              sortBy={sortBy}
              sortDir={sortDir}
              hideMatching={hideMatching}
            />
          </div>
          {/* Pinned below the scrollable listing (not sticky inside it) —
              stays visible regardless of scroll position without needing
              position: sticky. */}
          {leftActivePath && (
            <p
              className="truncate border-t bg-background px-2 py-1.5 font-mono text-xs text-blue-500"
              title={leftActivePath}
            >
              {leftActivePath}
            </p>
          )}
        </div>
        <div className="flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 border-b p-2">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={rightPath === '/'}
              onClick={() => navigateUp('right')}
              aria-label="Up (right)"
              title="Up"
            >
              <FolderUp className="size-4" aria-hidden="true" />
            </Button>
            <CopyablePath
              path={rightPath}
              className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
            />
            <PaneOwnInfo
              sizeInfo={view?.rightSizeInfo}
              checksum={view?.ownChecksum}
              status={view?.ownStatus}
            />
          </div>
          <div className="flex-1 overflow-y-auto">
            <ComparisonPane
              path={rightPath}
              side="right"
              onNavigate={(name) => navigateInto('right', name)}
              statusByName={rightStatusByName}
              checksumByName={rightChecksumByName}
              refreshToken={rightRefreshToken}
              onCopyToOtherSide={(name) => copyToOtherSide('right', name)}
              onDeleteFromThisSide={(name) => deleteFromThisSide('right', name)}
              sortBy={sortBy}
              sortDir={sortDir}
              hideMatching={hideMatching}
            />
          </div>
          {rightActivePath && (
            <p
              className="truncate border-t bg-background px-2 py-1.5 font-mono text-xs text-blue-500"
              title={rightActivePath}
            >
              {rightActivePath}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
