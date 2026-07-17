'use client';

import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/infrastructure/ui/components/dialog';
import { cn } from '@/lib/utils';
import type { RenamePlanStep } from '@/domain/directory-comparison/build-rename-plan';

function displaySourceName(
  step: RenamePlanStep,
  plan: RenamePlanStep[],
  stepResults: (string | null)[],
): string {
  if (typeof step.sourceName === 'string') return step.sourceName;
  const depIndex = step.sourceName.dependsOnStepIndex;
  return stepResults[depIndex] ?? plan[depIndex].destinationName;
}

function displayDestinationName(
  step: RenamePlanStep,
  index: number,
  stepResults: (string | null)[],
): string {
  return stepResults[index] ?? step.destinationName;
}

/**
 * Shows the result of the "checksum matches" search (spec: user request)
 * as an ordered, step-by-step rename PLAN rather than a flat list —
 * matches can chain into each other, or form a rename cycle (a straight
 * swap, or a longer loop), which can't be executed as independent
 * one-shot renames without clobbering data (see
 * domain/directory-comparison/build-rename-plan.ts). Each step is only
 * renameable once every step before it has actually completed — later
 * steps can depend on an earlier one's real runtime result (a
 * cycle-breaking backup's timestamped name isn't known ahead of time).
 */
export function ChecksumMatchModal({
  open,
  onOpenChange,
  loading,
  plan,
  completedThrough,
  stepResults,
  executingIndex,
  onRenameStep,
  onRenameAll,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  plan: RenamePlanStep[];
  /** Index (into `plan`) of the last step that has actually completed;
   * `-1` before anything has run. Step `completedThrough + 1` is the only
   * one currently renameable. */
  completedThrough: number;
  /** Parallel to `plan` — the REAL name each completed step actually
   * produced (a backup step's real timestamped name, or a normal step's
   * literal destination), `null` for steps not yet run. Only the parent
   * knows this, since it's the one making the actual rename/backup calls
   * and reading their responses. */
  stepResults: (string | null)[];
  /** The one step currently in flight (or `null`) — every step's button
   * is disabled while any step is executing, since steps must run in
   * order and two running concurrently would race. */
  executingIndex: number | null;
  onRenameStep: (index: number) => void;
  onRenameAll: () => void;
}) {
  const allDone = plan.length > 0 && completedThrough === plan.length - 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Checksum matches</DialogTitle>
          <DialogDescription>
            Files that don&apos;t match by name between the two sides, but whose
            content is identical — likely the same file, renamed. Only the LEFT
            side is renamed here; content is never touched on either side. Steps
            run in order, top to bottom — a step only becomes available once
            every step above it has completed.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Searching…
          </div>
        ) : plan.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No content matches found among the mismatched files.
          </p>
        ) : (
          <ol className="flex max-h-96 flex-col gap-2 overflow-y-auto">
            {plan.map((step, index) => {
              const done = index <= completedThrough;
              const isNext = index === completedThrough + 1;
              const executing = executingIndex === index;
              return (
                <li
                  key={index}
                  className={cn(
                    'flex items-center gap-2 rounded-md border p-2 text-sm',
                    done && 'opacity-60',
                    !done && !isNext && 'opacity-50',
                  )}
                >
                  <span className="w-5 shrink-0 text-center text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-mono">
                      {displaySourceName(step, plan, stepResults)}
                    </span>
                    <span className="text-muted-foreground"> {'=>'} </span>
                    <span className="font-mono">
                      {displayDestinationName(step, index, stepResults)}
                    </span>
                    {step.isBackup && (
                      <span className="ml-1 text-xs text-amber-600 dark:text-amber-500">
                        (making room)
                      </span>
                    )}
                  </span>
                  {done ? (
                    <Check
                      className="size-4 shrink-0 text-emerald-600 dark:text-emerald-500"
                      aria-label="Done"
                    />
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!isNext || executingIndex !== null}
                      onClick={() => onRenameStep(index)}
                    >
                      {executing ? (
                        <Loader2
                          className="size-4 animate-spin"
                          aria-label="Renaming"
                        />
                      ) : (
                        'Rename'
                      )}
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <DialogFooter className="justify-between sm:justify-between">
          <Button
            variant="secondary"
            disabled={plan.length === 0 || allDone || executingIndex !== null}
            onClick={onRenameAll}
          >
            {executingIndex !== null ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {executingIndex + 1} of {plan.length}
              </span>
            ) : (
              'Rename all'
            )}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
