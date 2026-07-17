export type ReadImageOutcome =
  | { ok: true; data: Buffer }
  | {
      ok: false;
      reason: 'not_found' | 'not_a_file' | 'too_large' | 'unreadable';
    };

/**
 * Reads a whole image file's bytes for the directory-comparison hover
 * thumbnail (spec: user request). No resizing/decoding — just the raw
 * file, scaled down by CSS on the frontend.
 */
export interface ThumbnailPort {
  readImageFile(path: string): Promise<ReadImageOutcome>;
}
