import { NextRequest, NextResponse } from 'next/server';
import {
  listDirectory,
  type SortBy,
  type SortDir,
} from '@/application/count-and-size/list-directory';
import { filesystemAdapter } from '@/infrastructure/scanning/filesystem-adapter';
import { scanRepositoryAdapter } from '@/infrastructure/count-and-size/scan-repository-adapter';

const DEFAULT_LIMIT = 200;
const SORT_BY_VALUES: SortBy[] = [
  'name',
  'type',
  'size',
  'count',
  'status',
  'date',
];

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get('path');
  if (!path) {
    return NextResponse.json({ error: 'Missing path' }, { status: 400 });
  }

  const offset = Number(request.nextUrl.searchParams.get('offset') ?? '0');
  const limit = Number(
    request.nextUrl.searchParams.get('limit') ?? DEFAULT_LIMIT,
  );
  const sortByParam = request.nextUrl.searchParams.get('sortBy');
  const sortBy: SortBy = SORT_BY_VALUES.includes(sortByParam as SortBy)
    ? (sortByParam as SortBy)
    : 'name';
  const sortDir: SortDir =
    request.nextUrl.searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc';

  const outcome = await listDirectory(
    path,
    offset,
    limit,
    sortBy,
    sortDir,
    filesystemAdapter,
    scanRepositoryAdapter,
  );

  if (!outcome.ok) {
    return NextResponse.json(
      { error: 'Directory not found or unreadable' },
      { status: 404 },
    );
  }

  return NextResponse.json(outcome.result);
}
