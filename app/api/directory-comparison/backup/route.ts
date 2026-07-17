import { NextRequest, NextResponse } from 'next/server';
import { backupEntry } from '@/application/directory-comparison/backup-entry';
import { renameAdapter } from '@/infrastructure/directory-comparison/rename-adapter';

const STATUS_BY_REASON: Record<string, number> = {
  source_not_found: 404,
  destination_exists: 409,
  unreadable: 500,
};

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { path?: string };
  if (!body.path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const { outcome, backedUpAs } = await backupEntry(body.path, renameAdapter);

  if (!outcome.ok) {
    return NextResponse.json(
      { error: outcome.reason },
      { status: STATUS_BY_REASON[outcome.reason] ?? 500 },
    );
  }

  return NextResponse.json({ ok: true, backedUpAs });
}
