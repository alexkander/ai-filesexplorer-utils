export type RenameOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: 'source_not_found' | 'destination_exists' | 'unreadable';
    };

/**
 * Renames a file at `sourcePath` to `destinationPath` (same directory,
 * different basename only) — never overwrites, `destinationPath` MUST NOT
 * already exist. Backs the drag-and-drop rename (spec: user request): drag
 * a file from one pane onto a file on the other pane to rename the DROP
 * TARGET to the dragged file's name — the dragged file itself is never
 * touched, only the one dropped on.
 */
export interface RenamePort {
  rename(sourcePath: string, destinationPath: string): Promise<RenameOutcome>;
}
