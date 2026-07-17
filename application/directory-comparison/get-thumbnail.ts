import type { ThumbnailPort } from './thumbnail-port';

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon',
};

export function imageMimeTypeFor(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? (MIME_TYPE_BY_EXTENSION[ext] ?? null) : null;
}

export type GetThumbnailOutcome =
  | { ok: true; data: Buffer; mimeType: string }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_a_file'
        | 'too_large'
        | 'unreadable'
        | 'unsupported_type';
    };

/**
 * Backs the directory-comparison hover thumbnail (spec: user request):
 * hovering a file's name shows a small preview if it looks like an image.
 * Rejects by extension before ever touching the filesystem — no
 * image-format sniffing, just the same trust-the-extension approach the
 * rest of this app already takes for file kind.
 */
export async function getThumbnail(
  path: string,
  thumbnailPort: ThumbnailPort,
): Promise<GetThumbnailOutcome> {
  const mimeType = imageMimeTypeFor(path);
  if (!mimeType) return { ok: false, reason: 'unsupported_type' };

  const outcome = await thumbnailPort.readImageFile(path);
  if (!outcome.ok) return outcome;
  return { ok: true, data: outcome.data, mimeType };
}
