import { NextRequest, NextResponse } from 'next/server';
import { deleteEntry } from '@/application/directory-comparison/delete-entry';
import { deleteAdapter } from '@/infrastructure/directory-comparison/delete-adapter';

const STATUS_BY_REASON: Record<string, number> = {
  not_found: 404,
  unreadable: 500,
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { path?: string };
  if (!body.path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const outcome = await deleteEntry(body.path, deleteAdapter);

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.reason },
      { status: STATUS_BY_REASON[outcome.reason] ?? 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
