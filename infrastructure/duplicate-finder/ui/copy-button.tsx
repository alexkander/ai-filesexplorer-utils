'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/infrastructure/ui/components/button';

/**
 * Copies one value to the clipboard, showing a check mark for a moment as
 * confirmation (this app has no toast/notification system). Used twice per
 * occurrence row: once for the full path, once for the folder containing it
 * (user request) — the two differ only in what they are handed, so they share
 * one implementation rather than being two near-identical components.
 */
export function CopyButton({
  value,
  label,
  title,
}: {
  value: string;
  label: string;
  title: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={() => void handleClick()}
      title={copied ? 'Copied!' : title}
      aria-label={title}
    >
      {copied ? (
        <Check className="size-3" aria-hidden="true" />
      ) : (
        <Copy className="size-3" aria-hidden="true" />
      )}
      {label}
    </Button>
  );
}
