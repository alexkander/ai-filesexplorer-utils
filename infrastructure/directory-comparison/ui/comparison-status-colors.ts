import type { EntryComparisonStatus } from '@/domain/directory-comparison/entry-comparison-result';

export const COMPARISON_STATUS_COLORS: Record<EntryComparisonStatus, string> = {
  not_compared: 'bg-gray-400 dark:bg-gray-500',
  matching: 'bg-green-500',
  differs: 'bg-red-500',
  only_left: 'bg-amber-500',
  only_right: 'bg-amber-500',
  scanning: 'bg-blue-500',
  error: 'bg-red-700',
};

export const COMPARISON_STATUS_LABELS: Record<EntryComparisonStatus, string> = {
  not_compared: 'Not compared',
  matching: 'Matching',
  differs: 'Differs',
  only_left: 'Only on this side',
  only_right: 'Only on this side',
  scanning: 'Scanning…',
  error: 'Error',
};
