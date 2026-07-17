// Shared by ComparisonPane's file-to-file drag-and-drop rename and
// BreadcrumbPath's drag-and-drop move — one MIME type per SOURCE side
// (rather than a single type with the side inside a JSON payload) so
// `onDragOver` can tell which side a drag came from just from
// `dataTransfer.types` — browsers withhold `getData` until the actual
// `drop` for security, so encoding the side in the type itself is the
// only way to gate hover feedback (and the `preventDefault` that allows a
// drop at all) before that point.
export function dragMimeType(sourceSide: 'left' | 'right'): string {
  return `application/x-directory-comparison-entry-${sourceSide}`;
}

export function otherSide(side: 'left' | 'right'): 'left' | 'right' {
  return side === 'left' ? 'right' : 'left';
}
