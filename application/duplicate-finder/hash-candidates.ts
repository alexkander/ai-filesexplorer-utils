import { isIgnored } from '@/domain/duplicate-finder/ignored-path-match';
import type { ChecksumPort } from './checksum-port';
import type { ChecksumCachePort } from './checksum-cache-port';
import type {
  DuplicateRepositoryPort,
  FileCandidate,
} from './duplicate-repository-port';

export interface HashCandidatesParams {
  scanSeq: number;
  repository: DuplicateRepositoryPort;
  checksums: ChecksumPort;
  cache: ChecksumCachePort;
  /** Bytes covered by a partial checksum — at or below it, that value IS the
   * full checksum (research.md Decision 5). */
  partialThreshold: number;
  /** Excluded paths are not worth reading: the grouping drops them anyway. */
  ignoredPaths: ReadonlySet<string>;
  signal: AbortSignal;
}

export interface HashCandidatesResult {
  hashed: number;
  reused: number;
  failed: number;
  aborted: boolean;
}

/**
 * Phases 2-4 of the scan: the size-first cascade (spec FR-013, SC-002).
 *
 * Phase 2 is the repository query itself — a file whose size is unique in
 * this scan is never returned here, so it is never opened. Phase 3 hashes the
 * first `partialThreshold` bytes of what is left; phase 4 hashes in full only
 * the files whose partial checksums collided with another candidate's.
 *
 * A checksum is looked up before being computed: this feature's own row
 * first (already validated against the current size/mtime by the listing
 * upsert), then the directory comparison tool's read-only cache. A miss
 * always means "hash it" — never "this file has no duplicates" (FR-017).
 */
export async function hashCandidates(
  params: HashCandidatesParams,
): Promise<HashCandidatesResult> {
  const {
    scanSeq,
    repository,
    checksums,
    cache,
    partialThreshold,
    ignoredPaths,
    signal,
  } = params;

  let hashed = 0;
  let reused = 0;
  let failed = 0;

  const partialCandidates = repository
    .findSharedSizeCandidates(scanSeq)
    .filter((candidate) => !isIgnored(candidate.path, ignoredPaths));
  repository.updateProgress({ processed: 0, total: partialCandidates.length });

  const reuseFromCache = (candidate: FileCandidate) =>
    cache.getCachedChecksums(
      candidate.path,
      candidate.size,
      candidate.modificationTime,
    );

  let processed = 0;
  for (const candidate of partialCandidates) {
    if (signal.aborted) return { hashed, reused, failed, aborted: true };

    processed += 1;
    repository.updateProgress({ processed, activePath: candidate.path });

    // Already known from a previous scan of this same, unchanged file.
    if (candidate.fullChecksum) {
      reused += 1;
      continue;
    }

    const cached = reuseFromCache(candidate);
    if (cached.fullChecksum) {
      repository.recordChecksums(candidate.path, {
        fullChecksum: cached.fullChecksum,
        ...(cached.partialChecksum
          ? { partialChecksum: cached.partialChecksum }
          : {}),
      });
      reused += 1;
      continue;
    }

    const knownPartial = candidate.partialChecksum ?? cached.partialChecksum;
    if (knownPartial) {
      // A small file's partial checksum covers the whole file, so it doubles
      // as the full one — recording both here is what lets phase 4 skip it.
      repository.recordChecksums(candidate.path, {
        partialChecksum: knownPartial,
        ...(candidate.size <= partialThreshold
          ? { fullChecksum: knownPartial }
          : {}),
      });
      reused += 1;
      continue;
    }

    try {
      const partial = await checksums.computePartialChecksum(
        candidate.path,
        signal,
      );
      repository.recordChecksums(candidate.path, {
        partialChecksum: partial,
        ...(candidate.size <= partialThreshold
          ? { fullChecksum: partial }
          : {}),
      });
      hashed += 1;
    } catch {
      if (signal.aborted) return { hashed, reused, failed, aborted: true };
      // One unreadable file never aborts the scan (spec FR-010); it is
      // counted and excluded from every later phase.
      repository.recordReadError(candidate.path);
      failed += 1;
    }
  }

  const fullCandidates = repository
    .findSharedPartialCandidates(scanSeq, partialThreshold)
    .filter((candidate) => !isIgnored(candidate.path, ignoredPaths));
  repository.updateProgress({ processed: 0, total: fullCandidates.length });

  processed = 0;
  for (const candidate of fullCandidates) {
    if (signal.aborted) return { hashed, reused, failed, aborted: true };

    processed += 1;
    repository.updateProgress({ processed, activePath: candidate.path });

    const cached = reuseFromCache(candidate);
    if (cached.fullChecksum) {
      repository.recordChecksums(candidate.path, {
        fullChecksum: cached.fullChecksum,
      });
      reused += 1;
      continue;
    }

    try {
      const full = await checksums.computeFullChecksum(candidate.path, signal);
      repository.recordChecksums(candidate.path, { fullChecksum: full });
      hashed += 1;
    } catch {
      if (signal.aborted) return { hashed, reused, failed, aborted: true };
      repository.recordReadError(candidate.path);
      failed += 1;
    }
  }

  return { hashed, reused, failed, aborted: false };
}
