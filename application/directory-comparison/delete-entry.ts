import type { DeleteOutcome, DeletePort } from './delete-port';

/**
 * Deletes an "only on this side" entry (spec: user request, mirrors
 * copyEntry). No business logic of its own — the actual guard (this must
 * only ever be offered for an entry with no counterpart on the other side)
 * lives in the UI, same as Copy's destination-parent computation.
 */
export function deleteEntry(
  path: string,
  deletePort: DeletePort,
): Promise<DeleteOutcome> {
  return deletePort.delete(path);
}
