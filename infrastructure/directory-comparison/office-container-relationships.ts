interface RelationshipRecord {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

const RELATIONSHIP_TAG = /<Relationship\b([^>]*?)\/?>/g;

function extractAttr(attrs: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return match ? unescapeXmlAttr(match[1]) : null;
}

function unescapeXmlAttr(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Parses a `.rels` part's XML text into its `<Relationship>` records. `null`
 * (a "can't tell", never thrown) for anything that doesn't look like a
 * well-formed relationships part — every `Relationship` element found must
 * carry `Id`/`Type`/`Target`, or the whole file is treated as unparseable
 * rather than guessing.
 */
export function parseRelationships(xml: string): RelationshipRecord[] | null {
  const records: RelationshipRecord[] = [];
  RELATIONSHIP_TAG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RELATIONSHIP_TAG.exec(xml)) !== null) {
    const attrs = match[1];
    const id = extractAttr(attrs, 'Id');
    const type = extractAttr(attrs, 'Type');
    const target = extractAttr(attrs, 'Target');
    if (id === null || type === null || target === null) return null;
    records.push({
      id,
      type,
      target,
      external: extractAttr(attrs, 'TargetMode') === 'External',
    });
  }
  return records;
}

/**
 * A `.rels` part's own path determines the base directory its `Target`
 * values resolve against — the directory containing the part it describes
 * relationships *for* (OPC convention: `<dir>/_rels/<name>.rels` describes
 * `<dir>/<name>`; the package-level `_rels/.rels` describes the package
 * root, `<dir>` = `""`). Takes everything before the last `_rels/` segment,
 * which handles both cases uniformly.
 */
export function relationshipsBaseDir(relsEntryName: string): string {
  const index = relsEntryName.lastIndexOf('_rels/');
  return index === -1 ? '' : relsEntryName.slice(0, index);
}

/** Resolves a `.rels` `Target` value (relative to `baseDir`, or absolute if
 * it starts with `/`) against the ZIP's flat entry-name namespace, handling
 * `.`/`..` segments the way OPC (and URLs generally) do. */
export function resolveRelationshipTarget(
  baseDir: string,
  target: string,
): string {
  const combined = target.startsWith('/')
    ? target.slice(1)
    : baseDir
      ? `${baseDir}/${target}`
      : target;

  const resolved: string[] = [];
  for (const segment of combined.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join('/');
}

/**
 * Rebuilds a `.rels` part's content as a normalized string — one line per
 * relationship, `id|type|contentKey`, sorted — where `contentKey` is the
 * resolved target's own already-computed content digest (hex) rather than
 * its literal filename, and external targets (hyperlinks etc., not a zip
 * entry) key off the target string itself. This is what
 * `office-container-checksum.ts` hashes in place of a `.rels` entry's raw
 * bytes: Google Drive can renumber a document's media files between exports
 * (e.g. `image1.png` becoming `image2.png`) and rewrites every affected
 * `.rels` file's `Target` values to match — the relationship IDs referenced
 * from other parts (`r:embed="rId4"`) never change, only which filename
 * `rId4` happens to point at this export, so resolving through to content
 * makes the normalized form invariant to that renumbering while still
 * catching a genuine relationship-graph difference (added/removed/
 * retargeted-to-different-content relationship).
 *
 * `null` (never throws) if the part doesn't parse as a well-formed
 * relationships XML — the caller falls back to this entry's raw content
 * digest, same "can't tell" convention as the rest of this fallback.
 */
export function normalizedRelationshipsDigestInput(
  relsEntryName: string,
  relsXmlText: string,
  contentDigestHexByName: ReadonlyMap<string, string>,
): string | null {
  const relationships = parseRelationships(relsXmlText);
  if (relationships === null) return null;

  const baseDir = relationshipsBaseDir(relsEntryName);
  const lines = relationships.map((rel) => {
    if (rel.external) return `${rel.id}|${rel.type}|external:${rel.target}`;
    const resolvedName = resolveRelationshipTarget(baseDir, rel.target);
    const contentDigest = contentDigestHexByName.get(resolvedName);
    const contentKey =
      contentDigest !== undefined
        ? `content:${contentDigest}`
        : `unresolved:${resolvedName}`;
    return `${rel.id}|${rel.type}|${contentKey}`;
  });
  lines.sort();
  return lines.join('\n');
}
