'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ScanStatusView } from '@/application/duplicate-finder/get-scan-status';

export type { ScanStatusView };

// Matches the comparison tool's per-file polling rather than Count and
// Size's 2000ms: this panel shows the exact file being hashed, which changes
// far faster than a directory's aggregate status.
const POLL_INTERVAL_MS = 1000;

export type StartScanError =
  | 'not_found'
  | 'not_a_directory'
  | 'unreadable'
  | 'root_ignored'
  | 'already_running'
  | 'unknown';

async function fetchStatus(): Promise<ScanStatusView | null> {
  const res = await fetch('/api/duplicate-finder/status');
  if (!res.ok) return null;
  return (await res.json()) as ScanStatusView;
}

/**
 * Single source of truth for the scan's state, shared by the form, the
 * status panel and the listing (which must refresh once results exist).
 * Mirrors the other tools' status hooks.
 */
export function useScanStatus() {
  const [status, setStatus] = useState<ScanStatusView | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<StartScanError | null>(null);
  // Bumped on every (re)fetch, including unchanged polls — the listing
  // depends on this rather than on `status` itself, so it refetches in
  // lockstep with the panel.
  const [tick, setTick] = useState(0);

  const applyStatus = useCallback((data: ScanStatusView | null) => {
    if (data) setStatus(data);
    setTick((current) => current + 1);
  }, []);

  const refetch = useCallback(async () => {
    applyStatus(await fetchStatus());
  }, [applyStatus]);

  useEffect(() => {
    let ignore = false;
    fetchStatus().then((data) => {
      if (!ignore) applyStatus(data);
    });
    return () => {
      ignore = true;
    };
  }, [applyStatus]);

  // Polls only while something is actually running, stopping by itself once
  // the scan reaches a terminal state.
  const isRunning = status?.state === 'running';
  useEffect(() => {
    if (!isRunning) return;
    let ignore = false;
    const id = setInterval(() => {
      fetchStatus().then((data) => {
        if (!ignore) applyStatus(data);
      });
    }, POLL_INTERVAL_MS);
    return () => {
      ignore = true;
      clearInterval(id);
    };
  }, [isRunning, applyStatus]);

  const scan = useCallback(
    async (rootPath: string, includeFolders: boolean) => {
      setStarting(true);
      setError(null);
      try {
        const res = await fetch('/api/duplicate-finder/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rootPath, includeFolders }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setError((body.error as StartScanError) ?? 'unknown');
        }
        await refetch();
      } finally {
        setStarting(false);
      }
    },
    [refetch],
  );

  const stop = useCallback(async () => {
    await fetch('/api/duplicate-finder/stop', { method: 'POST' });
    await refetch();
  }, [refetch]);

  return { status, starting, error, tick, scan, stop, refetch };
}
