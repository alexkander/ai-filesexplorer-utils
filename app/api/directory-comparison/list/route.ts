import { NextRequest, NextResponse } from 'next/server';
import { listDirectory } from '@/application/directory-comparison/list-directory';
import { filesystemAdapter } from '@/infrastructure/scanning/filesystem-adapter';
import { countAndSizeReadonlyAdapter } from '@/infrastructure/directory-comparison/count-and-size-readonly-adapter';

const DEFAULT_LIMIT = 200;

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path');
  if (!path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const offset = Number(request.nextUrl.searchParams.get('offset') ?? '0');
  const limit = Number(
    request.nextUrl.searchParams.get('limit') ?? DEFAULT_LIMIT,
  );

  const outcome = await listDirectory(
    path,
    offset,
    limit,
    filesystemAdapter,
    countAndSizeReadonlyAdapter,
  );

  if (!outcome.ok) {
    return outcome.reason === 'unreadable'
      ? NextResponse.json(
          { error: 'Directory could not be read' },
          { status: 403 },
        )
      : NextResponse.json({ error: 'Directory not found' }, { status: 404 });
  }

  return NextResponse.json(outcome.result);
}
