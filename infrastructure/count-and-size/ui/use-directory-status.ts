'use client';

import { useEffect, useState } from 'react';
import type { DirectoryView } from '@/domain/count-and-size/derive-directory-view';
import type { ScanMode } from '@/domain/count-and-size/scan-stack';

const POLL_INTERVAL_MS = 2000;

async function fetchStatus(path: string): Promise<DirectoryView | null> {
  const res = await fetch(
    `/api/count-and-size/status?path=${encodeURIComponent(path)}`,
  );
  if (!res.ok) return null;
  return (await res.json()) as DirectoryView;
}

/**
 * Single source of truth for `currentPath`'s DirectoryView, shared by the
 * status panel (display + Scan/Stop) and the listing (which needs to
 * refresh its subdirectories' scanStatus as a scan progresses/completes,
 * not just once on mount).
 */
export function useDirectoryStatus(currentPath: string) {
  const [view, setView] = useState<DirectoryView | null>(null);
  // Bumped every time `view` is (re)fetched, including unchanged polls —
  // the listing depends on this, not on `view` itself, so it refetches in
  // lockstep with the status panel.
  const [tick, setTick] = useState(0);
  const [starting, setStarting] = useState(false);

  const applyStatus = (data: DirectoryView | null) => {
    if (data) setView(data);
    setTick((t) => t + 1);
  };

  useEffect(() => {
    let ignore = false;
    fetchStatus(currentPath).then((data) => {
      if (!ignore) applyStatus(data);
    });
    return () => {
      ignore = true;
    };
  }, [currentPath]);

  // Live progress while a scan affecting this directory is active (spec
  // FR-017a) — polls only the currently-viewed directory, stopping
  // automatically once it reaches a terminal state.
  useEffect(() => {
    if (view?.state !== 'scanning') return;
    let ignore = false;
    const id = setInterval(() => {
      fetchStatus(currentPath).then((data) => {
        if (!ignore) applyStatus(data);
      });
    }, POLL_INTERVAL_MS);
    return () => {
      ignore = true;
      clearInterval(id);
    };
  }, [view?.state, currentPath]);

  const scan = async (mode?: ScanMode) => {
    setStarting(true);
    try {
      await fetch('/api/count-and-size/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentPath, mode }),
      });
      applyStatus(await fetchStatus(currentPath));
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    await fetch('/api/count-and-size/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: currentPath }),
    });
    applyStatus(await fetchStatus(currentPath));
  };

  return { view, tick, starting, scan, stop };
}
