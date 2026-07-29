import { NextRequest, NextResponse } from 'next/server';
import { checkRefreshScope } from '@/application/duplicate-finder/refresh-scope';
import { duplicateRepositoryAdapter } from '@/infrastructure/duplicate-finder/duplicate-repository-adapter';
import { duplicateScanWorker } from '@/infrastructure/duplicate-finder/duplicate-scan-worker';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { path?: string };
  const path = body.path?.trim();
  if (!path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const check = checkRefreshScope(duplicateRepositoryAdapter, path);
  if (check.outcome === 'refused') {
    return NextResponse.json({ error: check.reason }, { status: 409 });
  }

  const scanSeq = duplicateScanWorker.startRefresh(check.scopePath);

  // 202: it runs in the background like a full scan, and the client switches
  // to polling /status. `scanSeq` is unchanged on purpose — a refresh keeps
  // the rest of the result set.
  return NextResponse.json(
    { started: true, scopePath: check.scopePath, scanSeq },
    { status: 202 },
  );
}
