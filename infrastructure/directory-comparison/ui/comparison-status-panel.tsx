'use client';

import { RefreshCw, ScanLine } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import type { ComparisonView } from './use-comparison-status';

const PASS_LABELS: Record<NonNullable<ComparisonView['passActive']>, string> = {
  structural: 'Listing…',
  comparison: 'Comparing…',
};

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
      {view?.passActive && (
        <Button variant="outline" size="sm" onClick={onStop}>
          Stop
        </Button>
      )}
      {view && (
        <span className="font-medium">
          {view.passActive ? PASS_LABELS[view.passActive] : 'Idle'}
        </span>
      )}
    </div>
  );
}
