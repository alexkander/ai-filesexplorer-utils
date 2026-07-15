import { rename, stat } from 'fs/promises';
import type {
  RenameOutcome,
  RenamePort,
} from '@/application/directory-comparison/rename-port';

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Implements RenamePort via `fs.promises.rename` — same filesystem only
 * (both paths are the same directory, just a different basename), so no
 * cross-device fallback is needed here unlike delete-adapter.ts's move to
 * trash. Checks source exists and destination doesn't, up front, for clear
 * rejection reasons — mirrors copy-adapter.ts's checks. */
export const renameAdapter: RenamePort = {
  async rename(sourcePath, destinationPath): Promise<RenameOutcome> {
    if (!(await pathExists(sourcePath))) {
      return { ok: false, reason: 'source_not_found' };
    }
    if (await pathExists(destinationPath)) {
      return { ok: false, reason: 'destination_exists' };
    }
    try {
      await rename(sourcePath, destinationPath);
      return { ok: true };
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
  },
};
