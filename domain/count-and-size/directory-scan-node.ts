export type OwnOutcome = 'pending' | 'error' | 'stopped' | 'done';

export interface DirectoryScanNode {
  path: string;
  parentPath: string | null;
  depth: number;
  ownOutcome: OwnOutcome;
  directFileCount: number;
  directFileSize: number;
  hasUnreadableEntries: boolean;
  errorMessage: string | null;
  ownFinishedAt: string | null;
}
