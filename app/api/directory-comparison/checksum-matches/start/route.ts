import { NextRequest, NextResponse } from 'next/server';
import { getComparisonView } from '@/application/directory-comparison/get-comparison-view';
import {
  getCandidateNames,
  leftFileNamesFromEntries,
} from '@/application/directory-comparison/find-checksum-matches';
import { filesystemAdapter } from '@/infrastructure/scanning/filesystem-adapter';
import { comparisonRepositoryAdapter } from '@/infrastructure/directory-comparison/comparison-repository-adapter';
import { structuralScanWorker } from '@/infrastructure/directory-comparison/structural-scan-worker';
import { comparisonPassWorker } from '@/infrastructure/directory-comparison/comparison-pass-worker';
import { comparisonQueue } from '@/infrastructure/directory-comparison/comparison-queue';
import { countAndSizeReadonlyAdapter } from '@/infrastructure/directory-comparison/count-and-size-readonly-adapter';
import { checksumMatchWorker } from '@/infrastructure/directory-comparison/checksum-match-worker';

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

  const view = await getComparisonView(
    body.leftPath,
    body.rightPath,
    filesystemAdapter,
    comparisonRepositoryAdapter,
    structuralScanWorker.getActivePath(),
    comparisonPassWorker.getActivePath(),
    comparisonQueue.getActivePair(),
    countAndSizeReadonlyAdapter,
  );

  const { leftNames, rightNames } = getCandidateNames(view.entries);
  checksumMatchWorker.start(
    body.leftPath,
    body.rightPath,
    leftNames,
    rightNames,
    leftFileNamesFromEntries(view.entries),
  );

  return NextResponse.json({ accepted: true }, { status: 202 });
}
