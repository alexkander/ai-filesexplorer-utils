import { createHash } from 'crypto';

export interface ChildDescriptor {
  name: string;
  type: 'file' | 'directory';
  checksum: string;
}

const SEPARATOR = ' ';

/**
 * Merkle-style directory checksum (spec FR-014): hash of the sorted-by-name
 * list of (child name, child type, child checksum). Pure computation over
 * already-known values, not file content, so this stays in the domain layer
 * despite using `crypto` — Principle II forbids `fs`/SQL/network I/O, which
 * this has none of. Callers MUST pass an already name-sorted list.
 *
 * Kept as a local copy rather than importing the directory comparison tool's
 * equivalent — this feature slice stays free of cross-tool imports (the only
 * intentional exception is the shared `scanning` module). The two copies must
 * hash the same representation; if a future feature ever compares directory
 * checksums ACROSS the two tools, promote this into a shared module in that
 * change (research.md Decision 9).
 */
export function deriveDirectoryChecksum(children: ChildDescriptor[]): string {
  const hash = createHash('sha256');
  for (const child of children) {
    hash.update(child.name);
    hash.update(SEPARATOR);
    hash.update(child.type);
    hash.update(SEPARATOR);
    hash.update(child.checksum);
    hash.update(SEPARATOR);
  }
  return hash.digest('hex');
}
