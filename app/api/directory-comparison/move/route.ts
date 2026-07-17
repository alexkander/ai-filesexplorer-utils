import { NextRequest, NextResponse } from 'next/server';
import { moveEntry } from '@/application/directory-comparison/move-entry';
import { moveAdapter } from '@/infrastructure/directory-comparison/move-adapter';

const STATUS_BY_REASON: Record<string, number> = {
  source_not_found: 404,
  destination_exists: 409,
  unreadable: 500,
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    sourcePath?: string;
    destinationPath?: string;
  };
  if (!body.sourcePath || !body.destinationPath) {
    return NextResponse.json(
      { error: 'Missing sourcePath/destinationPath' },
      { status: 400 },
    );
  }

  const outcome = await moveEntry(
    body.sourcePath,
    body.destinationPath,
    moveAdapter,
  );

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.reason },
      { status: STATUS_BY_REASON[outcome.reason] ?? 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
