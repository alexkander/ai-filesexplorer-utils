'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { menuEntries } from '@/domain/navigation/menu-entry';
import { findActiveEntry } from '@/domain/navigation/find-active-entry';
import { Header } from './header';
import { Sidebar } from './sidebar';

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeEntry = findActiveEntry(pathname, menuEntries);

  return (
    <div className="flex h-screen w-full flex-col">
      <Header activeEntry={activeEntry} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeEntry={activeEntry} />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
