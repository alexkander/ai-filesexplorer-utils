/** Short date+time to the minute, e.g. "2026-07-11 20:21", from an ISO 8601 string. */
export function formatDateTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}
