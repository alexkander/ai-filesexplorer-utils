import { isFullyExplainedByOneFolderGroup } from '@/domain/duplicate-finder/collapse-nested-groups';
import {
  EMPTY_CONTENT_CHECKSUM,
  type DuplicateGroupWithPaths,
} from '@/domain/duplicate-finder/duplicate-group';
import type { DuplicateRepositoryPort } from './duplicate-repository-port';

export interface BuildDuplicateResultsParams {
  scanSeq: number;
  repository: DuplicateRepositoryPort;
  includeFolders: boolean;
}

export interface BuildDuplicateResultsResult {
  fileGroups: number;
  folderGroups: number;
  collapsedGroups: number;
}

/**
 * Phase 6, the scan's last step: turns the checksums recorded so far into the
 * result set the listing reads (spec FR-009, FR-012, FR-016).
 *
 * Runs even when the scan was stopped early, over whatever was hashed by
 * then, so Stop leaves usable partial results rather than an empty screen
 * (research.md Decision 13).
 */
export function buildDuplicateResults(
  params: BuildDuplicateResultsParams,
): BuildDuplicateResultsResult {
  const { scanSeq, repository, includeFolders } = params;

  const fileGroups = repository
    .findDuplicateFileGroups(scanSeq)
    .map((group): DuplicateGroupWithPaths => ({
      ...group,
      // Decided by the digest, not by `size === 0`: a file whose size is
      // misreported as 0 (rclone's Google Drive mount does this for Office
      // files edited in Drive) holds real content and must not be labelled
      // empty (research.md Decision 12).
      isEmpty: group.checksum === EMPTY_CONTENT_CHECKSUM,
    }));

  const folderGroups = includeFolders
    ? repository.findDuplicateDirectoryGroups(scanSeq)
    : [];

  // Which duplicated folder each folder-group member is — the index the
  // collapsing rule walks each occurrence's ancestors against (O(depth) per
  // occurrence rather than a scan of every member).
  const folderGroupByMemberPath = new Map<string, string>();
  for (const group of folderGroups) {
    for (const path of group.paths) {
      folderGroupByMemberPath.set(path, group.checksum);
    }
  }

  const allGroups = [...folderGroups, ...fileGroups];
  const kept = allGroups.filter(
    (group) =>
      !isFullyExplainedByOneFolderGroup(group.paths, folderGroupByMemberPath),
  );

  repository.clearResults();
  repository.saveGroups(kept, scanSeq);

  return {
    fileGroups: kept.filter((group) => group.kind === 'file').length,
    folderGroups: kept.filter((group) => group.kind === 'directory').length,
    collapsedGroups: allGroups.length - kept.length,
  };
}
