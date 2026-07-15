import { promises as fs } from 'fs';
import path from 'path';
import type {
  FileSystemPort,
  ListChildrenNamesOutcome,
  ListChildrenOutcome,
  RawEntry,
} from '@/application/scanning/filesystem-port';

function isUnreadableError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'EACCES' || code === 'EPERM' || code === 'ENOENT';
}

function isNotFoundError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function toRawEntry(
  dirPath: string,
  dirent: import('fs').Dirent,
): Promise<RawEntry> {
  const entryPath = path.join(dirPath, dirent.name);

  if (dirent.isSymbolicLink()) {
    return { name: dirent.name, path: entryPath, kind: 'symlink', size: 0 };
  }

  if (dirent.isDirectory()) {
    return { name: dirent.name, path: entryPath, kind: 'directory', size: 0 };
  }

  try {
    const stats = await fs.stat(entryPath);
    return {
      name: dirent.name,
      path: entryPath,
      kind: 'file',
      size: stats.size,
      modificationTime: stats.mtime.toISOString(),
    };
  } catch (error) {
    if (isUnreadableError(error)) {
      return {
        name: dirent.name,
        path: entryPath,
        kind: 'unreadable',
        size: 0,
      };
    }
    throw error;
  }
}

export const filesystemAdapter: FileSystemPort = {
  async listChildren(dirPath: string): Promise<ListChildrenOutcome> {
    let dirents;
    try {
      dirents = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      if (isNotFoundError(error)) return { ok: false, reason: 'not_found' };
      if (isUnreadableError(error)) return { ok: false, reason: 'unreadable' };
      throw error;
    }

    const entries = await Promise.all(
      dirents.map((dirent) => toRawEntry(dirPath, dirent)),
    );

    return { ok: true, result: { entries } };
  },

  async listChildrenNames(dirPath: string): Promise<ListChildrenNamesOutcome> {
    let dirents;
    try {
      dirents = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      if (isNotFoundError(error)) return { ok: false, reason: 'not_found' };
      if (isUnreadableError(error)) return { ok: false, reason: 'unreadable' };
      throw error;
    }

    const entries = dirents.map((dirent) => ({
      name: dirent.name,
      kind: dirent.isSymbolicLink()
        ? ('symlink' as const)
        : dirent.isDirectory()
          ? ('directory' as const)
          : ('file' as const),
    }));

    return { ok: true, result: { entries } };
  },

  async pathExists(targetPath: string): Promise<boolean> {
    try {
      await fs.stat(targetPath);
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      // A transient/permission error isn't proof the path is gone — treat
      // it as "still there" rather than risk pruning a row over a blip.
      return true;
    }
  },
};
