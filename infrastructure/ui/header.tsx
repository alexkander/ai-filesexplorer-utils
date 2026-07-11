import { APP_NAME } from '@/infrastructure/app-name';
import type { MenuEntry } from '@/domain/navigation/menu-entry';
import { HelpPopover } from './help-popover';

export function Header({ activeEntry }: { activeEntry?: MenuEntry }) {
  const title = activeEntry ? `${APP_NAME} — ${activeEntry.label}` : APP_NAME;

  return (
    <header className="flex h-12 w-full shrink-0 items-center justify-between border-b px-6">
      <span className="text-lg font-semibold">{title}</span>
      <div className="flex items-center gap-2">
        <HelpPopover />
      </div>
    </header>
  );
}
