import { NextRequest, NextResponse } from 'next/server';
import { getDirectoryStatus } from '@/application/count-and-size/get-directory-status';
import { scanRepositoryAdapter } from '@/infrastructure/count-and-size/scan-repository-adapter';

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path');
  if (!path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const view = getDirectoryStatus(path, scanRepositoryAdapter);
  return NextResponse.json(view);
}
