import { createReadStream } from 'fs';
import { createHash } from 'crypto';
import type { ChecksumPort } from '@/application/directory-comparison/checksum-port';

const PARTIAL_CHECKSUM_BYTES = 64 * 1024;

function computeFullChecksum(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    // `signal` (added post-implementation) lets Stop (FR-013) destroy this
    // stream mid-read instead of only being checked between separate files
    // — `fs.createReadStream` aborts the stream and emits 'error' with an
    // AbortError when it fires, which `stream.on('error', reject)` already
    // catches; the caller distinguishes an abort from a genuine read
    // failure via `signal.aborted`.
    const stream = createReadStream(path, { signal });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function computePartialChecksum(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    // Bounding the stream's own byte range (rather than manually destroying
    // it after N bytes) means 'end' fires naturally exactly once, whether
    // the file is larger or smaller than the threshold — no risk of both
    // 'close' and 'end' firing and calling hash.digest() twice.
    const stream = createReadStream(path, {
      end: PARTIAL_CHECKSUM_BYTES - 1,
      signal,
    });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Implements ChecksumPort via `fs.createReadStream` piped into
 * `crypto.createHash('sha256')` (research.md Decision 4) — streamed, never
 * loading a whole file into memory regardless of size.
 */
export const checksumAdapter: ChecksumPort = {
  computePartialChecksum,
  computeFullChecksum,
};
