export type GroupKind = 'file' | 'directory';

/** The two orderings the listing offers (spec FR-020). */
export type SortBy = 'size' | 'occurrences';

/** Both directions are offered: descending answers "what should I clean up
 * first", ascending answers "what is safe to dismiss" (user request). */
export type SortDir = 'asc' | 'desc';

/** Groups per page in the listing (spec Assumptions). */
export const PAGE_SIZE = 50;

/**
 * SHA-256 of zero bytes. A group is flagged "empty" by comparing against
 * this rather than by `size === 0` (research.md Decision 12): on rclone's
 * Google Drive mount, an Office file edited in Drive's compatibility mode
 * reports a filesystem size of 0 while holding real content, and marking
 * that as empty would be a lie. Its real content hashes to something else,
 * so the digest test gets it right for free.
 */
export const EMPTY_CONTENT_CHECKSUM =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** One repeated content checksum: a row of the results listing. */
export interface DuplicateGroup {
  checksum: string;
  kind: GroupKind;
  /** Bytes of a single occurrence — file size, or the folder's subtree size. */
  size: number;
  /** Always >= 2; a group below that never exists (spec FR-026). */
  occurrenceCount: number;
  isEmpty: boolean;
}

/** A group plus the paths it was built from, before/while being persisted. */
export interface DuplicateGroupWithPaths extends DuplicateGroup {
  paths: string[];
}

export function isSortBy(value: string): value is SortBy {
  return value === 'size' || value === 'occurrences';
}

export function isSortDir(value: string): value is SortDir {
  return value === 'asc' || value === 'desc';
}

export function isGroupKind(value: string): value is GroupKind {
  return value === 'file' || value === 'directory';
}
