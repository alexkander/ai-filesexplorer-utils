export type ScanMode = 'incremental' | 'full';

export interface ScanStackEntry {
  path: string;
  mode: ScanMode;
  /** Only meaningful for mode: 'incremental' (research.md Decision 10).
   * Computed once per startScan(..., 'incremental') call and carried
   * unchanged through every child entry pushed while unwinding that run. */
  doneSet?: ReadonlySet<string>;
}

/**
 * Pure LIFO stack of pending scan entries (spec FR-013, FR-014). Intentionally
 * in-memory only — see research.md Decision 2 for why it isn't persisted.
 */
export class ScanStack {
  private items: ScanStackEntry[] = [];

  push(entry: ScanStackEntry): void {
    this.items.push(entry);
  }

  pop(): ScanStackEntry | undefined {
    return this.items.pop();
  }

  contains(path: string): boolean {
    return this.items.some((item) => item.path === path);
  }

  clear(): ScanStackEntry[] {
    const cleared = this.items;
    this.items = [];
    return cleared;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  get size(): number {
    return this.items.length;
  }
}
