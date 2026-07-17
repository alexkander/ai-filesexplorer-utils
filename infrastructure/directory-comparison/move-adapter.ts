import { cp, rename, rm, stat } from 'fs/promises';
import type {
  MoveOutcome,
  MovePort,
} from '@/application/directory-comparison/move-port';

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Implements MovePort via `fs.promises.rename`, same EXDEV fallback as
 * delete-adapter.ts's move-to-trash: a plain rename is instant but only
 * works within one filesystem, and a breadcrumb drop target can easily be
 * on the OTHER side's tree (a different mount, e.g. local disk vs. an
 * NFS-mounted one) — falls back to copy-then-remove when that happens.
 */
export const moveAdapter: MovePort = {
  async move(sourcePath, destinationPath): Promise<MoveOutcome> {
    if (!(await pathExists(sourcePath))) {
      return { ok: false, reason: 'source_not_found' };
    }
    if (await pathExists(destinationPath)) {
      return { ok: false, reason: 'destination_exists' };
    }
    try {
      try {
        await rename(sourcePath, destinationPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
        await cp(sourcePath, destinationPath, { recursive: true });
        await rm(sourcePath, { recursive: true, force: false });
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
  },
};
