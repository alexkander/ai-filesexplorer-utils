import { NextRequest, NextResponse } from 'next/server';
import { setIgnored } from '@/application/directory-comparison/set-ignored';
import { comparisonRepositoryAdapter } from '@/infrastructure/directory-comparison/comparison-repository-adapter';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { path?: string; ignored?: boolean };
  if (!body.path || typeof body.ignored !== 'boolean') {
    return NextResponse.json(
      { error: 'Missing path/ignored' },
      { status: 400 },
    );
  }

  setIgnored(body.path, body.ignored, comparisonRepositoryAdapter);
  return NextResponse.json({ ok: true });
}
