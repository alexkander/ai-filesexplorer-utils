'use client';

import { useEffect, useState } from 'react';
import { FolderUp } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import { CopyablePath } from '@/infrastructure/ui/components/copyable-path';
import { DirectoryBrowser } from './directory-browser';
import { ScanStatusPanel } from './scan-status-panel';
import { useDirectoryStatus } from './use-directory-status';
import { getParentPath } from '@/domain/scanning/path-info';
import {
  loadLastPath,
  saveLastPath,
} from '@/infrastructure/count-and-size/last-path-storage';

/**
 * Owns the current browsing path client-side only — the path is
 * deliberately not reflected in the URL, but the last path visited is
 * remembered (localStorage) across visits/reloads.
 */
export function CountAndSizeExplorer() {
  const [currentPath, setCurrentPath] = useState('/');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Hydrating from an external system (localStorage) on mount — not
    // available during server rendering, so this can't be a lazy useState
    // initializer without a hydration mismatch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentPath(loadLastPath());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveLastPath(currentPath);
  }, [currentPath, hydrated]);

  const parentPath = getParentPath(currentPath);
  const { view, tick, starting, scan, stop } = useDirectoryStatus(currentPath);

  return (
    <div className="flex flex-1 flex-col">
      <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-background p-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={parentPath === null}
            onClick={() => parentPath && setCurrentPath(parentPath)}
            aria-label="Up"
            title="Up"
          >
            <FolderUp className="size-4" aria-hidden="true" />
          </Button>
          <CopyablePath
            path={currentPath}
            className="text-sm text-muted-foreground"
          />
        </div>
        <ScanStatusPanel
          view={view}
          starting={starting}
          onScan={() => void scan()}
          onForceFullRescan={() => void scan('full')}
          onStop={() => void stop()}
        />
      </div>
      <div className="p-4">
        <DirectoryBrowser
          currentPath={currentPath}
          onNavigate={setCurrentPath}
          refreshToken={tick}
        />
      </div>
    </div>
  );
}
