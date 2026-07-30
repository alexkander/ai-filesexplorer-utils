import { NextRequest, NextResponse } from 'next/server';
import { setIgnored } from '@/application/duplicate-finder/set-ignored';
import { duplicateRepositoryAdapter } from '@/infrastructure/duplicate-finder/duplicate-repository-adapter';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { path?: string; ignored?: boolean };
  const path = body.path?.trim();
  if (!path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const counts = setIgnored(
    duplicateRepositoryAdapter,
    path,
    body.ignored !== false,
  );
  return NextResponse.json(counts);
}
