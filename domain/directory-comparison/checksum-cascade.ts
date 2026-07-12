export interface FileCascadeSide {
  size: number;
  partialChecksum: string | null;
  fullChecksum: string | null;
}

export interface FileCascadeInput {
  left: FileCascadeSide;
  right: FileCascadeSide;
}

export type CascadeStep =
  | { kind: 'need_partial' }
  | { kind: 'need_full' }
  | { kind: 'verdict'; result: 'matching' | 'differs' };

/**
 * Pure cascade decision (research.md Decision 3): given a file pair's
 * currently-known size/partial/full values (each side's partial/full
 * possibly not yet computed), returns either the next cheaper comparison
 * stage still needed, or a final verdict — short-circuiting at the first
 * proof of a difference. No I/O; callers own actually computing whatever
 * `ChecksumPort` value the returned step requires and calling this again.
 */
export function nextCascadeStep(input: FileCascadeInput): CascadeStep {
  const { left, right } = input;

  if (left.size !== right.size) return { kind: 'verdict', result: 'differs' };

  if (left.partialChecksum === null || right.partialChecksum === null) {
    return { kind: 'need_partial' };
  }
  if (left.partialChecksum !== right.partialChecksum) {
    return { kind: 'verdict', result: 'differs' };
  }

  if (left.fullChecksum === null || right.fullChecksum === null) {
    return { kind: 'need_full' };
  }
  if (left.fullChecksum !== right.fullChecksum) {
    return { kind: 'verdict', result: 'differs' };
  }

  return { kind: 'verdict', result: 'matching' };
}
