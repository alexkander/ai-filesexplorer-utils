export type CopyOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: 'source_not_found' | 'destination_exists' | 'unreadable';
    };

/**
 * Copies a file or directory (recursively) from `sourcePath` to
 * `destinationPath`, never overwriting anything — `destinationPath` MUST NOT
 * already exist (spec Assumptions: the only filesystem-writing action this
 * otherwise read-only tool offers is copying an entry that exists on only
 * one side to the other, never overwriting/merging/deleting).
 */
export interface CopyPort {
  copy(sourcePath: string, destinationPath: string): Promise<CopyOutcome>;
}
