export interface MenuEntry {
  key: string;
  label: string;
  route: string;
}

export const menuEntries: MenuEntry[] = [
  { key: 'home', label: 'Home', route: '/' },
];
