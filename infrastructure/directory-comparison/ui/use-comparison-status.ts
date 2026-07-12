'use client';

import { useEffect, useState } from 'react';
import type { ScanMode } from '@/domain/scanning/scan-stack';
import type { ComparisonView } from '@/application/directory-comparison/get-comparison-view';

export type { ComparisonView } from '@/application/directory-comparison/get-comparison-view';

// Faster than Count and Size's 2000ms equivalent — per-file progress
// (compare-subtree.ts reporting the exact file pair being hashed) is much
// more granular and short-lived than a directory's aggregate scan status,
// so a slower poll would visibly lag behind real progress.
const POLL_INTERVAL_MS = 1000;

async function fetchStatus(
  left: string,
  right: string,
): Promise<ComparisonView | null> {
  const res = await fetch(
    `/api/directory-comparison/status?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`,
  );
  if (!res.ok) return null;
  return (await res.json()) as ComparisonView;
}

/**
 * Single source of truth for the currently-selected pair's ComparisonView,
 * shared by the status panel (display + Compare/Stop) and both panes (which
 * need to show each entry's status and refresh as a comparison progresses).
 * Mirrors Count and Size's use-directory-status.ts.
 */
export function useComparisonStatus(leftPath: string, rightPath: string) {
  const [view, setView] = useState<ComparisonView | null>(null);
  const [tick, setTick] = useState(0);
  const [starting, setStarting] = useState(false);

  const applyView = (data: ComparisonView | null) => {
    if (data) setView(data);
    setTick((t) => t + 1);
  };

  useEffect(() => {
    let ignore = false;
    fetchStatus(leftPath, rightPath).then((data) => {
      if (!ignore) applyView(data);
    });
    return () => {
      ignore = true;
    };
  }, [leftPath, rightPath]);

  // Keeps polling as long as *anything* is running in this tool
  // (view.activePath), not just while it's relevant to leftPath/rightPath
  // (view.passActive) — otherwise navigating away from the active pair
  // freezes the "currently processing" display at whatever it last showed,
  // instead of continuing to reflect where the comparison actually is.
  const isActive =
    view !== null && (view.passActive !== null || view.activePath !== null);
  useEffect(() => {
    if (!isActive) return;
    let ignore = false;
    const id = setInterval(() => {
      fetchStatus(leftPath, rightPath).then((data) => {
        if (!ignore) applyView(data);
      });
    }, POLL_INTERVAL_MS);
    return () => {
      ignore = true;
      clearInterval(id);
    };
  }, [isActive, leftPath, rightPath]);

  const compare = async (mode?: ScanMode) => {
    setStarting(true);
    try {
      await fetch('/api/directory-comparison/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leftPath, rightPath, mode }),
      });
      applyView(await fetchStatus(leftPath, rightPath));
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    await fetch('/api/directory-comparison/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leftPath, rightPath }),
    });
    applyView(await fetchStatus(leftPath, rightPath));
  };

  // For callers that changed the filesystem out-of-band (e.g. a successful
  // copy) and need the view's "only on this side" statuses to drop away
  // immediately, instead of waiting for the next poll tick (or never, if no
  // pass is currently active and isActive's poll isn't running at all).
  const refetch = async () => {
    applyView(await fetchStatus(leftPath, rightPath));
  };

  return { view, tick, starting, compare, stop, refetch };
}
