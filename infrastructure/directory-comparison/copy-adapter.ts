import { cp, stat } from 'fs/promises';
import type {
  CopyOutcome,
  CopyPort,
} from '@/application/directory-comparison/copy-port';

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Implements CopyPort via `fs.promises.cp` (Node built-in, no new
 * dependency), recursive for directories. Checks the destination doesn't
 * exist up front (fast, clear rejection reason) in addition to `cp`'s own
 * `errorOnExist`/`force: false` guard against overwriting mid-copy.
 */
export const copyAdapter: CopyPort = {
  async copy(sourcePath, destinationPath): Promise<CopyOutcome> {
    if (!(await pathExists(sourcePath))) {
      return { ok: false, reason: 'source_not_found' };
    }
    if (await pathExists(destinationPath)) {
      return { ok: false, reason: 'destination_exists' };
    }
    try {
      await cp(sourcePath, destinationPath, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      return { ok: true };
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
  },
};
