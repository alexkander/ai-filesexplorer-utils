import { cp, mkdir, rename, rm, stat } from 'fs/promises';
import path from 'path';
import type {
  DeleteOutcome,
  DeletePort,
} from '@/application/directory-comparison/delete-port';

// Same host-path root the app's own browsable filesystem is bind-mounted at
// (docker-compose.yml's ${MYFILES}); defaults to /thezone like that mount
// does when the env var is unset.
const MYFILES_ROOT = process.env.MYFILES || '/thezone';
const TRASH_ROOT = path.join(MYFILES_ROOT, '.ai-filesexplorer-utils-trash');

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

// One subfolder per delete, named for the moment it happened — colons
// replaced since this app only targets Linux, but a colon-free timestamp
// costs nothing and avoids surprises. A short random suffix guards against
// two deletes landing in the same millisecond (unlikely from a single
// user click, but cheap insurance).
function trashFolderName(): string {
  const safeTimestamp = new Date()
    .toISOString()
    .replace(/:/g, '-')
    .replace(/\./g, '-');
  const rand = Math.random().toString(16).slice(2, 6);
  return `${safeTimestamp}-${rand}`;
}

/** Implements DeletePort by MOVING the entry into a timestamped folder
 * under `${MYFILES}/.ai-filesexplorer-utils-trash/` rather than removing it
 * outright — a soft delete, recoverable by hand until the user empties that
 * folder themselves (this tool never does). Tries a plain rename first
 * (instant, same-filesystem only); falls back to copy-then-remove on EXDEV,
 * since the two panes are frequently on different mounts (e.g. local disk
 * vs. an NFS-mounted tree) and a rename can't cross that boundary. */
export const deleteAdapter: DeletePort = {
  async delete(targetPath): Promise<DeleteOutcome> {
    if (!(await pathExists(targetPath))) {
      return { ok: false, reason: 'not_found' };
    }

    const trashDir = path.join(TRASH_ROOT, trashFolderName());
    const destination = path.join(trashDir, path.basename(targetPath));

    try {
      await mkdir(trashDir, { recursive: true });
      try {
        await rename(targetPath, destination);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
        await cp(targetPath, destination, { recursive: true });
        await rm(targetPath, { recursive: true, force: false });
      }
      return { ok: true };
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
  },
};
