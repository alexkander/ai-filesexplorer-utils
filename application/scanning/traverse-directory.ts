import type { FileSystemPort, RawEntry } from './filesystem-port';
import { shouldIgnoreEntry } from '@/domain/scanning/should-ignore-entry';
import type { ScanMode } from '@/domain/scanning/scan-stack';

export interface TraverseDirectoryResult {
  entries: RawEntry[];
  hasUnreadableEntries: boolean;
  childDirPaths: string[];
}

export type TraverseDirectoryOutcome =
  | { ok: true; result: TraverseDirectoryResult }
  | { ok: false };

/**
 * The feature-agnostic half of a scan's per-node step: lists `path`'s direct
 * children, drops symlinks/unreadable entries (spec FR-015, FR-016), and
 * decides which subdirectories still need visiting — skipping any already
 * present in `doneSet` when `mode: 'incremental'` (research.md Decision 10).
 * Does not touch persistence; callers combine the returned entries with
 * their own feature-specific accumulation/repository writes.
 */
export async function traverseDirectory(
  path: string,
  fileSystem: FileSystemPort,
  mode: ScanMode,
  doneSet?: ReadonlySet<string>,
): Promise<TraverseDirectoryOutcome> {
  const outcome = await fileSystem.listChildren(path);
  if (!outcome.ok) return { ok: false };

  let hasUnreadableEntries = false;
  const entries: RawEntry[] = [];
  const childDirPaths: string[] = [];

  for (const entry of outcome.result.entries) {
    const decision = shouldIgnoreEntry(entry);
    if (decision.ignore) {
      if (decision.reason === 'unreadable') hasUnreadableEntries = true;
      continue;
    }

    entries.push(entry);
    if (entry.kind === 'directory') {
      if (mode === 'incremental' && doneSet?.has(entry.path)) continue;
      childDirPaths.push(entry.path);
    }
  }

  return { ok: true, result: { entries, hasUnreadableEntries, childDirPaths } };
}
