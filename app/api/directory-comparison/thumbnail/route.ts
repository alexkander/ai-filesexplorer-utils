import { NextRequest, NextResponse } from 'next/server';
import { getThumbnail } from '@/application/directory-comparison/get-thumbnail';
import { thumbnailAdapter } from '@/infrastructure/directory-comparison/thumbnail-adapter';

const STATUS_BY_REASON: Record<string, number> = {
  not_found: 404,
  not_a_file: 404,
  too_large: 413,
  unreadable: 403,
  unsupported_type: 415,
};

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path');
  if (!path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const outcome = await getThumbnail(path, thumbnailAdapter);
  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.reason },
      { status: STATUS_BY_REASON[outcome.reason] ?? 500 },
    );
  }

  return new NextResponse(new Uint8Array(outcome.data), {
    headers: {
      'Content-Type': outcome.mimeType,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
