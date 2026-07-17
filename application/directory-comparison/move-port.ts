export type MoveOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: 'source_not_found' | 'destination_exists' | 'unreadable';
    };

/**
 * Moves a file or directory (recursively) from `sourcePath` to
 * `destinationPath` — unlike RenamePort (same directory, different
 * basename only), the destination can be in a completely different
 * directory, on either side (spec: user request — dragging a file onto a
 * breadcrumb segment moves it into that directory). Never overwrites;
 * `destinationPath` MUST NOT already exist.
 */
export interface MovePort {
  move(sourcePath: string, destinationPath: string): Promise<MoveOutcome>;
}
