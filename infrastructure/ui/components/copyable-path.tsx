'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Click-to-copy path label, shared by Count and Size's and Directory
 * Comparison's path headers (user request) — copies the full path to the
 * clipboard and briefly swaps in "Copied!" as confirmation, since this app
 * has no toast/notification system otherwise.
 */
export function CopyablePath({
  path,
  className,
  title = 'Click to copy',
}: {
  path: string;
  className?: string;
  /** Overridable because a truncated path needs its full value on hover more
   * than it needs to be told it is clickable (user request). */
  title?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      title={title}
      className={cn('text-left font-mono hover:underline', className)}
    >
      {copied ? 'Copied!' : path}
    </button>
  );
}
