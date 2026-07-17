import { NextRequest, NextResponse } from 'next/server';
import { getComparisonView } from '@/application/directory-comparison/get-comparison-view';
import {
  findChecksumMatches,
  leftFileNamesFromEntries,
} from '@/application/directory-comparison/find-checksum-matches';
import { buildRenamePlan } from '@/domain/directory-comparison/build-rename-plan';
import { filesystemAdapter } from '@/infrastructure/scanning/filesystem-adapter';
import { comparisonRepositoryAdapter } from '@/infrastructure/directory-comparison/comparison-repository-adapter';
import { structuralScanWorker } from '@/infrastructure/directory-comparison/structural-scan-worker';
import { comparisonPassWorker } from '@/infrastructure/directory-comparison/comparison-pass-worker';
import { comparisonQueue } from '@/infrastructure/directory-comparison/comparison-queue';
import { countAndSizeReadonlyAdapter } from '@/infrastructure/directory-comparison/count-and-size-readonly-adapter';
import { checksumAdapter } from '@/infrastructure/directory-comparison/checksum-adapter';

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

  const matches = await findChecksumMatches(
    body.leftPath,
    body.rightPath,
    view.entries,
    checksumAdapter,
  );

  const plan = buildRenamePlan(matches, leftFileNamesFromEntries(view.entries));

  return NextResponse.json({ plan });
}
