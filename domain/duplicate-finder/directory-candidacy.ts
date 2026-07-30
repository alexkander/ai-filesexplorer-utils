export interface CandidacyInput {
  /** Something in this directory could not be read, so its content is not
   * fully known and no checksum derived from it would be trustworthy. */
  hasIncompleteContent: boolean;
  files: { contentIsShared: boolean; hasReadError: boolean }[];
  directories: { isCandidate: boolean }[];
}

/**
 * Can this directory possibly have a twin elsewhere in the scanned tree?
 * (research.md Decision 4 — the rule that lets folder detection coexist with
 * "a file with a unique size is never read".)
 *
 * If `D` and `D'` are distinct duplicated directories inside the scanned
 * root, then every file `f` in `D` has a distinct twin `f'` in `D'` holding
 * the same content, so `f`'s content necessarily occurs at least twice.
 * Contrapositive: a directory containing any file whose content occurs only
 * once cannot be duplicated — and can be pruned without hashing anything
 * extra, since files with a unique size never got a checksum in the first
 * place.
 *
 * The condition is necessary but not sufficient (two same-content files
 * could both live inside this very directory), which is fine: candidacy only
 * decides whether deriving a checksum is worth it. The actual verdict still
 * comes from comparing the derived checksums.
 */
export function isDirectoryCandidate(input: CandidacyInput): boolean {
  if (input.hasIncompleteContent) return false;
  if (input.files.some((file) => file.hasReadError || !file.contentIsShared)) {
    return false;
  }
  return input.directories.every((directory) => directory.isCandidate);
}
