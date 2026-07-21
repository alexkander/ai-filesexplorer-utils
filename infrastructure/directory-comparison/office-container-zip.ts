const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;
const EOCD_FIXED_SIZE = 22;
// A ZIP's trailing comment (right after EOCD) can be up to 64 KiB — the
// signature has to be searched for within that whole window from the end.
const EOCD_MAX_COMMENT_SIZE = 0xffff;
const ZIP64_MARKER = 0xffffffff;

export interface CentralDirEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  localHeaderOffset: number;
}

function findEndOfCentralDirectory(buf: Buffer): number | null {
  const searchStart = Math.max(
    0,
    buf.length - EOCD_FIXED_SIZE - EOCD_MAX_COMMENT_SIZE,
  );
  for (let i = buf.length - EOCD_FIXED_SIZE; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return null;
}

// Deliberately bails (returns null) on anything Zip64 or otherwise
// unexpected — Office documents are always well within Zip64's size/count
// thresholds, so a real one only shows up as a hand-off signal to fall back
// to the ordinary whole-file comparison, never as "this file is fine but
// unsupported".
export function readCentralDirectory(
  buf: Buffer,
  eocdOffset: number,
): CentralDirEntry[] | null {
  const entryCount = buf.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buf.readUInt32LE(eocdOffset + 16);
  if (entryCount === 0xffff || centralDirOffset === ZIP64_MARKER) return null;

  const entries: CentralDirEntry[] = [];
  let offset = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buf.length) return null;
    if (buf.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) return null;

    const compressionMethod = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    if (compressedSize === ZIP64_MARKER || localHeaderOffset === ZIP64_MARKER) {
      return null;
    }

    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buf.length) return null;

    entries.push({
      name: buf.toString('utf8', nameStart, nameEnd),
      compressionMethod,
      compressedSize,
      localHeaderOffset,
    });
    offset = nameEnd + extraLength + commentLength;
  }
  return entries;
}

// Central directory sizes are authoritative (unlike the local header, which
// can defer them to a trailing data descriptor) — only the local header's
// variable-length name/extra fields are needed here, to find where this
// entry's compressed data actually starts.
export function readEntryData(
  buf: Buffer,
  entry: CentralDirEntry,
): Buffer | null {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buf.length) return null;
  if (buf.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE) return null;

  const nameLength = buf.readUInt16LE(offset + 26);
  const extraLength = buf.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buf.length) return null;

  return buf.subarray(dataStart, dataEnd);
}

export function findZipEntries(buf: Buffer): CentralDirEntry[] | null {
  const eocdOffset = findEndOfCentralDirectory(buf);
  if (eocdOffset === null) return null;
  return readCentralDirectory(buf, eocdOffset);
}
