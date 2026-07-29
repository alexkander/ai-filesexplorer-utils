import { NextRequest, NextResponse } from 'next/server';
import { startScan } from '@/application/duplicate-finder/start-scan';
import { duplicateRepositoryAdapter } from '@/infrastructure/duplicate-finder/duplicate-repository-adapter';
import { pathInspectionAdapter } from '@/infrastructure/duplicate-finder/path-inspection-adapter';
import { duplicateScanWorker } from '@/infrastructure/duplicate-finder/duplicate-scan-worker';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    rootPath?: string;
    includeFolders?: boolean;
  };
  const rootPath = body.rootPath?.trim();
  if (!rootPath) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const result = await startScan({
    rootPath,
    includeFolders: body.includeFolders === true,
    repository: duplicateRepositoryAdapter,
    pathInspection: pathInspectionAdapter,
    worker: duplicateScanWorker,
  });

  if (result.outcome === 'ok') {
    // 202: the scan is running in the background, the client polls /status.
    return NextResponse.json(
      { started: true, scanSeq: result.scanSeq },
      { status: 202 },
    );
  }
  if (result.outcome === 'already_running') {
    return NextResponse.json(
      { error: result.outcome, activePath: result.activePath },
      { status: 409 },
    );
  }
  return NextResponse.json({ error: result.outcome }, { status: 400 });
}
