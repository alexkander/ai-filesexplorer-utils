'use client';

import { useEffect, useState } from 'react';
import { EyeOff, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/infrastructure/ui/components/dialog';
import { CopyablePath } from '@/infrastructure/ui/components/copyable-path';
import { getParentPath } from '@/domain/scanning/path-info';
import type { GroupKind } from '@/domain/duplicate-finder/duplicate-group';
import type { DeletionPlan } from '@/application/duplicate-finder/delete-duplicate';
import { CopyButton } from './copy-button';
import { humanizeSize } from './format-size';

export interface OccurrencesTarget {
  checksum: string;
  kind: GroupKind;
  name: string;
  /** The row the dialog was opened from, highlighted in the list so the user
   * can tell which of the copies they were looking at. */
  path: string;
}

/**
 * Where else this exact content lives (user request). The by-directory view
 * shows one copy at a time by construction — it is a directory listing — so
 * without this the user would have to switch tabs and hunt for the checksum
 * to answer "and where are the others?".
 */
export function OccurrencesDialog({
  target,
  onClose,
  onDeleted,
}: {
  target: OccurrencesTarget | null;
  onClose: () => void;
  /** A copy was moved to the trash: the listing behind this dialog has to
   * refresh its counts and sizes. */
  onDeleted: () => void;
}) {
  // Keyed by the group it belongs to, and only ever written from the fetch's
  // own callbacks. Resetting it synchronously when `target` changes would be
  // a setState inside the effect body; instead, a result whose key no longer
  // matches simply reads as "not loaded yet".
  const [result, setResult] = useState<{
    key: string;
    paths: string[] | null;
    failed: boolean;
  } | null>(null);

  const key = target ? `${target.kind}:${target.checksum}` : null;

  useEffect(() => {
    if (!target || !key) return;
    let ignore = false;
    fetch(
      `/api/duplicate-finder/occurrences?checksum=${encodeURIComponent(target.checksum)}&kind=${target.kind}`,
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('gone'))))
      .then((body: { paths: string[] }) => {
        if (!ignore) setResult({ key, paths: body.paths, failed: false });
      })
      .catch(() => {
        // The group can disappear between rendering the row and clicking:
        // a path ignored elsewhere, or a newer scan replacing the results.
        if (!ignore) setResult({ key, paths: null, failed: true });
      });
    return () => {
      ignore = true;
    };
  }, [target, key]);

  const current = result && result.key === key ? result : null;
  const paths = current?.paths ?? null;
  const failed = current?.failed ?? false;

  const [plan, setPlan] = useState<DeletionPlan | null>(null);
  const [busyPath, setBusyPath] = useState<string | null>(null);

  const REFUSALS: Record<string, string> = {
    not_reported:
      'That path is not part of the current results any more — refresh and try again.',
    last_copy:
      'That is the only copy left, so it is not a duplicate any more and cannot be deleted from here.',
    is_symlink: 'That path is a symlink, not the thing it points at.',
    kind_mismatch:
      'What is on disk no longer matches the results — re-scan and try again.',
    contains_trash:
      'That folder holds the trash directory, so it cannot be moved into it.',
    not_a_file: 'That path is not a regular file.',
    missing: 'That file is already gone from disk.',
    unreadable: 'That file could not be read.',
    outside_scan: 'That path lies outside the scanned directory.',
    scan_running: 'A scan is running — stop it before deleting anything.',
  };

  /**
   * Excludes one copy from duplicate search. The server prunes it and repairs
   * the group, so ignoring one of two copies leaves the other not duplicated
   * at all and the group disappears — exactly what deleting a copy does to the
   * results, minus touching the disk.
   */
  const ignore = async (path: string) => {
    setBusyPath(path);
    try {
      const res = await fetch('/api/duplicate-finder/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, ignored: true }),
      });
      if (!res.ok) {
        window.alert(`Failed to ignore "${path}"`);
        return;
      }
      setPlan(null);
      onDeleted();

      const remaining = (paths ?? []).filter((other) => other !== path);
      if (remaining.length < 2) {
        onClose();
        return;
      }
      if (key) setResult({ key, paths: remaining, failed: false });
    } finally {
      setBusyPath(null);
    }
  };

  /** Step 1: ask the server what would happen, touching nothing. */
  const planDeletion = async (path: string) => {
    setBusyPath(path);
    setPlan(null);
    try {
      const res = await fetch('/api/duplicate-finder/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, dryRun: true }),
      });
      const body = (await res.json()) as {
        plan?: DeletionPlan;
        error?: string;
      };
      if (!res.ok || !body.plan) {
        window.alert(
          REFUSALS[body.error ?? ''] ?? 'That file cannot be deleted.',
        );
        return;
      }
      setPlan(body.plan);
    } finally {
      setBusyPath(null);
    }
  };

  /** Step 2: the user confirmed the previewed change. */
  const confirmDeletion = async (path: string) => {
    setBusyPath(path);
    try {
      const res = await fetch('/api/duplicate-finder/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, dryRun: false }),
      });
      const body = (await res.json()) as {
        plan?: DeletionPlan;
        error?: string;
      };
      if (!res.ok || !body.plan) {
        window.alert(
          REFUSALS[body.error ?? ''] ?? 'That file could not be deleted.',
        );
        return;
      }

      setPlan(null);
      onDeleted();

      // One copy left means the content is no longer duplicated, so the group
      // is gone from the results and this dialog has nothing left to show.
      if (body.plan.groupDisappears) {
        onClose();
        return;
      }
      if (key && paths) {
        setResult({
          key,
          paths: paths.filter((candidate) => candidate !== path),
          failed: false,
        });
      }
    } finally {
      setBusyPath(null);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[min(92vw,80rem)]">
        <DialogHeader>
          <DialogTitle className="truncate">
            {target?.name ?? 'Duplicates'}
          </DialogTitle>
          <DialogDescription>
            {target && (
              <>
                Every place this{' '}
                {target.kind === 'directory' ? 'folder' : 'file'}
                &apos;s content appears in the scan.{' '}
                <span className="font-mono text-xs">{target.checksum}</span>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {failed ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            This group is no longer part of the current results — it was
            ignored, or a newer scan replaced them.
          </p>
        ) : paths === null ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading…
          </div>
        ) : (
          <ul className="flex max-h-[60vh] flex-col divide-y overflow-y-auto rounded-md border">
            {paths.map((path) => (
              <li key={path} className="flex flex-col">
                <div
                  className={
                    path === target?.path
                      ? 'flex items-center gap-2 bg-accent px-3 py-2 text-sm'
                      : 'flex items-center gap-2 px-3 py-2 text-sm'
                  }
                >
                  <CopyablePath
                    path={path}
                    title={path}
                    className="min-w-0 flex-1 truncate text-xs"
                  />
                  {path === target?.path && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      this one
                    </span>
                  )}
                  <CopyButton
                    value={path}
                    label="Path"
                    title={`Copy full path: ${path}`}
                  />
                  <CopyButton
                    value={getParentPath(path) ?? '/'}
                    label="Dir"
                    title={`Copy containing folder: ${getParentPath(path) ?? '/'}`}
                  />
                  {/* Only offered while the content still has copies to
                      spare. At two the group is about to disappear, and the
                      survivor must not be deletable from here (user rule). */}
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={busyPath !== null}
                    onClick={() => void ignore(path)}
                    title={
                      target?.kind === 'directory'
                        ? 'Ignore this folder and everything in it in future scans'
                        : 'Ignore this copy in future scans'
                    }
                  >
                    <EyeOff className="size-3" aria-hidden="true" />
                    Ignore
                  </Button>

                  {paths.length > 1 && (
                    <Button
                      variant="destructive"
                      size="xs"
                      disabled={busyPath !== null}
                      onClick={() => void planDeletion(path)}
                      title={
                        target?.kind === 'directory'
                          ? 'Move this whole folder to the trash'
                          : 'Move this copy to the trash'
                      }
                    >
                      {busyPath === path ? (
                        <Loader2
                          className="size-3 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <Trash2 className="size-3" aria-hidden="true" />
                      )}
                      Delete
                    </Button>
                  )}
                </div>

                {plan?.path === path && (
                  <div className="flex flex-wrap items-center gap-2 border-t bg-destructive/5 px-3 py-2 text-xs">
                    <span className="min-w-0 flex-1">
                      Moves this {plan.kind === 'directory' ? 'folder' : 'file'}
                      {plan.kind === 'directory'
                        ? ' and everything in it'
                        : ''}{' '}
                      to{' '}
                      <span className="font-mono break-all">
                        {plan.destination}
                      </span>
                      , freeing{' '}
                      <span className="font-medium">
                        {humanizeSize(plan.freedBytes)}
                      </span>{' '}
                      where it is now.{' '}
                      {plan.groupDisappears
                        ? 'Only one copy will be left, so this content stops counting as duplicated and leaves the results.'
                        : `${plan.remainingCopies} copies will remain.`}{' '}
                      Nothing is erased — move it back from there to undo.
                    </span>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => setPlan(null)}
                      disabled={busyPath !== null}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      size="xs"
                      onClick={() => void confirmDeletion(path)}
                      disabled={busyPath !== null}
                    >
                      Delete for real
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
