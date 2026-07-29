import { isIgnored } from '@/domain/duplicate-finder/ignored-path-match';
import type { DuplicateRepositoryPort } from './duplicate-repository-port';
import type { PathInspectionPort } from './path-inspection-port';
import type { ScanWorkerPort } from './scan-worker-port';

export type StartScanOutcome =
  | { outcome: 'ok'; scanSeq: number }
  | { outcome: 'not_found' }
  | { outcome: 'not_a_directory' }
  | { outcome: 'unreadable' }
  | { outcome: 'root_ignored' }
  | { outcome: 'already_running'; activePath: string | null };

export interface StartScanParams {
  rootPath: string;
  includeFolders: boolean;
  repository: DuplicateRepositoryPort;
  pathInspection: PathInspectionPort;
  worker: ScanWorkerPort;
}

/**
 * Validates a scan request and starts it (spec FR-004, FR-008).
 *
 * Returns a discriminated outcome rather than throwing so the decision of
 * which rejection applies stays in the application layer, where the spec's
 * rules live, and the Route Handler is left with nothing to do but map an
 * outcome to a status code.
 */
export async function startScan(
  params: StartScanParams,
): Promise<StartScanOutcome> {
  const { rootPath, includeFolders, repository, pathInspection, worker } =
    params;

  // Checked first: a running scan makes every other check moot, and a
  // second request must never disturb it (spec FR-008).
  const state = repository.getScanState();
  if (state.state === 'running') {
    return { outcome: 'already_running', activePath: state.activePath };
  }

  const kind = await pathInspection.inspect(rootPath);
  if (kind === 'missing') return { outcome: 'not_found' };
  if (kind === 'file') return { outcome: 'not_a_directory' };
  if (kind === 'unreadable') return { outcome: 'unreadable' };

  // A root at or beneath an ignored path would scan to an empty result set
  // and look like "no duplicates" — say what actually happened instead
  // (spec Edge Cases).
  if (isIgnored(rootPath, repository.loadIgnoredPathSet())) {
    return { outcome: 'root_ignored' };
  }

  return { outcome: 'ok', scanSeq: worker.start(rootPath, includeFolders) };
}
