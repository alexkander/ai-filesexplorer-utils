'use client';

import { RefreshCw, ScanLine } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import { humanizeSize, exactBytesLabel } from './format-size';
import { formatDateTime } from './format-date';
import { STATE_LABELS } from './state-labels';
import type { DirectoryView } from '@/domain/count-and-size/derive-directory-view';

export function ScanStatusPanel({
  view,
  starting,
  onScan,
  onForceFullRescan,
  onStop,
}: {
  view: DirectoryView | null;
  starting: boolean;
  onScan: () => void;
  onForceFullRescan: () => void;
  onStop: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
      <Button variant="outline" size="sm" disabled={starting} onClick={onScan}>
        <ScanLine className="size-4" aria-hidden="true" />
        Scan
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={starting}
        onClick={onForceFullRescan}
        title="Ignore existing results and rescan the entire subtree from scratch"
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        Force full rescan
      </Button>
      {view?.state === 'scanning' && (
        <Button variant="outline" size="sm" onClick={onStop}>
          Stop
        </Button>
      )}
      {view && (
        <>
          <span className="font-medium">{STATE_LABELS[view.state]}</span>
          <span className="text-muted-foreground">
            {view.lastScannedAt
              ? `last scanned ${formatDateTime(view.lastScannedAt)}`
              : 'not scanned yet'}
          </span>
          {view.state !== 'not_scanned' && (
            <span
              className="text-muted-foreground"
              title={exactBytesLabel(view.aggregatedSize)}
            >
              {view.aggregatedCount} files, {humanizeSize(view.aggregatedSize)}
            </span>
          )}
          {view.state === 'completed' && view.incomplete && (
            <span className="text-amber-600 dark:text-amber-500">
              incomplete
            </span>
          )}
          {view.hasUnreadableEntries && (
            <span className="text-amber-600 dark:text-amber-500">
              has unreadable entries
            </span>
          )}
        </>
      )}
    </div>
  );
}
