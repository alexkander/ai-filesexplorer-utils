import { createReadStream } from 'fs';
import { createHash } from 'crypto';
import type { ChecksumPort } from '@/application/directory-comparison/checksum-port';

const PARTIAL_CHECKSUM_BYTES = 64 * 1024;

function computeFullChecksum(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function computePartialChecksum(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    // Bounding the stream's own byte range (rather than manually destroying
    // it after N bytes) means 'end' fires naturally exactly once, whether
    // the file is larger or smaller than the threshold — no risk of both
    // 'close' and 'end' firing and calling hash.digest() twice.
    const stream = createReadStream(path, { end: PARTIAL_CHECKSUM_BYTES - 1 });
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
