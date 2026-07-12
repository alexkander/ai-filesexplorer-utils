export interface FileChecksumEntry {
  path: string;
  size: number;
  modificationTime: string; // ISO 8601
  partialChecksum: string | null;
  fullChecksum: string | null;
  checksummedAt: string | null; // ISO 8601
}
