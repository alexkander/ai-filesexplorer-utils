import { isWithinSubtree } from '@/domain/scanning/path-info';
import { normalizeScanPath } from '@/domain/duplicate-finder/normalize-path';
import {
  isInsideTrash,
  trashDestination,
} from '@/domain/duplicate-finder/trash-path';
import type { DuplicateRepositoryPort } from './duplicate-repository-port';
import type { FileDeletionPort } from './file-deletion-port';

export type DeleteRefusal =
  /** Not part of the current result set — the tool only ever deletes what it
   * itself reported. */
  | 'not_reported'
  /** Deleting it would leave the content with a single copy, so it is not a
   * duplicate any more and this UI must not offer to remove it (user rule). */
  | 'last_copy'
  | 'not_a_file'
  | 'is_symlink'
  /** The kind on disk does not match what the results say it is. */
  | 'kind_mismatch'
  /** The trash root lives inside the directory being moved, so the move would
   * have to put the folder inside itself. */
  | 'contains_trash'
  | 'missing'
  | 'unreadable'
  /** Outside the scanned root — impossible through the UI, refused anyway. */
  | 'outside_scan'
  | 'inside_trash'
  | 'scan_running';

export interface DeletionPlan {
  path: string;
  /** Whether this moves a single file or a whole folder — the confirmation has
   * to say which. */
  kind: 'file' | 'directory';
  /** Where the file is moved to: the trash root plus its own absolute path,
   * so the original structure is preserved (spec FR-042). */
  destination: string;
  /** Bytes reclaimed at the original location. */
  freedBytes: number;
  /** Copies that will remain afterwards. */
  remainingCopies: number;
  /** At one remaining copy the content stops being duplicated, so the whole
   * group leaves the results. */
  groupDisappears: boolean;
}

export type DeleteDuplicateOutcome =
  | { outcome: 'planned'; plan: DeletionPlan }
  | { outcome: 'deleted'; plan: DeletionPlan }
  | { outcome: 'refused'; reason: DeleteRefusal };

export interface DeleteDuplicateParams {
  repository: DuplicateRepositoryPort;
  deletion: FileDeletionPort;
  /** Root of the trash area the file is moved under. */
  trashRoot: string;
  path: string;
  /** When true nothing is touched: the checks run and the plan comes back,
   * which is what the UI shows before asking for confirmation (constitution
   * Principle V). */
  dryRun: boolean;
}

/**
 * "Deletes" one copy of a duplicate (spec User Story 5) — which really means
 * moving it under the trash root, keeping its original path structure, so the
 * operation stays recoverable by hand.
 *
 * The constitution's Principle V requires a dry-run that reports exactly what
 * would change plus explicit confirmation before anything is removed, so this
 * use case has two modes and the UI always runs the first one before the
 * second. Every check is repeated in the real run: the plan the user
 * confirmed may be minutes old, and the filesystem does not stand still.
 *
 * The refusals are the safety net, in order of what they protect:
 * - `not_reported` — only paths the current scan reported can be deleted.
 * - `last_copy` — never the final copy of a content (user rule): at one
 *   remaining copy nothing is duplicated any more.
 * - `is_symlink` / `kind_mismatch` — a symlink is not the thing it points at,
 *   and disk disagreeing with the results means something moved since the scan.
 * - `contains_trash` — a directory holding the trash root cannot be moved
 *   into it.
 * - `outside_scan` — a path outside the scanned root, whatever the database
 *   might say.
 * - `scan_running` — the result set is being rewritten underneath us.
 */
export async function deleteDuplicate(
  params: DeleteDuplicateParams,
): Promise<DeleteDuplicateOutcome> {
  const { repository, deletion, trashRoot, dryRun } = params;
  const path = normalizeScanPath(params.path);

  const state = repository.getScanState();
  if (state.state === 'running')
    return { outcome: 'refused', reason: 'scan_running' };

  // Moving something that is already in the trash would nest one trash
  // structure inside another and lose the original path.
  if (isInsideTrash(trashRoot, path)) {
    return { outcome: 'refused', reason: 'inside_trash' };
  }

  const rootPath = state.rootPath ? normalizeScanPath(state.rootPath) : null;
  if (!rootPath || !isWithinSubtree(path, rootPath)) {
    return { outcome: 'refused', reason: 'outside_scan' };
  }

  const occurrence = repository.findOccurrenceByPath(path);
  if (!occurrence) return { outcome: 'refused', reason: 'not_reported' };

  // Moving a directory that contains the trash root would move it inside
  // itself. Checked before anything else about the directory.
  if (
    occurrence.kind === 'directory' &&
    isInsideTrash(path, normalizeScanPath(trashRoot))
  ) {
    return { outcome: 'refused', reason: 'contains_trash' };
  }
  // A group only exists while it has two or more copies, so a lone file is
  // already unreachable from the UI. This is the belt-and-braces check that
  // makes the rule true regardless of how the request was built.
  if (occurrence.occurrenceCount < 2) {
    return { outcome: 'refused', reason: 'last_copy' };
  }

  const target = await deletion.describeTarget(path);
  if (target === 'missing') return { outcome: 'refused', reason: 'missing' };
  // A symlink is never the thing itself: moving through one would take its
  // target, possibly from outside the scanned tree entirely.
  if (target === 'symlink') return { outcome: 'refused', reason: 'is_symlink' };
  const expected =
    occurrence.kind === 'directory' ? 'directory' : 'regular_file';
  if (target !== expected) {
    // What is on disk is not what the results describe — something changed
    // since the scan, so refuse rather than move the wrong kind of thing.
    return {
      outcome: 'refused',
      reason: target === 'unreadable' ? 'unreadable' : 'kind_mismatch',
    };
  }

  const remainingCopies = occurrence.occurrenceCount - 1;
  const plan: DeletionPlan = {
    path,
    kind: occurrence.kind === 'directory' ? 'directory' : 'file',
    destination: trashDestination(trashRoot, path),
    freedBytes: occurrence.size,
    remainingCopies,
    groupDisappears: remainingCopies < 2,
  };

  if (dryRun) return { outcome: 'planned', plan };

  // The move happens first: only once the file is safely at its new home is
  // it forgotten from the results. A failure here throws and leaves both the
  // file and the results exactly as they were.
  const destination = await deletion.moveToTrash(path, plan.destination);
  if (plan.kind === 'directory') repository.removeDeletedDirectory(path);
  else repository.removeDeletedFile(path);
  return { outcome: 'deleted', plan: { ...plan, destination } };
}
