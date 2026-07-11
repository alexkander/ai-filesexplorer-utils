import Link from 'next/link';
import { menuEntries, type MenuEntry } from '@/domain/navigation/menu-entry';
import { cn } from '@/lib/utils';

export function Sidebar({ activeEntry }: { activeEntry?: MenuEntry }) {
  return (
    <nav className="w-56 shrink-0 overflow-y-auto border-r p-4">
      <ul className="flex flex-col gap-1">
        {menuEntries.map((entry) => {
          const isActive = entry.key === activeEntry?.key;
          return (
            <li key={entry.key}>
              <Link
                href={entry.route}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-2 text-sm hover:bg-accent',
                  isActive && 'bg-accent font-medium',
                )}
              >
                {entry.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
