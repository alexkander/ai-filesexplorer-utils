import type {
  DuplicateRepositoryPort,
  PruneCounts,
} from './duplicate-repository-port';

/**
 * Marks or unmarks a path as ignored for duplicate search (spec FR-024 —
 * FR-027).
 *
 * Thin on purpose: the repository owns the whole mark-and-prune transaction
 * (ignore row, occurrence removal at or beneath the path, group recount,
 * deletion of any group left below two occurrences). Splitting that across
 * two calls from here would let a failure leave the ignore list and the
 * result set out of step.
 *
 * Unmarking only removes the ignore entry — results come back on the next
 * scan, never retroactively, because nothing re-hashed them in the meantime.
 */
export function setIgnored(
  repository: DuplicateRepositoryPort,
  path: string,
  ignored: boolean,
): PruneCounts {
  return repository.setIgnored(path, ignored);
}
