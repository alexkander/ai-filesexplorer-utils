import type {
  DuplicateGroup,
  DuplicateGroupWithPaths,
  GroupKind,
  SortBy,
} from '@/domain/duplicate-finder/duplicate-group';

export type ScanRunState =
  'idle' | 'running' | 'finished' | 'stopped' | 'failed';

export type ScanPhase = 'listing' | 'hashing' | 'deriving_folders' | 'grouping';

export interface ScanState {
  scanSeq: number;
  rootPath: string | null;
  includeFolders: boolean;
  state: ScanRunState;
  phase: ScanPhase | null;
  activePath: string | null;
  processed: number;
  total: number;
  unreadableCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Every field optional — a progress update only writes what it knows. */
export interface ScanProgress {
  phase: ScanPhase | null;
  activePath: string | null;
  processed: number;
  total: number;
  unreadableCount: number;
}

export interface FileFacts {
  path: string;
  parentPath: string;
  size: number;
  modificationTime: string;
}

export interface DirectoryFacts {
  path: string;
  parentPath: string | null;
  depth: number;
  hasIncompleteContent: boolean;
}

export interface FileCandidate {
  path: string;
  size: number;
  modificationTime: string;
  partialChecksum: string | null;
  fullChecksum: string | null;
}

export interface RecordedChecksums {
  partialChecksum?: string;
  fullChecksum?: string;
}

export interface DirectoryRow {
  path: string;
  parentPath: string | null;
  depth: number;
  hasIncompleteContent: boolean;
}

export interface ChildFile {
  name: string;
  path: string;
  size: number;
  fullChecksum: string | null;
  hasReadError: boolean;
}

export interface ChildDirectory {
  name: string;
  path: string;
  isCandidate: boolean;
  directoryChecksum: string | null;
  subtreeSize: number;
}

export interface DirectChildren {
  files: ChildFile[];
  directories: ChildDirectory[];
}

export interface DirectoryResult {
  isCandidate: boolean;
  directoryChecksum: string | null;
  subtreeSize: number;
  childCount: number;
}

export interface GroupQuery {
  sortBy: SortBy;
  offset: number;
  limit: number;
}

export interface IgnoredPath {
  path: string;
  ignoredAt: string;
}

export interface PruneCounts {
  removedGroups: number;
  removedOccurrences: number;
}

/**
 * This feature's persistence contract
 * (contracts/duplicate-repository-port-contract.md). Scoped to its own
 * schema: it never touches the filesystem and never opens another tool's
 * database.
 */
export interface DuplicateRepositoryPort {
  // ---- scan lifecycle ---------------------------------------------------
  getScanState(): ScanState;
  /** Starts a run and returns the new `scan_seq`, which scopes its rows. */
  beginScan(rootPath: string, includeFolders: boolean): number;
  updateProgress(update: Partial<ScanProgress>): void;
  finishScan(
    state: 'finished' | 'stopped' | 'failed',
    errorMessage?: string,
  ): void;
  /** Startup reconciliation: a row left `running` by a dead process. */
  reconcileInterruptedScan(): void;

  // ---- phase 1: listing -------------------------------------------------
  upsertFileFacts(facts: FileFacts[], scanSeq: number): void;
  upsertDirectory(directory: DirectoryFacts, scanSeq: number): void;

  // ---- phases 2-4: hashing ----------------------------------------------
  /** Files sharing a size with at least one other file of this scan. */
  findSharedSizeCandidates(scanSeq: number): FileCandidate[];
  /**
   * Files still needing a full checksum: same size AND same partial checksum
   * as another candidate, and larger than `partialThreshold` (at or below it
   * the partial value already IS the full checksum).
   */
  findSharedPartialCandidates(
    scanSeq: number,
    partialThreshold: number,
  ): FileCandidate[];
  recordChecksums(path: string, checksums: RecordedChecksums): void;
  recordReadError(path: string): void;
  /**
   * Paths whose full checksum is shared by >= 2 files of this scan — the
   * input to folder candidacy, available BEFORE any group is persisted
   * (research.md Decision 4).
   */
  findSharedContentPaths(scanSeq: number): Set<string>;

  // ---- phase 5: folders -------------------------------------------------
  listDirectoriesDeepestFirst(scanSeq: number): DirectoryRow[];
  getDirectChildren(path: string, scanSeq: number): DirectChildren;
  recordDirectoryResult(path: string, result: DirectoryResult): void;

  // ---- phase 6: results -------------------------------------------------
  findDuplicateFileGroups(scanSeq: number): DuplicateGroupWithPaths[];
  findDuplicateDirectoryGroups(scanSeq: number): DuplicateGroupWithPaths[];
  clearResults(): void;
  saveGroups(groups: DuplicateGroupWithPaths[], scanSeq: number): void;

  // ---- reads for the UI -------------------------------------------------
  listGroups(query: GroupQuery): { groups: DuplicateGroup[]; total: number };
  listOccurrences(checksum: string, kind: GroupKind): string[];
  countGroups(): number;

  // ---- ignore list ------------------------------------------------------
  listIgnoredPaths(): IgnoredPath[];
  loadIgnoredPathSet(): Set<string>;
  /**
   * Marking owns the whole operation: ignore row, occurrence removal at or
   * beneath `path`, group recount, and deletion of any group left below two
   * occurrences — one transaction (spec FR-026). Unmarking only deletes the
   * ignore row; results come back on the next scan, never retroactively.
   */
  setIgnored(path: string, ignored: boolean): PruneCounts;
}
