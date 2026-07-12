'use client';

import { RefreshCw, ScanLine } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import type { ComparisonView } from './use-comparison-status';

const PASS_LABELS: Record<NonNullable<ComparisonView['passActive']>, string> = {
  structural: 'Listing…',
  comparison: 'Comparing…',
};

// Derived from view.activePath (system-wide) rather than view.passActive
// (scoped to whether the currently-viewed pane pair is what's active) — a
// comparison running on a different pair must still show "Comparing…" and
// offer Stop, otherwise the always-visible per-pane active-path text (see
// research.md Decision 16) contradicts an "Idle" label with no way to cancel.
function currentPass(
  view: ComparisonView | null,
): 'structural' | 'comparison' | null {
  return view?.activePath?.pass ?? null;
}

export function ComparisonStatusPanel({
  view,
  starting,
  onCompare,
  onForceFullRecompare,
  onStop,
}: {
  view: ComparisonView | null;
  starting: boolean;
  onCompare: () => void;
  onForceFullRecompare: () => void;
  onStop: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
      <Button
        variant="outline"
        size="sm"
        disabled={starting}
        onClick={onCompare}
      >
        <ScanLine className="size-4" aria-hidden="true" />
        Compare
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={starting}
        onClick={onForceFullRecompare}
        title="Ignore existing results and recompute everything from scratch on both sides"
      >
        <RefreshCw className="size-4" aria-hidden="true" />
        Force full re-compare
      </Button>
      {currentPass(view) && (
        <Button variant="outline" size="sm" onClick={onStop}>
          Stop
        </Button>
      )}
      {view && (
        <span className="font-medium">
          {(() => {
            const pass = currentPass(view);
            return pass ? PASS_LABELS[pass] : 'Idle';
          })()}
        </span>
      )}
    </div>
  );
}
