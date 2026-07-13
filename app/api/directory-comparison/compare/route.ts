import { NextRequest, NextResponse } from 'next/server';
import { startComparison } from '@/application/directory-comparison/start-comparison';
import { comparisonQueue } from '@/infrastructure/directory-comparison/comparison-queue';
import type { ScanMode } from '@/domain/scanning/scan-stack';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    leftPath?: string;
    rightPath?: string;
    mode?: string;
  };
  if (!body.leftPath || !body.rightPath) {
    return NextResponse.json(
      { error: 'Missing leftPath/rightPath' },
      { status: 400 },
    );
  }

  const mode: ScanMode = body.mode === 'full' ? 'full' : 'incremental';

  startComparison(body.leftPath, body.rightPath, comparisonQueue, mode);
  return NextResponse.json({ accepted: true }, { status: 202 });
}
