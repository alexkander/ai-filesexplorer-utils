import { joinChildPath } from '@/domain/scanning/path-info';
import {
  recordHashedName,
  sortMatches,
  type ChecksumMatch,
} from '@/application/directory-comparison/find-checksum-matches';
import {
  buildRenamePlan,
  type RenamePlanStep,
} from '@/domain/directory-comparison/build-rename-plan';
import { checksumAdapter } from './checksum-adapter';

export interface ChecksumMatchStatus {
  running: boolean;
  hashed: number;
  total: number;
  /** Raw discoveries so far, in whatever order they were found — shown
   * live while `running` (spec: user request). Superseded by `plan` once
   * hashing finishes: sequencing matches into safe, ordered rename steps
   * needs the COMPLETE set (a match found early can still turn out to be
   * part of a longer chain/cycle only apparent once everything's hashed),
   * so `plan` is null until then. */
  matches: ChecksumMatch[];
  plan: RenamePlanStep[] | null;
}

/**
 * Module-level singleton for the "Find checksum matches" search (spec:
 * user request: progressive results instead of a single all-at-once
 * response) — same shape as `comparison-pass-worker.ts`: `start()` kicks
 * off the search in the background and returns immediately, `/status`
 * polling reads whatever's been discovered so far. Hashes the left and
 * right candidate lists as two concurrent streams (same 2-way parallelism
 * the previous single-shot implementation had via `Promise.all`), folding
 * each freshly-hashed name into the running match set as it completes —
 * not two separate batches finishing before any cross-referencing starts.
 */
class ChecksumMatchWorker {
  private running = false;
  private hashed = 0;
  private total = 0;
  private matchByChecksum = new Map<string, ChecksumMatch>();
  private plan: RenamePlanStep[] | null = null;
  private abortController: AbortController | null = null;

  start(
    leftPath: string,
    rightPath: string,
    leftNames: string[],
    rightNames: string[],
    existingLeftNames: ReadonlySet<string>,
  ): void {
    // A fresh search always supersedes whatever's still running — its
    // results are stale the moment the user re-triggers this, same as
    // Compare's own queue-of-one behavior.
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;

    this.running = true;
    this.hashed = 0;
    this.total = leftNames.length + rightNames.length;
    this.matchByChecksum = new Map();
    this.plan = null;

    void this.run(
      leftPath,
      rightPath,
      leftNames,
      rightNames,
      existingLeftNames,
      abortController,
    );
  }

  private async run(
    leftPath: string,
    rightPath: string,
    leftNames: string[],
    rightNames: string[],
    existingLeftNames: ReadonlySet<string>,
    abortController: AbortController,
  ): Promise<void> {
    const leftByChecksum = new Map<string, string[]>();
    const rightByChecksum = new Map<string, string[]>();

    const hashSide = async (
      side: 'left' | 'right',
      parentPath: string,
      names: string[],
      ownByChecksum: Map<string, string[]>,
      otherByChecksum: Map<string, string[]>,
    ): Promise<void> => {
      for (const name of names) {
        if (abortController.signal.aborted) return;
        try {
          const checksum = await checksumAdapter.computeFullChecksum(
            joinChildPath(parentPath, name),
            abortController.signal,
          );
          if (abortController.signal.aborted) return;
          recordHashedName(
            side,
            name,
            checksum,
            ownByChecksum,
            otherByChecksum,
            this.matchByChecksum,
          );
        } catch {
          // Unreadable file (or aborted mid-read) — excluded from
          // matching rather than surfaced as an error; this is a
          // best-effort discovery tool, not a scan.
        }
        this.hashed += 1;
      }
    };

    try {
      await Promise.all([
        hashSide('left', leftPath, leftNames, leftByChecksum, rightByChecksum),
        hashSide(
          'right',
          rightPath,
          rightNames,
          rightByChecksum,
          leftByChecksum,
        ),
      ]);

      if (abortController.signal.aborted) return;

      this.plan = buildRenamePlan(
        sortMatches([...this.matchByChecksum.values()]),
        existingLeftNames,
      );
    } finally {
      // Only the run that's still current clears `running` — a
      // superseded one finishing later must not clobber a newer run's
      // in-progress state.
      if (this.abortController === abortController) {
        this.running = false;
      }
    }
  }

  getStatus(): ChecksumMatchStatus {
    return {
      running: this.running,
      hashed: this.hashed,
      total: this.total,
      matches: sortMatches([...this.matchByChecksum.values()]),
      plan: this.plan,
    };
  }
}

export const checksumMatchWorker = new ChecksumMatchWorker();
