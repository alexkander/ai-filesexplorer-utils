import type {
  DuplicateRepositoryPort,
  ScanPhase,
  ScanRunState,
} from './duplicate-repository-port';

export interface ScanStatusView {
  state: ScanRunState;
  phase: ScanPhase | null;
  rootPath: string | null;
  includeFolders: boolean;
  activePath: string | null;
  processed: number;
  total: number;
  unreadableCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  /** Groups in the current result set — what tells "no scan has been run
   * yet" (`state: 'idle'`) apart from "this scan found nothing" (spec
   * FR-022). */
  groupCount: number;
}

/**
 * Everything the status panel polls for (spec FR-006, FR-023). A plain read
 * of persisted state: the worker writes its progress to the database as it
 * goes, so this is correct even for a scan started before the last restart.
 */
export function getScanStatus(
  repository: DuplicateRepositoryPort,
): ScanStatusView {
  const state = repository.getScanState();
  return {
    state: state.state,
    phase: state.state === 'running' ? state.phase : null,
    rootPath: state.rootPath,
    includeFolders: state.includeFolders,
    activePath: state.activePath,
    processed: state.processed,
    total: state.total,
    unreadableCount: state.unreadableCount,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    errorMessage: state.errorMessage,
    groupCount: repository.countGroups(),
  };
}
