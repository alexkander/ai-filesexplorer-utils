// OOXML formats — Word/Excel/PowerPoint documents, templates, and macro-
// enabled variants — are all ZIP containers, and all are editable in place
// via Google Drive's browser "compatibility mode". Legacy binary formats
// (.doc/.xls/.ppt) use a different container (OLE2/CFB) and aren't in scope.
const OFFICE_CONTAINER_EXTENSIONS = new Set([
  '.docx',
  '.docm',
  '.dotx',
  '.dotm',
  '.xlsx',
  '.xlsm',
  '.xltx',
  '.xltm',
  '.pptx',
  '.pptm',
  '.potx',
  '.potm',
  '.ppsx',
  '.ppsm',
]);

/**
 * `true` for file extensions Google Drive can edit in place while keeping
 * the original OOXML/ZIP format ("Office compatibility mode") — the class of
 * files known to come back with a non-deterministically repackaged ZIP
 * container on every download (spec: user request — verified by downloading
 * the same live Drive file twice in a row and finding the two downloads
 * disagreed on nothing but each ZIP entry's embedded modified-time field).
 * Used to gate the container-content fallback comparison (research.md-style
 * decision, `compare-subtree.ts`): a raw-byte checksum mismatch on one of
 * these extensions isn't trustworthy proof of a real content difference the
 * way it is for every other file type.
 */
export function isOfficeContainerFormat(path: string): boolean {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return false;
  return OFFICE_CONTAINER_EXTENSIONS.has(path.slice(dot).toLowerCase());
}
