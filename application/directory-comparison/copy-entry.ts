import type { CopyOutcome, CopyPort } from './copy-port';

/**
 * Copies an "only on this side" entry to the other side (spec FR-018). The
 * only filesystem-writing use case in this otherwise read-only tool —
 * refuses to run if the destination already exists (CopyPort's contract),
 * so it can never overwrite, move, or delete anything.
 */
export function copyEntry(
  sourcePath: string,
  destinationPath: string,
  copyPort: CopyPort,
): Promise<CopyOutcome> {
  return copyPort.copy(sourcePath, destinationPath);
}
