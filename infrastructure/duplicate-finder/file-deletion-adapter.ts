import { promises as fs } from 'fs';
import path from 'path';
import type {
  DeletionTargetKind,
  FileDeletionPort,
} from '@/application/duplicate-finder/file-deletion-port';

/**
 * Where deleted duplicates go. Inside the container this resolves to
 * `/app/data` (the app's working directory is `/app`), which is the same
 * `data/` directory the databases live in — git-ignored, so nothing trashed
 * is ever committed. Overridable for the same reason the database paths are.
 */
export const TRASH_ROOT =
  process.env.DUPLICATE_FINDER_TRASH_DIR || path.join(process.cwd(), 'data');

/** `dest`, or `dest.1`, `dest.2`… — the first name nothing occupies. Deleting
 * the same path twice (restored in between, or a same-named file from a later
 * scan) must never silently overwrite what is already in the trash. */
async function firstFreeName(destination: string): Promise<string> {
  let candidate = destination;
  for (let suffix = 1; suffix < 1000; suffix += 1) {
    try {
      await fs.lstat(candidate);
    } catch {
      return candidate; // nothing there
    }
    candidate = `${destination}.${suffix}`;
  }
  throw new Error(`No free name in the trash for ${destination}`);
}

export const fileDeletionAdapter: FileDeletionPort = {
  async describeTarget(targetPath: string): Promise<DeletionTargetKind> {
    try {
      const stats = await fs.lstat(targetPath);
      if (stats.isSymbolicLink()) return 'symlink';
      if (stats.isDirectory()) return 'directory';
      if (!stats.isFile()) return 'unreadable';
      return 'regular_file';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing';
      return 'unreadable';
    }
  },

  async moveToTrash(sourcePath: string, destination: string): Promise<string> {
    const finalPath = await firstFreeName(destination);
    await fs.mkdir(path.dirname(finalPath), { recursive: true });

    try {
      await fs.rename(sourcePath, finalPath);
      return finalPath;
    } catch (error) {
      // The scanned tree and the trash root are routinely on different
      // filesystems (a NAS mount, an rclone mount, a separate disk), and
      // `rename` cannot cross that boundary. Copy-then-unlink is the
      // fallback, in that order: if the copy fails, the original is still
      // there.
      if ((error as NodeJS.ErrnoException)?.code !== 'EXDEV') throw error;
      // Copy first, remove second — if the copy fails the original is intact.
      // `recursive` covers a whole duplicated folder; for a file it behaves
      // like a plain copy.
      await fs.cp(sourcePath, finalPath, { recursive: true, force: false });
      await fs.rm(sourcePath, { recursive: true, force: false });
      return finalPath;
    }
  },
};
