import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { inflateRawSync } from 'zlib';
import {
  findZipEntries,
  readEntryData,
  type CentralDirEntry,
} from './office-container-zip';
import { normalizedRelationshipsDigestInput } from './office-container-relationships';

const STORED = 0;
const DEFLATED = 8;

// `.rels` parts need their actual XML text (to parse `<Relationship>`
// elements out of it) — every other entry only ever needs to prove content
// equality, so its still-compressed bytes are enough (and cheaper: no
// inflate needed). `null` for anything not stored/deflated — vanishingly
// rare in an OOXML file, and unsupported here the same way Zip64 is: a
// hand-off to fall back to the ordinary whole-file comparison.
function decompressText(entry: CentralDirEntry, data: Buffer): string | null {
  if (entry.compressionMethod === STORED) return data.toString('utf8');
  if (entry.compressionMethod === DEFLATED) {
    try {
      return inflateRawSync(data).toString('utf8');
    } catch {
      return null;
    }
  }
  return null;
}

function isRelationshipsPart(entryName: string): boolean {
  return entryName.endsWith('.rels');
}

/**
 * SHA-256 over the *multiset of an OOXML file's ZIP entry contents*, with
 * every `.rels` part's own content replaced by a normalized form that
 * resolves each relationship's target to *what it points at* rather than
 * *what it's currently named* (see `office-container-relationships.ts`) —
 * rather than the file's raw bytes. Deliberately invariant to every
 * container-level and per-entry naming detail Google Drive is known to
 * rewrite on each export of a "compatibility mode" file: per-entry
 * timestamps, entry ordering, and outright renumbering of media parts
 * (`image1.png` becoming `image2.png` between two exports, with every
 * `.rels` referencing it rewritten to match) — while still requiring an
 * exact content match (with correct multiplicity) for everything else, and
 * an exact relationship-graph match (by content, not name) for the parts
 * that reference renumbered media. This is the fallback comparison for when
 * repackaging alone is why two files' raw-byte checksums disagree.
 *
 * Returns `null` (never throws) for anything that doesn't parse as a
 * well-formed non-Zip64 ZIP — an unreadable/corrupt/genuinely-not-a-zip file
 * is a "can't tell" answer, not a match.
 */
export async function computeOfficeContainerChecksum(
  path: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const buf = await readFile(path, { signal });
    const entries = findZipEntries(buf);
    if (entries === null || entries.length === 0) return null;

    const dataByName = new Map<string, Buffer>();
    const contentDigestHexByName = new Map<string, string>();
    for (const entry of entries) {
      const data = readEntryData(buf, entry);
      if (data === null) return null;
      dataByName.set(entry.name, data);
      contentDigestHexByName.set(
        entry.name,
        createHash('sha256').update(data).digest('hex'),
      );
    }

    const finalDigests: Buffer[] = [];
    for (const entry of entries) {
      if (!isRelationshipsPart(entry.name)) {
        finalDigests.push(
          Buffer.from(contentDigestHexByName.get(entry.name)!, 'hex'),
        );
        continue;
      }

      const text = decompressText(entry, dataByName.get(entry.name)!);
      const normalized =
        text === null
          ? null
          : normalizedRelationshipsDigestInput(
              entry.name,
              text,
              contentDigestHexByName,
            );
      finalDigests.push(
        createHash('sha256')
          .update(normalized ?? dataByName.get(entry.name)!)
          .digest(),
      );
    }
    finalDigests.sort(Buffer.compare);

    const hash = createHash('sha256');
    for (const digest of finalDigests) hash.update(digest);
    return hash.digest('hex');
  } catch {
    return null;
  }
}
