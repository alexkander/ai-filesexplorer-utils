'use client';

import { useEffect, useState } from 'react';
import { FolderUp } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import { ComparisonPane } from './comparison-pane';
import { ComparisonStatusPanel } from './comparison-status-panel';
import { useComparisonStatus } from './use-comparison-status';
import { getParentPath } from '@/domain/scanning/path-info';
import type { EntryComparisonStatus } from '@/domain/directory-comparison/entry-comparison-result';
import {
  loadPanes,
  savePanes,
  type PanesState,
} from '@/infrastructure/directory-comparison/panes-storage';

function childPath(currentPath: string, name: string): string {
  return currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
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
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const state = loadPanes();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLeftPath(state.leftPath);
    setRightPath(state.rightPath);
    setMoveSync(state.moveSync);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const state: PanesState = { leftPath, rightPath, moveSync };
    savePanes(state);
  }, [leftPath, rightPath, moveSync, hydrated]);

  const { view, starting, compare, stop } = useComparisonStatus(
    leftPath,
    rightPath,
  );

  const leftStatusByName = new Map<string, EntryComparisonStatus>();
  const rightStatusByName = new Map<string, EntryComparisonStatus>();
  for (const entry of view?.entries ?? []) {
    if (entry.status !== 'only_right')
      leftStatusByName.set(entry.name, entry.status);
    if (entry.status !== 'only_left')
      rightStatusByName.set(entry.name, entry.status);
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
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-background p-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={moveSync}
            onChange={(e) => setMoveSync(e.target.checked)}
          />
          Move sync
        </label>
        <ComparisonStatusPanel
          view={view}
          starting={starting}
          onCompare={() => void compare()}
          onForceFullRecompare={() => void compare('full')}
          onStop={() => void stop()}
        />
      </div>
      <div className="grid flex-1 grid-cols-2 divide-x">
        <div className="flex flex-col">
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
            <p className="truncate font-mono text-sm text-muted-foreground">
              {leftPath}
            </p>
          </div>
          <ComparisonPane
            path={leftPath}
            onNavigate={(name) => navigateInto('left', name)}
            statusByName={leftStatusByName}
          />
        </div>
        <div className="flex flex-col">
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
            <p className="truncate font-mono text-sm text-muted-foreground">
              {rightPath}
            </p>
          </div>
          <ComparisonPane
            path={rightPath}
            onNavigate={(name) => navigateInto('right', name)}
            statusByName={rightStatusByName}
          />
        </div>
      </div>
    </div>
  );
}
