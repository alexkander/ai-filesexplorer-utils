import { NextRequest, NextResponse } from 'next/server';
import { startScan } from '@/application/count-and-size/start-scan';
import { scanRepositoryAdapter } from '@/infrastructure/count-and-size/scan-repository-adapter';
import { scanWorker } from '@/infrastructure/count-and-size/scan-worker';
import type { ScanMode } from '@/domain/scanning/scan-stack';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { path?: string; mode?: string };
  if (!body.path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const mode: ScanMode = body.mode === 'full' ? 'full' : 'incremental';

  startScan(body.path, scanRepositoryAdapter, scanWorker, mode);
  return NextResponse.json({ accepted: true }, { status: 202 });
}
