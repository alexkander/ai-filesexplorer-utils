import './globals.css';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';
import { DashboardShell } from '@/infrastructure/ui/dashboard-shell';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={cn('font-sans', geist.variable)}>
      <body>
        <DashboardShell>{children}</DashboardShell>
      </body>
    </html>
  );
}
