'use client';

import { useState, type DragEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dragMimeType } from './drag-mime-types';

interface Segment {
  label: string;
  path: string;
}

function buildSegments(path: string): Segment[] {
  const segments: Segment[] = [{ label: '/', path: '/' }];
  if (path === '/') return segments;
  let current = '';
  for (const part of path.split('/').filter(Boolean)) {
    current = current === '' ? `/${part}` : `${current}/${part}`;
    segments.push({ label: part, path: current });
  }
  return segments;
}

function acceptsDrop(e: DragEvent): boolean {
  return (
    e.dataTransfer.types.includes(dragMimeType('left')) ||
    e.dataTransfer.types.includes(dragMimeType('right'))
  );
}

/**
 * Splits a pane's current path into clickable breadcrumb segments (spec:
 * user request) — replaces the old plain path label. Each segment is also
 * a drop target for the same file drag `ComparisonPane` starts (spec: user
 * request): dropping a file dragged from EITHER pane onto a segment moves
 * that file into the segment's directory, on whichever side the segment
 * belongs to — not restricted to cross-side only like the file-onto-file
 * rename, since moving something to an ancestor of its own pane is just as
 * natural a drop target as moving it across.
 */
export function BreadcrumbPath({
  path,
  className,
  onNavigate,
  onDropFile,
}: {
  path: string;
  className?: string;
  onNavigate: (path: string) => void;
  /** `draggedSide`/`draggedName` identify the file that was dropped — the
   * caller reconstructs its current absolute path itself (it already
   * tracks both panes' paths), same division of responsibility as
   * ComparisonPane's onRenameDrop. */
  onDropFile: (
    targetDirPath: string,
    draggedSide: 'left' | 'right',
    draggedName: string,
  ) => void;
}) {
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const segments = buildSegments(path);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm text-muted-foreground',
        className,
      )}
    >
      {segments.map((segment, index) => (
        <span key={segment.path} className="flex shrink-0 items-center">
          {index > 0 && (
            <span className="mx-0.5 text-muted-foreground/50">/</span>
          )}
          <button
            type="button"
            title={segment.path}
            onClick={() => onNavigate(segment.path)}
            onDragOver={(e) => {
              if (!acceptsDrop(e)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDragEnter={(e) => {
              if (!acceptsDrop(e)) return;
              setDragOverPath(segment.path);
            }}
            onDragLeave={(e) => {
              if (
                e.relatedTarget instanceof Node &&
                e.currentTarget.contains(e.relatedTarget)
              ) {
                return;
              }
              setDragOverPath((current) =>
                current === segment.path ? null : current,
              );
            }}
            onDrop={(e) => {
              setDragOverPath(null);
              const draggedSide = e.dataTransfer.types.includes(
                dragMimeType('left'),
              )
                ? 'left'
                : e.dataTransfer.types.includes(dragMimeType('right'))
                  ? 'right'
                  : null;
              if (!draggedSide) return;
              e.preventDefault();
              const draggedName = e.dataTransfer.getData(
                dragMimeType(draggedSide),
              );
              if (!draggedName) return;
              onDropFile(segment.path, draggedSide, draggedName);
            }}
            className={cn(
              'rounded px-1 py-0.5 whitespace-nowrap hover:bg-accent hover:text-foreground',
              index === segments.length - 1 && 'font-medium text-foreground',
              dragOverPath === segment.path &&
                'bg-accent text-foreground ring-2 ring-inset ring-primary/50',
            )}
          >
            {segment.label}
          </button>
        </span>
      ))}
      <button
        type="button"
        title="Copy full path"
        onClick={() => void handleCopy()}
        className="ml-1 shrink-0 text-muted-foreground hover:text-foreground"
      >
        {copied ? (
          <Check className="size-3.5" aria-label="Copied" />
        ) : (
          <Copy className="size-3.5" aria-label="Copy full path" />
        )}
      </button>
    </div>
  );
}
