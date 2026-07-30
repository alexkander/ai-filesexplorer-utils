'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import type { ScanStatusView, StartScanError } from './use-scan-status';

const PHASE_LABELS: Record<string, string> = {
  listing: 'Listing files',
  hashing: 'Hashing candidates',
  deriving_folders: 'Deriving folder checksums',
  grouping: 'Grouping results',
};

const STATE_LABELS: Record<ScanStatusView['state'], string> = {
  idle: 'No scan run yet',
  running: 'Scanning',
  finished: 'Finished',
  stopped: 'Stopped',
  failed: 'Failed',
};

// One distinct message per rejection the application layer can return
// (spec FR-004, FR-008) — "something went wrong" would leave the user
// guessing which of four different problems they have.
const ERROR_MESSAGES: Record<StartScanError, string> = {
  not_found: 'That path does not exist.',
  not_a_directory: 'That path is a file, not a directory.',
  unreadable: 'That directory exists but could not be read.',
  root_ignored:
    'That path is on the ignored list, so a scan would find nothing. Un-ignore it first.',
  already_running:
    'A scan is already running. Stop it before starting another one.',
  unknown: 'The scan could not be started.',
};

export function ScanStatusPanel({
  status,
  error,
  onStop,
}: {
  status: ScanStatusView | null;
  error: StartScanError | null;
  onStop: () => void;
}) {
  if (error) {
    return <p className="text-sm text-destructive">{ERROR_MESSAGES[error]}</p>;
  }
  if (!status) return null;

  const isRunning = status.state === 'running';

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="flex items-center gap-2 font-medium">
        {isRunning && (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        )}
        {STATE_LABELS[status.state]}
      </span>

      {status.rootPath && (
        <span className="text-muted-foreground">
          {status.rootPath}
          {status.includeFolders ? ' (with folders)' : ''}
        </span>
      )}

      {isRunning && status.phase && (
        <span className="text-muted-foreground">
          {PHASE_LABELS[status.phase] ?? status.phase}
          {status.total > 0 && ` ${status.processed}/${status.total}`}
        </span>
      )}

      {isRunning && status.activePath && (
        <span
          className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
          title={status.activePath}
        >
          {status.activePath}
        </span>
      )}

      {status.unreadableCount > 0 && (
        <span className="text-amber-600 dark:text-amber-500">
          {status.unreadableCount} entr
          {status.unreadableCount === 1 ? 'y' : 'ies'} skipped (unreadable)
        </span>
      )}

      {status.state === 'stopped' && (
        <span className="text-amber-600 dark:text-amber-500">
          partial results
        </span>
      )}

      {status.state === 'failed' && status.errorMessage && (
        <span className="text-destructive">{status.errorMessage}</span>
      )}

      {status.finishedAt && !isRunning && (
        <span className="text-muted-foreground">
          {new Date(status.finishedAt).toLocaleString()}
        </span>
      )}

      {isRunning && (
        <Button variant="outline" size="sm" onClick={onStop}>
          Stop
        </Button>
      )}
    </div>
  );
}
