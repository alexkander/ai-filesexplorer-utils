import type { MenuEntry } from './menu-entry';

export function findActiveEntry(
  pathname: string,
  entries: MenuEntry[],
): MenuEntry | undefined {
  return entries.find((entry) => entry.route === pathname);
}
