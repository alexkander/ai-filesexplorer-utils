import { NextRequest, NextResponse } from 'next/server';
import { deleteDuplicate } from '@/application/duplicate-finder/delete-duplicate';
import { duplicateRepositoryAdapter } from '@/infrastructure/duplicate-finder/duplicate-repository-adapter';
import {
  fileDeletionAdapter,
  TRASH_ROOT,
} from '@/infrastructure/duplicate-finder/file-deletion-adapter';

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { path?: string; dryRun?: boolean };
  const path = body.path?.trim();
  if (!path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  // Deleting for real is opt-in: without an explicit `dryRun: false` this
  // endpoint only ever reports what it WOULD do (constitution Principle V).
  const dryRun = body.dryRun !== false;

  const result = await deleteDuplicate({
    repository: duplicateRepositoryAdapter,
    deletion: fileDeletionAdapter,
    trashRoot: TRASH_ROOT,
    path,
    dryRun,
  });

  if (result.outcome === 'refused') {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }

  return NextResponse.json({ outcome: result.outcome, plan: result.plan });
}
