import { promises as fs, constants } from 'fs';
import type {
  PathInspectionPort,
  PathKind,
} from '@/application/duplicate-finder/path-inspection-port';

/**
 * Implements PathInspectionPort with a `stat` plus a readability probe, so
 * the scan form can tell the user which of "does not exist", "is not a
 * directory" and "cannot be read" actually happened (spec FR-004).
 */
export const pathInspectionAdapter: PathInspectionPort = {
  async inspect(path: string): Promise<PathKind> {
    let stats;
    try {
      stats = await fs.stat(path);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing';
      // EACCES/EPERM on the stat itself means a parent directory is not
      // traversable — the path may well exist, we just cannot look.
      return 'unreadable';
    }

    if (!stats.isDirectory()) return 'file';

    try {
      // Listing a directory needs both read (see the names) and execute
      // (stat the entries) permission; checking only R_OK would let a scan
      // start and then fail on every single entry.
      await fs.access(path, constants.R_OK | constants.X_OK);
    } catch {
      return 'unreadable';
    }

    return 'directory';
  },
};
