import { NextRequest, NextResponse } from 'next/server';
import { clearUnreliableSizeFile } from '@/application/directory-comparison/clear-unreliable-size-file';
import { comparisonRepositoryAdapter } from '@/infrastructure/directory-comparison/comparison-repository-adapter';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { path?: string };
  if (!body.path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  clearUnreliableSizeFile(body.path, comparisonRepositoryAdapter);
  return NextResponse.json({ ok: true });
}
