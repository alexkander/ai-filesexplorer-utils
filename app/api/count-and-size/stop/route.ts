import { NextRequest, NextResponse } from 'next/server';
import { stopScan } from '@/application/count-and-size/stop-scan';
import { scanRepositoryAdapter } from '@/infrastructure/count-and-size/scan-repository-adapter';
import { scanWorker } from '@/infrastructure/count-and-size/scan-worker';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { path?: string };
  if (!body.path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const result = stopScan(body.path, scanRepositoryAdapter, scanWorker);
  return NextResponse.json(result);
}
