import { NextRequest, NextResponse } from 'next/server';
import { getComparisonView } from '@/application/directory-comparison/get-comparison-view';
import { filesystemAdapter } from '@/infrastructure/scanning/filesystem-adapter';
import { comparisonRepositoryAdapter } from '@/infrastructure/directory-comparison/comparison-repository-adapter';
import { structuralScanWorker } from '@/infrastructure/directory-comparison/structural-scan-worker';
import { comparisonPassWorker } from '@/infrastructure/directory-comparison/comparison-pass-worker';
import { comparisonQueue } from '@/infrastructure/directory-comparison/comparison-queue';
import { countAndSizeReadonlyAdapter } from '@/infrastructure/directory-comparison/count-and-size-readonly-adapter';

export async function GET(request: NextRequest) {
  const left = request.nextUrl.searchParams.get('left');
  const right = request.nextUrl.searchParams.get('right');
  if (!left || !right) {
    return NextResponse.json({ error: 'Missing left/right' }, { status: 400 });
  }

  const view = await getComparisonView(
    left,
    right,
    filesystemAdapter,
    comparisonRepositoryAdapter,
    structuralScanWorker.getActivePath(),
    comparisonPassWorker.getActivePath(),
    comparisonQueue.getActivePair(),
    countAndSizeReadonlyAdapter,
  );
  return NextResponse.json(view);
}
