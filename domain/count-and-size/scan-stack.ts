/**
 * Pure LIFO stack of pending scan paths (spec FR-013, FR-014). Intentionally
 * in-memory only — see research.md Decision 2 for why it isn't persisted.
 */
export class ScanStack {
  private items: string[] = [];

  push(path: string): void {
    this.items.push(path);
  }

  pop(): string | undefined {
    return this.items.pop();
  }

  contains(path: string): boolean {
    return this.items.includes(path);
  }

  clear(): string[] {
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
