import { readFile, stat } from 'fs/promises';
import type {
  ReadImageOutcome,
  ThumbnailPort,
} from '@/application/directory-comparison/thumbnail-port';

// No resizing — served as-is and scaled down by CSS, which is fine for a
// hover preview but not for an arbitrarily large file (a misnamed RAW/TIFF,
// a multi-hundred-MB export). This cap is just a safety valve against
// that, not a real thumbnail size limit.
const MAX_THUMBNAIL_BYTES = 25 * 1024 * 1024;

export const thumbnailAdapter: ThumbnailPort = {
  async readImageFile(path): Promise<ReadImageOutcome> {
    let stats;
    try {
      stats = await stat(path);
    } catch {
      return { ok: false, reason: 'not_found' };
    }
    if (!stats.isFile()) return { ok: false, reason: 'not_a_file' };
    if (stats.size > MAX_THUMBNAIL_BYTES) {
      return { ok: false, reason: 'too_large' };
    }
    try {
      const data = await readFile(path);
      return { ok: true, data };
    } catch {
      return { ok: false, reason: 'unreadable' };
    }
  },
};
