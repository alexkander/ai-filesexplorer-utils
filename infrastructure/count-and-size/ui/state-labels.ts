import type { DirectoryState } from '@/domain/count-and-size/derive-directory-view';

export const STATE_LABELS: Record<DirectoryState, string> = {
  not_scanned: 'Not scanned',
  scanning: 'Scanning…',
  completed: 'Completed',
  error: 'Error',
  stopped: 'Stopped',
};
