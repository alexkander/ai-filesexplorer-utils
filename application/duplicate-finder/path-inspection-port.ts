export type PathKind = 'missing' | 'file' | 'directory' | 'unreadable';

/**
 * Tells the three rejections spec FR-004 requires apart, which the shared
 * `FileSystemPort` deliberately cannot: its `listChildren` maps both ENOENT
 * and ENOTDIR to `not_found`, so "that path is a file, not a directory" and
 * "that path does not exist" arrive as the same answer — and the user is
 * entitled to know which one it was.
 *
 * Kept as this feature's own single-capability port rather than a new method
 * on the shared one: no other tool needs the distinction today (Principle I),
 * and widening a shared interface for one consumer is what interface
 * segregation exists to prevent.
 */
export interface PathInspectionPort {
  inspect(path: string): Promise<PathKind>;
}
