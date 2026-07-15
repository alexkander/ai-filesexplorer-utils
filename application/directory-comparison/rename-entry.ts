import type { RenameOutcome, RenamePort } from './rename-port';

/**
 * Renames the drop target to the dragged file's name (spec: user request,
 * mirrors copyEntry/deleteEntry). No business logic of its own — the
 * cross-side/file-only guard lives in the UI's drag-and-drop handlers.
 */
export function renameEntry(
  sourcePath: string,
  destinationPath: string,
  renamePort: RenamePort,
): Promise<RenameOutcome> {
  return renamePort.rename(sourcePath, destinationPath);
}
