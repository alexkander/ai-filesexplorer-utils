/** Human-readable size, e.g. "40.6 MB". Shown as the visible text. */
export function humanizeSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** Exact byte count, e.g. "42,592,198 B" — meant for a `title` tooltip. */
export function exactBytesLabel(bytes: number): string {
  return `${bytes.toLocaleString()} B`;
}
