import {
  getName,
  getParentPath,
  joinChildPath,
} from '@/domain/scanning/path-info';
import type { RenameOutcome, RenamePort } from './rename-port';

/** `.` + a filesystem-safe timestamp + `.bk`, appended onto the ORIGINAL
 * full name (spec: user request format "{filename}.{ext}.{timestamp}.bk"
 * — for a name like "photo.jpg" that's already exactly filename + "." +
 * ext, so there's no actual name/extension splitting to do here). Colons
 * and dots in the timestamp are replaced the same way delete-adapter.ts's
 * trash folder names are, for the same reason (filesystem-safe, and a
 * dot-free timestamp avoids it being misread as part of the extension). */
export function backupNameFor(originalName: string, now: Date): string {
  const safeTimestamp = now
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\./g, '-');
  return `${originalName}.${safeTimestamp}.bk`;
}

export interface BackupResult {
  outcome: RenameOutcome;
  /** The name it was renamed to, iff the rename succeeded. */
  backedUpAs: string | null;
}

/**
 * Renames a file to a timestamped "backup" name in its own directory —
 * one step of a checksum-match rename plan (see
 * domain/directory-comparison/build-rename-plan.ts): "make room" for a
 * pending rename by moving whatever's currently occupying its destination
 * out of the way first, without losing it.
 */
export async function backupEntry(
  path: string,
  renamePort: RenamePort,
): Promise<BackupResult> {
  const parent = getParentPath(path) ?? '/';
  const backupName = backupNameFor(getName(path), new Date());
  const backupPath = joinChildPath(parent, backupName);
  const outcome = await renamePort.rename(path, backupPath);
  return { outcome, backedUpAs: outcome.ok ? backupName : null };
}
