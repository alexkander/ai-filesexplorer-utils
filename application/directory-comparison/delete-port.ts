export type DeleteOutcome =
  { ok: true } | { ok: false; reason: 'not_found' | 'unreadable' };

/**
 * Removes a file or directory (recursively) at `path` from its current
 * location by moving it into this tool's own trash folder
 * (`${MYFILES}/.ai-filesexplorer-utils-trash/<timestamp>/`) — a soft
 * delete, not a permanent one; see delete-adapter.ts. The spec for this
 * tool originally deferred any deletion action to a later feature
 * (`specs/003-checksum-registry/spec.md` "Safe-by-Default Destructive
 * Operations": never deletes/moves/overwrites/merges files); this port
 * exists because of an explicit user request to add one anyway, scoped to
 * exactly the "only on this side" case Copy already handles. Still a
 * destructive-feeling action from the entry's original location — callers
 * MUST confirm with the user before calling this.
 */
export interface DeletePort {
  delete(path: string): Promise<DeleteOutcome>;
}
