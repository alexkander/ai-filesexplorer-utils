import { NextRequest, NextResponse } from 'next/server';
import { listGroupOccurrences } from '@/application/duplicate-finder/list-group-occurrences';
import { isGroupKind } from '@/domain/duplicate-finder/duplicate-group';
import { duplicateRepositoryAdapter } from '@/infrastructure/duplicate-finder/duplicate-repository-adapter';

export async function GET(request: NextRequest) {
  const checksum = request.nextUrl.searchParams.get('checksum');
  const kindParam = request.nextUrl.searchParams.get('kind') ?? 'file';

  if (!checksum) {
    return NextResponse.json({ error: 'Missing checksum' }, { status: 400 });
  }
  if (!isGroupKind(kindParam)) {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  }

  const result = listGroupOccurrences(
    duplicateRepositoryAdapter,
    checksum,
    kindParam,
  );
  if (!result.found) {
    // The group is no longer part of the current result set — ignored away,
    // or replaced by a newer scan, between the page load and the click.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ paths: result.paths });
}
