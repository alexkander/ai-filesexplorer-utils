import { NextRequest, NextResponse } from 'next/server';
import {
  listDirectory,
  type SortBy,
  type SortDir,
} from '@/application/directory-comparison/list-directory';
import { filesystemAdapter } from '@/infrastructure/scanning/filesystem-adapter';
import { countAndSizeReadonlyAdapter } from '@/infrastructure/directory-comparison/count-and-size-readonly-adapter';
import { comparisonRepositoryAdapter } from '@/infrastructure/directory-comparison/comparison-repository-adapter';

const DEFAULT_LIMIT = 200;
const SORT_BY_VALUES: SortBy[] = ['name', 'type', 'size', 'count'];

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
    countAndSizeReadonlyAdapter,
    comparisonRepositoryAdapter,
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
