import type { MoveOutcome, MovePort } from './move-port';

/**
 * Moves a file/directory to a different directory (spec: user request:
 * dragging a file from a pane onto a breadcrumb segment of either side's
 * path moves it into that directory) — no business logic of its own, the
 * confirmation prompt and refresh-after-move live in the UI layer, same
 * as copyEntry/deleteEntry/renameEntry.
 */
export function moveEntry(
  sourcePath: string,
  destinationPath: string,
  movePort: MovePort,
): Promise<MoveOutcome> {
  return movePort.move(sourcePath, destinationPath);
}
