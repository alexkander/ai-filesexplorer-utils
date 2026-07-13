import { NextRequest, NextResponse } from 'next/server';
import { stopComparison } from '@/application/directory-comparison/stop-comparison';
import { comparisonRepositoryAdapter } from '@/infrastructure/directory-comparison/comparison-repository-adapter';
import { structuralScanWorker } from '@/infrastructure/directory-comparison/structural-scan-worker';
import { comparisonPassWorker } from '@/infrastructure/directory-comparison/comparison-pass-worker';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    leftPath?: string;
    rightPath?: string;
  };
  if (!body.leftPath || !body.rightPath) {
    return NextResponse.json(
      { error: 'Missing leftPath/rightPath' },
      { status: 400 },
    );
  }

  const result = stopComparison(
    body.leftPath,
    body.rightPath,
    comparisonRepositoryAdapter,
    structuralScanWorker,
    comparisonPassWorker,
  );
  return NextResponse.json(result);
}
