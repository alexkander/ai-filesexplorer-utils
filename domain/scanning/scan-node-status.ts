export type OwnOutcome = 'pending' | 'error' | 'stopped' | 'done';

/**
 * The subset of a persisted scan node's fields that generic traversal
 * logic (doneSet derivation, etc.) needs — independent of whatever
 * feature-specific payload (count/size, checksum, ...) a concrete node
 * type also carries.
 */
export interface ScanNodeStatus {
  path: string;
  parentPath: string | null;
  depth: number;
  ownOutcome: OwnOutcome;
  hasUnreadableEntries: boolean;
}
