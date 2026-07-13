import type {
  ComparisonRepositoryPort,
  DirectoryComparisonNode,
  FileChecksumEntry,
} from './comparison-repository-port';
import type { ChecksumPort } from './checksum-port';
import {
  nextCascadeStep,
  type FileCascadeSide,
} from '@/domain/directory-comparison/checksum-cascade';
import {
  pairEntriesByName,
  type PairableEntry,
} from '@/domain/directory-comparison/entry-comparison-result';
import {
  deriveDirectoryChecksum,
  type ChildDescriptor,
} from '@/domain/directory-comparison/derive-directory-checksum';
import { getName } from '@/domain/scanning/path-info';
import type { ScanMode } from '@/domain/scanning/scan-stack';
import { isEmptyDirectorySubtree } from './is-empty-directory-subtree';

export interface CompareSubtreeDeps {
  comparisonRepository: ComparisonRepositoryPort;
  checksumPort: ChecksumPort;
}

export interface CompareSubtreeOptions {
  mode: ScanMode;
  /** Checked between pairs (as before) AND passed straight through to
   * `ChecksumPort` so an in-progress file read can be aborted mid-stream
   * (found necessary post-implementation: Stop previously had no effect
   * on whichever single file was actively being hashed when pressed — it
   * could only cancel pairs that hadn't started yet — so a large/slow file
   * made Stop look broken for however long that one file took). */
  signal: AbortSignal;
  /** Called with the most specific unit of work currently active: a
   * directory pair when `compareSubtree` starts resolving it, or a file
   * pair (added post-implementation — found necessary during manual
   * verification, since a single large/slow file gave no visible progress
   * otherwise) right before its content is actually read. */
  onProgress?: (leftPath: string, rightPath: string) => void;
}

export interface CompareSubtreeResult {
  cancelled: boolean;
  matching: boolean;
  /** Set iff `matching` — the checksum just derived/persisted for this pair
   * (identical on both sides), handed to the parent so it can build its own
   * Merkle child-descriptor list without re-querying the DB. */
  checksum: string | null;
  leftHasError: boolean;
  rightHasError: boolean;
}

const CANCELLED_RESULT: CompareSubtreeResult = {
  cancelled: true,
  matching: false,
  checksum: null,
  leftHasError: false,
  rightHasError: false,
};

/**
 * Recursively checks (research.md Decision 11) whether `node`'s cached
 * `directoryChecksum` is still trustworthy: every direct file's
 * `checksummedAt` is not older than its (just-refreshed by Pass 1)
 * `modificationTime`, and every direct subdirectory is itself still valid
 * by this same check, recursively, and non-null. Pure disk-state
 * comparisons only — no hashing, no content reads (SC-005).
 */
function isCacheStillValid(
  node: DirectoryComparisonNode,
  comparisonRepository: ComparisonRepositoryPort,
): boolean {
  if (node.directoryChecksum === null) return false;
  if (node.hasUnreadableEntries || node.ownOutcome !== 'done') return false;

  const { directories, files } = comparisonRepository.getDirectChildren(
    node.path,
  );

  for (const file of files) {
    if (file.checksummedAt === null) return false;
    if (file.checksummedAt < file.modificationTime) return false;
  }
  for (const dir of directories) {
    if (!isCacheStillValid(dir, comparisonRepository)) return false;
  }
  return true;
}

type FileVerdict = 'matching' | 'differs' | 'error' | 'cancelled';

interface FileCompareResult {
  verdict: FileVerdict;
  checksum: string | null;
  leftError: boolean;
  rightError: boolean;
}

type StageResult =
  | { outcome: 'value'; value: string }
  | { outcome: 'error' }
  | { outcome: 'cancelled' };

async function computeStageOrError(
  checksumPort: ChecksumPort,
  comparisonRepository: ComparisonRepositoryPort,
  file: FileChecksumEntry,
  stage: 'need_partial' | 'need_full',
  signal: AbortSignal,
): Promise<StageResult> {
  if (signal.aborted) return { outcome: 'cancelled' };
  try {
    const value =
      stage === 'need_partial'
        ? await checksumPort.computePartialChecksum(file.path, signal)
        : await checksumPort.computeFullChecksum(file.path, signal);
    comparisonRepository.recordChecksums(
      file.path,
      stage === 'need_partial'
        ? { partialChecksum: value }
        : { fullChecksum: value },
    );
    return { outcome: 'value', value };
  } catch {
    // A Stop mid-read surfaces here as a rejected promise too (the stream's
    // 'error' event fires with an AbortError) — distinguish that from a
    // genuine read failure so a cancelled file doesn't get falsely flagged
    // with hasReadError (FR-011 is about real I/O failures, not Stop).
    if (signal.aborted) return { outcome: 'cancelled' };
    comparisonRepository.recordContentReadFailure(file.path);
    return { outcome: 'error' };
  }
}

/**
 * Cascading comparison for one paired file (research.md Decision 3): loops
 * `checksum-cascade.ts`'s pure decision function, computing/persisting
 * whatever stage it asks for next via `ChecksumPort`, until a verdict is
 * reached, a read failure occurs on either side, or `signal` fires.
 */
async function compareFilePair(
  leftFile: FileChecksumEntry,
  rightFile: FileChecksumEntry,
  checksumPort: ChecksumPort,
  comparisonRepository: ComparisonRepositoryPort,
  signal: AbortSignal,
  onProgress?: (leftPath: string, rightPath: string) => void,
): Promise<FileCompareResult> {
  // A file previously flagged with a read error gets its cached checksums
  // treated as absent (rather than trusted as-is), so the cascade below
  // requests a fresh read for it even in incremental mode — a prior failure
  // (e.g. a transient I/O hiccup) deserves another attempt on every compare,
  // not just a "Force full re-compare".
  let left: FileCascadeSide = {
    size: leftFile.size,
    partialChecksum: leftFile.hasReadError ? null : leftFile.partialChecksum,
    fullChecksum: leftFile.hasReadError ? null : leftFile.fullChecksum,
  };
  let right: FileCascadeSide = {
    size: rightFile.size,
    partialChecksum: rightFile.hasReadError ? null : rightFile.partialChecksum,
    fullChecksum: rightFile.hasReadError ? null : rightFile.fullChecksum,
  };

  for (;;) {
    const step = nextCascadeStep({ left, right });
    if (step.kind === 'verdict') {
      return {
        verdict: step.result,
        checksum: step.result === 'matching' ? left.fullChecksum : null,
        leftError: false,
        rightError: false,
      };
    }

    // Only reached when content actually needs reading — reports this exact
    // file pair as the active unit of work (more precise than the
    // containing directory alone), so the UI can show progress per file
    // instead of only per directory.
    onProgress?.(leftFile.path, rightFile.path);

    const key =
      step.kind === 'need_partial' ? 'partialChecksum' : 'fullChecksum';
    let leftError = false;
    let rightError = false;

    if (left[key] === null) {
      const result = await computeStageOrError(
        checksumPort,
        comparisonRepository,
        leftFile,
        step.kind,
        signal,
      );
      if (result.outcome === 'cancelled') {
        return {
          verdict: 'cancelled',
          checksum: null,
          leftError: false,
          rightError: false,
        };
      }
      if (result.outcome === 'error') leftError = true;
      else left = { ...left, [key]: result.value };
    }
    if (right[key] === null) {
      const result = await computeStageOrError(
        checksumPort,
        comparisonRepository,
        rightFile,
        step.kind,
        signal,
      );
      if (result.outcome === 'cancelled') {
        return {
          verdict: 'cancelled',
          checksum: null,
          leftError: false,
          rightError: false,
        };
      }
      if (result.outcome === 'error') rightError = true;
      else right = { ...right, [key]: result.value };
    }

    if (leftError || rightError) {
      return { verdict: 'error', checksum: null, leftError, rightError };
    }
  }
}

/**
 * Pass 2 (research.md Decision 3, Decision 5): walks the two already-listed
 * subtrees bottom-up via post-order recursion (children resolved before
 * their parent, satisfying the same "deepest first" requirement
 * `derive-done-set.ts` addresses for Pass 1, via its own logic — this is
 * not a call into `deriveDoneSet`, which is Pass-1-shaped), pairing direct
 * entries by name (FR-006) and applying the cascading comparison. Only
 * once a directory pair is confirmed `matching` with no read errors
 * anywhere in it does it compute and persist a `directoryChecksum`
 * (identical on both sides) via `derive-directory-checksum.ts`; otherwise
 * any previously-cached checksum is cleared (FR-011a).
 */
export async function compareSubtree(
  leftNode: DirectoryComparisonNode,
  rightNode: DirectoryComparisonNode,
  deps: CompareSubtreeDeps,
  options: CompareSubtreeOptions,
): Promise<CompareSubtreeResult> {
  if (options.signal.aborted) return CANCELLED_RESULT;
  options.onProgress?.(leftNode.path, rightNode.path);

  const { comparisonRepository, checksumPort } = deps;

  if (
    options.mode === 'incremental' &&
    leftNode.directoryChecksum !== null &&
    rightNode.directoryChecksum !== null &&
    leftNode.directoryChecksum === rightNode.directoryChecksum &&
    isCacheStillValid(leftNode, comparisonRepository) &&
    isCacheStillValid(rightNode, comparisonRepository)
  ) {
    comparisonRepository.markSubtreeResolved(leftNode.path);
    comparisonRepository.markSubtreeResolved(rightNode.path);
    return {
      cancelled: false,
      matching: true,
      checksum: leftNode.directoryChecksum,
      leftHasError: false,
      rightHasError: false,
    };
  }

  const leftChildren = comparisonRepository.getDirectChildren(leftNode.path);
  const rightChildren = comparisonRepository.getDirectChildren(rightNode.path);

  const leftDirsByName = new Map(
    leftChildren.directories.map((d) => [getName(d.path), d]),
  );
  const leftFilesByName = new Map(
    leftChildren.files.map((f) => [getName(f.path), f]),
  );
  const rightDirsByName = new Map(
    rightChildren.directories.map((d) => [getName(d.path), d]),
  );
  const rightFilesByName = new Map(
    rightChildren.files.map((f) => [getName(f.path), f]),
  );

  const leftEntries: PairableEntry[] = [
    ...leftChildren.directories.map((d) => ({
      name: getName(d.path),
      kind: 'directory' as const,
    })),
    ...leftChildren.files.map((f) => ({
      name: getName(f.path),
      kind: 'file' as const,
    })),
  ];
  const rightEntries: PairableEntry[] = [
    ...rightChildren.directories.map((d) => ({
      name: getName(d.path),
      kind: 'directory' as const,
    })),
    ...rightChildren.files.map((f) => ({
      name: getName(f.path),
      kind: 'file' as const,
    })),
  ];

  const pairs = pairEntriesByName(leftEntries, rightEntries);

  let allMatching = true;
  let leftHasError =
    leftNode.ownOutcome === 'error' || leftNode.hasUnreadableEntries;
  let rightHasError =
    rightNode.ownOutcome === 'error' || rightNode.hasUnreadableEntries;
  const childDescriptors: ChildDescriptor[] = [];

  for (const pair of pairs) {
    if (options.signal.aborted) return CANCELLED_RESULT;

    if (!pair.left || !pair.right) {
      const presentKind = (pair.left ?? pair.right)!.kind;
      if (presentKind === 'directory') {
        const presentNode = pair.left
          ? leftDirsByName.get(pair.name)!
          : rightDirsByName.get(pair.name)!;
        // An empty directory on only one side is equivalent to a
        // non-existent directory on the other — ignored entirely rather
        // than counted as a mismatch (doesn't affect allMatching, doesn't
        // enter the checksum's child list either).
        if (isEmptyDirectorySubtree(presentNode, comparisonRepository)) {
          continue;
        }
      }
      allMatching = false;
      continue;
    }

    if (pair.left.kind !== pair.right.kind) {
      allMatching = false;
      continue;
    }

    if (pair.left.kind === 'directory') {
      const childLeftNode = leftDirsByName.get(pair.name)!;
      const childRightNode = rightDirsByName.get(pair.name)!;
      const result = await compareSubtree(
        childLeftNode,
        childRightNode,
        deps,
        options,
      );
      if (result.cancelled) return CANCELLED_RESULT;
      leftHasError = leftHasError || result.leftHasError;
      rightHasError = rightHasError || result.rightHasError;
      if (!result.matching || result.checksum === null) {
        allMatching = false;
      } else {
        childDescriptors.push({
          name: pair.name,
          type: 'directory',
          checksum: result.checksum,
        });
      }
    } else {
      const leftFile = leftFilesByName.get(pair.name)!;
      const rightFile = rightFilesByName.get(pair.name)!;
      const result = await compareFilePair(
        leftFile,
        rightFile,
        checksumPort,
        comparisonRepository,
        options.signal,
        options.onProgress,
      );
      if (result.verdict === 'cancelled') return CANCELLED_RESULT;
      leftHasError = leftHasError || result.leftError;
      rightHasError = rightHasError || result.rightError;
      if (result.verdict === 'matching' && result.checksum !== null) {
        childDescriptors.push({
          name: pair.name,
          type: 'file',
          checksum: result.checksum,
        });
      } else {
        allMatching = false;
      }
    }
  }

  if (leftHasError)
    comparisonRepository.recordContentReadFailure(leftNode.path);
  if (rightHasError)
    comparisonRepository.recordContentReadFailure(rightNode.path);

  const matching = allMatching && !leftHasError && !rightHasError;
  let checksum: string | null = null;

  if (matching) {
    const sorted = [...childDescriptors].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    checksum = deriveDirectoryChecksum(sorted);
    comparisonRepository.recordDirectoryChecksum(leftNode.path, checksum);
    comparisonRepository.recordDirectoryChecksum(rightNode.path, checksum);
  } else {
    comparisonRepository.recordDirectoryChecksum(leftNode.path, null);
    comparisonRepository.recordDirectoryChecksum(rightNode.path, null);
  }

  return { cancelled: false, matching, checksum, leftHasError, rightHasError };
}
