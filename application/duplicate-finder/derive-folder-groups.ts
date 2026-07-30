import {
  deriveDirectoryChecksum,
  type ChildDescriptor,
} from '@/domain/duplicate-finder/derive-directory-checksum';
import { isDirectoryCandidate } from '@/domain/duplicate-finder/directory-candidacy';
import { isIgnored } from '@/domain/duplicate-finder/ignored-path-match';
import type { DuplicateRepositoryPort } from './duplicate-repository-port';

export interface DeriveFolderGroupsParams {
  scanSeq: number;
  repository: DuplicateRepositoryPort;
  /** An ignored child means this directory's recorded content is not its real
   * content, so no checksum derived from it can be trusted — the same rule the
   * walk applies via `has_incomplete_content` (research.md Decision 15),
   * re-applied here because a refresh derives from rows that predate the
   * ignore. */
  ignoredPaths: ReadonlySet<string>;
  signal: AbortSignal;
}

export interface DeriveFolderGroupsResult {
  candidates: number;
  aborted: boolean;
}

/**
 * Phase 5 of the scan (spec FR-014): derives a Merkle checksum for every
 * directory that could plausibly have a twin, bottom-up.
 *
 * Candidacy is decided against `findSharedContentPaths` — the files whose
 * content occurs at least twice in this scan — NOT against the persisted
 * groups, which phase 6 has not written yet. Every file a candidate needs a
 * full checksum for is, by construction, already in that set and therefore
 * already hashed by phase 4, which is what keeps folder detection from
 * forcing a full-tree read (research.md Decision 4).
 *
 * Deepest-first ordering means every subdirectory's own result is already
 * recorded when its parent is visited, so one pass suffices.
 */
export function deriveFolderGroups(
  params: DeriveFolderGroupsParams,
): DeriveFolderGroupsResult {
  const { scanSeq, repository, ignoredPaths, signal } = params;

  const sharedContentPaths = repository.findSharedContentPaths(scanSeq);
  const directories = repository.listDirectoriesDeepestFirst(scanSeq);

  repository.updateProgress({ processed: 0, total: directories.length });

  let candidates = 0;
  let processed = 0;

  for (const directory of directories) {
    if (signal.aborted) return { candidates, aborted: true };

    processed += 1;
    repository.updateProgress({ processed, activePath: directory.path });

    if (isIgnored(directory.path, ignoredPaths)) {
      repository.recordDirectoryResult(directory.path, {
        isCandidate: false,
        directoryChecksum: null,
        subtreeSize: 0,
        childCount: 0,
      });
      continue;
    }

    const children = repository.getDirectChildren(directory.path, scanSeq);
    const hasIgnoredChild =
      children.files.some((file) => isIgnored(file.path, ignoredPaths)) ||
      children.directories.some((dir) => isIgnored(dir.path, ignoredPaths));

    const subtreeSize =
      children.files.reduce((sum, file) => sum + file.size, 0) +
      children.directories.reduce((sum, dir) => sum + dir.subtreeSize, 0);
    const childCount = children.files.length + children.directories.length;

    const candidate = isDirectoryCandidate({
      hasIncompleteContent: directory.hasIncompleteContent || hasIgnoredChild,
      files: children.files.map((file) => ({
        contentIsShared: sharedContentPaths.has(file.path),
        hasReadError: file.hasReadError,
      })),
      directories: children.directories.map((dir) => ({
        isCandidate: dir.isCandidate,
      })),
    });

    const descriptors: ChildDescriptor[] = [];
    let derivable = candidate;

    if (candidate) {
      for (const file of children.files) {
        if (!file.fullChecksum) {
          // Shouldn't happen — a shared-content file has a full checksum by
          // definition — but deriving a checksum from a missing one would
          // silently invent an equality, so bail out instead.
          derivable = false;
          break;
        }
        descriptors.push({
          name: file.name,
          type: 'file',
          checksum: file.fullChecksum,
        });
      }
    }

    if (derivable) {
      for (const dir of children.directories) {
        if (!dir.directoryChecksum) {
          derivable = false;
          break;
        }
        descriptors.push({
          name: dir.name,
          type: 'directory',
          checksum: dir.directoryChecksum,
        });
      }
    }

    if (derivable) {
      descriptors.sort((a, b) =>
        a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
      );
      candidates += 1;
    }

    repository.recordDirectoryResult(directory.path, {
      isCandidate: derivable,
      directoryChecksum: derivable
        ? deriveDirectoryChecksum(descriptors)
        : null,
      subtreeSize,
      childCount,
    });
  }

  return { candidates, aborted: false };
}
